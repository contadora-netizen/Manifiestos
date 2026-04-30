"""
Declaraciones de Importación — Backend
Lógica:
  1. Recibe factura (PDF/Excel/imagen)
  2. Extrae productos con Gemini AI
  3. Busca en Google Drive (carpeta MANIFIESTOS) los PDFs más recientes por proveedor
  4. Indexa el texto de cada declaración y busca coincidencias exactas de referencia/EAN
  5. Por cada proveedor con match: toma las 2 páginas (pág 1 + pág 2) de esa declaración
  6. Une todo en un solo PDF y lo devuelve
"""
import os, re, json, base64, tempfile, datetime, io
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
import pdfplumber
from pypdf import PdfReader, PdfWriter
import google.generativeai as genai

app = Flask(__name__)
CORS(app)

# ── Constantes ───────────────────────────────────────────────────────────────
MANIFIESTOS_FOLDER_ID = "1REBnSu-CJbOqrbhyKi6wfNSl2PPAaPhL"
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
genai.configure(api_key=GEMINI_API_KEY)

# ── Helper Drive via MCP-like calls ──────────────────────────────────────────
# En Claude Code el usuario tiene Google Drive conectado.
# El backend necesita un token OAuth; en producción se pasa via env var.
# Aquí usamos la API de Google Drive directamente con las credenciales del usuario.

import urllib.request, urllib.parse, ssl
from concurrent.futures import ThreadPoolExecutor, as_completed

def drive_request(path, token):
    """Hace una petición GET a Google Drive API v3."""
    sep = "&" if "?" in path else "?"
    url = f"https://www.googleapis.com/drive/v3/{path}{sep}supportsAllDrives=true&includeItemsFromAllDrives=true"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    ctx = ssl.create_default_context()
    with urllib.request.urlopen(req, context=ctx) as resp:
        return json.loads(resp.read())

def drive_download(file_id, token):
    """Descarga contenido binario de un archivo Drive."""
    url = f"https://www.googleapis.com/drive/v3/files/{file_id}?alt=media&supportsAllDrives=true"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    ctx = ssl.create_default_context()
    with urllib.request.urlopen(req, context=ctx) as resp:
        return resp.read()

def get_subfolders(folder_id, token):
    """Lista subcarpetas de una carpeta Drive."""
    q = urllib.parse.quote(f"'{folder_id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false")
    data = drive_request(f"files?q={q}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime%20desc&pageSize=100", token)
    return data.get("files", [])

def get_pdfs_in_folder(folder_id, token):
    """Lista PDFs en una carpeta, ordenados por fecha de modificación desc."""
    q = urllib.parse.quote(f"'{folder_id}' in parents and mimeType = 'application/pdf' and trashed = false")
    data = drive_request(f"files?q={q}&fields=files(id,name,modifiedTime,size)&orderBy=modifiedTime%20desc&pageSize=50", token)
    return data.get("files", [])


# ── Extracción de texto de declaración ──────────────────────────────────────
def extract_declaration_text(pdf_bytes):
    """Extrae todo el texto de un PDF de declaración."""
    reader = PdfReader(io.BytesIO(pdf_bytes))
    text = ""
    for page in reader.pages:
        t = page.extract_text() or ""
        text += t + "\n"
    return text

def parse_referencias_from_declaration(text):
    """
    Extrae referencias y EAN de una declaración DIAN.
    Patrones identificados:
      - REFERENCIA: OCT-JK42234C-ROSA
      - REFERENCIA/CODIGO: PTE-TE44
      - CODIGO DE BARRAS EAN: 7901000070457
      - CODIGO DE BARRAS: 7592325120448
    Retorna set de strings normalizados (uppercase, sin espacios).
    """
    refs = set()
    
    # Referencias alfanuméricas
    for m in re.finditer(r'REFERENCIA(?:/CODIGO)?[:\s]+([A-Z0-9][A-Z0-9\-\.\/]+)', text, re.IGNORECASE):
        refs.add(m.group(1).strip().upper())
    
    # Códigos de barras EAN (7-14 dígitos)
    for m in re.finditer(r'CODIGO DE BARRAS(?:\s+EAN)?[:\s]+(\d{7,14})', text, re.IGNORECASE):
        refs.add(m.group(1).strip())
    
    # Datos según factura (campo "DATOS SEGUN FACTURA: OCT-K80456L ...")
    for m in re.finditer(r'DATOS SEGUN FACTURA[:\s]+([A-Z0-9][A-Z0-9\-\.\/]+)', text, re.IGNORECASE):
        val = m.group(1).strip().upper()
        # Solo tomar la parte antes del primer espacio
        refs.add(val.split()[0] if ' ' in val else val)
    
    return refs

