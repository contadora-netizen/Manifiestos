import { useState, useCallback, useRef, useEffect } from "react";
import RUTAS_HISTORICAS from "./rutasHistoricas.json";
import CONDUCTORES_INFO from "./conductoresInfo.json";
import DashboardContratos from "./DashboardContratos";

const API = import.meta.env.VITE_API_URL || "https://refreshing-gentleness-production-7a26.up.railway.app";
const CAPI_BASE = (import.meta.env.VITE_CAPI_URL || "").replace(/\/api$/, "") || "http://localhost:3000";
const GS = "https://script.google.com/macros/s/AKfycbzT419j_RKVp1RmtDMJ62T2bERbnu1yfZrFBrO2QdzR3jCeViFtXieMqRFOomUhCKrQ/exec";

// ── Google Sheets API ─────────────────────────────────────────────────────────
const gsGet = async (action, params = {}) => {
  const url = new URL(GS);
  url.searchParams.set("action", action);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString());
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || "Error Google Sheets");
  return json.data;
};
const gsPost = async (action, body = {}) => {
  const res = await fetch(GS, {
    method: "POST",
    body: JSON.stringify({ action, ...body }),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || "Error Google Sheets");
  return json.data;
};

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
${(Number(c.anticipo)||Number(c.retencion)||Number(c.reteica)) ? `
<div style="margin-top:4px;border:1px solid #000;border-radius:4px;padding:6px">
  <div style="font-size:7px;font-weight:700;letter-spacing:0.08em;color:#555;margin-bottom:4px">LIQUIDACIÓN DE PAGO</div>
  <div class="grid4">
    <div class="cell"><span class="lbl">Anticipo</span><span class="val">${fmt(c.anticipo||0)}</span></div>
    <div class="cell"><span class="lbl">Retención fuente</span><span class="val">${fmt(c.retencion||0)}</span></div>
    <div class="cell"><span class="lbl">ReteICA</span><span class="val">${fmt(c.reteica||0)}</span></div>
    <div class="cell"><span class="lbl"><strong>SALDO A PAGAR</strong></span><span class="val" style="font-weight:bold;font-size:11px;color:#1e7e34">${fmt(c.saldo_pagar||0)}</span></div>
  </div>
</div>` : ""}

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
  const displayName = item.isAuto ? item.label : item.file?.name;
  const displaySub  = item.isAuto
    ? `${item.cliente || ""}${item.ciudad ? ` · ${item.ciudad}` : ""} · ${item.refs?.length || 0} refs`
    : `${(item.file?.size / 1024).toFixed(0)} KB`;
  const noMatchFile = item.isAuto
    ? `no-match_${item.label}.txt`
    : `no-match_${(item.file?.name || "").replace(".pdf","")}.txt`;

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "8px 10px", borderRadius: 7,
      background: item.status === "processing" ? "#1255a408" : "#f8fafc",
      border: `1px solid ${item.status === "processing" ? C.blue + "44" : item.isAuto ? "#1e7e3444" : C.border}`,
      marginBottom: 6, transition: "all 0.2s"
    }}>
      <div style={{ fontSize: 18 }}>{item.isAuto ? "🤖" : "📄"}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {displayName}
          </div>
          {item.isAuto && (
            <span style={{ fontSize:9, background:"#e8f5e9", color:C.green, borderRadius:3, padding:"1px 5px", fontWeight:700, flexShrink:0 }}>BD AUTO</span>
          )}
        </div>
        <div style={{ fontSize: 10, color: C.textMuted }}>{displaySub}</div>
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
            <a href={item.reportUrl} download={noMatchFile}
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

