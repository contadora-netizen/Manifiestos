import { useState, useCallback, useRef, useEffect } from "react";

const API = import.meta.env.VITE_API_URL || "https://refreshing-gentleness-production-7a26.up.railway.app";

const C = {
  bg: "#f0f4f8",
  card: "#ffffff",
  border: "#dde3ec",
  navy: "#0a1f3c",
  navyMid: "#122a50",
  blue: "#1255a4",
  blueLight: "#1976d2",
  accent: "#d4780a",
  accentHover: "#b5620a",
  gold: "#e8920c",
  green: "#1e7e34",
  greenBg: "#e8f5e9",
  red: "#c0392b",
  text: "#1a2535",
  textMuted: "#4a6380",
  textDim: "#8fa3bc",
  white: "#ffffff",
  shadow: "0 2px 12px rgba(10,31,60,0.10)",
};

const fmtDate = (iso) =>
  new Date(iso).toLocaleDateString("es-CO", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit"
  });

const todayStr = () => new Date().toDateString();

const getProductCache = () => { try { return JSON.parse(localStorage.getItem("alumar_product_cache") || "{}"); } catch { return {}; } };
const saveProductCache = (update) => {
  try {
    const current = getProductCache();
    localStorage.setItem("alumar_product_cache", JSON.stringify({ ...current, ...update }));
  } catch {}
};

const blobToBase64 = (blob) => new Promise((resolve, reject) => {
  const fr = new FileReader(); fr.onloadend = () => resolve(fr.result); fr.onerror = reject; fr.readAsDataURL(blob);
});
const savePdfToStorage = async (id, blob) => {
  try {
    const b64 = await blobToBase64(blob);
    // Limpiar PDFs viejos (guardar máximo 8)
    const hist = JSON.parse(localStorage.getItem("alumar_hist") || "[]");
    const keepIds = new Set(hist.slice(0, 8).map(e => e.id));
    Object.keys(localStorage).filter(k => k.startsWith("alumar_pdf_") && !keepIds.has(k.slice(11))).forEach(k => localStorage.removeItem(k));
    localStorage.setItem(`alumar_pdf_${id}`, b64);
  } catch {}
};
const getPdfFromStorage = (id) => localStorage.getItem(`alumar_pdf_${id}`) || null;

function saveHistory(entry) {
  const prev = JSON.parse(localStorage.getItem("alumar_hist") || "[]");
  const updated = [entry, ...prev].slice(0, 50);
  localStorage.setItem("alumar_hist", JSON.stringify(updated));
  return updated;
}

// ── Contratos: clausulas estándar ────────────────────────────────────────────
const CLAUSULAS_TRANSPORTE = [
  "PRIMERA El transportista se compromete con Alumar SAS a transportar y entregar en forma directa, en el destino que se encuentra registrado en cada factura, en el vehículo que se relaciona en este contrato y no en uno distinto, vehículo que debe estar conducido por el mismo conductor que figura en este contrato y no por una persona distinta, la mercancía completa y en perfecto estado de empaque y contenido relacionada en cada una de las facturas que se relacionan en este contrato, a más tardar en los 8 días siguientes a la entrega de Alumar al transportista. PARAGRÁFO 1: Se considera incumplimiento de este contrato y constituye una grave falta el entregar la mercancía en una dirección distinta a la señalada en la factura, así medien instrucciones verbales distintas. PARAGRÁFO 2: Se considera incumplimiento de este contrato y una grave falta que el transportista destine un conductor distinto al que se relaciona en este contrato, sin consultar previamente con Alumar dicho cambio. PARAGRÁFO 3: El entregar en el destino la mercancía en mal estado de empaque o de producto se considera incumplimiento de este contrato y hace responsable al transportista de estos daños. El conductor se compromete a responder las llamadas del departamento de despachos y a facilitar la información solicitada como: ciudad donde se encuentra, tiempo de entrega, próximo destino etc.",
  "SEGUNDA El transportista está obligado a permanecer en la bodega de Alumar pendiente del llenado del vehículo, para constatar las diferentes cantidades de unidades de embalaje. Alumar funcionará de 6AM a 8 PM.",
  "TERCERA El transportista se compromete a rodar únicamente en el horario de 6AM a 8 PM.",
  "CUARTA El transportista se compromete a entregar en cada destino, las unidades de embalaje contadas en presencia del cliente y hacer firmar y sellar al cliente dicho cumplido a satisfacción, firma acompañada del nombre y cédula de quien firma y se obliga a enviar al whatsapp del departamento de tráfico de Alumar la copia del cumplido firmado y sellado por el cliente cada vez que termine una entrega, esta copia no es válida para el pago del contrato, para ello debe entregar los cumplidos en físico y completamente.",
  "QUINTA Cualquier faltante de mercancía en el vehículo será responsabilidad del transportista (quien deberá cancelar su valor comercial precio de venta actualizado) en las 48 horas siguientes a la entrega de los cumplidos físicos en Alumar. Si este faltante no fuere cancelado en el tiempo previsto, Alumar procederá conforme a la ley.",
  "SEXTA El transportista tiene la obligación de rodar durante las noches de su ruta, el vehículo en parqueaderos legalmente establecidos, debidamente vigilados, que respondan por las pérdidas parciales y totales. No hacerlo constituye violación a este contrato y acarrea las consecuencias legales además de exigir al transportista la restitución del dinero correspondiente a la mercancía perdida o averiada.",
  "SÉPTIMA Es violación a este contrato cargar dentro del vehículo mercancía distinta a la de Alumar y constituye muy grave delito cargar mercancía que pueda atentar contra la mercancía de Alumar como ácidos, líquidos inflamables, venenos, tierra, arena, y todo aquello que pueda afectar el estado de la mercancía. Lo mismo que constituye delito muy grave cargar mercancía prohibida por la ley como estupefacientes, pólvora y afines. Estos casos, de ser comprobados, serán denunciados a la Fiscalía de la Nación.",
  "OCTAVA El valor acordado para este contrato es pagadero así: 60% a la firma de este contrato y 40% al recibir la totalidad de los cumplidos debidamente firmados por el cliente. Entregas de mercancía cuyo cumplido no haya sido firmado debidamente por el cliente, serán cobradas al transportista en su totalidad. La no entrega de los cumplidos en físico o la pérdida del documento no justificado acarreará sanción.",
  "NOVENA Si el transportista no entregare la totalidad de la mercancía en los 8 días estipulados en este contrato, deberá cancelar a Alumar, a modo de multa, $100.000 pesos diarios por cada día de retraso sin justificación comprobada.",
];