def find_matching_pages(pdf_bytes, search_terms, already_matched=None):
    """
    Busca declaraciones DIAN que contengan alguno de los términos buscados.
    already_matched: set de términos ya encontrados en PDFs anteriores (para no duplicar).
    Retorna (page_indices, newly_matched_terms).
    """
    if already_matched is None:
        already_matched = set()
    reader = PdfReader(io.BytesIO(pdf_bytes))
    n = len(reader.pages)
    page_texts = [(page.extract_text() or "").upper() for page in reader.pages]

    decl_starts = [i for i, txt in enumerate(page_texts)
                   if "DECLARACI" in txt and "IMPORTACI" in txt and "500" in txt]
    if not decl_starts:
        decl_starts = list(range(0, n, 2))

    matched_page_indices = []
    newly_matched = set()

    for start in decl_starts:
        combined = page_texts[start]
        if start + 1 < n:
            combined += "\n" + page_texts[start + 1]
        for term in search_terms:
            term_norm = term.upper().strip()
            if (term_norm and len(term_norm) >= 5
                    and not term_norm.isdigit()
                    and term_norm not in already_matched
                    and term_norm not in newly_matched
                    and term_norm in combined):
                newly_matched.add(term_norm)
                matched_page_indices.extend([start, start + 1] if start + 1 < n else [start])
                break

    return sorted(set(matched_page_indices)), newly_matched


# ── Extracción de productos de la factura ────────────────────────────────────
def extract_invoice_pdf_text(pdf_bytes):
    """Extrae texto de la factura agrupando palabras por línea según coordenadas Y."""
    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            all_lines = []
            for page in pdf.pages:
                words = page.extract_words(x_tolerance=3, y_tolerance=3)
                if not words:
                    t = page.extract_text()
                    if t:
                        all_lines.append(t)
                    continue
                # Agrupar palabras por línea (mismo Y aprox)
                from collections import defaultdict
                lines = defaultdict(list)
                for w in words:
                    y_key = round(w["top"] / 4) * 4  # agrupar por bloques de 4pt
                    lines[y_key].append(w)
                for y_key in sorted(lines.keys()):
                    row_words = sorted(lines[y_key], key=lambda w: w["x0"])
                    line_text = "  ".join(w["text"] for w in row_words)
                    all_lines.append(line_text)
            return "\n".join(all_lines)
    except Exception:
        reader = PdfReader(io.BytesIO(pdf_bytes))
        return "\n".join(p.extract_text() or "" for p in reader.pages)


def build_search_variants(reference):
    """
    Genera variantes de búsqueda desde una referencia de producto ALUMAR.
    Siempre incluye la referencia original (>= 5 chars).
    Las variantes derivadas (más cortas) requieren >= 6 chars para evitar falsos positivos.
    """
    if not reference or len(reference) < 4:
        return set()
    ref = reference.upper().strip()
    primary = {ref} if len(ref) >= 5 and not ref.isdigit() else set()
    derived = set()
    parts = ref.split('-')
    if len(parts) >= 2:
        v1 = '-'.join(parts[1:])
        v2 = '-'.join(parts[:-1])
        if '-' in v1: derived.add(v1)
        if '-' in v2: derived.add(v2)
        if len(parts) >= 3:
            v3 = '-'.join(parts[1:-1])
            if '-' in v3: derived.add(v3)
        # Solo para sufijos cortos (≤5 dígitos): agregar/quitar un cero inicial
        # Ej: TAATI-19406 → TAATI-019406. NO tocar 007293, 008026, etc.
        last = parts[-1]
        if last.isdigit() and len(last) <= 5:
            padded = last.zfill(len(last) + 1)
            derived.add('-'.join(parts[:-1] + [padded]))
        if last.startswith('0') and last[1:].isdigit() and len(last) <= 6:
            stripped = last.lstrip('0') or '0'
            if stripped != last:
                derived.add('-'.join(parts[:-1] + [stripped]))
    filtered_derived = {v for v in derived if len(v) >= 6 and not v.isdigit()}
    return primary | filtered_derived


