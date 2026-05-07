import { useState, useEffect, useCallback } from "react";

const CAPI = import.meta.env.VITE_CAPI_URL || "/api";

const C = {
  bg: "#f0f4f8", card: "#ffffff", border: "#dde3ec",
  navy: "#0a1f3c", navyMid: "#122a50",
  blue: "#1255a4", blueLight: "#1976d2",
  accent: "#d4780a", gold: "#e8920c",
  green: "#1e7e34", greenBg: "#e8f5e9",
  red: "#c0392b", redBg: "#fdeaea",
  text: "#1a2535", textMuted: "#4a6380", textDim: "#8fa3bc",
  white: "#ffffff",
  shadow: "0 2px 12px rgba(10,31,60,0.10)",
};

const fmtMoney = (n) => {
  if (!n && n !== 0) return "$0";
  const num = typeof n === "string" ? parseFloat(n) : n;
  if (num >= 1e9) return `$${(num / 1e9).toFixed(1)}B`;
  if (num >= 1e6) return `$${(num / 1e6).toFixed(1)}M`;
  if (num >= 1e3) return `$${(num / 1e3).toFixed(0)}K`;
  return `$${num.toLocaleString("es-CO")}`;
};

const fmtFull = (n) => `$${(parseFloat(n) || 0).toLocaleString("es-CO", { minimumFractionDigits: 0 })}`;

const fmtDate = (iso) => {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" });
};

const Badge = ({ color, bg, children }) => (
  <span style={{
    background: bg || `${color}18`, color: color || C.blue,
    padding: "2px 8px", borderRadius: 6, fontSize: 11, fontWeight: 600, whiteSpace: "nowrap"
  }}>{children}</span>
);

