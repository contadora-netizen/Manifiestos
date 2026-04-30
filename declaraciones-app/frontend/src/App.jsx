import { useState, useCallback, useRef, useEffect } from "react";

const API = "http://localhost:5050";

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

// ── Utilidades ───────────────────────────────────────────────────────────────
const fmtDate = (iso) => new Date(iso).toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

function saveHistory(entry) {
  const prev = JSON.parse(localStorage.getItem("alumar_hist") || "[]");
  const updated = [entry, ...prev].slice(0, 50);
  localStorage.setItem("alumar_hist", JSON.stringify(updated));
  return updated;
}

// ── Modal visor PDF ──────────────────────────────────────────────────────────
function PDFModal({ url, filename, onClose, onDownload }) {
  const handlePrint = () => {
    const iframe = document.getElementById("pdf-preview-frame");
    if (iframe) {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    }
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: "rgba(5,15,30,0.82)",
      display: "flex", flexDirection: "column"
    }}>
      {/* Barra superior del modal */}
      <div style={{
        background: `linear-gradient(135deg, #0a1f3c, #122a50)`,
        borderBottom: "2px solid #d4780a",
        padding: "0 1.25rem", height: 52,
        display: "flex", alignItems: "center", gap: 12, flexShrink: 0
      }}>
        {/* Logo pequeño */}
        <div style={{
          background: "#ffffff", border: "1.5px solid #2a2a2a",
          borderRadius: 3, padding: "2px 7px", lineHeight: 1
        }}>
          <div style={{ fontFamily: "'Arial Black', Arial, sans-serif", fontWeight: 900, fontSize: 14, color: "#cc1111" }}>alumar</div>
        </div>
        <div style={{ width: 1, height: 28, background: "#ffffff22" }} />
        <div style={{ flex: 1, fontSize: 12, color: "#a0b8d0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          <span style={{ color: "#ffffff", fontWeight: 600 }}>Vista previa · </span>{filename}
        </div>
        <button onClick={handlePrint} style={{
          background: "linear-gradient(135deg, #d4780a, #e8920c)",
          color: "white", border: "none", borderRadius: 7,
          padding: "7px 18px", cursor: "pointer",
          fontWeight: 700, fontSize: 12, letterSpacing: "0.05em",
          display: "flex", alignItems: "center", gap: 6,
          boxShadow: "0 2px 10px rgba(212,120,10,0.35)"
        }}>🖨 Imprimir</button>
        <button onClick={onDownload} style={{
          background: "#1e7e34", color: "white", border: "none",
          borderRadius: 7, padding: "7px 18px", cursor: "pointer",
          fontWeight: 700, fontSize: 12, letterSpacing: "0.05em"
        }}>⬇ Descargar</button>
        <button onClick={onClose} style={{
          background: "transparent", color: "#8faec8",
          border: "1px solid #ffffff22", borderRadius: 7,
          padding: "7px 14px", cursor: "pointer", fontSize: 12
        }}>✕ Cerrar</button>
      </div>
      {/* Visor PDF */}
      <iframe
        id="pdf-preview-frame"
        src={url}
        style={{ flex: 1, border: "none", background: "#525659" }}
        title="Vista previa declaraciones"
      />
    </div>
  );
}

// ── Componentes base ─────────────────────────────────────────────────────────
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

// ── Fila de factura en la cola ───────────────────────────────────────────────
function InvoiceRow({ item, onRemove, onPreview }) {
  const statusColor = {
    pending: C.textDim,
    processing: C.blue,
    done: C.green,
    error: C.red,
  }[item.status];

  const statusLabel = {
    pending: "En espera",
    processing: "Procesando...",
    done: "✓ Listo",
    error: "✗ Error",
  }[item.status];

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
        </div>
      )}
      {item.status === "pending" && (
        <button onClick={() => onRemove(item.id)}
          style={{ background: "transparent", border: "none", cursor: "pointer", color: C.textDim, fontSize: 14, padding: "0 2px" }}>×</button>
      )}
    </div>
  );
}