function generateContratoPDF(c) {
  const fmt = (v) => v ? `$${Number(v).toLocaleString("es-CO")}` : "";
  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<title>Contrato ${c.numero}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;font-size:9.5px;padding:12mm 14mm;color:#000}
.hdr{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #000;padding-bottom:6px;margin-bottom:8px}
.logo{border:2px solid #2a2a2a;padding:3px 8px;line-height:1}
.logo-r{font-family:'Arial Black',Arial,sans-serif;font-weight:900;font-size:20px;color:#cc1111}
.logo-s{font-size:7.5px;text-align:center;color:#2a2a2a}
.title{font-size:13px;font-weight:bold;text-align:center;flex:1;padding:0 16px}
.num{font-size:13px;font-weight:bold;border:2px solid #000;padding:3px 10px}
.row{display:flex;gap:6px;margin-bottom:4px;align-items:flex-end;flex-wrap:wrap}
.lbl{font-size:8px;color:#444;white-space:nowrap;flex-shrink:0}
.val{border-bottom:1px solid #000;font-size:9px;min-width:60px;padding:0 2px;flex:1}
.sec{font-weight:bold;font-size:9.5px;margin:8px 0 4px;border-bottom:1px solid #000;padding-bottom:2px;letter-spacing:.05em}
.grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:8px}
.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:8px}
.grid2{display:grid;grid-template-columns:repeat(2,1fr);gap:6px;margin-bottom:8px}
.cell{display:flex;flex-direction:column;gap:2px}
.cell .lbl{font-size:8px;color:#444}
.cell .val{border-bottom:1px solid #000;font-size:9px;padding:1px 2px;min-height:14px}
.span2{grid-column:span 2}.span3{grid-column:span 3}.span4{grid-column:span 4}
.clausulas{margin-top:8px}
.cl{font-size:8px;text-align:justify;margin-bottom:5px;line-height:1.45}
.firmas{display:flex;justify-content:space-around;margin-top:24px;text-align:center}
.firma-box{width:160px}
.firma-line{border-top:1px solid #000;margin-top:36px;padding-top:3px;font-size:8.5px;font-weight:bold}
</style></head><body>
<div class="hdr">
  <div class="logo">
    <div class="logo-r">alumar</div>
    <div class="logo-s">International Housewares</div>
    <div class="logo-s">NIT. 800.193.639-5</div>
  </div>
  <div class="title">CONTRATO DE TRANSPORTE TERRESTRE DE CARGA</div>
  <div class="num">No. ${c.numero}</div>
</div>

<div class="grid4">
  <div class="cell"><span class="lbl">Fecha de cargue</span><span class="val">${c.fecha_cargue||""}</span></div>
  <div class="cell"><span class="lbl">Fecha salida del vehículo</span><span class="val">${c.fecha_salida||""}</span></div>
  <div class="cell span2"><span class="lbl">Contratante: ALUMAR SAS NIT 800.193.639-5</span><span class="val" style="border:none;font-weight:bold">▪</span></div>
</div>

<div class="sec">CONTRATISTA</div>
<div class="grid4">
  <div class="cell span2"><span class="lbl">Nombre completo</span><span class="val">${c.contratista_nombre||""}</span></div>
  <div class="cell"><span class="lbl">C.C.</span><span class="val">${c.contratista_cc||""}</span></div>
  <div class="cell"><span class="lbl">Teléfono</span><span class="val">${c.contratista_telefono||""}</span></div>
  <div class="cell span2"><span class="lbl">Domicilio</span><span class="val">${c.contratista_domicilio||""}</span></div>
  <div class="cell"><span class="lbl">Ciudad</span><span class="val">${c.contratista_ciudad||""}</span></div>
</div>

<div class="sec">CONDUCTOR Y VEHÍCULO</div>
<div class="grid4">
  <div class="cell span2"><span class="lbl">Conductor</span><span class="val">${c.conductor_nombre||""}</span></div>
  <div class="cell"><span class="lbl">Celular</span><span class="val">${c.conductor_celular||""}</span></div>
  <div class="cell"><span class="lbl">Vehículo Marca</span><span class="val">${c.vehiculo_marca||""}</span></div>
  <div class="cell"><span class="lbl">Placas</span><span class="val">${c.vehiculo_placas||""}</span></div>
  <div class="cell"><span class="lbl">Licencia de tránsito N°</span><span class="val">${c.vehiculo_licencia||""}</span></div>
  <div class="cell"><span class="lbl">SOAT vence</span><span class="val">${c.vehiculo_soat||""}</span></div>
  <div class="cell"><span class="lbl">Técnico-mecánica vence</span><span class="val">${c.tecnicomecanica||""}</span></div>
  <div class="cell span2"><span class="lbl">Nombre propietario tarjeta</span><span class="val">${c.vehiculo_propietario||""}</span></div>
  <div class="cell"><span class="lbl">Compañía aseguradora</span><span class="val">${c.aseguradora||""}</span></div>
  <div class="cell"><span class="lbl">Capacidad</span><span class="val">${c.capacidad||""}</span></div>
  <div class="cell"><span class="lbl">Medidas</span><span class="val">${c.medidas||""}</span></div>
</div>

<div class="sec">CARGA A MOVILIZAR</div>
<div class="grid4">
  <div class="cell span4"><span class="lbl">Facturas N°</span><span class="val">${c.facturas||""}</span></div>
  <div class="cell"><span class="lbl">Devoluciones N°</span><span class="val">${c.devoluciones||""}</span></div>
  <div class="cell span3"><span class="lbl">Destino (ciudades)</span><span class="val">${c.destino||""}</span></div>
  <div class="cell span2"><span class="lbl">Valor total de la mercancía</span><span class="val">${fmt(c.valor_mercancia)}</span></div>
</div>

<div class="grid4" style="margin-top:4px;border:1px solid #000;padding:6px;border-radius:4px">
  <div class="cell"><span class="lbl">Valor contrato</span><span class="val">${fmt(c.valor_contrato)}</span></div>
  <div class="cell"><span class="lbl">Pelete</span><span class="val">${fmt(c.valor_pelete)}</span></div>
  <div class="cell"><span class="lbl">Palencia</span><span class="val">${fmt(c.valor_palencia)}</span></div>
  <div class="cell"><span class="lbl"><strong>SS TOTAL</strong></span><span class="val" style="font-weight:bold;font-size:11px">${fmt(c.valor_total)}</span></div>
</div>

${c.observaciones ? `<div style="margin-top:6px;font-size:8.5px"><strong>Observaciones:</strong> ${c.observaciones}</div>` : ""}

<div class="clausulas">
  <div class="sec">CLÁUSULAS</div>
  ${CLAUSULAS_TRANSPORTE.map((cl, i) => `<div class="cl"><strong>${["PRIMERA","SEGUNDA","TERCERA","CUARTA","QUINTA","SEXTA","SÉPTIMA","OCTAVA","NOVENA"][i]}</strong> ${cl.replace(/^[A-ZÁÉÍÓÚ]+\s/,"")}</div>`).join("")}
</div>

<div style="font-size:8px;text-align:justify;margin-top:6px">
  En prueba de conformidad se firma en original y copia, una para Alumar y otra para el contratista, en el municipio de los Patios Norte de Santander.
</div>

<div class="firmas">
  <div class="firma-box"><div class="firma-line">DEPTO. DE TRÁFICO<br>ALUMAR S.A.S</div></div>
  <div class="firma-box"><div class="firma-line">EL CONTRATISTA</div></div>
  <div class="firma-box"><div class="firma-line">EL CONDUCTOR</div></div>
</div>
</body></html>`;
  const w = window.open("", "_blank");
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 600);
}

// ── Modal PDF ────────────────────────────────────────────────────────────────
function PDFModal({ url, filename, onClose, onDownload }) {
  const handlePrint = () => {
    const iframe = document.getElementById("pdf-preview-frame");
    if (iframe) { iframe.contentWindow.focus(); iframe.contentWindow.print(); }
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(5,15,30,0.82)", display: "flex", flexDirection: "column" }}>
      <div style={{
        background: `linear-gradient(135deg, #0a1f3c, #122a50)`,
        borderBottom: "2px solid #d4780a",
        padding: "0 1.25rem", height: 52,
        display: "flex", alignItems: "center", gap: 12, flexShrink: 0
      }}>
        <div style={{ background: "#ffffff", border: "1.5px solid #2a2a2a", borderRadius: 3, padding: "2px 7px", lineHeight: 1 }}>
          <div style={{ fontFamily: "'Arial Black', Arial, sans-serif", fontWeight: 900, fontSize: 14, color: "#cc1111" }}>alumar</div>
        </div>
        <div style={{ width: 1, height: 28, background: "#ffffff22" }} />
        <div style={{ flex: 1, fontSize: 12, color: "#a0b8d0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          <span style={{ color: "#ffffff", fontWeight: 600 }}>Vista previa · </span>{filename}
        </div>
        <button onClick={handlePrint} style={{ background: "linear-gradient(135deg, #d4780a, #e8920c)", color: "white", border: "none", borderRadius: 7, padding: "7px 18px", cursor: "pointer", fontWeight: 700, fontSize: 12 }}>🖨 Imprimir</button>
        <button onClick={onDownload} style={{ background: "#1e7e34", color: "white", border: "none", borderRadius: 7, padding: "7px 18px", cursor: "pointer", fontWeight: 700, fontSize: 12 }}>⬇ Descargar</button>
        <button onClick={onClose} style={{ background: "transparent", color: "#8faec8", border: "1px solid #ffffff22", borderRadius: 7, padding: "7px 14px", cursor: "pointer", fontSize: 12 }}>✕ Cerrar</button>
      </div>
      <iframe id="pdf-preview-frame" src={url} style={{ flex: 1, border: "none", background: "#525659" }} title="Vista previa" />
    </div>
  );
}

// ── Componentes base ──────────────────────────────────────────────────────────
function Badge({ children, color = C.blue }) {
  return (
    <span style={{
      background: color + "18", color,
      border: `1px solid ${color}40`,
      borderRadius: 4, padding: "2px 8px",
      fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", whiteSpace: "nowrap"
    }}>{children}</span>
  );
}

function Spinner({ size = 16 }) {
  return (
    <div style={{
      width: size, height: size,
      border: `2px solid #c0cfe0`,
      borderTop: `2px solid ${C.blue}`,
      borderRadius: "50%",
      animation: "spin 0.8s linear infinite", flexShrink: 0
    }} />
  );
}

function Step({ n, label, active, done }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, opacity: done || active ? 1 : 0.4 }}>
      <div style={{
        width: 26, height: 26, borderRadius: "50%",
        background: done ? C.green : active ? C.blue : "#c8d6e5",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 11, fontWeight: 700, color: "white", flexShrink: 0,
        transition: "background 0.3s"
      }}>{done ? "✓" : n}</div>
      <span style={{ fontSize: 12, color: active ? C.text : C.textMuted, fontWeight: active ? 600 : 400 }}>{label}</span>
    </div>
  );
}

// ── Fila de factura ───────────────────────────────────────────────────────────
function InvoiceRow({ item, onRemove, onPreview }) {
  const statusColor = { pending: C.textDim, processing: C.blue, done: C.green, error: C.red }[item.status];
  const statusLabel = { pending: "En espera", processing: "Procesando...", done: "✓ Listo", error: "✗ Error" }[item.status];

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "8px 10px", borderRadius: 7,
      background: item.status === "processing" ? "#1255a408" : "#f8fafc",
      border: `1px solid ${item.status === "processing" ? C.blue + "44" : C.border}`,
      marginBottom: 6, transition: "all 0.2s"
    }}>
      <div style={{ fontSize: 18 }}>📄</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {item.file.name}
        </div>
        <div style={{ fontSize: 10, color: C.textMuted }}>{(item.file.size / 1024).toFixed(0)} KB</div>
        {/* Referencias no encontradas */}
        {item.notFound?.length > 0 && (
          <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: 3 }}>
            <span style={{ fontSize: 9, color: C.red, fontWeight: 700 }}>Sin declaración: </span>
            {item.notFound.map(r => (
              <span key={r} style={{ fontSize: 9, background: "#fdecea", color: C.red, borderRadius: 3, padding: "1px 5px", fontFamily: "monospace" }}>{r}</span>
            ))}
          </div>
        )}
      </div>
      {item.status === "processing" && <Spinner size={14} />}
      <span style={{ fontSize: 11, color: statusColor, fontWeight: 600, flexShrink: 0 }}>{statusLabel}</span>
      {item.status === "done" && item.resultUrl && (
        <div style={{ display: "flex", gap: 5 }}>
          <button onClick={() => onPreview(item)}
            style={{ fontSize: 11, background: C.blue, color: "white", border: "none", borderRadius: 5, padding: "4px 10px", cursor: "pointer", fontWeight: 700 }}>
            👁 Ver
          </button>
          <a href={item.resultUrl} download={item.resultFilename}
            style={{ fontSize: 11, background: C.green, color: "white", borderRadius: 5, padding: "4px 10px", textDecoration: "none", fontWeight: 700, display: "flex", alignItems: "center" }}>
            ⬇
          </a>
          {item.reportUrl && (
            <a href={item.reportUrl} download={`no-match_${item.file.name.replace(".pdf","")}.txt`}
              title="Descargar reporte de referencias sin declaración"
              style={{ fontSize: 11, background: C.accent, color: "white", borderRadius: 5, padding: "4px 10px", textDecoration: "none", fontWeight: 700, display: "flex", alignItems: "center" }}>
              📋
            </a>
          )}
        </div>
      )}
      {item.status === "pending" && (
        <button onClick={() => onRemove(item.id)}
          style={{ background: "transparent", border: "none", cursor: "pointer", color: C.textDim, fontSize: 14, padding: "0 2px" }}>×</button>
      )}
    </div>
  );
}

// ── Historial ─────────────────────────────────────────────────────────────────
function HistoryRow({ entry }) {
  const [open, setOpen] = useState(false);
  const hasPdf = !!getPdfFromStorage(entry.id);
  const downloadPdf = () => {
    const data = getPdfFromStorage(entry.id);
    if (!data) return;
    const a = document.createElement("a");
    a.href = data;
    a.download = entry.pdfFilename || `declaraciones_${entry.invoiceName}`;
    a.click();
  };
  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, marginBottom: 8, overflow: "hidden" }}>
      <div onClick={() => setOpen(o => !o)} style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "10px 14px", cursor: "pointer",
        background: open ? "#f0f4f8" : C.white, transition: "background 0.15s"
      }}>
        <div style={{ fontSize: 16 }}>📄</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {entry.invoiceName}
          </div>
          <div style={{ fontSize: 10, color: C.textMuted }}>{fmtDate(entry.date)}</div>
        </div>
        {entry.matches?.length > 0
          ? <Badge color={C.green}>{entry.matches.length} proveedor{entry.matches.length !== 1 ? "es" : ""}</Badge>
          : <Badge color={C.red}>Sin match</Badge>}
        {entry.notFound?.length > 0 && <Badge color={C.red}>{entry.notFound.length} sin declaración</Badge>}
        {hasPdf && (
          <button
            onClick={e => { e.stopPropagation(); downloadPdf(); }}
            title="Descargar PDF generado"
            style={{
              background: C.green, color: "white", border: "none",
              borderRadius: 5, padding: "3px 10px", cursor: "pointer",
              fontSize: 11, fontWeight: 700, flexShrink: 0
            }}>⬇ PDF</button>
        )}
        <span style={{ color: C.textDim, fontSize: 12 }}>{open ? "▲" : "▼"}</span>
      </div>
      {open && (
        <div style={{ padding: "10px 14px", borderTop: `1px solid ${C.border}`, background: "#f8fafc" }}>
          {entry.matches?.length > 0 && (
            <>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.textDim, letterSpacing: "0.08em", marginBottom: 8 }}>DECLARACIONES ENCONTRADAS</div>
              {entry.matches.map((m, i) => (
                <div key={i} style={{ fontSize: 11, color: C.textMuted, padding: "3px 0", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between" }}>
                  <span><strong style={{ color: C.text }}>{m.proveedor}</strong> · {m.archivo}</span>
                  <span style={{ color: C.textDim }}>{m.paginas_incluidas} págs.</span>
                </div>
              ))}
            </>
          )}
          {entry.notFound?.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.red, letterSpacing: "0.08em", marginBottom: 6 }}>REFERENCIAS SIN DECLARACIÓN</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {entry.notFound.map((r, i) => (
                  <span key={i} style={{ fontSize: 10, background: "#fdecea", color: C.red, borderRadius: 4, padding: "2px 6px", fontFamily: "monospace" }}>{r}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Contrato: formulario ──────────────────────────────────────────────────────
function ContratoForm({ onSave, onCancel, initial, nextNumero }) {
  const empty = {
    id: crypto.randomUUID(), numero: nextNumero,
    fecha_cargue: new Date().toISOString().slice(0,10),
    fecha_salida: new Date().toISOString().slice(0,10),
    contratista_nombre: "", contratista_cc: "", contratista_domicilio: "", contratista_ciudad: "", contratista_telefono: "",
    conductor_nombre: "", conductor_celular: "",
    vehiculo_marca: "", vehiculo_placas: "", vehiculo_licencia: "", vehiculo_soat: "",
    vehiculo_propietario: "", aseguradora: "", tecnicomecanica: "", capacidad: "", medidas: "",
    facturas: "", devoluciones: "", destino: "",
    valor_mercancia: "", valor_contrato: "", valor_pelete: "", valor_palencia: "", valor_total: "",
    observaciones: "",
  };
  const [form, setForm] = useState(initial || empty);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  useEffect(() => {
    const total = (Number(form.valor_contrato)||0) + (Number(form.valor_pelete)||0) + (Number(form.valor_palencia)||0);
    if (total > 0) setForm(f => ({ ...f, valor_total: total }));
  }, [form.valor_contrato, form.valor_pelete, form.valor_palencia]);

  const lbl = { fontSize: 10, color: C.textMuted, fontWeight: 600, marginBottom: 3, display: "block" };
  const inp = { width: "100%", border: `1px solid ${C.border}`, borderRadius: 5, padding: "6px 8px", fontSize: 12, color: C.text, outline: "none", background: C.white };
  const Sec = ({ t }) => <div style={{ fontSize: 10, fontWeight: 700, color: C.textDim, letterSpacing: "0.1em", margin: "16px 0 8px", paddingBottom: 4, borderBottom: `1px solid ${C.border}` }}>{t}</div>;
  const F = ({ label, k, type="text", span=1, placeholder="" }) => (
    <div style={{ gridColumn: `span ${span}` }}>
      <label style={lbl}>{label}</label>
      <input type={type} value={form[k]||""} onChange={e => set(k, e.target.value)} placeholder={placeholder} style={inp} />
    </div>
  );
  const g = (cols) => ({ display: "grid", gridTemplateColumns: `repeat(${cols},1fr)`, gap: 10 });

  return (
    <div style={{ position:"fixed", inset:0, zIndex:2000, background:"rgba(5,15,30,0.88)", overflow:"auto", padding:"1.5rem" }}>
      <div style={{ maxWidth:920, margin:"0 auto", background:C.white, borderRadius:14, overflow:"hidden", boxShadow:"0 8px 48px rgba(0,0,0,0.5)" }}>
        {/* Header */}
        <div style={{ background:`linear-gradient(135deg,${C.navy},${C.navyMid})`, borderBottom:"3px solid #d4780a", padding:"0.875rem 1.5rem", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            <div style={{ background:"#fff", border:"2px solid #2a2a2a", borderRadius:3, padding:"3px 8px", lineHeight:1 }}>
              <div style={{ fontFamily:"'Arial Black',Arial,sans-serif", fontWeight:900, fontSize:18, color:"#cc1111" }}>alumar</div>
            </div>
            <div style={{ color:"#fff", fontWeight:700, fontSize:14 }}>Contrato de Transporte Terrestre N° <span style={{ color:C.gold }}>{form.numero}</span></div>
          </div>
          <button onClick={onCancel} style={{ background:"transparent", border:"1px solid #ffffff33", color:"#8faec8", borderRadius:7, padding:"6px 14px", cursor:"pointer", fontSize:12 }}>✕ Cerrar</button>
        </div>

        <div style={{ padding:"1.5rem" }}>
          <Sec t="INFORMACIÓN GENERAL" />
          <div style={g(4)}>
            <F label="N° Contrato" k="numero" />
            <F label="Fecha de cargue" k="fecha_cargue" type="date" />
            <F label="Fecha salida vehículo" k="fecha_salida" type="date" />
          </div>

          <Sec t="CONTRATISTA (TRANSPORTADOR)" />
          <div style={g(4)}>
            <F label="Nombre completo" k="contratista_nombre" span={2} />
            <F label="C.C." k="contratista_cc" />
            <F label="Teléfono" k="contratista_telefono" />
            <F label="Domicilio" k="contratista_domicilio" span={2} />
            <F label="Ciudad" k="contratista_ciudad" />
          </div>

          <Sec t="CONDUCTOR" />
          <div style={g(4)}>
            <F label="Nombre conductor" k="conductor_nombre" span={2} />
            <F label="Celular" k="conductor_celular" />
          </div>

          <Sec t="VEHÍCULO" />
          <div style={g(4)}>
            <F label="Marca" k="vehiculo_marca" />
            <F label="Placas" k="vehiculo_placas" />
            <F label="Licencia de tránsito N°" k="vehiculo_licencia" />
            <F label="SOAT vence" k="vehiculo_soat" type="date" />
            <F label="Nombre propietario tarjeta" k="vehiculo_propietario" span={2} />
            <F label="Compañía aseguradora" k="aseguradora" />
            <F label="Técnico-mecánica vence" k="tecnicomecanica" type="date" />
            <F label="Capacidad" k="capacidad" />
            <F label="Medidas" k="medidas" />
          </div>

          <Sec t="CARGA A MOVILIZAR" />
          <div style={{ ...g(4), marginBottom:10 }}>
            <div style={{ gridColumn:"span 4" }}>
              <label style={lbl}>Facturas N° (separadas por guión)</label>
              <input value={form.facturas||""} onChange={e => set("facturas",e.target.value)}
                placeholder="Ej: 53741 - 742 - 743 - 744 - 745" style={inp} />
            </div>
            <div style={{ gridColumn:"span 2" }}>
              <label style={lbl}>Destino (ciudades)</label>
              <input value={form.destino||""} onChange={e => set("destino",e.target.value)}
                placeholder="Ej: MEDELLÍN - SINCELEJO - AGUACHICA - OCAÑA" style={inp} />
            </div>
            <F label="Devoluciones N°" k="devoluciones" />
            <div>
              <label style={lbl}>Valor total mercancía $</label>
              <input type="number" value={form.valor_mercancia||""} onChange={e => set("valor_mercancia",e.target.value)} style={inp} />
            </div>
          </div>

          <Sec t="VALORES DEL CONTRATO" />
          <div style={g(4)}>
            <div>
              <label style={lbl}>Valor contrato $</label>
              <input type="number" value={form.valor_contrato||""} onChange={e => set("valor_contrato",e.target.value)} style={inp} />
            </div>
            <div>
              <label style={lbl}>Pelete $</label>
              <input type="number" value={form.valor_pelete||""} onChange={e => set("valor_pelete",e.target.value)} style={inp} />
            </div>
            <div>
              <label style={lbl}>Palencia $</label>
              <input type="number" value={form.valor_palencia||""} onChange={e => set("valor_palencia",e.target.value)} style={inp} />
            </div>
            <div>
              <label style={lbl}>SS Total $ (automático)</label>
              <input readOnly value={form.valor_total ? `$${Number(form.valor_total).toLocaleString("es-CO")}` : ""}
                style={{ ...inp, background:"#f0f4f8", fontWeight:700, color:C.green }} />
            </div>
          </div>

          <div style={{ marginTop:16 }}>
            <label style={lbl}>Observaciones / Notas adicionales</label>
            <textarea value={form.observaciones||""} onChange={e => set("observaciones",e.target.value)}
              rows={2} style={{ ...inp, resize:"vertical" }} />
          </div>

          <div style={{ display:"flex", justifyContent:"flex-end", gap:10, marginTop:20, paddingTop:16, borderTop:`1px solid ${C.border}` }}>
            <button onClick={onCancel} style={{ background:"transparent", border:`1px solid ${C.border}`, borderRadius:7, padding:"9px 20px", cursor:"pointer", color:C.textMuted, fontSize:12 }}>Cancelar</button>
            <button onClick={() => generateContratoPDF(form)} style={{ background:C.blue, color:"white", border:"none", borderRadius:7, padding:"9px 20px", cursor:"pointer", fontWeight:700, fontSize:12 }}>🖨 Vista previa / Imprimir</button>
            <button onClick={() => onSave(form)} style={{ background:`linear-gradient(135deg,${C.accent},${C.gold})`, color:"white", border:"none", borderRadius:7, padding:"9px 20px", cursor:"pointer", fontWeight:700, fontSize:12 }}>💾 Guardar contrato</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Contrato: fila de historial ───────────────────────────────────────────────
function ContratoRow({ contrato, onEdit }) {
  const [open, setOpen] = useState(false);
  const fmt = (v) => v ? `$${Number(v).toLocaleString("es-CO")}` : "—";
  return (
    <div style={{ border:`1px solid ${C.border}`, borderRadius:8, marginBottom:8, overflow:"hidden" }}>
      <div onClick={() => setOpen(o => !o)} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px", cursor:"pointer", background: open ? "#f0f4f8" : C.white, transition:"background 0.15s" }}>
        <div style={{ fontSize:16 }}>🚛</div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:12, fontWeight:700, color:C.text }}>N° {contrato.numero} — {contrato.contratista_nombre || "Sin nombre"}</div>
          <div style={{ fontSize:10, color:C.textMuted }}>{contrato.fecha_cargue} · {contrato.destino || "Sin destino especificado"}</div>
        </div>
        <Badge color={C.green}>{fmt(contrato.valor_total)}</Badge>
        <button onClick={e => { e.stopPropagation(); generateContratoPDF(contrato); }}
          style={{ fontSize:11, background:C.blue, color:"white", border:"none", borderRadius:5, padding:"4px 10px", cursor:"pointer", fontWeight:700 }}>🖨 Imprimir</button>
        <button onClick={e => { e.stopPropagation(); onEdit(contrato); }}
          style={{ fontSize:11, background:C.accent, color:"white", border:"none", borderRadius:5, padding:"4px 10px", cursor:"pointer", fontWeight:700 }}>✏ Editar</button>
        <span style={{ color:C.textDim, fontSize:12 }}>{open ? "▲" : "▼"}</span>
      </div>
      {open && (
        <div style={{ padding:"10px 14px", borderTop:`1px solid ${C.border}`, background:"#f8fafc", fontSize:11, color:C.textMuted }}>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10 }}>
            <div><strong style={{ color:C.text }}>Conductor:</strong> {contrato.conductor_nombre || "—"}</div>
            <div><strong style={{ color:C.text }}>Vehículo:</strong> {contrato.vehiculo_marca} {contrato.vehiculo_placas}</div>
            <div><strong style={{ color:C.text }}>Aseguradora:</strong> {contrato.aseguradora || "—"}</div>
            <div style={{ gridColumn:"span 3" }}><strong style={{ color:C.text }}>Facturas:</strong> {contrato.facturas || "—"}</div>
            <div><strong style={{ color:C.text }}>Valor mercancía:</strong> {fmt(contrato.valor_mercancia)}</div>
            <div><strong style={{ color:C.text }}>Contrato:</strong> {fmt(contrato.valor_contrato)} · Pelete: {fmt(contrato.valor_pelete)}</div>
            <div><strong style={{ color:C.text }}>Palencia:</strong> {fmt(contrato.valor_palencia)}</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [queue, setQueue] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const [tab, setTab] = useState("work");
  const [history, setHistory] = useState(() => JSON.parse(localStorage.getItem("alumar_hist") || "[]"));
  const [activeLog, setActiveLog] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [pdfModal, setPdfModal] = useState(null);
  const [histFilter, setHistFilter] = useState("today");
  const [contratos, setContratos] = useState(() => JSON.parse(localStorage.getItem("alumar_contratos") || "[]"));
  const [showContratoForm, setShowContratoForm] = useState(false);
  const [editingContrato, setEditingContrato] = useState(null);
  const fileRef = useRef();
  const logRef = useRef();

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [activeLog]);

  const addLog = (msg) => setActiveLog(prev => [...prev, { ts: new Date().toLocaleTimeString(), msg }]);

  const addFiles = useCallback((files) => {
    const pdfs = Array.from(files).filter(f => f.name.toLowerCase().endsWith(".pdf"));
    if (!pdfs.length) return;
    setQueue(prev => [
      ...prev,
      ...pdfs.map(f => ({ id: crypto.randomUUID(), file: f, status: "pending", resultUrl: null, resultFilename: null, notFound: [], reportUrl: null, date: todayStr() }))
    ]);
  }, []);

  const removeFromQueue = (id) => setQueue(prev => prev.filter(i => i.id !== id));

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer.files);
  };

  const processAll = async () => {
    if (processing) return;
    const pending = queue.filter(i => i.status === "pending");
    if (!pending.length) return;

    setProcessing(true);
    setActiveLog([]);

    for (const item of pending) {
      setQueue(prev => prev.map(i => i.id === item.id ? { ...i, status: "processing" } : i));
      addLog(`⏳ Procesando ${item.file.name}...`);

      const fd = new FormData();
      fd.append("invoice", item.file);
      fd.append("cache_hints", JSON.stringify(getProductCache()));

      try {
        const res = await fetch(`${API}/api/process`, { method: "POST", body: fd });

        if (!res.ok) {
          const data = await res.json();
          addLog(`✗ ${item.file.name}: ${data.error || "Error desconocido"}`);
          setQueue(prev => prev.map(i => i.id === item.id ? { ...i, status: "error" } : i));
          const newHist = saveHistory({ id: item.id, date: new Date().toISOString(), invoiceName: item.file.name, matches: [], notFound: [] });
          setHistory(newHist);
          continue;
        }

        const resumenRaw = res.headers.get("X-Resumen");
        const noEncontradosRaw = res.headers.get("X-No-Encontrados");
        const cacheUpdateRaw = res.headers.get("X-Cache-Update");
        const resumen = resumenRaw ? JSON.parse(resumenRaw) : [];
        const notFound = noEncontradosRaw ? JSON.parse(noEncontradosRaw) : [];
        if (cacheUpdateRaw) { try { saveProductCache(JSON.parse(cacheUpdateRaw)); } catch {} }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const filename = res.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1]
          || `declaraciones_${item.file.name}`;

        // Generar reporte de no-match
        let reportUrl = null;
        if (notFound.length > 0) {
          const lines = [
            "REFERENCIAS SIN DECLARACIÓN DE IMPORTACIÓN",
            "=".repeat(50),
            `Factura: ${item.file.name}`,
            `Fecha:   ${new Date().toLocaleDateString("es-CO", { day: "2-digit", month: "long", year: "numeric" })}`,
            "",
            `Total referencias no encontradas: ${notFound.length}`,
            "",
            ...notFound.map(r => `  • ${r}`),
            "",
            "Nota: Estas referencias no aparecen en ninguna declaración",
            "de importación disponible en la carpeta MANIFIESTOS de Drive.",
          ];
          reportUrl = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" }));
        }

        await savePdfToStorage(item.id, blob);

        resumen.forEach(r => addLog(`✓ ${r.proveedor}: ${r.archivo} (${r.paginas_incluidas} págs.)`));
        if (notFound.length > 0) addLog(`⚠ Sin declaración: ${notFound.join(", ")}`);
        addLog(`✓ PDF listo — ${resumen.reduce((a, r) => a + r.paginas_incluidas, 0)} páginas totales`);

        setQueue(prev => prev.map(i =>
          i.id === item.id ? { ...i, status: "done", resultUrl: url, resultFilename: filename, notFound, reportUrl, date: todayStr() } : i
        ));

        const newHist = saveHistory({
          id: item.id, date: new Date().toISOString(),
          invoiceName: item.file.name, matches: resumen, notFound,
          pdfFilename: filename
        });
        setHistory(newHist);
        setPdfModal({ url, filename });

      } catch (e) {
        addLog(`✗ ${item.file.name}: Error de conexión — ${e.message}`);
        setQueue(prev => prev.map(i => i.id === item.id ? { ...i, status: "error" } : i));
      }
    }

    setProcessing(false);
    addLog("─── Procesamiento completado ───");
  };

  const clearDone = () => setQueue(prev => prev.filter(i => i.status === "pending" || i.status === "processing"));
  const pendingCount = queue.filter(i => i.status === "pending").length;
  const doneCount = queue.filter(i => i.status === "done").length;

  const openPreview = (item) => setPdfModal({ url: item.resultUrl, filename: item.resultFilename });
  const closeModal = () => setPdfModal(null);
  const saveContrato = (contrato) => {
    const prev = JSON.parse(localStorage.getItem("alumar_contratos") || "[]");
    const idx = prev.findIndex(c => c.id === contrato.id);
    const updated = idx >= 0 ? prev.map(c => c.id === contrato.id ? contrato : c) : [contrato, ...prev];
    localStorage.setItem("alumar_contratos", JSON.stringify(updated));
    setContratos(updated);
    setShowContratoForm(false);
    setEditingContrato(null);
  };
  const nextNumero = () => {
    const nums = contratos.map(c => parseInt(c.numero)).filter(n => !isNaN(n));
    return nums.length ? String(Math.max(...nums) + 1) : "";
  };

  const downloadModal = () => {
    if (!pdfModal) return;
    const a = document.createElement("a");
    a.href = pdfModal.url; a.download = pdfModal.filename; a.click();
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: "'Segoe UI', system-ui, sans-serif", color: C.text }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 3px; }
        button:hover { filter: brightness(0.93); }
      `}</style>

      {pdfModal && <PDFModal url={pdfModal.url} filename={pdfModal.filename} onClose={closeModal} onDownload={downloadModal} />}

      {/* HEADER */}
      <div style={{
        background: `linear-gradient(135deg, ${C.navy} 0%, ${C.navyMid} 100%)`,
        borderBottom: "3px solid #d4780a",
        padding: "0 2rem", height: 62,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        boxShadow: "0 2px 16px rgba(10,31,60,0.25)"
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ background: "#ffffff", border: "2px solid #2a2a2a", borderRadius: 4, padding: "4px 10px", lineHeight: 1, boxShadow: "0 2px 8px rgba(0,0,0,0.3)" }}>
            <div style={{ fontFamily: "'Arial Black', Arial, sans-serif", fontWeight: 900, fontSize: 22, color: "#cc1111", letterSpacing: "-0.5px", lineHeight: 1 }}>alumar</div>
            <div style={{ fontSize: 7.5, color: "#2a2a2a", letterSpacing: "0.04em", fontWeight: 500, textAlign: "center", marginTop: 2 }}>International Housewares</div>
          </div>
          <div style={{ width: 1, height: 36, background: "#ffffff22" }} />
          <div style={{ fontSize: 10, color: "#a0b8d0", letterSpacing: "0.06em" }}>
            DECLARACIONES DE IMPORTACIÓN<br />
            <span style={{ color: "#6a8fb0" }}>Generador automático DIAN</span>
          </div>
        </div>
        <div style={{ fontSize: 10, color: "#6a8fb0", textAlign: "right" }}>
          <div>Google Drive · MANIFIESTOS</div>
          <div style={{ color: "#8faec8" }}>{new Date().toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long" })}</div>
        </div>
      </div>

      {/* TABS */}
      <div style={{ background: C.white, borderBottom: `1px solid ${C.border}`, padding: "0 2rem", display: "flex" }}>
        {[["work", "⚡ Procesar Facturas"], ["history", `📋 Historial (${history.length})`], ["contratos", `🚛 Contratos (${contratos.length})`]].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} style={{
            background: "transparent", border: "none",
            borderBottom: tab === key ? `3px solid ${C.blue}` : "3px solid transparent",
            color: tab === key ? C.blue : C.textMuted,
            padding: "12px 20px", cursor: "pointer", fontSize: 13,
            fontWeight: tab === key ? 700 : 400, marginBottom: -1, transition: "all 0.15s"
          }}>{label}</button>
        ))}
      </div>

      <div style={{ maxWidth: 1160, margin: "0 auto", padding: "1.5rem" }}>

        {/* TAB: PROCESAR */}
        {tab === "work" && (
          <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: "1.5rem" }}>

            {/* Panel izquierdo */}
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>

              {/* Flujo */}
              <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: "1.25rem", boxShadow: C.shadow }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: C.textDim, letterSpacing: "0.1em", marginBottom: 16 }}>FLUJO DE TRABAJO</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <Step n="1" label="Agregar facturas PDF" active={!queue.length} done={queue.length > 0} />
                  <Step n="2" label="Generar declaraciones" active={queue.length > 0 && !processing} done={doneCount > 0} />
                </div>
              </div>

              {/* Drop zone */}
              <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: "1.25rem", boxShadow: C.shadow }}>
                <label style={{ fontSize: 10, fontWeight: 700, color: C.textDim, letterSpacing: "0.1em", display: "block", marginBottom: 8 }}>
                  FACTURAS DE IMPORTACIÓN (PDF)
                </label>
                <div
                  onDrop={onDrop}
                  onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onClick={() => fileRef.current?.click()}
                  style={{
                    border: `2px dashed ${dragOver ? C.blue : C.border}`,
                    borderRadius: 8, padding: "1.5rem 1rem",
                    textAlign: "center", cursor: "pointer",
                    background: dragOver ? "#1255a408" : "#f8fafc",
                    transition: "all 0.2s"
                  }}
                >
                  <input ref={fileRef} type="file" accept=".pdf" multiple
                    onChange={e => addFiles(e.target.files)} style={{ display: "none" }} />
                  <div style={{ fontSize: 28, marginBottom: 8 }}>📂</div>
                  <div style={{ color: C.textMuted, fontSize: 12, fontWeight: 600 }}>Arrastra o haz clic</div>
                  <div style={{ color: C.textDim, fontSize: 10, marginTop: 4 }}>Puedes seleccionar varias facturas</div>
                </div>
              </div>

              {/* Botón principal */}
              <button
                onClick={processAll}
                disabled={!pendingCount || processing}
                style={{
                  background: pendingCount && !processing
                    ? `linear-gradient(135deg, ${C.accent}, ${C.gold})` : "#c8d6e5",
                  color: pendingCount && !processing ? C.white : C.textDim,
                  border: "none", borderRadius: 9, padding: "14px",
                  cursor: pendingCount && !processing ? "pointer" : "not-allowed",
                  fontWeight: 800, fontSize: 13, letterSpacing: "0.07em",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  boxShadow: pendingCount && !processing ? "0 4px 16px rgba(212,120,10,0.35)" : "none",
                  transition: "all 0.2s"
                }}
              >
                {processing ? <><Spinner /> Procesando...</> : `⚡ GENERAR PDF${pendingCount > 1 ? `S (${pendingCount})` : ""}`}
              </button>

              {doneCount > 0 && !processing && (
                <button onClick={clearDone} style={{
                  background: "transparent", color: C.textMuted,
                  border: `1px solid ${C.border}`, borderRadius: 7, padding: "8px",
                  cursor: "pointer", fontSize: 11
                }}>🗑 Limpiar completados</button>
              )}
            </div>

            {/* Panel derecho */}
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>

              {/* Cola */}
              <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden", boxShadow: C.shadow }}>
                <div style={{
                  background: `linear-gradient(135deg, ${C.navy}, ${C.navyMid})`,
                  padding: "0.875rem 1.25rem",
                  display: "flex", alignItems: "center", justifyContent: "space-between"
                }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: C.white }}>📋 Cola de procesamiento</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    {pendingCount > 0 && <Badge color="#a0c4ff">{pendingCount} pendiente{pendingCount !== 1 ? "s" : ""}</Badge>}
                    {doneCount > 0 && <Badge color="#81c784">{doneCount} listo{doneCount !== 1 ? "s" : ""}</Badge>}
                  </div>
                </div>
                <div style={{ padding: "1rem" }}>
                  {queue.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "3rem 1rem", color: C.textDim }}>
                      <div style={{ fontSize: 40, marginBottom: 12 }}>📄</div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: C.textMuted, marginBottom: 6 }}>No hay facturas en cola</div>
                      <div style={{ fontSize: 12 }}>Arrastra los PDFs al panel izquierdo</div>
                    </div>
                  ) : (
                    queue.map(item => <InvoiceRow key={item.id} item={item} onRemove={removeFromQueue} onPreview={openPreview} />)
                  )}
                </div>
              </div>

              {/* Log */}
              {activeLog.length > 0 && (
                <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden", boxShadow: C.shadow }}>
                  <div style={{ background: `linear-gradient(135deg, ${C.navy}, ${C.navyMid})`, padding: "0.6rem 1.25rem", fontSize: 10, fontWeight: 700, color: "#8faec8", letterSpacing: "0.1em" }}>ACTIVIDAD</div>
                  <div ref={logRef} style={{ padding: "0.75rem 1.25rem", fontFamily: "monospace", fontSize: 11, maxHeight: 200, overflowY: "auto", background: "#f8fafc" }}>
                    {activeLog.map((l, i) => (
                      <div key={i} style={{
                        color: l.msg.startsWith("✓") ? C.green : l.msg.startsWith("✗") ? C.red : l.msg.startsWith("⚠") ? C.accent : C.textMuted,
                        marginBottom: 3, display: "flex", gap: 8
                      }}>
                        <span style={{ color: C.textDim, flexShrink: 0 }}>{l.ts}</span>
                        <span>{l.msg}</span>
                      </div>
                    ))}
                    {processing && (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, color: C.blue, marginTop: 4 }}>
                        <Spinner size={12} /><span>En proceso...</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Instrucciones */}
              {queue.length === 0 && (
                <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: "1.5rem", boxShadow: C.shadow }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.textMuted, marginBottom: 12 }}>¿Cómo usar el sistema?</div>
                  {[
                    ["1", "Agrega una o varias facturas de importación en PDF"],
                    ["2", "Haz clic en GENERAR PDF — el sistema busca las declaraciones DIAN automáticamente"],
                    ["3", "Visualiza o descarga el PDF generado con todas las declaraciones"],
                  ].map(([n, txt]) => (
                    <div key={n} style={{ display: "flex", gap: 10, marginBottom: 10 }}>
                      <div style={{ width: 22, height: 22, borderRadius: "50%", background: C.blue, color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{n}</div>
                      <div style={{ fontSize: 12, color: C.textMuted, lineHeight: 1.5, paddingTop: 2 }}>{txt}</div>
                    </div>
                  ))}
                  <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: C.textDim, letterSpacing: "0.08em", marginBottom: 8 }}>PROVEEDORES DISPONIBLES</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {["DECOCAR", "OCT", "FRENTANA", "DISOLLE", "ALLEANZA", "ACERO", "OXFORD", "NADIR", "PASABACHE"].map(p => (
                        <Badge key={p} color={C.textMuted}>{p}</Badge>
                      ))}
                      <Badge color={C.textDim}>+17 más</Badge>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB: HISTORIAL */}
        {tab === "history" && (
          <div style={{ maxWidth: 800 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>Historial de procesamiento</div>
                <div style={{ fontSize: 12, color: C.textMuted }}>{history.length} factura{history.length !== 1 ? "s" : ""} en total</div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {[["today", "📅 Hoy"], ["all", "📋 Todo"]].map(([val, lbl]) => (
                  <button key={val} onClick={() => setHistFilter(val)} style={{
                    background: histFilter === val ? C.blue : "transparent",
                    color: histFilter === val ? "white" : C.textMuted,
                    border: `1px solid ${histFilter === val ? C.blue : C.border}`,
                    borderRadius: 7, padding: "5px 12px", cursor: "pointer", fontSize: 11, fontWeight: histFilter === val ? 700 : 400
                  }}>{lbl}</button>
                ))}
                {history.length > 0 && (
                  <button onClick={() => { localStorage.removeItem("alumar_hist"); setHistory([]); }}
                    style={{ background: "transparent", border: `1px solid ${C.border}`, borderRadius: 7, padding: "5px 12px", cursor: "pointer", fontSize: 11, color: C.textMuted }}>
                    🗑 Limpiar
                  </button>
                )}
              </div>
            </div>
            {(() => {
              const filtered = histFilter === "today"
                ? history.filter(e => new Date(e.date).toDateString() === todayStr())
                : history;
              return filtered.length === 0 ? (
              <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: "4rem 2rem", textAlign: "center", boxShadow: C.shadow }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: C.textMuted, marginBottom: 6 }}>
                  {histFilter === "today" ? "Sin facturas procesadas hoy" : "Sin historial todavía"}
                </div>
                <div style={{ fontSize: 12, color: C.textDim }}>
                  {histFilter === "today"
                    ? <span>¿Buscas días anteriores? <button onClick={() => setHistFilter("all")} style={{ background: "none", border: "none", color: C.blue, cursor: "pointer", fontSize: 12, textDecoration: "underline" }}>Ver todo el historial</button></span>
                    : "Las facturas procesadas aparecerán aquí."}
                </div>
              </div>
            ) : (
              <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: "1.25rem", boxShadow: C.shadow }}>
                {filtered.map(entry => <HistoryRow key={entry.id} entry={entry} />)}
              </div>
            );
            })()}
          </div>
        )}

        {/* TAB: CONTRATOS */}
        {tab === "contratos" && (
          <div style={{ maxWidth:860 }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
              <div>
                <div style={{ fontSize:16, fontWeight:700, color:C.text }}>Contratos de transporte</div>
                <div style={{ fontSize:12, color:C.textMuted }}>{contratos.length} contrato{contratos.length !== 1 ? "s" : ""} registrado{contratos.length !== 1 ? "s" : ""}</div>
              </div>
              <button onClick={() => { setEditingContrato(null); setShowContratoForm(true); }}
                style={{ background:`linear-gradient(135deg,${C.accent},${C.gold})`, color:"white", border:"none", borderRadius:8, padding:"10px 20px", cursor:"pointer", fontWeight:700, fontSize:13, boxShadow:"0 4px 14px rgba(212,120,10,0.35)" }}>
                + Nuevo contrato
              </button>
            </div>
            {contratos.length === 0 ? (
              <div style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:12, padding:"4rem 2rem", textAlign:"center", boxShadow:C.shadow }}>
                <div style={{ fontSize:40, marginBottom:12 }}>🚛</div>
                <div style={{ fontSize:14, fontWeight:600, color:C.textMuted, marginBottom:6 }}>Sin contratos registrados</div>
                <div style={{ fontSize:12, color:C.textDim }}>Haz clic en <strong>+ Nuevo contrato</strong> para crear el primero.</div>
              </div>
            ) : (
              <div style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:12, padding:"1.25rem", boxShadow:C.shadow }}>
                {contratos.map(c => (
                  <ContratoRow key={c.id} contrato={c} onEdit={(ct) => { setEditingContrato(ct); setShowContratoForm(true); }} />
                ))}
              </div>
            )}
          </div>
        )}

      </div>

      {/* Modal formulario contrato */}
      {showContratoForm && (
        <ContratoForm
          initial={editingContrato}
          nextNumero={nextNumero()}
          onSave={saveContrato}
          onCancel={() => { setShowContratoForm(false); setEditingContrato(null); }}
        />
      )}
    </div>
  );
}
