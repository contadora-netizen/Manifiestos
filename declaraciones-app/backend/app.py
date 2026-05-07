"""
Declaraciones de Importación — Backend
Lógica:
  1. Recibe factura PDF
  2. Extrae productos con Gemini AI
  3. Se autentica en Google Drive con Service Account (sin token manual)
  4. Busca en carpeta MANIFIESTOS las declaraciones DIAN más recientes
  5. Devuelve PDF con las páginas que coinciden
"""
import os, re, json, datetime, io
from dotenv import load_dotenv
load_dotenv()  # Carga variables desde backend/.env automáticamente
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
import pdfplumber
from pypdf import PdfReader, PdfWriter
from groq import Groq
from google.oauth2 import service_account
import google.auth.transport.requests
import urllib.request, urllib.parse, ssl
from concurrent.futures import ThreadPoolExecutor, as_completed

app = Flask(__name__)
CORS(app, expose_headers=["X-Resumen", "X-No-Encontrados", "X-Productos-Buscados", "X-Cache-Update", "Content-Disposition"])

# ── Constantes ────────────────────────────────────────────────────────────────
MANIFIESTOS_FOLDER_ID = "1REBnSu-CJbOqrbhyKi6wfNSl2PPAaPhL"
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
groq_client = Groq(api_key=GROQ_API_KEY)

# ── Service Account — autenticación automática con Google Drive ───────────────
_sa_credentials = None

def get_drive_token():
    """
    Obtiene (y cachea) un token Bearer para Google Drive usando la cuenta de servicio.
    Se refresca automáticamente cuando expira.
    """
    global _sa_credentials

    sa_json_str = (
        os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON")
        or os.environ.get("JSON_DE_CUENTA_DE_SERVICIO_DE_GOOGLE")
        or ""
    )
    if not sa_json_str:
        raise Exception(
            "Variable GOOGLE_SERVICE_ACCOUNT_JSON no configurada. "
            "Ve a Railway → Variables y agrega las credenciales JSON de la cuenta de servicio."
        )

    if _sa_credentials is None or not _sa_credentials.valid:
        sa_info = json.loads(sa_json_str)
        _sa_credentials = service_account.Credentials.from_service_account_info(
            sa_info,
            scopes=["https://www.googleapis.com/auth/drive.readonly"]
        )
        req = google.auth.transport.requests.Request()
        _sa_credentials.refresh(req)

    return _sa_credentials.token


# ── Helpers Drive ─────────────────────────────────────────────────────────────
def drive_request(path, token):
    """Petición GET a Google Drive API v3."""
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
    q = urllib.parse.quote(
        f"'{folder_id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
    )
    data = drive_request(
        f"files?q={q}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime%20desc&pageSize=100",
        token
    )
    return data.get("files", [])

def get_pdfs_in_folder(folder_id, token):
    """Lista PDFs en una carpeta, ordenados por fecha desc."""
    q = urllib.parse.quote(
        f"'{folder_id}' in parents and mimeType = 'application/pdf' and trashed = false"
    )
    data = drive_request(
        f"files?q={q}&fields=files(id,name,modifiedTime,size)&orderBy=modifiedTime%20desc&pageSize=50",
        token
    )
    return data.get("files", [])


# ── Extracción de texto ───────────────────────────────────────────────────────
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
                from collections import defaultdict
                lines = defaultdict(list)
                for w in words:
                    y_key = round(w["top"] / 4) * 4
                    lines[y_key].append(w)
                for y_key in sorted(lines.keys()):
                    row_words = sorted(lines[y_key], key=lambda w: w["x0"])
                    line_text = "  ".join(w["text"] for w in row_words)
                    all_lines.append(line_text)
            return "\n".join(all_lines)
    except Exception:
        reader = PdfReader(io.BytesIO(pdf_bytes))
        return "\n".join(p.extract_text() or "" for p in reader.pages)