def extract_products_with_ai(invoice_text):
    """Usa Gemini para extraer referencias de producto desde la factura de ALUMAR."""
    model = genai.GenerativeModel("gemini-2.0-flash")

    prompt = f"""Eres un experto en facturas de ALUMAR S.A.S., empresa colombiana importadora de productos para el hogar.

TEXTO DE FACTURA (columnas separadas por |):
{invoice_text[:8000]}

TAREA: Extrae TODOS los productos de la factura. La columna "Referencia" contiene los códigos de producto de ALUMAR, que son exactamente los que aparecen en las declaraciones de importación DIAN.

REGLAS:
- Extrae la columna "Referencia" o "REF" de cada fila de producto (ej: AATI-007293, TAATI-006075, OCT-ZY70220-PY7, MTE-G54, N6225, OX-002959)
- INCLUIR todas las referencias alfanuméricas con o sin guiones
- IGNORAR solo: líneas de flete, descuento, impuesto, totales — que no tienen referencia de producto
- NO ignorar ningún código de producto por su formato
- IMPORTANTE: el texto puede tener errores de OCR. Corrige caracteres confundidos: 0↔O, 1↔I, 6↔G. Ej: "0O6X0-002959" debe leerse como "OX-002959", "0CT-PLYG" como "OCT-PLYG"

Responde ÚNICAMENTE JSON válido (sin bloques de código, sin texto adicional):
{{
  "productos": [
    {{
      "descripcion": "descripción del producto",
      "referencia": "código exacto de la columna Referencia",
      "ean": ""
    }}
  ],
  "numero_factura": "número de factura"
}}"""

    response = model.generate_content(prompt)
    text = response.text.strip()
    # Extraer bloque JSON robusto: buscar desde el primer { hasta el último }
    start = text.find('{')
    end = text.rfind('}')
    if start != -1 and end != -1 and end > start:
        text = text[start:end+1]
    return json.loads(text)


# ── API Endpoints ─────────────────────────────────────────────────────────────

@app.route("/api/health")
def health():
    return jsonify({"ok": True, "ts": datetime.datetime.now().isoformat()})


@app.route("/api/debug-invoice", methods=["POST"])
def debug_invoice():
    """Diagnóstico: muestra el texto extraído de la factura y lo que devuelve la IA."""
    if "invoice" not in request.files:
        return jsonify({"error": "Falta archivo invoice"}), 400
    invoice_bytes = request.files["invoice"].read()
    extracted_text = extract_invoice_pdf_text(invoice_bytes)
    try:
        # Llamar con el texto ya extraído
        gemini_model = genai.GenerativeModel("gemini-2.0-flash")
        prompt = f"""Eres un experto en facturas de importación colombianas de ALUMAR S.A.S.
Analiza este texto de factura y extrae los productos con su referencia del PROVEEDOR EXTERNO.

TEXTO DE FACTURA (columnas separadas por |):
{extracted_text[:8000]}

REGLAS CRÍTICAS para identificar la referencia del proveedor:
- Las referencias del proveedor tienen formato como: OCT-DKC5015D-G, PTE-TE44, AW30927-014, KC79317F-BL, ST147
- Suelen estar en columnas llamadas "REF", "REFERENCIA", "CODIGO", "SKU", "ITEM"
- IGNORAR códigos internos de Alumar: comienzan con números (01..., 02...) o son palabras sueltas (UZFEL, FLETE)
- IGNORAR líneas de flete, descuento, impuesto — no son productos

Responde ÚNICAMENTE JSON válido (sin bloques de código, sin texto adicional):
{{
  "productos": [
    {{
      "descripcion": "descripción del producto",
      "referencia": "referencia exacta del proveedor"
    }}
  ],
  "numero_factura": "número de factura"
}}"""
        response = gemini_model.generate_content(prompt)
        ai_raw = response.text.strip()
        start = ai_raw.find('{')
        end = ai_raw.rfind('}')
        ai_json = json.loads(ai_raw[start:end+1]) if start != -1 else {}
    except Exception as e:
        ai_json = {"error": str(e)}
        ai_raw = ""
    return jsonify({
        "texto_extraido": extracted_text[:5000],
        "ai_resultado": ai_json,
        "ai_raw": ai_raw[:2000]
    })