const KpiCard = ({ icon, label, value, sub, color }) => (
  <div style={{
    background: C.white, border: `1px solid ${C.border}`, borderRadius: 12,
    padding: "1.1rem 1.25rem", boxShadow: C.shadow, flex: 1, minWidth: 160
  }}>
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
      <div style={{
        width: 36, height: 36, borderRadius: 10,
        background: `${color || C.blue}15`, display: "flex", alignItems: "center",
        justifyContent: "center", fontSize: 18
      }}>{icon}</div>
      <div style={{ fontSize: 11, color: C.textMuted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
    </div>
    <div style={{ fontSize: 26, fontWeight: 700, color: color || C.navy, lineHeight: 1.1 }}>{value}</div>
    {sub && <div style={{ fontSize: 11, color: C.textDim, marginTop: 4 }}>{sub}</div>}
  </div>
);

const BarChart = ({ data, labelKey, valueKey, maxBars = 8, color = C.blue, title }) => {
  if (!data?.length) return null;
  const items = data.slice(0, maxBars);
  const max = Math.max(...items.map(d => parseFloat(d[valueKey]) || 0));
  return (
    <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: "1rem 1.25rem", boxShadow: C.shadow }}>
      {title && <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>{title}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {items.map((d, i) => {
          const val = parseFloat(d[valueKey]) || 0;
          const pct = max > 0 ? (val / max) * 100 : 0;
          const label = typeof d[labelKey] === "string" ? d[labelKey] : `${d.nombre || ""} ${d.apellido || ""}`.trim();
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 130, fontSize: 11, color: C.textMuted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flexShrink: 0 }}
                   title={label}>
                {label.length > 22 ? label.substring(0, 22) + "..." : label}
              </div>
              <div style={{ flex: 1, height: 18, background: "#f0f4f8", borderRadius: 4, overflow: "hidden", position: "relative" }}>
                <div style={{
                  width: `${pct}%`, height: "100%", borderRadius: 4, transition: "width 0.4s ease",
                  background: `linear-gradient(90deg, ${color}, ${color}cc)`,
                }} />
              </div>
              <div style={{ fontSize: 11, fontWeight: 600, color: C.text, width: 36, textAlign: "right", flexShrink: 0 }}>{val}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const MonthChart = ({ data, title }) => {
  if (!data?.length) return null;
  const max = Math.max(...data.map(d => d.guias || 0));
  const meses = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  return (
    <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: "1rem 1.25rem", boxShadow: C.shadow }}>
      {title && <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>{title}</div>}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 120 }}>
        {data.map((d, i) => {
          const h = max > 0 ? (d.guias / max) * 100 : 0;
          const [, m] = (d.mes || "").split("-");
          const mesLabel = meses[parseInt(m) - 1] || m;
          return (
            <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: C.blue }}>{d.guias}</div>
              <div style={{
                width: "100%", maxWidth: 32, height: `${h}%`, minHeight: 4, borderRadius: "4px 4px 0 0",
                background: `linear-gradient(180deg, ${C.blue}, ${C.blueLight})`, transition: "height 0.4s ease",
              }} />
              <div style={{ fontSize: 9, color: C.textDim, fontWeight: 500 }}>{mesLabel}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default function DashboardContratos({ onOpenContrato }) {
  const [kpis, setKpis] = useState(null);
  const [guias, setGuias] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [transportistas, setTransportistas] = useState([]);
  const [subTab, setSubTab] = useState("resumen");

  const [filtros, setFiltros] = useState({
    desde: "", hasta: "", transportista: "", ruta: ""
  });
  const [filtrosActivos, setFiltrosActivos] = useState({ ...filtros });

  const cargarKpis = useCallback(async () => {
    try {
      const res = await fetch(`${CAPI}/dashboard/kpis`);
      if (!res.ok) throw new Error("Error cargando KPIs");
      setKpis(await res.json());
    } catch (e) {
      setError(e.message);
    }
  }, []);

  const cargarGuias = useCallback(async (p = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filtrosActivos.desde) params.set("desde", filtrosActivos.desde);
      if (filtrosActivos.hasta) params.set("hasta", filtrosActivos.hasta);
      if (filtrosActivos.transportista) params.set("transportista", filtrosActivos.transportista);
      if (filtrosActivos.ruta) params.set("ruta", filtrosActivos.ruta);
      params.set("page", p);
      params.set("limit", 25);

      const res = await fetch(`${CAPI}/dashboard/guias?${params}`);
      if (!res.ok) throw new Error("Error cargando guias");
      const data = await res.json();
      setGuias(data.data);
      setTotal(data.total);
      setPage(data.page);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [filtrosActivos]);

  const cargarTransportistas = useCallback(async () => {
    try {
      const res = await fetch(`${CAPI}/transportistas`);
      if (res.ok) setTransportistas(await res.json());
    } catch {}
  }, []);

  useEffect(() => { cargarKpis(); cargarTransportistas(); }, [cargarKpis, cargarTransportistas]);
  useEffect(() => { cargarGuias(1); }, [cargarGuias]);

  const aplicarFiltros = () => { setFiltrosActivos({ ...filtros }); };
  const limpiarFiltros = () => {
    const clean = { desde: "", hasta: "", transportista: "", ruta: "" };
    setFiltros(clean);
    setFiltrosActivos(clean);
  };

  const totalPages = Math.ceil(total / 25);

  if (error && !kpis) {
    return (
      <div style={{ background: C.redBg, border: `1px solid ${C.red}`, borderRadius: 12, padding: "2rem", textAlign: "center" }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: C.red, marginBottom: 8 }}>Error conectando con la BD</div>
        <div style={{ fontSize: 12, color: C.textMuted }}>{error}</div>
        <div style={{ fontSize: 11, color: C.textDim, marginTop: 8 }}>Verifica que el contratos-api este corriendo en puerto 3000</div>
        <button onClick={() => { setError(null); cargarKpis(); cargarGuias(); }}
          style={{ marginTop: 12, background: C.blue, color: "white", border: "none", borderRadius: 6, padding: "8px 16px", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
          Reintentar
        </button>
      </div>
    );
  }

  const r = kpis?.resumen || {};

  return (
    <div style={{ maxWidth: 1080 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>Dashboard de Transporte</div>
          <div style={{ fontSize: 12, color: C.textMuted }}>Guias de carga desde la BD MySQL de Alumar (ultimos 12 meses)</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {[["resumen", "Resumen"], ["guias", "Guias de Carga"]].map(([key, label]) => (
            <button key={key} onClick={() => setSubTab(key)} style={{
              background: subTab === key ? C.navy : "transparent",
              color: subTab === key ? "white" : C.textMuted,
              border: `1px solid ${subTab === key ? C.navy : C.border}`,
              borderRadius: 8, padding: "7px 16px", cursor: "pointer", fontSize: 12, fontWeight: 600, transition: "all 0.15s"
            }}>{label}</button>
          ))}
        </div>
      </div>

      {/* Sub-tab: Resumen */}
      {subTab === "resumen" && (
        <>
          {/* KPIs */}
          <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
            <KpiCard icon="📦" label="Guias de Carga" value={r.total_guias || 0} sub="Ultimos 12 meses" color={C.navy} />
            <KpiCard icon="💰" label="Mercancia Total" value={fmtMoney(r.total_mercancia)} sub={fmtFull(r.total_mercancia)} color={C.green} />
            <KpiCard icon="🚛" label="Flete Total" value={fmtMoney(r.total_flete)} sub={fmtFull(r.total_flete)} color={C.accent} />
            <KpiCard icon="👤" label="Transportistas" value={r.transportistas_activos || 0} sub={`${r.vehiculos_usados || 0} vehiculos`} color={C.blue} />
          </div>

          {/* Charts row */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
            <MonthChart data={kpis?.por_mes} title="Guias por mes" />
            <BarChart data={kpis?.top_transportistas} labelKey="nombre" valueKey="viajes" color={C.blue} title="Top transportistas (viajes)" />
          </div>

          {/* Top rutas */}
          <BarChart data={kpis?.top_rutas} labelKey="ruta" valueKey="viajes" color={C.accent} title="Top rutas (viajes)" maxBars={8} />
        </>
      )}

      {/* Sub-tab: Guias list */}
      {subTab === "guias" && (
        <>
          {/* Filters */}
          <div style={{
            background: C.white, border: `1px solid ${C.border}`, borderRadius: 12,
            padding: "1rem 1.25rem", marginBottom: 12, boxShadow: C.shadow
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>Filtros</div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div style={{ flex: "1 1 140px" }}>
                <label style={{ fontSize: 10, color: C.textDim, display: "block", marginBottom: 3 }}>Desde</label>
                <input type="date" value={filtros.desde} onChange={e => setFiltros(f => ({ ...f, desde: e.target.value }))}
                  style={{ width: "100%", padding: "6px 8px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12, fontFamily: "inherit" }} />
              </div>
              <div style={{ flex: "1 1 140px" }}>
                <label style={{ fontSize: 10, color: C.textDim, display: "block", marginBottom: 3 }}>Hasta</label>
                <input type="date" value={filtros.hasta} onChange={e => setFiltros(f => ({ ...f, hasta: e.target.value }))}
                  style={{ width: "100%", padding: "6px 8px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12, fontFamily: "inherit" }} />
              </div>
              <div style={{ flex: "1 1 180px" }}>
                <label style={{ fontSize: 10, color: C.textDim, display: "block", marginBottom: 3 }}>Transportista</label>
                <select value={filtros.transportista} onChange={e => setFiltros(f => ({ ...f, transportista: e.target.value }))}
                  style={{ width: "100%", padding: "6px 8px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12, fontFamily: "inherit", background: "white" }}>
                  <option value="">Todos</option>
                  {transportistas.map(t => (
                    <option key={t.codigo} value={t.codigo}>{t.nombre} {t.apellido}</option>
                  ))}
                </select>
              </div>
              <div style={{ flex: "1 1 180px" }}>
                <label style={{ fontSize: 10, color: C.textDim, display: "block", marginBottom: 3 }}>Ruta (buscar)</label>
                <input type="text" value={filtros.ruta} onChange={e => setFiltros(f => ({ ...f, ruta: e.target.value }))}
                  placeholder="Ej: BOGOTA" style={{ width: "100%", padding: "6px 8px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12, fontFamily: "inherit" }} />
              </div>
              <button onClick={aplicarFiltros}
                style={{ background: C.blue, color: "white", border: "none", borderRadius: 6, padding: "7px 16px", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                Aplicar
              </button>
              <button onClick={limpiarFiltros}
                style={{ background: "transparent", color: C.textMuted, border: `1px solid ${C.border}`, borderRadius: 6, padding: "7px 12px", cursor: "pointer", fontSize: 12 }}>
                Limpiar
              </button>
            </div>
          </div>

          {/* Results header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ fontSize: 12, color: C.textMuted }}>
              {total} guia{total !== 1 ? "s" : ""} encontrada{total !== 1 ? "s" : ""}
              {(filtrosActivos.desde || filtrosActivos.hasta || filtrosActivos.transportista || filtrosActivos.ruta) &&
                <Badge color={C.accent}>Filtros activos</Badge>
              }
            </div>
            {totalPages > 1 && (
              <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <button onClick={() => cargarGuias(page - 1)} disabled={page <= 1}
                  style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 4, padding: "4px 8px", cursor: page > 1 ? "pointer" : "not-allowed", fontSize: 11, opacity: page <= 1 ? 0.4 : 1 }}>
                  &lt;
                </button>
                <span style={{ fontSize: 11, color: C.textMuted }}>{page} / {totalPages}</span>
                <button onClick={() => cargarGuias(page + 1)} disabled={page >= totalPages}
                  style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 4, padding: "4px 8px", cursor: page < totalPages ? "pointer" : "not-allowed", fontSize: 11, opacity: page >= totalPages ? 0.4 : 1 }}>
                  &gt;
                </button>
              </div>
            )}
          </div>

          {/* Table */}
          <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden", boxShadow: C.shadow }}>
            {loading ? (
              <div style={{ padding: "3rem", textAlign: "center", color: C.textDim, fontSize: 13 }}>Cargando...</div>
            ) : guias.length === 0 ? (
              <div style={{ padding: "3rem", textAlign: "center", color: C.textDim }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
                <div style={{ fontSize: 13 }}>No se encontraron guias con estos filtros</div>
              </div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: `linear-gradient(135deg, ${C.navy}, ${C.navyMid})` }}>
                    {["Guia", "Fecha", "Transportista", "Vehiculo", "Ruta", "Mercancia", "Flete", ""].map((h, i) => (
                      <th key={i} style={{
                        padding: "10px 12px", textAlign: i >= 5 ? "right" : "left",
                        color: "#8faec8", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em"
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {guias.map((g, i) => {
                    const num = (g.guia_numero || "").replace(/^0+/, "");
                    const transp = [g.transportista_nombre, g.transportista_apellido].filter(Boolean).join(" ");
                    const rutaCorta = (g.ruta || "").length > 35 ? g.ruta.substring(0, 35) + "..." : g.ruta;
                    return (
                      <tr key={g.guia_numero} style={{
                        borderBottom: `1px solid ${C.border}`,
                        background: i % 2 === 0 ? "white" : "#fafbfd",
                        transition: "background 0.1s"
                      }}
                        onMouseEnter={e => e.currentTarget.style.background = "#f0f4f8"}
                        onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? "white" : "#fafbfd"}
                      >
                        <td style={{ padding: "8px 12px", fontWeight: 700, color: C.blue, fontFamily: "monospace" }}>{num}</td>
                        <td style={{ padding: "8px 12px", color: C.text, whiteSpace: "nowrap" }}>{fmtDate(g.fecha)}</td>
                        <td style={{ padding: "8px 12px", color: C.text }}>{transp}</td>
                        <td style={{ padding: "8px 12px" }}>
                          <Badge color={C.navy}>{g.placa || "-"}</Badge>
                          {g.marca && <span style={{ fontSize: 10, color: C.textDim, marginLeft: 4 }}>{g.marca}</span>}
                        </td>
                        <td style={{ padding: "8px 12px", color: C.textMuted, fontSize: 11 }} title={g.ruta}>{rutaCorta}</td>
                        <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 600, color: C.green, fontFamily: "monospace", fontSize: 11 }}>
                          {fmtMoney(g.valor_mercancia)}
                        </td>
                        <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 600, color: C.accent, fontFamily: "monospace", fontSize: 11 }}>
                          {g.flete_desc || "-"}
                        </td>
                        <td style={{ padding: "8px 12px", textAlign: "center" }}>
                          <button onClick={() => onOpenContrato && onOpenContrato(num)}
                            title="Abrir contrato"
                            style={{
                              background: `linear-gradient(135deg, ${C.accent}, ${C.gold})`, color: "white", border: "none",
                              borderRadius: 6, padding: "5px 10px", cursor: "pointer", fontSize: 11, fontWeight: 600
                            }}>
                            Ver
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Pagination bottom */}
          {totalPages > 1 && (
            <div style={{ display: "flex", justifyContent: "center", gap: 4, marginTop: 12 }}>
              {Array.from({ length: Math.min(totalPages, 10) }, (_, i) => i + 1).map(p => (
                <button key={p} onClick={() => cargarGuias(p)}
                  style={{
                    width: 30, height: 30, borderRadius: 6, border: `1px solid ${page === p ? C.blue : C.border}`,
                    background: page === p ? C.blue : "white", color: page === p ? "white" : C.textMuted,
                    cursor: "pointer", fontSize: 11, fontWeight: page === p ? 700 : 400, transition: "all 0.15s"
                  }}>{p}</button>
              ))}
              {totalPages > 10 && <span style={{ color: C.textDim, alignSelf: "center", fontSize: 12 }}>... {totalPages}</span>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