def find_matching_pages(pdf_bytes, search_terms, already_matched=None):
    """
    Busca en un PDF de declaración los términos indicados.
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


def build_search_variants(reference):
    """
    Genera variantes de búsqueda desde una referencia de producto ALUMAR.
    Siempre incluye el original (>= 5 chars).
    Variantes derivadas requieren >= 6 chars para evitar falsos positivos.
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
    """Usa Groq (Llama) para extraer referencias de producto desde la factura de ALUMAR."""
    prompt = f"""Eres un experto en facturas de ALUMAR S.A.S., empresa colombiana importadora de productos para el hogar.

TEXTO DE FACTURA (columnas separadas por espacios/tabulaciones):
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

    response = groq_client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.1,
        max_tokens=4096,
    )
    text = response.choices[0].message.content.strip()
    start = text.find('{')
    end = text.rfind('}')
    if start != -1 and end != -1 and end > start:
        text = text[start:end+1]
    return json.loads(text)


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.route("/api/health")
def health():
    """Verifica que el backend y la conexión con Drive estén funcionando."""
    drive_ok = False
    drive_error = None
    try:
        token = get_drive_token()
        folders = get_subfolders(MANIFIESTOS_FOLDER_ID, token)
        drive_ok = True
        folder_count = len(folders)
    except Exception as e:
        drive_error = str(e)
        folder_count = 0

    return jsonify({
        "ok": True,
        "ts": datetime.datetime.now().isoformat(),
        "drive": {"connected": drive_ok, "folders": folder_count, "error": drive_error},
        "groq": {"configured": bool(GROQ_API_KEY)}
    })


@app.route("/api/process", methods=["POST"])
def process_invoice():
    """
    Endpoint principal.
    Recibe: factura PDF
    Devuelve: PDF con las declaraciones correspondientes
    """
    if "invoice" not in request.files:
        return jsonify({"error": "Se requiere archivo de factura (invoice)"}), 400

    invoice_file = request.files["invoice"]
    invoice_bytes = invoice_file.read()
    invoice_name = invoice_file.filename

    # 1. Autenticar con Drive
    try:
        token = get_drive_token()
    except Exception as e:
        return jsonify({"error": f"Error de autenticación con Google Drive: {str(e)}"}), 500

    # 2. Extraer texto de la factura
    try:
        invoice_text = extract_invoice_pdf_text(invoice_bytes)
    except Exception as e:
        return jsonify({"error": f"No se pudo leer la factura: {str(e)}"}), 400

    if not invoice_text.strip():
        return jsonify({"error": "La factura no tiene texto extraíble"}), 400

    # 3. Extraer productos con IA
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
    print("PRODUCTOS EXTRAÍDOS:")
    for p in productos:
        print(f"  - {p}")
    print(f"TÉRMINOS DE BÚSQUEDA: {search_terms}")
    print("=" * 60)

    # 4. Obtener subcarpetas de MANIFIESTOS
    try:
        supplier_folders = get_subfolders(MANIFIESTOS_FOLDER_ID, token)
        print(f"Carpetas encontradas: {len(supplier_folders)}")
    except Exception as e:
        return jsonify({"error": f"Error accediendo a Drive: {str(e)}"}), 500

    # Usar caché del frontend para priorizar carpetas conocidas
    cache_hints_raw = request.form.get("cache_hints", "{}")
    try:
        cache_hints = json.loads(cache_hints_raw)
    except Exception:
        cache_hints = {}
    cached_folder_ids = {v.get("folder_id") for v in cache_hints.values() if isinstance(v, dict) and v.get("folder_id")}
    if cached_folder_ids:
        supplier_folders.sort(key=lambda f: 0 if f["id"] in cached_folder_ids else 1)
        print(f"Caché activo: priorizando {len(cached_folder_ids)} carpetas conocidas")

    # 5. Buscar en paralelo
    matched_declarations = []
    search_log = []

    def check_folder(folder):
        folder_name = folder["name"]
        folder_id = folder["id"]
        try:
            pdfs = get_pdfs_in_folder(folder_id, token)
        except Exception as e:
            print(f"  [{folder_name}] ERROR get_pdfs: {e}")
            return None
        if not pdfs:
            return None

        folder_matched_terms = set()
        folder_pdfs_results = []
        consecutive_misses = 0
        found_any = False

        for pdf_meta in pdfs:
            remaining = {t for t in search_terms if t not in folder_matched_terms}
            if not remaining:
                break
            if not found_any and consecutive_misses >= 3:
                break
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
                    "file_id": pdf_meta["id"],
                })
                consecutive_misses = 0
                found_any = True
            else:
                consecutive_misses += 1

        if not folder_pdfs_results:
            return None
        return {
            "proveedor": folder_name,
            "folder_id": folder_id,
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

    # 6. Construir PDF final con deduplicación global
    all_pdf_results = []
    for decl in matched_declarations:
        for pdf_result in decl["pdfs"]:
            all_pdf_results.append({"proveedor": decl["proveedor"], "folder_id": decl.get("folder_id", ""), **pdf_result})
    all_pdf_results.sort(key=lambda x: x.get("date", ""), reverse=True)

    global_matched = set()
    writer = PdfWriter()
    resumen = []
    not_found = []

    for pdf_result in all_pdf_results:
        new_terms = pdf_result["matched_terms"] - global_matched
        if not new_terms:
            print(f"  SKIP (duplicado): {pdf_result['archivo']}")
            continue
        global_matched.update(new_terms)
        reader = PdfReader(io.BytesIO(pdf_result["pdf_bytes"]))
        pages_added = 0
        # pdfplumber detecta palabras reales — más confiable que extract_text() de pypdf
        with pdfplumber.open(io.BytesIO(pdf_result["pdf_bytes"])) as plumber_pdf:
            for idx in pdf_result["paginas_match"]:
                if idx < len(reader.pages):
                    has_content = False
                    if idx < len(plumber_pdf.pages):
                        plumber_page = plumber_pdf.pages[idx]
                        words = plumber_page.extract_words()
                        # Mínimo 10 palabras: filtra páginas en blanco y páginas
                        # con solo número de página / encabezado (0-3 palabras)
                        if len(words) >= 10:
                            has_content = True
                        elif words:
                            # Pocos palabras: verificar con chars para detectar
                            # páginas con contenido mixto (tablas, campos cortos)
                            chars = plumber_page.chars
                            has_content = len(chars) >= 100
                    if has_content:
                        writer.add_page(reader.pages[idx])
                        pages_added += 1
        print(f"  INCLUIDO: {pdf_result['archivo']} ({pages_added} págs) — {new_terms}")
        resumen.append({
            "proveedor": pdf_result["proveedor"],
            "archivo": pdf_result["archivo"],
            "paginas_incluidas": pages_added
        })

    # Calcular referencias no encontradas
    refs_originales = {p["referencia"].upper().strip() for p in productos if p.get("referencia")}
    for ref in refs_originales:
        variants = build_search_variants(ref)
        if not any(v in global_matched for v in variants):
            not_found.append(ref)

    # Construir mapa de caché: referencia → carpeta/archivo donde se encontró
    term_a_ref = {}
    for p in productos:
        if p.get("referencia"):
            ref = p["referencia"].upper().strip()
            term_a_ref[ref] = ref
            for v in build_search_variants(p["referencia"]):
                term_a_ref[v] = ref
    cache_update = {}
    for pdf_result in all_pdf_results:
        for term in pdf_result.get("matched_terms", set()):
            orig_ref = term_a_ref.get(term, term)
            cache_update[orig_ref] = {
                "folder_id": pdf_result.get("folder_id", ""),
                "folder_name": pdf_result.get("proveedor", ""),
                "file_id": pdf_result.get("file_id", ""),
                "file_name": pdf_result.get("archivo", ""),
            }

    output = io.BytesIO()
    writer.write(output)
    output.seek(0)

    fecha_str = datetime.date.today().strftime("%Y%m%d")
    filename = f"declaraciones_{invoice_name.replace('.pdf','').replace(' ','_')}_{fecha_str}.pdf"

    response = send_file(
        output,
        mimetype="application/pdf",
        as_attachment=True,
        download_name=filename
    )
    response.headers["X-Resumen"] = json.dumps(resumen)
    response.headers["X-No-Encontrados"] = json.dumps(not_found)
    response.headers["X-Productos-Buscados"] = json.dumps(list(search_terms)[:20])
    response.headers["X-Cache-Update"] = json.dumps(cache_update)
    return response


@app.route("/api/process-refs", methods=["POST"])
def process_refs():
    """
    Endpoint alternativo: recibe referencias de productos directamente (JSON).
    Omite el paso de PDF/AI y va directo a buscar en Drive.
    Body JSON: {
      "referencias": ["AATI-007293", "TAATI-006075", ...],
      "factura_nombre": "Factura 53855",
      "cache_hints": {}
    }
    """
    data = request.get_json(silent=True) or {}
    referencias = data.get("referencias", [])
    factura_nombre = data.get("factura_nombre", "desde_bd")
    cache_hints = data.get("cache_hints", {})

    if not referencias:
        return jsonify({"error": "Se requiere lista de referencias"}), 400

    # 1. Autenticar con Drive
    try:
        token = get_drive_token()
    except Exception as e:
        return jsonify({"error": f"Error de autenticación con Google Drive: {str(e)}"}), 500

    # 2. Construir términos de búsqueda con variantes
    search_terms = set()
    for ref in referencias:
        if ref and len(ref.strip()) >= 4:
            search_terms.update(build_search_variants(ref.strip()))

    if not search_terms:
        return jsonify({"error": "No se generaron términos de búsqueda válidos"}), 400

    print("=" * 60)
    print(f"PROCESS-REFS: {len(referencias)} refs → {len(search_terms)} términos")
    print(f"Refs: {referencias[:10]}")
    print("=" * 60)

    # 3. Obtener subcarpetas de MANIFIESTOS
    try:
        supplier_folders = get_subfolders(MANIFIESTOS_FOLDER_ID, token)
    except Exception as e:
        return jsonify({"error": f"Error accediendo a Drive: {str(e)}"}), 500

    # Priorizar carpetas conocidas del caché
    cached_folder_ids = {v.get("folder_id") for v in cache_hints.values() if isinstance(v, dict) and v.get("folder_id")}
    if cached_folder_ids:
        supplier_folders.sort(key=lambda f: 0 if f["id"] in cached_folder_ids else 1)

    # 4. Buscar en paralelo (misma lógica que /api/process)
    matched_declarations = []

    def check_folder(folder):
        folder_name = folder["name"]
        folder_id   = folder["id"]
        try:
            pdfs = get_pdfs_in_folder(folder_id, token)
        except Exception:
            return None
        if not pdfs:
            return None

        folder_matched_terms = set()
        folder_pdfs_results  = []
        consecutive_misses   = 0
        found_any            = False

        for pdf_meta in pdfs:
            remaining = {t for t in search_terms if t not in folder_matched_terms}
            if not remaining:
                break
            if not found_any and consecutive_misses >= 3:
                break
            if found_any and consecutive_misses >= 2:
                break
            try:
                pdf_bytes = drive_download(pdf_meta["id"], token)
            except Exception:
                consecutive_misses += 1
                continue
            matched_pages, newly_matched = find_matching_pages(pdf_bytes, remaining, folder_matched_terms)
            if matched_pages:
                folder_matched_terms.update(newly_matched)
                folder_pdfs_results.append({
                    "archivo": pdf_meta["name"],
                    "paginas_match": matched_pages,
                    "pdf_bytes": pdf_bytes,
                    "matched_terms": newly_matched,
                    "date": pdf_meta.get("modifiedTime", ""),
                    "file_id": pdf_meta["id"],
                })
                consecutive_misses = 0
                found_any = True
            else:
                consecutive_misses += 1

        if not folder_pdfs_results:
            return None
        return {
            "proveedor": folder_name,
            "folder_id": folder_id,
            "pdfs": folder_pdfs_results,
        }

    with ThreadPoolExecutor(max_workers=16) as executor:
        futures = {executor.submit(check_folder, f): f for f in supplier_folders}
        for future in as_completed(futures):
            result = future.result()
            if result:
                matched_declarations.append(result)

    if not matched_declarations:
        return jsonify({
            "error": "No se encontraron declaraciones para estas referencias",
            "referencias_buscadas": list(search_terms),
            "no_encontradas": referencias,
        }), 404

    # 5. Construir PDF final con deduplicación global
    all_pdf_results = []
    for decl in matched_declarations:
        for pdf_result in decl["pdfs"]:
            all_pdf_results.append({"proveedor": decl["proveedor"], "folder_id": decl.get("folder_id",""), **pdf_result})
    all_pdf_results.sort(key=lambda x: x.get("date",""), reverse=True)

    global_matched = set()
    writer = PdfWriter()
    resumen = []

    for pdf_result in all_pdf_results:
        new_terms = pdf_result["matched_terms"] - global_matched
        if not new_terms:
            continue
        global_matched.update(new_terms)
        reader = PdfReader(io.BytesIO(pdf_result["pdf_bytes"]))
        pages_added = 0
        with pdfplumber.open(io.BytesIO(pdf_result["pdf_bytes"])) as plumber_pdf:
            for idx in pdf_result["paginas_match"]:
                if idx < len(reader.pages):
                    has_content = False
                    if idx < len(plumber_pdf.pages):
                        words = plumber_pdf.pages[idx].extract_words()
                        if len(words) >= 10:
                            has_content = True
                        elif words:
                            has_content = len(plumber_pdf.pages[idx].chars) >= 100
                    if has_content:
                        writer.add_page(reader.pages[idx])
                        pages_added += 1
        resumen.append({
            "proveedor": pdf_result["proveedor"],
            "archivo": pdf_result["archivo"],
            "paginas_incluidas": pages_added,
        })

    # Referencias no encontradas
    refs_upper = {r.upper().strip() for r in referencias}
    not_found = [r for r in referencias if not any(v in global_matched for v in build_search_variants(r))]

    # Cache update
    cache_update = {}
    for pdf_result in all_pdf_results:
        for term in pdf_result.get("matched_terms", set()):
            cache_update[term] = {
                "folder_id":   pdf_result.get("folder_id",""),
                "folder_name": pdf_result.get("proveedor",""),
                "file_id":     pdf_result.get("file_id",""),
                "file_name":   pdf_result.get("archivo",""),
            }

    output = io.BytesIO()
    writer.write(output)
    output.seek(0)

    fecha_str = datetime.date.today().strftime("%Y%m%d")
    filename = f"declaraciones_{factura_nombre.replace(' ','_')}_{fecha_str}.pdf"

    response = send_file(output, mimetype="application/pdf", as_attachment=True, download_name=filename)
    response.headers["X-Resumen"]          = json.dumps(resumen)
    response.headers["X-No-Encontrados"]   = json.dumps(not_found)
    response.headers["X-Productos-Buscados"] = json.dumps(list(search_terms)[:20])
    response.headers["X-Cache-Update"]     = json.dumps(cache_update)
    return response


@app.route("/api/debug-invoice", methods=["POST"])
def debug_invoice():
    """Diagnóstico: muestra el texto extraído y lo que devuelve la IA."""
    if "invoice" not in request.files:
        return jsonify({"error": "Falta archivo invoice"}), 400

    invoice_bytes = request.files["invoice"].read()
    extracted_text = extract_invoice_pdf_text(invoice_bytes)

    try:
        ai_json = extract_products_with_ai(extracted_text)
        ai_raw = json.dumps(ai_json, ensure_ascii=False)
    except Exception as e:
        ai_json = {"error": str(e)}
        ai_raw = str(e)

    return jsonify({
        "texto_extraido": extracted_text[:5000],
        "ai_resultado": ai_json,
        "ai_raw": ai_raw[:2000]
    })


@app.route("/api/preview", methods=["POST"])
def preview_invoice():
    """Preview: extrae productos y lista carpetas disponibles."""
    if "invoice" not in request.files:
        return jsonify({"error": "Se requiere archivo de factura"}), 400

    invoice_bytes = request.files["invoice"].read()

    try:
        invoice_text = extract_invoice_pdf_text(invoice_bytes)
        invoice_data = extract_products_with_ai(invoice_text)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    try:
        token = get_drive_token()
        folders = get_subfolders(MANIFIESTOS_FOLDER_ID, token)
        proveedores = [{"nombre": f["name"], "ultima_actualizacion": f.get("modifiedTime", "")} for f in folders]
    except Exception:
        proveedores = []

    return jsonify({
        "factura": {
            "numero": invoice_data.get("numero_factura"),
            "productos": invoice_data.get("productos", [])
        },
        "terminos_busqueda": list({
            t for p in invoice_data.get("productos", [])
            for t in build_search_variants(p.get("referencia", ""))
            if t
        }),
        "proveedores_en_drive": proveedores
    })


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5050))
    debug = os.environ.get("FLASK_ENV") != "production"
    app.run(debug=debug, port=port, host="0.0.0.0")