@app.route("/api/process", methods=["POST"])
def process_invoice():
    """
    Endpoint principal.
    Recibe: factura PDF + token OAuth de Google Drive
    Devuelve: PDF con las declaraciones correspondientes
    """
    token = request.form.get("drive_token", "")
    if not token:
        return jsonify({"error": "Se requiere token de Google Drive (drive_token)"}), 400
    
    if "invoice" not in request.files:
        return jsonify({"error": "Se requiere archivo de factura (invoice)"}), 400
    
    invoice_file = request.files["invoice"]
    invoice_bytes = invoice_file.read()
    invoice_name = invoice_file.filename
    
    # 1. Extraer texto de la factura
    try:
        invoice_text = extract_invoice_pdf_text(invoice_bytes)
    except Exception as e:
        return jsonify({"error": f"No se pudo leer la factura: {str(e)}"}), 400
    
    if not invoice_text.strip():
        return jsonify({"error": "La factura no tiene texto extraíble"}), 400
    
    # 2. Extraer productos con IA
    print("=" * 60)
    print("TEXTO EXTRAÍDO (primeros 1000 chars):")
    print(invoice_text[:1000])
    print("=" * 60)
    try:
        invoice_data = extract_products_with_ai(invoice_text)
    except Exception as e:
        print(f"ERROR AI: {e}")
        return jsonify({"error": f"Error extrayendo productos: {str(e)}"}), 500

    print("RESULTADO AI:", json.dumps(invoice_data, ensure_ascii=False)[:500])
    productos = invoice_data.get("productos", [])
    if not productos:
        return jsonify({"error": "No se encontraron productos en la factura"}), 400
    
    # Construir set de términos de búsqueda con variantes
    search_terms = set()
    for p in productos:
        if p.get("referencia"):
            search_terms.update(build_search_variants(p["referencia"]))
        if p.get("ean") and len(p["ean"].strip()) >= 8:
            search_terms.add(p["ean"].strip())

    print("=" * 60)
    print("PRODUCTOS EXTRAÍDOS DE LA FACTURA:")
    for p in productos:
        print(f"  - {p}")
    print(f"TÉRMINOS DE BÚSQUEDA: {search_terms}")
    print("=" * 60)
    
    # 3. Obtener subcarpetas de MANIFIESTOS (una por proveedor)
    try:
        supplier_folders = get_subfolders(MANIFIESTOS_FOLDER_ID, token)
        print(f"DEBUG carpetas encontradas en process: {len(supplier_folders)}")
    except Exception as e:
        print(f"DEBUG error get_subfolders: {e}")
        return jsonify({"error": f"Error accediendo a Drive: {str(e)}"}), 500

    # 4. Para cada carpeta de proveedor en paralelo: buscar matches
    matched_declarations = []
    search_log = []

    def check_folder(folder):
        folder_name = folder["name"]
        folder_id = folder["id"]
        try:
            pdfs = get_pdfs_in_folder(folder_id, token)
            print(f"  [{folder_name}] PDFs: {len(pdfs)}")
        except Exception as e:
            print(f"  [{folder_name}] ERROR get_pdfs: {e}")
            return None
        if not pdfs:
            return None
        # Buscar en múltiples PDFs de la carpeta, acumulando matches
        # PDFs ya vienen ordenados de más reciente a más antiguo → primer match = importación más reciente
        folder_matched_terms = set()
        folder_pdfs_results = []
        consecutive_misses = 0
        found_any = False
        for pdf_meta in pdfs:
            remaining = {t for t in search_terms if t not in folder_matched_terms}
            if not remaining:
                break
            # Salida rápida: carpeta irrelevante (3 PDFs sin ningún match)
            if not found_any and consecutive_misses >= 3:
                break
            # Salida después de match: 2 PDFs consecutivos sin match nuevo
            if found_any and consecutive_misses >= 2:
                break
            try:
                pdf_bytes = drive_download(pdf_meta["id"], token)
            except Exception as e:
                print(f"  [{folder_name}] ERROR download: {e}")
                consecutive_misses += 1
                continue
            matched_pages, newly_matched = find_matching_pages(pdf_bytes, remaining, folder_matched_terms)
            if matched_pages:
                print(f"  [{folder_name}] MATCH en {pdf_meta['name']} — {newly_matched}")
                folder_matched_terms.update(newly_matched)
                folder_pdfs_results.append({
                    "archivo": pdf_meta["name"],
                    "paginas_match": matched_pages,
                    "pdf_bytes": pdf_bytes,
                    "matched_terms": newly_matched,
                    "date": pdf_meta.get("modifiedTime", ""),
                })
                consecutive_misses = 0
                found_any = True
            else:
                consecutive_misses += 1
        if not folder_pdfs_results:
            return None
        return {
            "proveedor": folder_name,
            "pdfs": folder_pdfs_results,
            "log": {"proveedor": folder_name, "archivos": [r["archivo"] for r in folder_pdfs_results], "estado": "✓ match"}
        }

    with ThreadPoolExecutor(max_workers=16) as executor:
        futures = {executor.submit(check_folder, f): f for f in supplier_folders}
        for future in as_completed(futures):
            result = future.result()
            if result:
                log_entry = result.pop("log")
                matched_declarations.append(result)
                search_log.append(log_entry)

    if not matched_declarations:
        return jsonify({
            "error": "No se encontraron declaraciones con los productos de esta factura",
            "productos_buscados": list(search_terms),
            "log": search_log
        }), 404

    # 5. Construir PDF final con deduplicación global
    # Recopilar todos los PDF results y ordenar por fecha desc (más reciente primero)
    all_pdf_results = []
    for decl in matched_declarations:
        for pdf_result in decl["pdfs"]:
            all_pdf_results.append({"proveedor": decl["proveedor"], **pdf_result})
    all_pdf_results.sort(key=lambda x: x.get("date", ""), reverse=True)

    global_matched = set()
    writer = PdfWriter()
    resumen = []

    for pdf_result in all_pdf_results:
        # Solo incluir si aporta al menos un término nuevo globalmente
        new_terms = pdf_result["matched_terms"] - global_matched
        if not new_terms:
            print(f"  SKIP (duplicado): {pdf_result['archivo']} — términos ya cubiertos")
            continue
        global_matched.update(new_terms)
        reader = PdfReader(io.BytesIO(pdf_result["pdf_bytes"]))
        pages_added = 0
        for idx in pdf_result["paginas_match"]:
            if idx < len(reader.pages):
                writer.add_page(reader.pages[idx])
                pages_added += 1
        print(f"  INCLUIDO: {pdf_result['archivo']} ({pages_added} págs) — {new_terms}")
        resumen.append({
            "proveedor": pdf_result["proveedor"],
            "archivo": pdf_result["archivo"],
            "paginas_incluidas": pages_added
        })
    
    # Guardar PDF
    output = io.BytesIO()
    writer.write(output)
    output.seek(0)
    
    fecha_str = datetime.date.today().strftime("%Y%m%d")
    filename = f"declaraciones_{invoice_name.replace('.pdf','').replace(' ','_')}_{fecha_str}.pdf"
    
    # Devolver como archivo con header de metadata
    response = send_file(
        output,
        mimetype="application/pdf",
        as_attachment=True,
        download_name=filename
    )
    response.headers["X-Resumen"] = json.dumps(resumen)
    response.headers["X-Productos-Buscados"] = json.dumps(list(search_terms)[:20])
    return response