// ── Fila del historial ───────────────────────────────────────────────────────
function HistoryRow({ entry }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, marginBottom: 8, overflow: "hidden" }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "10px 14px", cursor: "pointer",
          background: open ? "#f0f4f8" : C.white,
          transition: "background 0.15s"
        }}
      >
        <div style={{ fontSize: 16 }}>📄</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {entry.invoiceName}
          </div>
          <div style={{ fontSize: 10, color: C.textMuted }}>{fmtDate(entry.date)}</div>
        </div>
        {entry.matches?.length > 0
          ? <Badge color={C.green}>{entry.matches.length} proveedor{entry.matches.length !== 1 ? "es" : ""}</Badge>
          : <Badge color={C.red}>Sin match</Badge>
        }
        <span style={{ color: C.textDim, fontSize: 12 }}>{open ? "▲" : "▼"}</span>
      </div>
      {open && (
        <div style={{ padding: "10px 14px", borderTop: `1px solid ${C.border}`, background: "#f8fafc" }}>
          {entry.matches?.length > 0 ? (
            <>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.textDim, letterSpacing: "0.08em", marginBottom: 8 }}>DECLARACIONES ENCONTRADAS</div>
              {entry.matches.map((m, i) => (
                <div key={i} style={{ fontSize: 11, color: C.textMuted, padding: "3px 0", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between" }}>
                  <span><strong style={{ color: C.text }}>{m.proveedor}</strong> · {m.archivo}</span>
                  <span style={{ color: C.textDim }}>{m.paginas_incluidas} págs.</span>
                </div>
              ))}
            </>
          ) : (
            <div style={{ fontSize: 11, color: C.textMuted }}>No se encontraron declaraciones para esta factura.</div>
          )}
          {entry.products?.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.textDim, letterSpacing: "0.08em", marginBottom: 6 }}>PRODUCTOS BUSCADOS</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {entry.products.map((p, i) => (
                  <span key={i} style={{ fontSize: 10, background: "#e8f0fc", color: C.blue, borderRadius: 4, padding: "2px 6px", fontFamily: "monospace" }}>{p}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [token, setToken] = useState("");
  const [queue, setQueue] = useState([]); // [{id, file, status, resultUrl, resultFilename}]
  const [dragOver, setDragOver] = useState(false);
  const [tab, setTab] = useState("work"); // work | history
  const [history, setHistory] = useState(() => JSON.parse(localStorage.getItem("alumar_hist") || "[]"));
  const [activeLog, setActiveLog] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [pdfModal, setPdfModal] = useState(null); // { url, filename }
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
      ...pdfs.map(f => ({ id: crypto.randomUUID(), file: f, status: "pending", resultUrl: null, resultFilename: null }))
    ]);
  }, []);

  const removeFromQueue = (id) => setQueue(prev => prev.filter(i => i.id !== id));

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer.files);
  };

  const processAll = async () => {
    if (!token || processing) return;
    const pending = queue.filter(i => i.status === "pending");
    if (!pending.length) return;

    setProcessing(true);
    setActiveLog([]);

    for (const item of pending) {
      // Marcar como procesando
      setQueue(prev => prev.map(i => i.id === item.id ? { ...i, status: "processing" } : i));
      addLog(`⏳ Procesando ${item.file.name}...`);

      const fd = new FormData();
      fd.append("invoice", item.file);
      fd.append("drive_token", token);

      try {
        const res = await fetch(`${API}/api/process`, { method: "POST", body: fd });

        if (!res.ok) {
          const data = await res.json();
          addLog(`✗ ${item.file.name}: ${data.error || "Error"}`);
          setQueue(prev => prev.map(i => i.id === item.id ? { ...i, status: "error" } : i));
          const newHist = saveHistory({ id: item.id, date: new Date().toISOString(), invoiceName: item.file.name, matches: [], products: data.productos_buscados || [] });
          setHistory(newHist);
          continue;
        }

        const resumenRaw = res.headers.get("X-Resumen");
        const resumen = resumenRaw ? JSON.parse(resumenRaw) : [];
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const filename = res.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1] || `declaraciones_${item.file.name}`;

        resumen.forEach(r => addLog(`✓ ${r.proveedor}: ${r.archivo} (${r.paginas_incluidas} págs.)`));
        addLog(`✓ ${item.file.name} — PDF listo (${resumen.reduce((a, r) => a + r.paginas_incluidas, 0)} páginas)`);

        setQueue(prev => prev.map(i => i.id === item.id ? { ...i, status: "done", resultUrl: url, resultFilename: filename } : i));

        const newHist = saveHistory({ id: item.id, date: new Date().toISOString(), invoiceName: item.file.name, matches: resumen, products: resumen.map(r => r.proveedor) });
        setHistory(newHist);

        // Abrir vista previa automáticamente
        setPdfModal({ url, filename });

      } catch (e) {
        addLog(`✗ ${item.file.name}: Error de conexión`);
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
        textarea::placeholder { color: ${C.textDim}; }
        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 3px; }
        button:hover { filter: brightness(0.93); }
      `}</style>

      {/* Modal PDF */}
      {pdfModal && (
        <PDFModal
          url={pdfModal.url}
          filename={pdfModal.filename}
          onClose={closeModal}
          onDownload={downloadModal}
        />
      )}

      {/* ── HEADER ── */}
      <div style={{
        background: `linear-gradient(135deg, ${C.navy} 0%, ${C.navyMid} 100%)`,
        borderBottom: "3px solid #d4780a",
        padding: "0 2rem", height: 62,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        boxShadow: "0 2px 16px rgba(10,31,60,0.25)"
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {/* Logo ALUMAR */}
          <div style={{
            background: "#ffffff", border: "2px solid #2a2a2a",
            borderRadius: 4, padding: "4px 10px", lineHeight: 1,
            boxShadow: "0 2px 8px rgba(0,0,0,0.3)"
          }}>
            <div style={{ fontFamily: "'Arial Black', Arial, sans-serif", fontWeight: 900, fontSize: 22, color: "#cc1111", letterSpacing: "-0.5px", lineHeight: 1 }}>
              alumar
            </div>
            <div style={{ fontSize: 7.5, color: "#2a2a2a", letterSpacing: "0.04em", fontWeight: 500, textAlign: "center", marginTop: 2 }}>
              International Housewares
            </div>
          </div>
          <div style={{ width: 1, height: 36, background: "#ffffff22" }} />
          <div style={{ fontSize: 10, color: "#a0b8d0", letterSpacing: "0.06em" }}>
            DECLARACIONES DE IMPORTACIÓN<br />
            <span style={{ color: "#6a8fb0" }}>Generador automático DIAN</span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ fontSize: 10, color: "#6a8fb0", textAlign: "right" }}>
            <div>Google Drive · MANIFIESTOS</div>
            <div style={{ color: "#8faec8" }}>{new Date().toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long" })}</div>
          </div>
        </div>
      </div>

      {/* ── TABS ── */}
      <div style={{ background: C.white, borderBottom: `1px solid ${C.border}`, padding: "0 2rem", display: "flex", gap: 0 }}>
        {[["work", "⚡ Procesar Facturas"], ["history", `📋 Historial (${history.length})`]].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} style={{
            background: "transparent", border: "none", borderBottom: tab === key ? `3px solid ${C.blue}` : "3px solid transparent",
            color: tab === key ? C.blue : C.textMuted,
            padding: "12px 20px", cursor: "pointer", fontSize: 13, fontWeight: tab === key ? 700 : 400,
            marginBottom: -1, transition: "all 0.15s"
          }}>{label}</button>
        ))}
      </div>

      <div style={{ maxWidth: 1160, margin: "0 auto", padding: "1.5rem 1.5rem" }}>

        {/* ══ TAB: PROCESAR ══ */}
        {tab === "work" && (
          <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: "1.5rem" }}>

            {/* ─ Panel izquierdo ─ */}
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>

              {/* Flujo */}
              <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: "1.25rem", boxShadow: C.shadow }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: C.textDim, letterSpacing: "0.1em", marginBottom: 16 }}>FLUJO DE TRABAJO</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <Step n="1" label="Token OAuth de Drive" active={!token} done={!!token} />
                  <Step n="2" label="Agregar facturas PDF" active={!!token && !queue.length} done={queue.length > 0} />
                  <Step n="3" label="Generar declaraciones" active={queue.length > 0 && !processing} done={doneCount > 0} />
                </div>
              </div>

              {/* Token */}
              <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: "1.25rem", boxShadow: C.shadow }}>
                <label style={{ fontSize: 10, fontWeight: 700, color: C.textDim, letterSpacing: "0.1em", display: "block", marginBottom: 8 }}>
                  TOKEN OAUTH GOOGLE DRIVE
                </label>
                <textarea
                  value={token}
                  onChange={e => setToken(e.target.value.trim())}
                  placeholder="Pega aquí tu access_token de Google..."
                  rows={3}
                  style={{
                    width: "100%", background: "#f8fafc", border: `1px solid ${C.border}`,
                    borderRadius: 7, padding: "9px 12px", color: C.text,
                    fontSize: 11, outline: "none", resize: "vertical", fontFamily: "monospace"
                  }}
                />
                <div style={{ marginTop: 6, fontSize: 10, color: C.textDim, lineHeight: 1.6 }}>
                  Token válido ~1 hora. Obtén uno nuevo en{" "}
                  <a href="https://developers.google.com/oauthplayground" target="_blank" rel="noreferrer"
                    style={{ color: C.blueLight }}>OAuth Playground</a>
                  {" "}· scope: <code style={{ background: "#e8f0fc", padding: "1px 4px", borderRadius: 3, color: C.blue }}>drive.readonly</code>
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
                    borderRadius: 8, padding: "1.25rem 1rem",
                    textAlign: "center", cursor: "pointer",
                    background: dragOver ? "#1255a408" : "#f8fafc",
                    transition: "all 0.2s"
                  }}
                >
                  <input ref={fileRef} type="file" accept=".pdf" multiple
                    onChange={e => addFiles(e.target.files)} style={{ display: "none" }} />
                  <div style={{ fontSize: 24, marginBottom: 6 }}>📂</div>
                  <div style={{ color: C.textMuted, fontSize: 12, fontWeight: 600 }}>Arrastra o haz clic</div>
                  <div style={{ color: C.textDim, fontSize: 10, marginTop: 2 }}>Puedes seleccionar varias facturas a la vez</div>
                </div>
              </div>

              {/* Botón principal */}
              <button
                onClick={processAll}
                disabled={!token || !pendingCount || processing}
                style={{
                  background: token && pendingCount && !processing
                    ? `linear-gradient(135deg, ${C.accent}, ${C.gold})` : "#c8d6e5",
                  color: token && pendingCount && !processing ? C.white : C.textDim,
                  border: "none", borderRadius: 9, padding: "13px",
                  cursor: token && pendingCount && !processing ? "pointer" : "not-allowed",
                  fontWeight: 800, fontSize: 13, letterSpacing: "0.07em",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  boxShadow: token && pendingCount && !processing ? "0 4px 16px rgba(212,120,10,0.35)" : "none",
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

            {/* ─ Panel derecho ─ */}
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>

              {/* Cola de facturas */}
              <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden", boxShadow: C.shadow }}>
                <div style={{
                  background: `linear-gradient(135deg, ${C.navy}, ${C.navyMid})`,
                  padding: "0.875rem 1.25rem",
                  display: "flex", alignItems: "center", justifyContent: "space-between"
                }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: C.white }}>
                    📋 Cola de procesamiento
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    {pendingCount > 0 && <Badge color="#a0c4ff">{pendingCount} pendiente{pendingCount !== 1 ? "s" : ""}</Badge>}
                    {doneCount > 0 && <Badge color="#81c784">{doneCount} listo{doneCount !== 1 ? "s" : ""}</Badge>}
                  </div>
                </div>
                <div style={{ padding: "1rem" }}>
                  {queue.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "2.5rem 1rem", color: C.textDim }}>
                      <div style={{ fontSize: 36, marginBottom: 10 }}>📄</div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: C.textMuted, marginBottom: 6 }}>
                        No hay facturas en cola
                      </div>
                      <div style={{ fontSize: 12 }}>Arrastra los PDFs al panel izquierdo o haz clic en "Arrastra o haz clic"</div>
                    </div>
                  ) : (
                    queue.map(item => (
                      <InvoiceRow key={item.id} item={item} onRemove={removeFromQueue} onPreview={openPreview} />
                    ))
                  )}
                </div>
              </div>

              {/* Log de actividad */}
              {activeLog.length > 0 && (
                <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden", boxShadow: C.shadow }}>
                  <div style={{
                    background: `linear-gradient(135deg, ${C.navy}, ${C.navyMid})`,
                    padding: "0.6rem 1.25rem",
                    fontSize: 10, fontWeight: 700, color: "#8faec8", letterSpacing: "0.1em"
                  }}>ACTIVIDAD</div>
                  <div ref={logRef} style={{ padding: "0.75rem 1.25rem", fontFamily: "monospace", fontSize: 11, maxHeight: 200, overflowY: "auto", background: "#f8fafc" }}>
                    {activeLog.map((l, i) => (
                      <div key={i} style={{
                        color: l.msg.startsWith("✓") ? C.green : l.msg.startsWith("✗") ? C.red : C.textMuted,
                        marginBottom: 3, display: "flex", gap: 8
                      }}>
                        <span style={{ color: C.textDim, flexShrink: 0 }}>{l.ts}</span>
                        <span>{l.msg}</span>
                      </div>
                    ))}
                    {processing && (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, color: C.blue, marginTop: 4 }}>
                        <Spinner size={12} />
                        <span>Procesando...</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Instrucciones cuando está vacío */}
              {queue.length === 0 && (
                <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: "1.5rem", boxShadow: C.shadow }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.textMuted, marginBottom: 12 }}>¿Cómo usar el sistema?</div>
                  {[
                    ["1", "Obtén un token de Google Drive desde OAuth Playground (scope: drive.readonly)"],
                    ["2", "Agrega una o varias facturas de importación en PDF"],
                    ["3", "Haz clic en GENERAR PDF — el sistema busca las declaraciones DIAN automáticamente"],
                    ["4", "Los PDFs se descargan automáticamente al terminar cada factura"],
                  ].map(([n, txt]) => (
                    <div key={n} style={{ display: "flex", gap: 10, marginBottom: 10 }}>
                      <div style={{
                        width: 22, height: 22, borderRadius: "50%",
                        background: C.blue, color: "white",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 11, fontWeight: 700, flexShrink: 0
                      }}>{n}</div>
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

        {/* ══ TAB: HISTORIAL ══ */}
        {tab === "history" && (
          <div style={{ maxWidth: 800 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>Historial de procesamiento</div>
                <div style={{ fontSize: 12, color: C.textMuted }}>{history.length} factura{history.length !== 1 ? "s" : ""} procesada{history.length !== 1 ? "s" : ""}</div>
              </div>
              {history.length > 0 && (
                <button onClick={() => { localStorage.removeItem("alumar_hist"); setHistory([]); }}
                  style={{ background: "transparent", border: `1px solid ${C.border}`, borderRadius: 7, padding: "6px 14px", cursor: "pointer", fontSize: 11, color: C.textMuted }}>
                  🗑 Limpiar historial
                </button>
              )}
            </div>

            {history.length === 0 ? (
              <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: "4rem 2rem", textAlign: "center", boxShadow: C.shadow }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: C.textMuted, marginBottom: 6 }}>Sin historial todavía</div>
                <div style={{ fontSize: 12, color: C.textDim }}>Las facturas procesadas aparecerán aquí automáticamente.</div>
              </div>
            ) : (
              <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: "1.25rem", boxShadow: C.shadow }}>
                {history.map(entry => <HistoryRow key={entry.id} entry={entry} />)}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