// ── Conductor: formulario ─────────────────────────────────────────────────────
function ConductorForm({ onSave, onCancel, initial }) {
  const empty = {
    id: crypto.randomUUID(),
    nombre: "", cc: "", celular: "", telefono: "",
    direccion: "", ciudad: "",
    licencia_numero: "", licencia_categoria: "", licencia_vencimiento: "",
    soat: "", tecnicomecanica: "",
    vehiculo_marca: "", vehiculo_placas: "", vehiculo_propietario: "", vehiculo_licencia: "", aseguradora: "", capacidad: "", medidas: "",
    eps: "", arl: "",
    contacto_emergencia_nombre: "", contacto_emergencia_telefono: "",
    observaciones: "",
  };
  const [form, setForm] = useState(initial || empty);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

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
      <div style={{ maxWidth:860, margin:"0 auto", background:C.white, borderRadius:14, overflow:"hidden", boxShadow:"0 8px 48px rgba(0,0,0,0.5)" }}>
        <div style={{ background:`linear-gradient(135deg,${C.navy},${C.navyMid})`, borderBottom:"3px solid #d4780a", padding:"0.875rem 1.5rem", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            <div style={{ background:"#fff", border:"2px solid #2a2a2a", borderRadius:3, padding:"3px 8px", lineHeight:1 }}>
              <div style={{ fontFamily:"'Arial Black',Arial,sans-serif", fontWeight:900, fontSize:18, color:"#cc1111" }}>alumar</div>
            </div>
            <div style={{ color:"#fff", fontWeight:700, fontSize:14 }}>👤 {initial ? "Editar Conductor" : "Nuevo Conductor"}</div>
          </div>
          <button onClick={onCancel} style={{ background:"transparent", border:"1px solid #ffffff33", color:"#8faec8", borderRadius:7, padding:"6px 14px", cursor:"pointer", fontSize:12 }}>✕ Cerrar</button>
        </div>

        <div style={{ padding:"1.5rem" }}>
          <Sec t="DATOS PERSONALES" />
          <div style={g(4)}>
            <F label="Nombre completo" k="nombre" span={2} placeholder="Ej: Juan Carlos Pérez López" />
            <F label="Cédula (C.C.)" k="cc" placeholder="Ej: 13 456 789" />
            <F label="Celular" k="celular" placeholder="Ej: 300 123 4567" />
            <F label="Teléfono fijo" k="telefono" placeholder="Opcional" />
            <F label="Dirección" k="direccion" span={2} placeholder="Ej: Cra 5 # 12-34" />
            <F label="Ciudad" k="ciudad" placeholder="Ej: Cúcuta" />
          </div>

          <Sec t="LICENCIA DE CONDUCCIÓN" />
          <div style={g(4)}>
            <F label="N° Licencia" k="licencia_numero" span={2} />
            <F label="Categoría" k="licencia_categoria" placeholder="C1 / C2 / C3" />
            <F label="Vencimiento licencia" k="licencia_vencimiento" type="date" />
          </div>

          <Sec t="VEHÍCULO HABITUAL" />
          <div style={g(4)}>
            <F label="Marca" k="vehiculo_marca" placeholder="Ej: Kenworth" />
            <F label="Placas" k="vehiculo_placas" placeholder="Ej: UPD 123" />
            <F label="N° Licencia de tránsito" k="vehiculo_licencia" />
            <F label="Propietario tarjeta" k="vehiculo_propietario" span={2} />
            <F label="Capacidad" k="capacidad" placeholder="Ej: 10.000 kg" />
            <F label="Medidas" k="medidas" placeholder="Ej: 12x2.4x2.6 m" />
            <F label="SOAT vence" k="soat" type="date" />
            <F label="Técnico-mecánica vence" k="tecnicomecanica" type="date" />
            <F label="Compañía aseguradora" k="aseguradora" span={2} />
          </div>

          <Sec t="SEGURIDAD SOCIAL" />
          <div style={g(4)}>
            <F label="EPS" k="eps" span={2} placeholder="Ej: Sura, Sanitas, Nueva EPS..." />
            <F label="ARL" k="arl" span={2} placeholder="Ej: Positiva, Sura..." />
          </div>

          <Sec t="CONTACTO DE EMERGENCIA" />
          <div style={g(4)}>
            <F label="Nombre contacto" k="contacto_emergencia_nombre" span={2} />
            <F label="Teléfono contacto" k="contacto_emergencia_telefono" span={2} />
          </div>

          <div style={{ marginTop:16 }}>
            <label style={lbl}>Observaciones</label>
            <textarea value={form.observaciones||""} onChange={e => set("observaciones", e.target.value)}
              rows={2} style={{ ...inp, resize:"vertical" }} placeholder="Notas adicionales sobre el conductor..." />
          </div>

          <div style={{ display:"flex", justifyContent:"flex-end", gap:10, marginTop:20, paddingTop:16, borderTop:`1px solid ${C.border}` }}>
            <button onClick={onCancel} style={{ background:"transparent", border:`1px solid ${C.border}`, borderRadius:7, padding:"9px 20px", cursor:"pointer", color:C.textMuted, fontSize:12 }}>Cancelar</button>
            <button onClick={() => onSave(form)} style={{ background:`linear-gradient(135deg,${C.accent},${C.gold})`, color:"white", border:"none", borderRadius:7, padding:"9px 24px", cursor:"pointer", fontWeight:700, fontSize:13 }}>💾 Guardar conductor</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Conductor: helpers documentos ─────────────────────────────────────────────
const TIPOS_DOC = ["Licencia", "SOAT", "Técnico-mecánica", "Cédula", "EPS", "ARL", "Tarjeta propiedad", "Seguro", "Otro"];
const getDocsConductor = (id) => { try { return JSON.parse(localStorage.getItem(`alumar_docs_${id}`) || "[]"); } catch { return []; } };
const saveDocsConductor = (id, docs) => { try { localStorage.setItem(`alumar_docs_${id}`, JSON.stringify(docs)); } catch { alert("Almacenamiento lleno. Elimina documentos antiguos."); } };

// ── Conductor: helpers seguridad social ───────────────────────────────────────
const MESES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const getSegSal = (id) => { try { return JSON.parse(localStorage.getItem(`alumar_segsal_${id}`) || "[]"); } catch { return []; } };
const saveSegSal = (id, data) => { try { localStorage.setItem(`alumar_segsal_${id}`, JSON.stringify(data)); } catch { alert("Almacenamiento lleno."); } };

// ── Conductor: fila ───────────────────────────────────────────────────────────
function ConductorRow({ conductor: c, onEdit }) {
  const [open, setOpen] = useState(false);
  const [docs, setDocs] = useState(() => getDocsConductor(c.id));
  const [uploading, setUploading] = useState(false);
  const [nuevoTipo, setNuevoTipo] = useState("Licencia");
  const [nuevoNombre, setNuevoNombre] = useState("");
  const [docTab, setDocTab] = useState("info"); // "info" | "docs" | "segsal"
  const fileRef = useRef();
  const segFileRef = useRef();
  const [segsal, setSegsal] = useState(() => getSegSal(c.id));
  const [showSegForm, setShowSegForm] = useState(false);
  const [segUpload, setSegUpload] = useState(null);
  const emptySegForm = { mes: String(new Date().getMonth()), anio: String(new Date().getFullYear()), fecha_pago: "", total: "", eps_valor: "", arl_valor: "", pension_valor: "" };
  const [segForm, setSegForm] = useState(emptySegForm);

  const venceColor = (dateStr) => {
    if (!dateStr) return C.textDim;
    const diff = (new Date(dateStr) - new Date()) / (1000*60*60*24);
    if (diff < 0) return C.red;
    if (diff < 30) return C.accent;
    return C.green;
  };
  const FechaTag = ({ label, val }) => val ? (
    <span style={{ fontSize:10, background: venceColor(val)+"18", color: venceColor(val), border:`1px solid ${venceColor(val)}40`, borderRadius:4, padding:"2px 7px", fontWeight:600 }}>
      {label}: {new Date(val).toLocaleDateString("es-CO",{day:"2-digit",month:"short",year:"numeric"})}
    </span>
  ) : null;

  const tipoIcon = (t) => ({ Licencia:"🪪", SOAT:"🛡", "Técnico-mecánica":"🔧", Cédula:"🪪", EPS:"🏥", ARL:"⛑", "Tarjeta propiedad":"📋", Seguro:"📄", Otro:"📎" }[t] || "📄");

  const subirArchivo = async (file) => {
    if (file.size > 3 * 1024 * 1024) { alert("El archivo supera 3 MB. Comprime el PDF o imagen antes de subir."); return; }
    setUploading(true);
    const reader = new FileReader();
    reader.onloadend = () => {
      const nuevo = {
        id: crypto.randomUUID(),
        tipo: nuevoTipo,
        nombre: nuevoNombre.trim() || `${nuevoTipo} — ${file.name}`,
        archivo: file.name,
        mimetype: file.type,
        data: reader.result,
        size: file.size,
        fecha: new Date().toISOString(),
      };
      const updated = [nuevo, ...docs];
      saveDocsConductor(c.id, updated);
      setDocs(updated);
      setNuevoNombre("");
      setUploading(false);
    };
    reader.readAsDataURL(file);
  };

  const verDoc = (doc) => {
    const w = window.open("", "_blank");
    if (doc.mimetype?.startsWith("image/")) {
      w.document.write(`<html><body style="margin:0;background:#222;display:flex;align-items:center;justify-content:center;min-height:100vh">
        <img src="${doc.data}" style="max-width:100%;max-height:100vh;object-fit:contain" /></body></html>`);
    } else {
      w.document.write(`<html><body style="margin:0;height:100vh">
        <iframe src="${doc.data}" style="width:100%;height:100%;border:none"></iframe></body></html>`);
    }
    w.document.close();
  };

  const descargarDoc = (doc) => {
    const a = document.createElement("a");
    a.href = doc.data;
    a.download = doc.archivo || doc.nombre;
    a.click();
  };

  const eliminarDoc = (id) => {
    const updated = docs.filter(d => d.id !== id);
    saveDocsConductor(c.id, updated);
    setDocs(updated);
  };

  const inp = { border:`1px solid ${C.border}`, borderRadius:5, padding:"5px 8px", fontSize:11, color:C.text, outline:"none", background:C.white };

  return (
    <div style={{ border:`1px solid ${C.border}`, borderRadius:8, marginBottom:8, overflow:"hidden" }}>
      {/* Cabecera */}
      <div onClick={() => setOpen(o => !o)} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px", cursor:"pointer", background: open ? "#f0f4f8" : C.white, transition:"background 0.15s" }}>
        <div style={{ width:36, height:36, borderRadius:"50%", background:`linear-gradient(135deg,${C.blue},${C.navyMid})`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, flexShrink:0 }}>👤</div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:13, fontWeight:700, color:C.text }}>{c.nombre || "Sin nombre"}</div>
          <div style={{ fontSize:10, color:C.textMuted }}>{c.cc ? `C.C. ${c.cc}` : ""}{c.ciudad ? ` · ${c.ciudad}` : ""}{c.celular ? ` · ${c.celular}` : ""}</div>
        </div>
        {c.vehiculo_placas && <Badge color={C.navy}>{c.vehiculo_placas}</Badge>}
        {docs.length > 0 && <Badge color={C.blue}>📎 {docs.length} doc{docs.length!==1?"s":""}</Badge>}
        <FechaTag label="Lic." val={c.licencia_vencimiento} />
        <FechaTag label="SOAT" val={c.soat} />
        <button onClick={e => { e.stopPropagation(); onEdit(c); }}
          style={{ fontSize:11, background:C.accent, color:"white", border:"none", borderRadius:5, padding:"4px 12px", cursor:"pointer", fontWeight:700, flexShrink:0 }}>✏ Editar</button>
        <span style={{ color:C.textDim, fontSize:12 }}>{open ? "▲" : "▼"}</span>
      </div>

      {/* Panel expandido */}
      {open && (
        <div style={{ borderTop:`1px solid ${C.border}`, background:"#f8fafc" }}>
          {/* Sub-tabs */}
          <div style={{ display:"flex", borderBottom:`1px solid ${C.border}`, background:C.white }}>
            {[["info","📋 Información"],["docs",`📎 Documentos (${docs.length})`],["segsal",`🏥 Seg. Social${segsal.length > 0 ? ` (${segsal.length})` : ""}`]].map(([k,lbl]) => (
              <button key={k} onClick={() => setDocTab(k)} style={{
                background:"transparent", border:"none",
                borderBottom: docTab===k ? `2px solid ${C.blue}` : "2px solid transparent",
                color: docTab===k ? C.blue : C.textMuted,
                padding:"8px 16px", cursor:"pointer", fontSize:11,
                fontWeight: docTab===k ? 700 : 400, marginBottom:-1
              }}>{lbl}</button>
            ))}
          </div>

          {/* TAB INFO */}
          {docTab === "info" && (
            <div style={{ padding:"12px 14px" }}>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:"8px 16px", fontSize:11 }}>
                {c.licencia_numero && <div><span style={{ color:C.textDim }}>Licencia N°: </span><strong>{c.licencia_numero}</strong>{c.licencia_categoria ? ` (${c.licencia_categoria})` : ""}</div>}
                {c.vehiculo_marca && <div><span style={{ color:C.textDim }}>Vehículo: </span><strong>{c.vehiculo_marca} {c.vehiculo_placas}</strong></div>}
                {c.aseguradora && <div><span style={{ color:C.textDim }}>Aseguradora: </span><strong>{c.aseguradora}</strong></div>}
                {c.eps && <div><span style={{ color:C.textDim }}>EPS: </span><strong>{c.eps}</strong></div>}
                {c.arl && <div><span style={{ color:C.textDim }}>ARL: </span><strong>{c.arl}</strong></div>}
                {c.vehiculo_propietario && <div><span style={{ color:C.textDim }}>Propietario: </span><strong>{c.vehiculo_propietario}</strong></div>}
                {c.contacto_emergencia_nombre && <div style={{ gridColumn:"span 2" }}><span style={{ color:C.textDim }}>Emergencias: </span><strong>{c.contacto_emergencia_nombre}</strong>{c.contacto_emergencia_telefono ? ` · ${c.contacto_emergencia_telefono}` : ""}</div>}
                {c.observaciones && <div style={{ gridColumn:"span 3", color:C.textMuted, fontStyle:"italic" }}>{c.observaciones}</div>}
              </div>
              <div style={{ display:"flex", gap:6, marginTop:10, flexWrap:"wrap" }}>
                <FechaTag label="Lic. vence" val={c.licencia_vencimiento} />
                <FechaTag label="SOAT vence" val={c.soat} />
                <FechaTag label="Técnomecánica vence" val={c.tecnicomecanica} />
              </div>
            </div>
          )}

          {/* TAB DOCUMENTOS */}
          {docTab === "docs" && (
            <div style={{ padding:"12px 14px" }}>
              {/* Subir nuevo documento */}
              <div style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:8, padding:"10px 12px", marginBottom:12 }}>
                <div style={{ fontSize:10, fontWeight:700, color:C.textDim, letterSpacing:"0.08em", marginBottom:8 }}>SUBIR DOCUMENTO ESCANEADO</div>
                <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
                  <select value={nuevoTipo} onChange={e => setNuevoTipo(e.target.value)}
                    style={{ ...inp, minWidth:140 }}>
                    {TIPOS_DOC.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <input value={nuevoNombre} onChange={e => setNuevoNombre(e.target.value)}
                    placeholder="Nombre descriptivo (opcional)" style={{ ...inp, flex:1, minWidth:160 }} />
                  <button onClick={() => fileRef.current?.click()} disabled={uploading}
                    style={{ background:C.blue, color:"white", border:"none", borderRadius:6, padding:"6px 14px", cursor:"pointer", fontWeight:700, fontSize:11, flexShrink:0 }}>
                    {uploading ? "Subiendo..." : "📎 Seleccionar archivo"}
                  </button>
                  <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp"
                    style={{ display:"none" }}
                    onChange={e => { if (e.target.files[0]) subirArchivo(e.target.files[0]); e.target.value=""; }} />
                </div>
                <div style={{ fontSize:10, color:C.textDim, marginTop:6 }}>Acepta PDF, JPG, PNG · Máximo 3 MB por archivo</div>
              </div>

              {/* Lista de documentos */}
              {docs.length === 0 ? (
                <div style={{ textAlign:"center", padding:"1.5rem", color:C.textDim, fontSize:12 }}>
                  📂 No hay documentos subidos aún. Sube el escáner de la licencia, SOAT u otros.
                </div>
              ) : (
                <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                  {docs.map(doc => (
                    <div key={doc.id} style={{ display:"flex", alignItems:"center", gap:10, background:C.white, border:`1px solid ${C.border}`, borderRadius:7, padding:"8px 12px" }}>
                      <div style={{ fontSize:20, flexShrink:0 }}>{tipoIcon(doc.tipo)}</div>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:12, fontWeight:600, color:C.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{doc.nombre}</div>
                        <div style={{ fontSize:10, color:C.textMuted }}>
                          <Badge color={C.blue}>{doc.tipo}</Badge>
                          {" · "}{(doc.size/1024).toFixed(0)} KB
                          {" · "}{new Date(doc.fecha).toLocaleDateString("es-CO",{day:"2-digit",month:"short",year:"numeric"})}
                        </div>
                      </div>
                      <button onClick={() => verDoc(doc)}
                        style={{ fontSize:11, background:C.blue, color:"white", border:"none", borderRadius:5, padding:"4px 10px", cursor:"pointer", fontWeight:700 }}>👁 Ver</button>
                      <button onClick={() => descargarDoc(doc)}
                        style={{ fontSize:11, background:C.green, color:"white", border:"none", borderRadius:5, padding:"4px 10px", cursor:"pointer", fontWeight:700 }}>⬇</button>
                      <button onClick={() => { if(confirm("¿Eliminar este documento?")) eliminarDoc(doc.id); }}
                        style={{ fontSize:11, background:"transparent", border:`1px solid ${C.border}`, color:C.red, borderRadius:5, padding:"4px 8px", cursor:"pointer", fontWeight:700 }}>✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {/* TAB SEGURIDAD SOCIAL */}
          {docTab === "segsal" && (
            <div style={{ padding:"12px 14px" }}>
              {/* Header + botón */}
              <div style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:8, padding:"10px 12px", marginBottom:12 }}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom: showSegForm ? 12 : 0 }}>
                  <div style={{ fontSize:10, fontWeight:700, color:C.textDim, letterSpacing:"0.08em" }}>PLANILLAS DE SEGURIDAD SOCIAL</div>
                  <button onClick={() => { setShowSegForm(v => !v); setSegUpload(null); setSegForm(emptySegForm); }}
                    style={{ background: showSegForm ? "transparent" : C.blue, color: showSegForm ? C.textMuted : "white", border:`1px solid ${showSegForm ? C.border : C.blue}`, borderRadius:6, padding:"5px 14px", cursor:"pointer", fontWeight:700, fontSize:11 }}>
                    {showSegForm ? "✕ Cancelar" : "➕ Nueva planilla"}
                  </button>
                </div>

                {showSegForm && (
                  <div>
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:8 }}>
                      <div>
                        <label style={{ fontSize:10, color:C.textMuted, fontWeight:600, display:"block", marginBottom:3 }}>Mes</label>
                        <select value={segForm.mes} onChange={e => setSegForm(f => ({...f, mes: e.target.value}))} style={{ ...inp, cursor:"pointer" }}>
                          {MESES.map((m,i) => <option key={i} value={String(i)}>{m}</option>)}
                        </select>
                      </div>
                      <div>
                        <label style={{ fontSize:10, color:C.textMuted, fontWeight:600, display:"block", marginBottom:3 }}>Año</label>
                        <input value={segForm.anio} onChange={e => setSegForm(f => ({...f, anio: e.target.value}))} style={inp} placeholder="2026" />
                      </div>
                      <div>
                        <label style={{ fontSize:10, color:C.textMuted, fontWeight:600, display:"block", marginBottom:3 }}>Fecha de pago</label>
                        <input type="date" value={segForm.fecha_pago} onChange={e => setSegForm(f => ({...f, fecha_pago: e.target.value}))} style={inp} />
                      </div>
                      <div>
                        <label style={{ fontSize:10, color:C.textMuted, fontWeight:600, display:"block", marginBottom:3 }}>Total pagado $</label>
                        <input type="number" value={segForm.total} onChange={e => setSegForm(f => ({...f, total: e.target.value}))} style={inp} placeholder="575800" />
                      </div>
                      <div>
                        <label style={{ fontSize:10, color:C.textMuted, fontWeight:600, display:"block", marginBottom:3 }}>🏥 Salud (EPS) $</label>
                        <input type="number" value={segForm.eps_valor} onChange={e => setSegForm(f => ({...f, eps_valor: e.target.value}))} style={inp} />
                      </div>
                      <div>
                        <label style={{ fontSize:10, color:C.textMuted, fontWeight:600, display:"block", marginBottom:3 }}>⛑ ARL $</label>
                        <input type="number" value={segForm.arl_valor} onChange={e => setSegForm(f => ({...f, arl_valor: e.target.value}))} style={inp} />
                      </div>
                      <div>
                        <label style={{ fontSize:10, color:C.textMuted, fontWeight:600, display:"block", marginBottom:3 }}>💰 Pensión $</label>
                        <input type="number" value={segForm.pension_valor} onChange={e => setSegForm(f => ({...f, pension_valor: e.target.value}))} style={inp} />
                      </div>
                      <div>
                        <label style={{ fontSize:10, color:C.textMuted, fontWeight:600, display:"block", marginBottom:3 }}>📎 Escáner planilla</label>
                        <button onClick={() => segFileRef.current?.click()}
                          style={{ background: segUpload ? C.green : "#f0f4f8", color: segUpload ? "white" : C.textMuted, border:`1px solid ${segUpload ? C.green : C.border}`, borderRadius:5, padding:"6px 8px", cursor:"pointer", fontSize:10, width:"100%", fontWeight:600 }}>
                          {segUpload ? `✓ ${segUpload.nombre.slice(0,18)}` : "📎 Adjuntar PDF"}
                        </button>
                        <input ref={segFileRef} type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display:"none" }}
                          onChange={e => {
                            const f = e.target.files[0];
                            if (!f) return;
                            if (f.size > 5*1024*1024) { alert("Máximo 5 MB"); return; }
                            const fr = new FileReader();
                            fr.onloadend = () => setSegUpload({ data: fr.result, nombre: f.name, mimetype: f.type });
                            fr.readAsDataURL(f);
                            e.target.value = "";
                          }} />
                      </div>
                    </div>
                    <div style={{ display:"flex", justifyContent:"flex-end", gap:8, marginTop:12, paddingTop:10, borderTop:`1px solid ${C.border}` }}>
                      <button onClick={() => { setShowSegForm(false); setSegForm(emptySegForm); setSegUpload(null); }}
                        style={{ background:"transparent", border:`1px solid ${C.border}`, borderRadius:6, padding:"6px 16px", cursor:"pointer", color:C.textMuted, fontSize:11 }}>Cancelar</button>
                      <button onClick={() => {
                        if (!segForm.fecha_pago) { alert("Ingresa la fecha de pago"); return; }
                        const nuevo = {
                          id: crypto.randomUUID(),
                          mes: segForm.mes, anio: segForm.anio,
                          mes_nombre: MESES[parseInt(segForm.mes)],
                          fecha_pago: segForm.fecha_pago,
                          total: Number(segForm.total) || 0,
                          eps_valor: Number(segForm.eps_valor) || 0,
                          arl_valor: Number(segForm.arl_valor) || 0,
                          pension_valor: Number(segForm.pension_valor) || 0,
                          archivo: segUpload?.data || null,
                          nombre_archivo: segUpload?.nombre || null,
                          mimetype: segUpload?.mimetype || null,
                          fecha_subida: new Date().toISOString(),
                        };
                        const updated = [nuevo, ...segsal].sort((a,b) => parseInt(b.anio)*12+parseInt(b.mes) - (parseInt(a.anio)*12+parseInt(a.mes)));
                        saveSegSal(c.id, updated);
                        setSegsal(updated);
                        setShowSegForm(false);
                        setSegForm(emptySegForm);
                        setSegUpload(null);
                      }} style={{ background:`linear-gradient(135deg,${C.accent},${C.gold})`, color:"white", border:"none", borderRadius:6, padding:"6px 20px", cursor:"pointer", fontWeight:700, fontSize:11 }}>
                        💾 Guardar planilla
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Lista planillas */}
              {segsal.length === 0 ? (
                <div style={{ textAlign:"center", padding:"2rem", color:C.textDim, fontSize:12 }}>
                  📋 No hay planillas registradas. Agrega la del mes actual con <strong>➕ Nueva planilla</strong>.
                </div>
              ) : (
                <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                  {segsal.map(p => {
                    const diasDesde = Math.floor((new Date() - new Date(p.fecha_pago)) / (1000*60*60*24));
                    const col = diasDesde <= 35 ? C.green : diasDesde <= 70 ? C.accent : C.red;
                    const fmt = v => v ? `$${Number(v).toLocaleString("es-CO")}` : "—";
                    return (
                      <div key={p.id} style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:8, padding:"10px 14px" }}>
                        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
                          <span style={{ background:`${col}18`, color:col, border:`1px solid ${col}40`, borderRadius:5, padding:"3px 10px", fontSize:12, fontWeight:700 }}>
                            {p.mes_nombre} {p.anio}
                          </span>
                          <span style={{ fontSize:11, color:C.textMuted }}>
                            Pagado: {new Date(p.fecha_pago).toLocaleDateString("es-CO",{day:"2-digit",month:"short",year:"numeric"})}
                          </span>
                          <span style={{ fontSize:12, fontWeight:700, color:C.text, marginLeft:"auto" }}>{fmt(p.total)}</span>
                          {p.archivo && (
                            <button onClick={() => {
                              const w = window.open("","_blank");
                              if (p.mimetype?.startsWith("image/")) {
                                w.document.write(`<html><body style="margin:0;background:#222;display:flex;align-items:center;justify-content:center;min-height:100vh"><img src="${p.archivo}" style="max-width:100%;max-height:100vh;object-fit:contain"/></body></html>`);
                              } else {
                                w.document.write(`<html><body style="margin:0;height:100vh"><iframe src="${p.archivo}" style="width:100%;height:100%;border:none"></iframe></body></html>`);
                              }
                              w.document.close();
                            }} style={{ fontSize:11, background:C.blue, color:"white", border:"none", borderRadius:5, padding:"3px 10px", cursor:"pointer", fontWeight:700 }}>👁 Ver</button>
                          )}
                          <button onClick={() => { if(confirm(`¿Eliminar planilla ${p.mes_nombre} ${p.anio}?`)) { const u = segsal.filter(s => s.id !== p.id); saveSegSal(c.id, u); setSegsal(u); }}}
                            style={{ fontSize:11, background:"transparent", border:`1px solid ${C.border}`, color:C.red, borderRadius:5, padding:"3px 8px", cursor:"pointer", fontWeight:700 }}>✕</button>
                        </div>
                        <div style={{ display:"flex", gap:16, fontSize:11, color:C.textMuted }}>
                          {p.eps_valor > 0 && <span>🏥 Salud: <strong style={{color:C.text}}>{fmt(p.eps_valor)}</strong></span>}
                          {p.arl_valor > 0 && <span>⛑ ARL: <strong style={{color:C.text}}>{fmt(p.arl_valor)}</strong></span>}
                          {p.pension_valor > 0 && <span>💰 Pensión: <strong style={{color:C.text}}>{fmt(p.pension_valor)}</strong></span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

        </div>
      )}
    </div>
  );
}

// ── Contrato: formulario ──────────────────────────────────────────────────────
function ContratoForm({ onSave, onCancel, initial, nextNumero, conductoresList = [] }) {
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
    anticipo: "", retencion: "", reteica: "", saldo_pagar: "",
    observaciones: "",
  };
  const [form, setForm] = useState(initial || empty);
  const [conductorHistorico, setConductorHistorico] = useState("");
  const [rutaHistorica, setRutaHistorica] = useState("");
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  useEffect(() => {
    const total = (Number(form.valor_contrato)||0) + (Number(form.valor_pelete)||0) + (Number(form.valor_palencia)||0);
    if (total > 0) setForm(f => ({ ...f, valor_total: total }));
  }, [form.valor_contrato, form.valor_pelete, form.valor_palencia]);

  useEffect(() => {
    const base   = Number(form.valor_total)  || 0;
    const ant    = Number(form.anticipo)     || 0;
    const ret    = Number(form.retencion)    || 0;
    const rica   = Number(form.reteica)      || 0;
    setForm(f => ({ ...f, saldo_pagar: base - ant - ret - rica }));
  }, [form.valor_total, form.anticipo, form.retencion, form.reteica]);

  const [vehiculoSeleccionado, setVehiculoSeleccionado] = useState("");
  const [filtroCiudad, setFiltroCiudad] = useState("");
  const [filtroAnio, setFiltroAnio] = useState("");
  const conductoresHistoricos = Object.keys(RUTAS_HISTORICAS).sort();
  const todasLasRutas = conductorHistorico ? RUTAS_HISTORICAS[conductorHistorico] || [] : [];
  // Años disponibles a partir de ultima_fecha (únicas, descendentes)
  const aniosDisponibles = [...new Set(
    todasLasRutas.map(r => r.ultima_fecha ? r.ultima_fecha.slice(0,4) : null).filter(Boolean)
  )].sort((a,b) => b - a);
  // Aplicar filtros
  const rutasDelConductor = todasLasRutas.filter(r => {
    const ciudadOk = filtroCiudad.trim() === "" || r.ruta.toUpperCase().includes(filtroCiudad.toUpperCase().trim());
    const anioOk   = filtroAnio === "" || (r.ultima_fecha && r.ultima_fecha.startsWith(filtroAnio));
    return ciudadOk && anioOk;
  });
  const rutaSeleccionada = todasLasRutas.find(r => r.ruta === rutaHistorica);
  const infoconductor = conductorHistorico ? CONDUCTORES_INFO[conductorHistorico] : null;
  const vehiculosDelConductor = infoconductor?.vehiculos || [];

  const aplicarConductor = (nombreConductor, vehiculo) => {
    const info = CONDUCTORES_INFO[nombreConductor];
    if (!info) return;
    setForm(f => ({
      ...f,
      conductor_nombre: f.conductor_nombre || nombreConductor,
      contratista_nombre: f.contratista_nombre || nombreConductor,
      contratista_cc: f.contratista_cc || info.cc || "",
      eps: info.eps || f.eps || "",
      arl: info.arl || f.arl || "",
      licencia_categoria: info.licencia_categoria || f.licencia_categoria || "",
      ...(vehiculo ? {
        vehiculo_placas: vehiculo.placas || f.vehiculo_placas || "",
        vehiculo_marca: vehiculo.tipo || f.vehiculo_marca || "",
        vehiculo_soat: vehiculo.soat || f.vehiculo_soat || "",
        tecnicomecanica: vehiculo.tecnicomecanica || f.tecnicomecanica || "",
        vehiculo_propietario: vehiculo.propietario || f.vehiculo_propietario || "",
        capacidad: vehiculo.capacidad || f.capacidad || "",
        medidas: vehiculo.medidas || f.medidas || "",
      } : {}),
    }));
  };

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

          {/* ── Selector rápido historial ────────────────────────────── */}
          <div style={{ background:"#f0f4f8", border:`1px solid ${C.border}`, borderRadius:10, padding:"14px 16px", marginBottom:20 }}>
            <div style={{ fontSize:10, fontWeight:700, color:C.textDim, letterSpacing:"0.1em", marginBottom:10 }}>
              ⚡ AUTOCOMPLETAR DESDE HISTORIAL DE FLETES
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10 }}>
              {/* Conductor */}
              <div>
                <label style={lbl}>Conductor (historial 2024-2026)</label>
                <select value={conductorHistorico} onChange={e => {
                    const nombre = e.target.value;
                    setConductorHistorico(nombre);
                    setRutaHistorica("");
                    setVehiculoSeleccionado("");
                    setFiltroCiudad("");
                    setFiltroAnio("");
                    if (nombre) aplicarConductor(nombre, null);
                  }} style={{ ...inp, cursor:"pointer" }}>
                  <option value="">— Seleccionar conductor —</option>
                  {conductoresHistoricos.map(c => (
                    <option key={c} value={c}>{c} ({RUTAS_HISTORICAS[c].length} rutas)</option>
                  ))}
                </select>
              </div>

              {/* Vehículo */}
              <div>
                <label style={lbl}>Vehículo{infoconductor && vehiculosDelConductor.length === 0 ? " (sin registro)" : ""}</label>
                <select value={vehiculoSeleccionado}
                  onChange={e => {
                    setVehiculoSeleccionado(e.target.value);
                    const veh = vehiculosDelConductor.find(v => v.placas === e.target.value);
                    if (veh) aplicarConductor(conductorHistorico, veh);
                  }}
                  disabled={!conductorHistorico || vehiculosDelConductor.length === 0}
                  style={{ ...inp, cursor: conductorHistorico && vehiculosDelConductor.length > 0 ? "pointer" : "not-allowed", opacity: conductorHistorico ? 1 : 0.5 }}>
                  <option value="">— Seleccionar vehículo —</option>
                  {vehiculosDelConductor.map((v,i) => (
                    <option key={i} value={v.placas}>
                      {v.placas} · {v.tipo}{v.capacidad ? ` · ${v.capacidad}` : ""}{v.soat ? ` · SOAT: ${new Date(v.soat).toLocaleDateString("es-CO",{day:"2-digit",month:"short",year:"numeric"})}` : ""}
                    </option>
                  ))}
                </select>
              </div>

              {/* Ruta */}
              {/* Ruta — con filtros ciudad y año */}
              <div style={{ gridColumn: "span 1" }}>
                <label style={lbl}>
                  Ruta
                  {rutaSeleccionada ? ` · ${rutaSeleccionada.viajes}x · Prom $${rutaSeleccionada.valor_promedio.toLocaleString("es-CO")}` : ""}
                  {conductorHistorico && rutasDelConductor.length !== todasLasRutas.length
                    ? ` · ${rutasDelConductor.length}/${todasLasRutas.length} filtradas`
                    : conductorHistorico ? ` · ${todasLasRutas.length} rutas` : ""}
                </label>
                {/* Filtros: ciudad + año */}
                {conductorHistorico && (
                  <div style={{ display:"flex", gap:6, marginBottom:5 }}>
                    <input
                      type="text"
                      placeholder="🔍 Buscar ciudad..."
                      value={filtroCiudad}
                      onChange={e => { setFiltroCiudad(e.target.value); setRutaHistorica(""); }}
                      style={{ ...inp, flex:1, fontSize:11, padding:"4px 7px" }}
                    />
                    <select
                      value={filtroAnio}
                      onChange={e => { setFiltroAnio(e.target.value); setRutaHistorica(""); }}
                      style={{ ...inp, width:76, fontSize:11, padding:"4px 6px", cursor:"pointer" }}>
                      <option value="">Todos</option>
                      {aniosDisponibles.map(a => <option key={a} value={a}>{a}</option>)}
                    </select>
                  </div>
                )}
                <select value={rutaHistorica}
                  onChange={e => {
                    setRutaHistorica(e.target.value);
                    const ruta = todasLasRutas.find(r => r.ruta === e.target.value);
                    if (ruta) setForm(f => ({
                      ...f,
                      destino: ruta.ruta,
                      valor_contrato: ruta.valor_promedio,
                    }));
                  }}
                  disabled={!conductorHistorico}
                  style={{ ...inp, cursor: conductorHistorico ? "pointer" : "not-allowed", opacity: conductorHistorico ? 1 : 0.5 }}>
                  <option value="">
                    {rutasDelConductor.length === 0 && conductorHistorico
                      ? "— Sin rutas para este filtro —"
                      : "— Seleccionar ruta —"}
                  </option>
                  {rutasDelConductor.map((r,i) => (
                    <option key={i} value={r.ruta}>
                      {r.ultima_fecha ? new Date(r.ultima_fecha).toLocaleDateString("es-CO",{day:"2-digit",month:"short",year:"numeric"}) : "Sin fecha"} · {r.viajes}x · ${r.valor_promedio.toLocaleString("es-CO")} · {r.ruta}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {(conductorHistorico || rutaSeleccionada) && (
              <div style={{ marginTop:8, fontSize:11, color:C.green, fontWeight:600 }}>
                ✓ {[
                  conductorHistorico && "nombre y cédula",
                  vehiculoSeleccionado && "placa, SOAT y tecno-mecánica",
                  rutaSeleccionada && `destino y valor sugerido $${rutaSeleccionada.valor_promedio.toLocaleString("es-CO")}`,
                ].filter(Boolean).join(" · ")} autocompletados. Puedes ajustar los campos abajo.
              </div>
            )}
          </div>

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
          {conductoresList.length > 0 && (
            <div style={{ marginBottom:10 }}>
              <label style={lbl}>Seleccionar conductor guardado (opcional)</label>
              <select onChange={e => {
                const c = conductoresList.find(x => x.id === e.target.value);
                if (!c) return;
                setForm(f => ({
                  ...f,
                  conductor_nombre: c.nombre || f.conductor_nombre,
                  conductor_celular: c.celular || f.conductor_celular,
                  contratista_nombre: c.nombre || f.contratista_nombre,
                  contratista_cc: c.cc || f.contratista_cc,
                  contratista_telefono: c.celular || f.contratista_telefono,
                  contratista_domicilio: c.direccion || f.contratista_domicilio,
                  contratista_ciudad: c.ciudad || f.contratista_ciudad,
                  vehiculo_marca: c.vehiculo_marca || f.vehiculo_marca,
                  vehiculo_placas: c.vehiculo_placas || f.vehiculo_placas,
                  vehiculo_licencia: c.vehiculo_licencia || f.vehiculo_licencia,
                  vehiculo_soat: c.soat || f.vehiculo_soat,
                  tecnicomecanica: c.tecnicomecanica || f.tecnicomecanica,
                  vehiculo_propietario: c.vehiculo_propietario || f.vehiculo_propietario,
                  aseguradora: c.aseguradora || f.aseguradora,
                  capacidad: c.capacidad || f.capacidad,
                  medidas: c.medidas || f.medidas,
                }));
              }} defaultValue="" style={{ ...inp, cursor:"pointer" }}>
                <option value="">— Elegir conductor —</option>
                {conductoresList.map(c => (
                  <option key={c.id} value={c.id}>{c.nombre}{c.vehiculo_placas ? ` · ${c.vehiculo_placas}` : ""}</option>
                ))}
              </select>
            </div>
          )}
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

          {/* ── Liquidación de pago ─────────────────────────────────── */}
          <Sec t="LIQUIDACIÓN DE PAGO" />
          <div style={{ background:"#f8fbff", border:`1px solid ${C.border}`, borderRadius:10, padding:"14px 16px" }}>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10, marginBottom:12 }}>
              <div>
                <label style={lbl}>Anticipo $</label>
                <input type="number" value={form.anticipo||""} onChange={e => set("anticipo",e.target.value)}
                  placeholder="0" style={inp} />
              </div>
              <div>
                <label style={lbl}>Retención en la fuente $</label>
                <input type="number" value={form.retencion||""} onChange={e => set("retencion",e.target.value)}
                  placeholder="0" style={inp} />
              </div>
              <div>
                <label style={lbl}>ReteICA $</label>
                <input type="number" value={form.reteica||""} onChange={e => set("reteica",e.target.value)}
                  placeholder="0" style={inp} />
              </div>
              <div>
                <label style={{ ...lbl, color: form.saldo_pagar < 0 ? C.red : C.green }}>
                  Saldo a pagar $ {form.saldo_pagar < 0 ? "⚠" : ""}
                </label>
                <input readOnly
                  value={form.saldo_pagar !== "" && form.valor_total
                    ? `$${Number(form.saldo_pagar).toLocaleString("es-CO")}` : ""}
                  style={{ ...inp, background: form.saldo_pagar < 0 ? "#fff0f0" : "#e8f5e9",
                    fontWeight: 700, fontSize: 13,
                    color: form.saldo_pagar < 0 ? C.red : C.green,
                    border: `1px solid ${form.saldo_pagar < 0 ? C.red : C.green}` }} />
              </div>
            </div>
            {/* Resumen visual */}
            {form.valor_total > 0 && (
              <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center", fontSize:11, color:C.textMuted, borderTop:`1px dashed ${C.border}`, paddingTop:10 }}>
                <span>SS Total <strong style={{ color:C.text }}>${Number(form.valor_total||0).toLocaleString("es-CO")}</strong></span>
                {Number(form.anticipo) > 0 && <><span style={{ color:C.textDim }}>−</span><span>Anticipo <strong style={{ color:C.accent }}>${Number(form.anticipo).toLocaleString("es-CO")}</strong></span></>}
                {Number(form.retencion) > 0 && <><span style={{ color:C.textDim }}>−</span><span>Retención <strong style={{ color:C.red }}>${Number(form.retencion).toLocaleString("es-CO")}</strong></span></>}
                {Number(form.reteica) > 0 && <><span style={{ color:C.textDim }}>−</span><span>ReteICA <strong style={{ color:C.red }}>${Number(form.reteica).toLocaleString("es-CO")}</strong></span></>}
                <span style={{ color:C.textDim }}>=</span>
                <span style={{ fontWeight:700, fontSize:13, color: form.saldo_pagar < 0 ? C.red : C.green }}>
                  Saldo ${Number(form.saldo_pagar||0).toLocaleString("es-CO")}
                </span>
              </div>
            )}
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

// ── Procesados: pestaña con consulta BD + búsqueda declaraciones en Drive ─────
function ProcesadosTab({ procesados, procesadosLoading, recargarProcesados, capiBase }) {
  const ayer = new Date(); ayer.setDate(ayer.getDate() - 1);
  const ayerStr = ayer.toISOString().slice(0, 10);
  const [bdFecha, setBdFecha] = useState(ayerStr);
  const [bdLoading, setBdLoading] = useState(false);
  const [bdResumen, setBdResumen] = useState(null);
  const [bdError, setBdError] = useState("");

  // Drive search state
  const [driveLoading, setDriveLoading] = useState(false);
  const [driveLogs, setDriveLogs] = useState([]);
  const [driveItems, setDriveItems] = useState([]); // por factura
  const [driveError, setDriveError] = useState("");
  const logRef = useRef(null);

  const fmt = v => v ? `$${Number(v).toLocaleString("es-CO")}` : "—";

  const addLog = (msg) => {
    setDriveLogs(prev => [...prev, { time: new Date().toLocaleTimeString("es-CO"), msg }]);
    setTimeout(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, 60);
  };

  const consultarBD = async () => {
    if (!bdFecha) return;
    setBdLoading(true); setBdError(""); setBdResumen(null);
    setDriveItems([]); setDriveLogs([]); setDriveError("");
    try {
      const r = await fetch(`${capiBase}/api/declaraciones/dia/${bdFecha}`);
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || "Error en la consulta");
      setBdResumen(d);
    } catch (e) {
      setBdError(e.message);
    } finally {
      setBdLoading(false);
    }
  };

  const buscarDeclaraciones = async () => {
    if (!bdFecha || driveLoading) return;
    setDriveLoading(true);
    setDriveLogs([]);
    setDriveItems([]);
    setDriveError("");

    try {
      addLog(`📅 Consultando referencias del ${bdFecha} en la BD...`);

      // Paso 1: obtener referencias de producto por factura
      const r = await fetch(`${capiBase}/api/facturas/dia/${bdFecha}/referencias`);
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || "Error consultando referencias");

      const facturas = d.facturas || [];
      const tablaOk = d.tabla_detalle_encontrada;
      addLog(`🗄️ ${facturas.length} facturas · ${tablaOk ? `tabla de detalle: ${tablaOk}` : "sin tabla de detalle — solo número de factura"}`);

      if (!facturas.length) {
        addLog("⚠ No hay facturas para esta fecha.");
        setDriveLoading(false);
        return;
      }

      // Inicializar items para mostrar el progreso
      setDriveItems(facturas.map(f => ({
        factura: f.factura_numero,
        factura_label: f.factura_label || f.factura_numero,
        cliente: f.cliente || "",
        ciudad: f.ciudad || "",
        refs: f.referencias || [],
        status: "pending",
        resumen: [],
        notFound: [],
        url: null,
        filename: null,
      })));

      // Cargar cache de productos
      let cache = {};
      try { const raw = localStorage.getItem("alumar_product_cache"); if (raw) cache = JSON.parse(raw); } catch {}

      // Paso 2: procesar cada factura contra Drive
      for (let i = 0; i < facturas.length; i++) {
        const f = facturas[i];
        const facNum = f.factura_numero;
        const refs = f.referencias || [];

        setDriveItems(prev => prev.map(it => it.factura === facNum ? { ...it, status: "processing" } : it));

        if (!refs.length) {
          addLog(`⚠ [${i+1}/${facturas.length}] Factura ${facNum} (${f.cliente||"—"}): sin referencias de producto en BD`);
          setDriveItems(prev => prev.map(it => it.factura === facNum ? { ...it, status: "sin_refs" } : it));
          continue;
        }

        addLog(`⏳ [${i+1}/${facturas.length}] Factura ${facNum} — ${refs.length} ref${refs.length!==1?"s":""}: ${refs.slice(0,4).join(", ")}${refs.length>4?` +${refs.length-4} más`:""}`);

        try {
          const res = await fetch(`${API}/api/process-refs`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ referencias: refs, factura_nombre: `Factura_${facNum}`, cache_hints: cache }),
          });

          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            addLog(`  ✗ Error: ${errData.error || `HTTP ${res.status}`}`);
            setDriveItems(prev => prev.map(it => it.factura === facNum ? { ...it, status: "error" } : it));
            continue;
          }

          const resumenRaw = res.headers.get("X-Resumen");
          const noEncRaw = res.headers.get("X-No-Encontrados");
          const cacheUpd = res.headers.get("X-Cache-Update");
          const resumen = resumenRaw ? JSON.parse(resumenRaw) : [];
          const notFound = noEncRaw ? JSON.parse(noEncRaw) : [];

          if (cacheUpd) {
            try {
              const cu = JSON.parse(cacheUpd);
              cache = { ...cache, ...cu };
              localStorage.setItem("alumar_product_cache", JSON.stringify(cache));
            } catch {}
          }

          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const cdisposition = res.headers.get("Content-Disposition") || "";
          const filename = cdisposition.match(/filename="(.+)"/)?.[1] || `declaraciones_${facNum}.pdf`;
          const totalPags = resumen.reduce((a, r) => a + (r.paginas_incluidas || 0), 0);

          resumen.forEach(r => addLog(`  ✓ ${r.proveedor}: ${r.archivo} (${r.paginas_incluidas} págs.)`));
          if (notFound.length > 0) addLog(`  ⚠ Sin dec.: ${notFound.slice(0,5).join(", ")}${notFound.length>5?` (+${notFound.length-5} más)`:""}`);
          addLog(`  📄 PDF listo — ${totalPags} páginas · ${resumen.length} proveedor${resumen.length!==1?"es":""}`);

          setDriveItems(prev => prev.map(it =>
            it.factura === facNum
              ? { ...it, status: "done", resumen, notFound, url, filename }
              : it
          ));
        } catch (e) {
          addLog(`  ✗ Factura ${facNum}: ${e.message}`);
          setDriveItems(prev => prev.map(it => it.factura === facNum ? { ...it, status: "error" } : it));
        }
      }

      const conDec = driveItems.filter ? 0 : 0; // se calcula abajo desde el estado
      addLog("─── Búsqueda en Drive completada ───");
    } catch (e) {
      setDriveError(e.message);
      addLog(`✗ Error general: ${e.message}`);
    } finally {
      setDriveLoading(false);
    }
  };

  const doneCount = driveItems.filter(i => i.status === "done").length;
  const sinRefsCount = driveItems.filter(i => i.status === "sin_refs").length;
  const errorCount = driveItems.filter(i => i.status === "error").length;

  return (
    <div style={{ maxWidth:960 }}>

      {/* ── Sección BD ─────────────────────────────────────────────── */}
      <div style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:12, padding:"16px 20px", marginBottom:20, boxShadow:C.shadow }}>
        <div style={{ fontSize:14, fontWeight:700, color:C.text, marginBottom:4 }}>🗄️ Consultar facturas desde la Base de Datos</div>
        <div style={{ fontSize:12, color:C.textMuted, marginBottom:14 }}>
          Extrae las facturas despachadas en una fecha directamente del sistema ADN y busca sus declaraciones de importación en Drive.
        </div>
        <div style={{ display:"flex", gap:10, alignItems:"flex-end", flexWrap:"wrap" }}>
          <div>
            <label style={{ display:"block", fontSize:10, fontWeight:700, color:C.textMuted, marginBottom:4 }}>FECHA A CONSULTAR</label>
            <input type="date" value={bdFecha} onChange={e => setBdFecha(e.target.value)}
              style={{ border:`1px solid ${C.border}`, borderRadius:6, padding:"7px 10px", fontSize:13, color:C.text, outline:"none" }} />
          </div>
          <button onClick={consultarBD} disabled={bdLoading || !bdFecha}
            style={{ background:`linear-gradient(135deg,${C.navy},${C.navyMid})`, color:"white", border:"none", borderRadius:8, padding:"9px 20px", cursor:"pointer", fontWeight:700, fontSize:12, display:"flex", alignItems:"center", gap:6, opacity:bdLoading?0.7:1 }}>
            {bdLoading ? <><Spinner size={12}/> Consultando BD...</> : "🗄️ Consultar facturas"}
          </button>
          {bdFecha === ayerStr && <span style={{ fontSize:11, color:C.textMuted, alignSelf:"center" }}>← ayer</span>}
        </div>

        {bdError && (
          <div style={{ marginTop:12, background:"#fff0f0", border:`1px solid #f5c6cb`, borderRadius:8, padding:"10px 14px", fontSize:12, color:C.red }}>
            ⚠ {bdError}
          </div>
        )}

        {bdResumen && (
          <div style={{ marginTop:16 }}>
            {/* KPIs */}
            <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10, marginBottom:14 }}>
              {[
                { lbl:"Facturas del día", val: bdResumen.total_facturas, color: C.blue },
                { lbl:"Valor neto total", val: fmt(bdResumen.totales?.neto), color: C.green },
                { lbl:"Bultos", val: (bdResumen.totales?.bultos||0).toLocaleString("es-CO"), color: C.accent },
                { lbl:"Peso total", val: `${(bdResumen.totales?.peso||0).toLocaleString("es-CO")} kg`, color: C.textMuted },
              ].map(({ lbl, val, color }) => (
                <div key={lbl} style={{ background:"#f0f4f8", borderRadius:8, padding:"10px 12px", textAlign:"center" }}>
                  <div style={{ fontSize:18, fontWeight:800, color }}>{val}</div>
                  <div style={{ fontSize:10, color:C.textMuted, marginTop:2 }}>{lbl}</div>
                </div>
              ))}
            </div>

            {/* Guías */}
            {bdResumen.guias?.length > 0 && (
              <div style={{ marginBottom:12, fontSize:11, color:C.textMuted }}>
                <strong style={{ color:C.text }}>Guías:</strong>{" "}
                {bdResumen.guias.map(g => (
                  <button key={g} onClick={() => window.open(`${capiBase}/?guia=${g}`, "_blank")}
                    style={{ marginRight:5, background:"#e8f0fb", color:C.blue, border:`1px solid ${C.blue}30`, borderRadius:4, padding:"2px 8px", fontSize:11, cursor:"pointer", fontWeight:700 }}>
                    CTT-{String(g).padStart(5,"0")}
                  </button>
                ))}
              </div>
            )}

            {bdResumen.total_facturas === 0 ? (
              <div style={{ textAlign:"center", padding:"2rem", color:C.textMuted, fontSize:13 }}>
                📭 No se encontraron facturas para el {bdFecha}
              </div>
            ) : (
              <>
                <div style={{ border:`1px solid ${C.border}`, borderRadius:10, overflow:"hidden" }}>
                  <div style={{ display:"grid", gridTemplateColumns:"130px 2fr 1.5fr 1fr 90px 90px 80px", gap:6, padding:"9px 12px", background:`linear-gradient(135deg,${C.navy},${C.navyMid})`, fontSize:9, fontWeight:700, color:"#8faec8", letterSpacing:"0.07em" }}>
                    <div>N° FACTURA</div><div>CLIENTE</div><div>CIUDAD</div><div>GUÍA CTT</div>
                    <div style={{ textAlign:"right" }}>NETO</div><div style={{ textAlign:"right" }}>BULTOS</div><div style={{ textAlign:"right" }}>PESO</div>
                  </div>
                  {bdResumen.facturas.map((f, i) => (
                    <div key={i} style={{
                      display:"grid", gridTemplateColumns:"130px 2fr 1.5fr 1fr 90px 90px 80px", gap:6,
                      padding:"8px 12px", alignItems:"center",
                      borderBottom: i < bdResumen.facturas.length-1 ? `1px solid ${C.border}` : "none",
                      background: i%2===0 ? C.white : "#f8fafc"
                    }}>
                      <div>
                        <div style={{ fontWeight:800, color:C.blue, fontFamily:"monospace", fontSize:12 }}>
                          {f.factura_label || `${f.tipo_doc||""} ${f.factura_numero}`}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize:11, fontWeight:600, color:C.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{f.cliente_nombre||"—"}</div>
                      </div>
                      <div style={{ fontSize:11, color:C.text }}>{f.ciudad||"—"}</div>
                      <div>
                        {f.guia_numero ? (
                          <button onClick={() => window.open(`${capiBase}/?guia=${f.guia_numero}`, "_blank")}
                            style={{ background:"#e8f0fb", color:C.blue, border:`1px solid ${C.blue}30`, borderRadius:4, padding:"2px 7px", fontSize:10, cursor:"pointer", fontWeight:700 }}>
                            CTT-{String(f.guia_numero).padStart(5,"0")}
                          </button>
                        ) : <span style={{ color:C.textDim, fontSize:10 }}>Sin guía</span>}
                      </div>
                      <div style={{ textAlign:"right", fontSize:11, fontWeight:700, color:C.green, fontFamily:"monospace" }}>{fmt(f.neto)}</div>
                      <div style={{ textAlign:"right", fontSize:11, color:C.text }}>{parseFloat(f.bultos)||0}</div>
                      <div style={{ textAlign:"right", fontSize:11, color:C.textMuted }}>{parseFloat(f.peso)||0} kg</div>
                    </div>
                  ))}
                  <div style={{ display:"grid", gridTemplateColumns:"80px 2fr 1.5fr 1fr 90px 90px 80px", gap:6, padding:"9px 12px", background:"#e8edf4", fontWeight:700, borderTop:`2px solid ${C.border}` }}>
                    <div style={{ gridColumn:"span 4", textAlign:"right", fontSize:9, letterSpacing:"0.06em", color:C.textMuted }}>TOTALES ({bdResumen.total_facturas} facturas)</div>
                    <div style={{ textAlign:"right", fontFamily:"monospace", color:C.green, fontSize:12 }}>{fmt(bdResumen.totales?.neto)}</div>
                    <div style={{ textAlign:"right", fontSize:12 }}>{(bdResumen.totales?.bultos||0).toLocaleString("es-CO")}</div>
                    <div style={{ textAlign:"right", fontSize:11, color:C.textMuted }}>{(bdResumen.totales?.peso||0).toLocaleString("es-CO")} kg</div>
                  </div>
                </div>

                {/* Botón Buscar declaraciones en Drive */}
                <div style={{ marginTop:16, display:"flex", alignItems:"center", gap:12 }}>
                  <button onClick={buscarDeclaraciones} disabled={driveLoading}
                    style={{ background:`linear-gradient(135deg,#1e7e34,#27a745)`, color:"white", border:"none", borderRadius:8, padding:"10px 22px", cursor:"pointer", fontWeight:700, fontSize:13, display:"flex", alignItems:"center", gap:8, opacity:driveLoading?0.7:1, boxShadow:"0 2px 8px rgba(30,126,52,0.3)" }}>
                    {driveLoading ? <><Spinner size={13}/> Buscando en Drive...</> : "🔍 Buscar declaraciones en Drive"}
                  </button>
                  {driveItems.length > 0 && !driveLoading && (
                    <span style={{ fontSize:12, color:C.textMuted }}>
                      {doneCount > 0 && <span style={{ color:C.green, fontWeight:700 }}>✓ {doneCount} con declaraciones </span>}
                      {sinRefsCount > 0 && <span style={{ color:C.accent }}>· {sinRefsCount} sin refs </span>}
                      {errorCount > 0 && <span style={{ color:C.red }}>· {errorCount} con error</span>}
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Sección resultados Drive ─────────────────────────────────── */}
      {(driveItems.length > 0 || driveLogs.length > 0) && (
        <div style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:12, padding:"16px 20px", marginBottom:20, boxShadow:C.shadow }}>
          <div style={{ fontSize:14, fontWeight:700, color:C.text, marginBottom:12 }}>
            📂 Declaraciones de importación en Drive
            {driveLoading && <span style={{ fontSize:11, color:C.textMuted, fontWeight:400, marginLeft:10 }}>buscando...</span>}
          </div>

          {driveError && (
            <div style={{ background:"#fff0f0", border:`1px solid #f5c6cb`, borderRadius:8, padding:"10px 14px", fontSize:12, color:C.red, marginBottom:12 }}>
              ⚠ {driveError}
            </div>
          )}

          <div style={{ display:"grid", gridTemplateColumns:"280px 1fr", gap:16 }}>
            {/* Panel de actividad / log */}
            <div style={{ borderRadius:8, overflow:"hidden", border:`1px solid ${C.border}` }}>
              <div style={{ background:`linear-gradient(135deg,${C.navy},${C.navyMid})`, padding:"8px 14px", fontSize:10, fontWeight:700, color:"#8faec8", letterSpacing:"0.1em" }}>
                ACTIVIDAD
              </div>
              <div ref={logRef} style={{ height:320, overflowY:"auto", background:"#0a1a2e", padding:"10px 12px" }}>
                {driveLogs.length === 0 ? (
                  <div style={{ color:"#4a6380", fontSize:10, fontFamily:"monospace", padding:"4px 0" }}>Esperando...</div>
                ) : driveLogs.map((l, i) => (
                  <div key={i} style={{ display:"flex", gap:8, marginBottom:4, fontFamily:"monospace", fontSize:10, lineHeight:1.4 }}>
                    <span style={{ color:"#3a5a7a", flexShrink:0 }}>{l.time}</span>
                    <span style={{ color: l.msg.startsWith("  ✓") ? "#4caf50" : l.msg.startsWith("  ✗") || l.msg.startsWith("✗") ? "#ef5350" : l.msg.startsWith("  ⚠") || l.msg.startsWith("⚠") ? "#ff9800" : "#8fc7ff" }}>
                      {l.msg}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Lista de facturas con resultados */}
            <div style={{ display:"flex", flexDirection:"column", gap:8, maxHeight:340, overflowY:"auto" }}>
              {driveItems.map((item) => {
                const statusColor = item.status === "done" ? C.green : item.status === "error" ? C.red : item.status === "sin_refs" ? C.accent : item.status === "processing" ? C.blue : C.textMuted;
                const statusLabel = item.status === "done" ? "✓ Con declaraciones" : item.status === "error" ? "✗ Error" : item.status === "sin_refs" ? "⚠ Sin referencias" : item.status === "processing" ? "⏳ Procesando..." : "· Pendiente";
                return (
                  <div key={item.factura} style={{ border:`1px solid ${C.border}`, borderRadius:8, padding:"10px 14px", background: item.status === "processing" ? "#f0f8ff" : C.white }}>
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom: item.resumen.length > 0 ? 8 : 0 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                        <span style={{ fontFamily:"monospace", fontWeight:800, color:C.blue, fontSize:13 }}>{item.factura_label || item.factura}</span>
                        <span style={{ fontSize:11, color:C.text }}>{item.cliente}</span>
                        {item.ciudad && <span style={{ fontSize:10, color:C.textMuted }}>— {item.ciudad}</span>}
                        {item.refs.length > 0 && <span style={{ fontSize:9, color:C.textDim, background:"#f0f4f8", borderRadius:3, padding:"1px 5px" }}>{item.refs.length} refs</span>}
                      </div>
                      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                        <span style={{ fontSize:11, color:statusColor, fontWeight:600 }}>{statusLabel}</span>
                        {item.url && (
                          <a href={item.url} download={item.filename}
                            style={{ fontSize:11, background:C.green, color:"white", borderRadius:5, padding:"4px 10px", textDecoration:"none", fontWeight:700, display:"flex", alignItems:"center", gap:4 }}>
                            ⬇ Descargar PDF
                          </a>
                        )}
                      </div>
                    </div>

                    {/* Detalle de proveedores encontrados */}
                    {item.resumen.length > 0 && (
                      <div style={{ display:"flex", flexWrap:"wrap", gap:5, marginTop:4 }}>
                        {item.resumen.map((r, ri) => (
                          <div key={ri} style={{ background:"#e8f5e9", border:`1px solid ${C.green}30`, borderRadius:4, padding:"2px 8px", fontSize:10, color:C.green }}>
                            <strong>{r.proveedor}</strong> · {r.paginas_incluidas} pág.
                          </div>
                        ))}
                        {item.notFound.length > 0 && (
                          <div style={{ background:"#fff8e1", border:`1px solid ${C.accent}30`, borderRadius:4, padding:"2px 8px", fontSize:10, color:C.accent }}>
                            {item.notFound.length} sin match
                          </div>
                        )}
                      </div>
                    )}

                    {/* Sin referencias en BD */}
                    {item.status === "sin_refs" && (
                      <div style={{ fontSize:10, color:C.textMuted, marginTop:4, fontStyle:"italic" }}>
                        No se encontraron referencias de producto en la tabla de detalle de la BD.
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* KPIs resultados */}
          {driveItems.length > 0 && !driveLoading && (
            <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10, marginTop:16 }}>
              {[
                { lbl:"Total facturas", val: driveItems.length, color: C.blue },
                { lbl:"Con declaraciones", val: doneCount, color: C.green },
                { lbl:"Sin referencias BD", val: sinRefsCount, color: C.accent },
                { lbl:"Con error", val: errorCount, color: C.red },
              ].map(({ lbl, val, color }) => (
                <div key={lbl} style={{ background:"#f0f4f8", borderRadius:8, padding:"10px 12px", textAlign:"center" }}>
                  <div style={{ fontSize:22, fontWeight:800, color }}>{val}</div>
                  <div style={{ fontSize:10, color:C.textMuted, marginTop:2 }}>{lbl}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

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
        {contrato.saldo_pagar > 0 && <Badge color={C.blue}>Saldo {fmt(contrato.saldo_pagar)}</Badge>}
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
            {(Number(contrato.anticipo)||Number(contrato.retencion)||Number(contrato.reteica)) ? (
              <div style={{ gridColumn:"span 3", marginTop:4, paddingTop:6, borderTop:`1px dashed ${C.border}`, display:"flex", gap:16, flexWrap:"wrap" }}>
                {Number(contrato.anticipo) > 0 && <span><strong style={{ color:C.text }}>Anticipo:</strong> {fmt(contrato.anticipo)}</span>}
                {Number(contrato.retencion) > 0 && <span><strong style={{ color:C.text }}>Retención:</strong> {fmt(contrato.retencion)}</span>}
                {Number(contrato.reteica) > 0 && <span><strong style={{ color:C.text }}>ReteICA:</strong> {fmt(contrato.reteica)}</span>}
                <span style={{ fontWeight:700, color:C.green }}><strong style={{ color:C.text }}>Saldo a pagar:</strong> {fmt(contrato.saldo_pagar)}</span>
              </div>
            ) : null}
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
  const [contratos, setContratos] = useState([]);
  const [showContratoForm, setShowContratoForm] = useState(false);
  const [editingContrato, setEditingContrato] = useState(null);
  const [conductores, setConductores] = useState([]);
  const [showConductorForm, setShowConductorForm] = useState(false);
  const [editingConductor, setEditingConductor] = useState(null);
  const [conductorSearch, setConductorSearch] = useState("");
  const [procesados, setProcesados] = useState([]);
  const [procesadosLoading, setProcesadosLoading] = useState(false);
  const [gsLoading, setGsLoading] = useState(true);
  const [gsError, setGsError] = useState(null);
  // ── Auto-BD ────────────────────────────────────────────────────────────────
  const [autoEnabled, setAutoEnabled] = useState(false);
  const [autoProcessing, setAutoProcessing] = useState(false);
  const [autoStatus, setAutoStatus] = useState({ totalHoy: 0, ultimaRevision: null, proxima: null });
  const autoProcessedRef = useRef(new Set());   // números de factura ya encolados
  const autoIntervalRef  = useRef(null);
  const [consultaFecha, setConsultaFecha] = useState(new Date().toISOString().slice(0, 10));
  const [consultaLoading, setConsultaLoading] = useState(false);
  const [consultaResultado, setConsultaResultado] = useState(null); // { total, nuevas, fecha }
  // ──────────────────────────────────────────────────────────────────────────
  const fileRef = useRef();
  const logRef = useRef();

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [activeLog]);

  // Cargar conductores y contratos desde Google Sheets al iniciar
  useEffect(() => {
    const cargar = async () => {
      setGsLoading(true);
      setGsError(null);
      try {
        const [conds, conts, procs] = await Promise.all([
          gsGet("getConductores"),
          gsGet("getContratos"),
          gsGet("getProcessados"),
        ]);
        setConductores(Array.isArray(conds) ? conds : []);
        setContratos(Array.isArray(conts) ? conts : []);
        setProcesados(Array.isArray(procs) ? procs : []);
      } catch (e) {
        setGsError("No se pudo conectar con Google Sheets: " + e.message);
      } finally {
        setGsLoading(false);
      }
    };
    cargar();
  }, []);

  const addLog = (msg) => setActiveLog(prev => [...prev, { ts: new Date().toLocaleTimeString(), msg }]);

  // ── Auto-BD: procesar items desde BD (sin archivo físico) ─────────────────
  const processAutoItems = async (items) => {
    if (!items.length) return;
    setAutoProcessing(true);
    for (const item of items) {
      setQueue(prev => prev.map(i => i.id === item.id ? { ...i, status: "processing" } : i));
      addLog(`🤖 [Auto] ${item.label} · ${item.refs.length} referencia${item.refs.length !== 1 ? "s" : ""}...`);
      try {
        const res = await fetch(`${API}/api/process-refs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ referencias: item.refs, factura_nombre: item.label, cache_hints: getProductCache() }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          addLog(`  ✗ ${item.label}: ${err.error || `HTTP ${res.status}`}`);
          setQueue(prev => prev.map(i => i.id === item.id ? { ...i, status: "error" } : i));
          continue;
        }
        const resumen  = JSON.parse(res.headers.get("X-Resumen")        || "[]");
        const notFound = JSON.parse(res.headers.get("X-No-Encontrados") || "[]");
        const cacheUpd = res.headers.get("X-Cache-Update");
        if (cacheUpd) { try { saveProductCache({ ...getProductCache(), ...JSON.parse(cacheUpd) }); } catch {} }
        const blob = await res.blob();
        const url  = URL.createObjectURL(blob);
        const filename = res.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1] || `dec_${item.label}.pdf`;
        resumen.forEach(r => addLog(`  ✓ ${r.proveedor}: ${r.archivo} (${r.paginas_incluidas} págs.)`));
        if (notFound.length) addLog(`  ⚠ Sin dec.: ${notFound.slice(0, 4).join(", ")}${notFound.length > 4 ? ` +${notFound.length - 4}` : ""}`);
        setQueue(prev => prev.map(i =>
          i.id === item.id ? { ...i, status: "done", resultUrl: url, resultFilename: filename, notFound, date: todayStr() } : i
        ));
        saveHistory({ id: item.id, date: new Date().toISOString(), invoiceName: item.label, matches: resumen, notFound, pdfFilename: filename });
        await savePdfToStorage(item.id, blob);
      } catch (e) {
        addLog(`  ✗ ${item.label}: ${e.message}`);
        setQueue(prev => prev.map(i => i.id === item.id ? { ...i, status: "error" } : i));
      }
    }
    setAutoProcessing(false);
    addLog("─── Auto-BD completado ───");
  };

  // ── Auto-BD: revisar facturas nuevas de hoy ───────────────────────────────
  const runAutoCheck = useCallback(async () => {
    const hoy = new Date().toISOString().slice(0, 10);
    const ahora = new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
    const proxStr = new Date(Date.now() + 5 * 60 * 1000).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
    setAutoStatus(s => ({ ...s, ultimaRevision: ahora, proxima: proxStr }));
    try {
      const r = await fetch(`${CAPI_BASE}/api/facturas/dia/${hoy}/referencias`);
      const d = await r.json();
      const facturas = d.facturas || [];
      setAutoStatus(s => ({ ...s, totalHoy: facturas.length }));
      const nuevas = facturas.filter(f =>
        f.referencias.length > 0 &&
        !autoProcessedRef.current.has(f.factura_numero_raw)
      );
      if (!nuevas.length) return;
      addLog(`🤖 Auto-BD: ${nuevas.length} factura${nuevas.length !== 1 ? "s" : ""} nueva${nuevas.length !== 1 ? "s" : ""} detectada${nuevas.length !== 1 ? "s" : ""}`);
      nuevas.forEach(f => autoProcessedRef.current.add(f.factura_numero_raw));
      const items = nuevas.map(f => ({
        id: crypto.randomUUID(),
        isAuto: true,
        label: f.factura_label || f.factura_numero,
        factura_numero: f.factura_numero,
        factura_numero_raw: f.factura_numero_raw,
        cliente: f.cliente || "",
        ciudad: f.ciudad || "",
        refs: f.referencias,
        status: "pending",
        resultUrl: null, resultFilename: null,
        notFound: [], reportUrl: null, date: todayStr(),
      }));
      setQueue(prev => [...prev, ...items]);
      processAutoItems(items);
    } catch (e) {
      console.warn("[Auto-BD] Error:", e.message);
    }
  }, []);

  // ── Consultar facturas de una fecha específica ────────────────────────────
  const consultarFecha = async () => {
    if (!consultaFecha) return;
    setConsultaLoading(true);
    setConsultaResultado(null);
    try {
      const r = await fetch(`${CAPI_BASE}/api/facturas/dia/${consultaFecha}/referencias`);
      const d = await r.json();
      const facturas = d.facturas || [];
      const nuevas = facturas.filter(f =>
        f.referencias.length > 0 &&
        !autoProcessedRef.current.has(f.factura_numero_raw)
      );
      setConsultaResultado({ total: facturas.length, nuevas: nuevas.length, fecha: consultaFecha });
      if (!nuevas.length) {
        addLog(`📅 ${consultaFecha}: ${facturas.length} factura(s) encontrada(s), todas ya procesadas o sin referencias.`);
        return;
      }
      addLog(`📅 ${consultaFecha}: ${nuevas.length} factura(s) nueva(s) para procesar`);
      nuevas.forEach(f => autoProcessedRef.current.add(f.factura_numero_raw));
      const items = nuevas.map(f => ({
        id: crypto.randomUUID(),
        isAuto: true,
        label: f.factura_label || f.factura_numero,
        factura_numero: f.factura_numero,
        factura_numero_raw: f.factura_numero_raw,
        cliente: f.cliente || "",
        ciudad: f.ciudad || "",
        refs: f.referencias,
        status: "pending",
        resultUrl: null, resultFilename: null,
        notFound: [], reportUrl: null, date: todayStr(),
      }));
      setQueue(prev => [...prev, ...items]);
      processAutoItems(items);
    } catch (e) {
      addLog(`❌ Error consultando ${consultaFecha}: ${e.message}`);
    } finally {
      setConsultaLoading(false);
    }
  };

  // ── Intervalo cada 5 minutos ──────────────────────────────────────────────
  useEffect(() => {
    if (autoEnabled) {
      runAutoCheck();
      autoIntervalRef.current = setInterval(runAutoCheck, 5 * 60 * 1000);
    } else {
      if (autoIntervalRef.current) { clearInterval(autoIntervalRef.current); autoIntervalRef.current = null; }
      setAutoStatus(s => ({ ...s, proxima: null }));
    }
    return () => { if (autoIntervalRef.current) clearInterval(autoIntervalRef.current); };
  }, [autoEnabled]);

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

      // Items auto-BD usan /api/process-refs en lugar de /api/process
      if (item.isAuto) {
        addLog(`⏳ [Auto] ${item.label}...`);
        try {
          const res = await fetch(`${API}/api/process-refs`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ referencias: item.refs, factura_nombre: item.label, cache_hints: getProductCache() }),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            addLog(`✗ ${item.label}: ${err.error || "Error"}`);
            setQueue(prev => prev.map(i => i.id === item.id ? { ...i, status: "error" } : i));
            saveHistory({ id: item.id, date: new Date().toISOString(), invoiceName: item.label, matches: [], notFound: [] });
            continue;
          }
          const resumen  = JSON.parse(res.headers.get("X-Resumen")        || "[]");
          const notFound = JSON.parse(res.headers.get("X-No-Encontrados") || "[]");
          const cacheUpd = res.headers.get("X-Cache-Update");
          if (cacheUpd) { try { saveProductCache(JSON.parse(cacheUpd)); } catch {} }
          const blob = await res.blob();
          const url  = URL.createObjectURL(blob);
          const filename = res.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1] || `dec_${item.label}.pdf`;
          resumen.forEach(r => addLog(`✓ ${r.proveedor}: ${r.archivo} (${r.paginas_incluidas} págs.)`));
          if (notFound.length) addLog(`⚠ Sin declaración: ${notFound.join(", ")}`);
          addLog(`✓ PDF listo — ${resumen.reduce((a, r) => a + r.paginas_incluidas, 0)} páginas`);
          setQueue(prev => prev.map(i => i.id === item.id ? { ...i, status: "done", resultUrl: url, resultFilename: filename, notFound, date: todayStr() } : i));
          saveHistory({ id: item.id, date: new Date().toISOString(), invoiceName: item.label, matches: resumen, notFound, pdfFilename: filename });
          await savePdfToStorage(item.id, blob);
          setPdfModal({ url, filename });
        } catch (e) {
          addLog(`✗ ${item.label}: ${e.message}`);
          setQueue(prev => prev.map(i => i.id === item.id ? { ...i, status: "error" } : i));
        }
        continue;
      }

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

  const saveContrato = async (contrato) => {
    try {
      const conFecha = { ...contrato, fecha_creacion: contrato.fecha_creacion || new Date().toISOString() };
      await gsPost("saveContrato", { data: conFecha });
      setContratos(prev => {
        const idx = prev.findIndex(c => c.id === conFecha.id);
        return idx >= 0 ? prev.map(c => c.id === conFecha.id ? conFecha : c) : [conFecha, ...prev];
      });
      setShowContratoForm(false);
      setEditingContrato(null);
    } catch (e) {
      alert("Error guardando contrato: " + e.message);
    }
  };

  const saveConductor = async (conductor) => {
    try {
      const conFecha = { ...conductor, fecha_creacion: conductor.fecha_creacion || new Date().toISOString() };
      await gsPost("saveConductor", { data: conFecha });
      setConductores(prev => {
        const idx = prev.findIndex(c => c.id === conFecha.id);
        return idx >= 0 ? prev.map(c => c.id === conFecha.id ? conFecha : c) : [conFecha, ...prev];
      });
      setShowConductorForm(false);
      setEditingConductor(null);
    } catch (e) {
      alert("Error guardando conductor: " + e.message);
    }
  };

  const deleteConductor = async (id) => {
    try {
      await gsPost("deleteConductor", { id });
      setConductores(prev => prev.filter(c => c.id !== id));
    } catch (e) {
      alert("Error eliminando conductor: " + e.message);
    }
  };

  const recargarProcesados = async () => {
    setProcesadosLoading(true);
    try {
      const procs = await gsGet("getProcessados");
      setProcesados(Array.isArray(procs) ? procs : []);
    } catch (e) {
      alert("Error al recargar: " + e.message);
    } finally {
      setProcesadosLoading(false);
    }
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
          <div style={{ display:"flex", alignItems:"center", gap:6, justifyContent:"flex-end" }}>
            {gsLoading
              ? <><Spinner size={10}/><span style={{ color:"#8faec8" }}>Conectando Google Sheets...</span></>
              : gsError
              ? <span style={{ color:"#ff8a80" }}>⚠ Sin conexión GS</span>
              : <span style={{ color:"#69f0ae" }}>● Google Sheets</span>
            }
          </div>
          <div style={{ color: "#8faec8" }}>{new Date().toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long" })}</div>
        </div>
      </div>

      {/* TABS */}
      <div style={{ background: C.white, borderBottom: `1px solid ${C.border}`, padding: "0 2rem", display: "flex" }}>
        {[["work", "⚡ Procesar Facturas"], ["history", `📋 Historial (${history.length})`], ["dashboard", "📊 Dashboard"], ["guias-ctt", "📄 Guías CTT"], ["contratos", `🚛 Contratos (${contratos.length})`], ["conductores", `👤 Conductores (${conductores.length})`]].map(([key, label]) => (
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

              {/* Auto-BD */}
              <div style={{ background: C.white, border: `1px solid ${autoEnabled ? "#1e7e3466" : C.border}`, borderRadius: 12, padding: "1.25rem", boxShadow: C.shadow, transition:"border-color 0.3s" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: C.textDim, letterSpacing: "0.1em", marginBottom: 12 }}>AUTOMÁTICO DESDE BD</div>

                {/* Toggle */}
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom: 14 }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: autoEnabled ? C.green : C.text }}>
                      {autoEnabled ? "🟢 Activo" : "⚫ Inactivo"}
                    </div>
                    <div style={{ fontSize: 10, color: C.textMuted }}>Revisa cada 5 min</div>
                  </div>
                  <button
                    onClick={() => setAutoEnabled(v => !v)}
                    style={{
                      width: 44, height: 24, borderRadius: 12, border: "none", cursor: "pointer",
                      background: autoEnabled ? C.green : C.border,
                      position: "relative", transition: "background 0.25s"
                    }}>
                    <span style={{
                      position:"absolute", top: 3, left: autoEnabled ? 22 : 2,
                      width: 18, height: 18, borderRadius: "50%", background: "white",
                      transition: "left 0.25s", boxShadow:"0 1px 3px rgba(0,0,0,0.2)"
                    }} />
                  </button>
                </div>

                {/* Status */}
                <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", fontSize:11 }}>
                    <span style={{ color:C.textMuted }}>Facturas hoy</span>
                    <span style={{ fontWeight:700, color:C.text }}>{autoStatus.totalHoy}</span>
                  </div>
                  <div style={{ display:"flex", justifyContent:"space-between", fontSize:11 }}>
                    <span style={{ color:C.textMuted }}>Encoladas</span>
                    <span style={{ fontWeight:700, color:C.green }}>{queue.filter(q => q.isAuto).length}</span>
                  </div>
                  {autoStatus.ultimaRevision && (
                    <div style={{ display:"flex", justifyContent:"space-between", fontSize:10, color:C.textMuted, borderTop:`1px solid ${C.border}`, paddingTop:6, marginTop:2 }}>
                      <span>Última revisión</span>
                      <span>{autoStatus.ultimaRevision}</span>
                    </div>
                  )}
                  {autoStatus.proxima && (
                    <div style={{ display:"flex", justifyContent:"space-between", fontSize:10, color:C.textMuted }}>
                      <span>Próxima</span>
                      <span>{autoStatus.proxima}</span>
                    </div>
                  )}
                  {autoProcessing && (
                    <div style={{ display:"flex", alignItems:"center", gap:6, fontSize:11, color:C.green, marginTop:4 }}>
                      <Spinner size={10}/> Procesando automáticamente...
                    </div>
                  )}
                </div>

                {/* Botón verificar ahora */}
                {autoEnabled && (
                  <button onClick={runAutoCheck} disabled={autoProcessing}
                    style={{ marginTop:12, width:"100%", background:"#f0f4f8", border:`1px solid ${C.border}`, borderRadius:6, padding:"7px 0", fontSize:11, color:C.textMuted, cursor:"pointer", fontWeight:600 }}>
                    🔄 Verificar ahora
                  </button>
                )}
              </div>

              {/* Consulta por fecha */}
              <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: "1.25rem", boxShadow: C.shadow }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: C.textDim, letterSpacing: "0.1em", marginBottom: 10 }}>CONSULTAR OTRO DÍA</div>
                <input
                  type="date"
                  value={consultaFecha}
                  onChange={e => { setConsultaFecha(e.target.value); setConsultaResultado(null); }}
                  max={new Date().toISOString().slice(0, 10)}
                  style={{ width: "100%", border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 8px", fontSize: 12, color: C.text, marginBottom: 8, boxSizing: "border-box" }}
                />
                {consultaResultado && (
                  <div style={{ fontSize: 11, marginBottom: 8, padding: "6px 8px", borderRadius: 6,
                    background: consultaResultado.nuevas > 0 ? "#e8f5e9" : "#f0f4f8",
                    color: consultaResultado.nuevas > 0 ? C.green : C.textMuted, fontWeight: 600 }}>
                    {consultaResultado.nuevas > 0
                      ? `✓ ${consultaResultado.nuevas} factura(s) encolada(s) de ${consultaResultado.total} del día`
                      : `ℹ ${consultaResultado.total} factura(s) encontradas — ya procesadas o sin referencias`}
                  </div>
                )}
                <button
                  onClick={consultarFecha}
                  disabled={consultaLoading || autoProcessing || !consultaFecha}
                  style={{
                    width: "100%", border: "none", borderRadius: 6, padding: "7px 0",
                    fontSize: 11, fontWeight: 700, cursor: consultaLoading ? "wait" : "pointer",
                    background: consultaLoading ? C.border : `linear-gradient(135deg,${C.blue},${C.blueLight})`,
                    color: consultaLoading ? C.textMuted : "white", transition: "background 0.2s"
                  }}>
                  {consultaLoading ? <><Spinner size={10}/> Consultando...</> : "📅 Procesar facturas del día"}
                </button>
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

        {/* TAB: DASHBOARD */}
        {tab === "dashboard" && (
          <DashboardContratos onOpenContrato={(num) => {
            window.open(`${CAPI_BASE}/?guia=${num}`, '_blank');
          }} />
        )}

        {/* TAB: GUÍAS CTT */}
        {tab === "guias-ctt" && (
          <div style={{ height: "calc(100vh - 120px)", display: "flex", flexDirection: "column" }}>
            <iframe
              src={CAPI_BASE}
              title="Guías CTT — Contratos de Transporte"
              style={{ flex: 1, border: "none", borderRadius: 8, width: "100%" }}
              allow="print"
            />
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

        {/* TAB: CONDUCTORES */}
        {tab === "conductores" && (
          <div style={{ maxWidth:860 }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
              <div>
                <div style={{ fontSize:16, fontWeight:700, color:C.text }}>Conductores</div>
                <div style={{ fontSize:12, color:C.textMuted }}>{conductores.length} conductor{conductores.length !== 1 ? "es" : ""} registrado{conductores.length !== 1 ? "s" : ""}</div>
              </div>
              <button onClick={() => { setEditingConductor(null); setShowConductorForm(true); }}
                style={{ background:`linear-gradient(135deg,${C.blue},${C.blueLight})`, color:"white", border:"none", borderRadius:8, padding:"10px 20px", cursor:"pointer", fontWeight:700, fontSize:13, boxShadow:"0 4px 14px rgba(18,85,164,0.30)" }}>
                + Nuevo conductor
              </button>
            </div>

            {conductores.length > 0 && (
              <div style={{ marginBottom:14 }}>
                <input
                  value={conductorSearch}
                  onChange={e => setConductorSearch(e.target.value)}
                  placeholder="🔍  Buscar por nombre, cédula, placa o ciudad..."
                  style={{ width:"100%", border:`1px solid ${C.border}`, borderRadius:8, padding:"9px 14px", fontSize:13, color:C.text, outline:"none", background:C.white }}
                />
              </div>
            )}

            {(() => {
              const busq = conductorSearch.toLowerCase();
              const filtrados = conductores.filter(c =>
                !busq ||
                c.nombre?.toLowerCase().includes(busq) ||
                c.cc?.toLowerCase().includes(busq) ||
                c.vehiculo_placas?.toLowerCase().includes(busq) ||
                c.ciudad?.toLowerCase().includes(busq)
              );
              return filtrados.length === 0 ? (
                <div style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:12, padding:"4rem 2rem", textAlign:"center", boxShadow:C.shadow }}>
                  <div style={{ fontSize:40, marginBottom:12 }}>👤</div>
                  <div style={{ fontSize:14, fontWeight:600, color:C.textMuted, marginBottom:6 }}>
                    {conductorSearch ? "Sin resultados" : "Sin conductores registrados"}
                  </div>
                  <div style={{ fontSize:12, color:C.textDim }}>
                    {conductorSearch ? "Intenta con otro nombre, cédula o placa." : <>Haz clic en <strong>+ Nuevo conductor</strong> para agregar el primero.</>}
                  </div>
                </div>
              ) : (
                <div style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:12, padding:"1.25rem", boxShadow:C.shadow }}>
                  {filtrados.map(c => (
                    <ConductorRow key={c.id} conductor={c} onEdit={(ct) => { setEditingConductor(ct); setShowConductorForm(true); }} />
                  ))}
                </div>
              );
            })()}

            {conductores.length > 0 && (() => {
              const hoy = new Date();
              const proxVencer = conductores.filter(c => {
                const fechas = [c.licencia_vencimiento, c.soat, c.tecnicomecanica].filter(Boolean);
                return fechas.some(f => {
                  const diff = (new Date(f) - hoy) / (1000*60*60*24);
                  return diff >= 0 && diff <= 30;
                });
              });
              const vencidos = conductores.filter(c => {
                const fechas = [c.licencia_vencimiento, c.soat, c.tecnicomecanica].filter(Boolean);
                return fechas.some(f => new Date(f) < hoy);
              });
              if (!proxVencer.length && !vencidos.length) return null;
              return (
                <div style={{ marginTop:16, display:"flex", flexDirection:"column", gap:8 }}>
                  {vencidos.length > 0 && (
                    <div style={{ background:"#fdecea", border:`1px solid ${C.red}40`, borderRadius:10, padding:"10px 16px", fontSize:12 }}>
                      <strong style={{ color:C.red }}>⚠ Documentos vencidos:</strong>{" "}
                      {vencidos.map(c => c.nombre).join(", ")}
                    </div>
                  )}
                  {proxVencer.length > 0 && (
                    <div style={{ background:"#fff8e1", border:`1px solid ${C.gold}40`, borderRadius:10, padding:"10px 16px", fontSize:12 }}>
                      <strong style={{ color:C.accent }}>⏰ Próximos a vencer (30 días):</strong>{" "}
                      {proxVencer.map(c => c.nombre).join(", ")}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}

        {/* TAB: PROCESADOS AUTOMÁTICOS */}
        {tab === "procesados" && (
          <ProcesadosTab
            procesados={procesados}
            procesadosLoading={procesadosLoading}
            recargarProcesados={recargarProcesados}
            capiBase={CAPI_BASE}
          />
        )}

      </div>

      {/* Modal formulario conductor */}
      {showConductorForm && (
        <ConductorForm
          initial={editingConductor}
          onSave={saveConductor}
          onCancel={() => { setShowConductorForm(false); setEditingConductor(null); }}
        />
      )}

      {/* Modal formulario contrato */}
      {showContratoForm && (
        <ContratoForm
          initial={editingContrato}
          nextNumero={nextNumero()}
          onSave={saveContrato}
          onCancel={() => { setShowContratoForm(false); setEditingContrato(null); }}
          conductoresList={conductores}
        />
      )}
    </div>
  );
}