@app.route("/api/preview", methods=["POST"])
def preview_invoice():
    """
    Preview: extrae productos de la factura y muestra qué encontraría,
    sin descargar PDFs completos (más rápido para validar antes de procesar).
    """
    token = request.form.get("drive_token", "")
    if not token:
        return jsonify({"error": "Se requiere token de Google Drive"}), 400
    
    if "invoice" not in request.files:
        return jsonify({"error": "Se requiere archivo de factura"}), 400
    
    invoice_bytes = request.files["invoice"].read()
    
    try:
        invoice_text = extract_invoice_pdf_text(invoice_bytes)
        invoice_data = extract_products_with_ai(invoice_text)
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    
    # Lista de proveedores en Drive
    try:
        folders = get_subfolders(MANIFIESTOS_FOLDER_ID, token)
        proveedores_disponibles = [{"nombre": f["name"], "ultima_actualizacion": f.get("modifiedTime","")} for f in folders]
    except Exception as e:
        proveedores_disponibles = []
    
    return jsonify({
        "factura": {
            "numero": invoice_data.get("numero_factura"),
            "proveedor": invoice_data.get("proveedor_principal"),
            "productos": invoice_data.get("productos", [])
        },
        "terminos_busqueda": list({
            t for p in invoice_data.get("productos", [])
            for t in [p.get("referencia",""), p.get("ean","")]
            if t
        }),
        "proveedores_en_drive": proveedores_disponibles
    })


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5050))
    debug = os.environ.get("FLASK_ENV") != "production"
    app.run(debug=debug, port=port, host="0.0.0.0")
