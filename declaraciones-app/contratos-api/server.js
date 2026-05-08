const express = require('express');
const mysql = require('mysql2/promise');
const path = require('path');

require('dotenv').config ? require('dotenv').config() : null;

const app = express();
const PORT = process.env.PORT || 3000;

const dbConfig = {
  host: process.env.DB_HOST || '159.195.147.74',
  port: parseInt(process.env.DB_PORT || '3500'),
  user: process.env.DB_USER || 'consulta_alumar',
  password: process.env.DB_PASS,
  database: process.env.DB_NAME || 'alumar',
  connectTimeout: 10000,
};

let pool;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({ ...dbConfig, waitForConnections: true, connectionLimit: 5 });
  }
  return pool;
}

app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true, service: 'alumar-contratos-api' }));

// ── GET /api/guias - List recent guides for the dropdown ──
app.get('/api/guias', async (_req, res) => {
  try {
    const [rows] = await getPool().query(`
      SELECT
        g.DCG_NUMERO       AS guia_numero,
        g.DCG_FECHA         AS fecha,
        g.DCG_RUTA          AS ruta,
        g.DCG_DESCRIPCION   AS flete_desc,
        t.TRA_NOMBRE        AS transportista_nombre,
        t.TRA_APELLIDO      AS transportista_apellido,
        v.VEH_PLACA         AS placa
      FROM adn_doccliguia g
      LEFT JOIN adn_transportistas t ON g.DCG_TRA_CODIGO = t.TRA_CODIGO
      LEFT JOIN adn_vehiculos v ON g.DCG_VEH_PLACA = v.VEH_PLACA
      ORDER BY g.DCG_FECHA DESC, g.DCG_NUMERO DESC
      LIMIT 50
    `);
    res.json(rows);
  } catch (err) {
    console.error('Error /api/guias:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/contrato/:id - Full contract data composed from DB ──
app.get('/api/contrato/:id', async (req, res) => {
  try {
    const guiaNum = req.params.id.padStart(10, '0');

    // 1. Guide header + transportista + vehiculo
    const [guias] = await getPool().query(`
      SELECT
        g.DCG_NUMERO        AS guia_numero,
        g.DCG_FECHA         AS fecha_cargue,
        g.DCG_DESCRIPCION   AS flete_descripcion,
        g.DCG_RUTA          AS ruta,
        g.DCG_NETOGUIA      AS valor_mercancia,
        g.DCG_PESO          AS peso_total,
        g.DCG_BULTOS        AS bultos,
        g.DCG_ESTADO        AS estado,
        t.TRA_CODIGO        AS tra_codigo,
        t.TRA_NOMBRE        AS transportista_nombre,
        t.TRA_APELLIDO      AS transportista_apellido,
        t.TRA_CEDULA        AS transportista_cc,
        t.TRA_TELEFONO      AS transportista_telefono,
        t.TRA_DIRECCION     AS transportista_direccion,
        t.TRA_EMAIL         AS transportista_email,
        v.VEH_PLACA         AS vehiculo_placa,
        v.VEH_MARCA         AS vehiculo_marca,
        v.VEH_MODELO        AS vehiculo_modelo,
        v.VEH_PESO          AS vehiculo_capacidad
      FROM adn_doccliguia g
      LEFT JOIN adn_transportistas t ON g.DCG_TRA_CODIGO = t.TRA_CODIGO
      LEFT JOIN adn_vehiculos v ON g.DCG_VEH_PLACA = v.VEH_PLACA
      WHERE g.DCG_NUMERO = ?
    `, [guiaNum]);

    if (!guias.length) {
      return res.status(404).json({ error: `Guía ${guiaNum} no encontrada` });
    }

    const guia = guias[0];

    // 2. Invoices linked to this guide
    const [facturas] = await getPool().query(`
      SELECT
        d.DCL_NUMERO        AS factura_numero,
        d.DCL_TDT_CODIGO    AS tipo_doc,
        d.DCL_FECHA         AS fecha,
        d.DCL_NETO          AS neto,
        d.DCL_BRUTO         AS bruto,
        d.DCL_BULTOS        AS bultos,
        d.DCL_PESO          AS peso,
        c.CLT_CODIGO        AS cliente_codigo,
        c.CLT_NOMBRE        AS cliente_nombre,
        c.CLT_DIRECCION1    AS cliente_direccion,
        c.CLT_TELEFONO1     AS cliente_telefono,
        cd.CDD_DESCRI       AS ciudad
      FROM adn_doccli d
      LEFT JOIN adn_clientes c ON d.DCL_CLT_CODIGO = c.CLT_CODIGO
      LEFT JOIN adn_ciudades cd ON c.CLT_CDD_CODIGO = cd.CDD_CODIGO
      WHERE d.DCL_NUMGUIA = ?
      ORDER BY d.DCL_FECHA, d.DCL_NUMERO
    `, [guiaNum]);

    // 3. Compose the response
    const ciudadesSet = new Set();
    const facturasNums = [];
    let totalMercancia = 0;

    for (const f of facturas) {
      if (f.ciudad) ciudadesSet.add(f.ciudad);
      facturasNums.push(f.factura_numero.replace(/^0+/, ''));
      totalMercancia += parseFloat(f.neto) || 0;
    }

    const contratoNum = guia.guia_numero.replace(/^0+/, '');
    const fleteTexto = guia.flete_descripcion || '';
    const fleteNumerico = parseInt(fleteTexto.replace(/\D/g, ''), 10) || 0;

    res.json({
      contrato: {
        numero: contratoNum,
        fecha_cargue: guia.fecha_cargue,
        fecha_salida: null,
        estado: guia.estado,
      },
      transportista: {
        nombre: `${guia.transportista_nombre || ''} ${guia.transportista_apellido || ''}`.trim(),
        cc: guia.transportista_cc || '',
        telefono: guia.transportista_telefono || '',
        direccion: guia.transportista_direccion || '',
        email: guia.transportista_email || '',
        ciudad: '',
        celular: '',
      },
      conductor: {
        nombre: '',
        cc: '',
      },
      vehiculo: {
        marca: guia.vehiculo_marca || '',
        placas: guia.vehiculo_placa || '',
        modelo: guia.vehiculo_modelo || '',
        capacidad: guia.vehiculo_capacidad > 0 ? `${guia.vehiculo_capacidad} Ton` : '',
        licencia: '',
        soat: '',
        tarjeta_propiedad: '',
        aseguradora: '',
        cert_tecmec: '',
      },
      carga: {
        descripcion: 'Menaje de cocina y mesa — Línea importada',
        destino: guia.ruta || '',
        facturas: facturasNums.join(', '),
        devoluciones: '',
        ciudades: [...ciudadesSet].join(', '),
        valor_mercancia: Math.round(totalMercancia || parseFloat(guia.valor_mercancia) || 0),
        valor_flete: fleteNumerico,
        peso: parseFloat(guia.peso_total) || 0,
        bultos: parseFloat(guia.bultos) || 0,
      },
      facturas_detalle: facturas,
      _meta: {
        fuente: 'adn_doccliguia + adn_doccli + adn_transportistas + adn_vehiculos + adn_clientes + adn_ciudades',
        campos_manuales: [
          'conductor (nombre, CC)',
          'celular transportista',
          'ciudad transportista',
          'fecha salida vehículo',
          'SOAT, licencia tránsito, tarjeta propiedad, aseguradora, cert. técnico-mecánica',
          'devoluciones',
        ],
      },
    });
  } catch (err) {
    console.error('Error /api/contrato/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/transportistas - List for autocomplete ──
app.get('/api/transportistas', async (_req, res) => {
  try {
    const [rows] = await getPool().query(`
      SELECT TRA_CODIGO AS codigo, TRA_NOMBRE AS nombre, TRA_APELLIDO AS apellido,
             TRA_CEDULA AS cc, TRA_TELEFONO AS telefono, TRA_DIRECCION AS direccion
      FROM adn_transportistas
      WHERE TRA_ACTIVO = 1 AND TRA_CODIGO != '000001'
      ORDER BY TRA_NOMBRE
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/vehiculos - List for autocomplete ──
app.get('/api/vehiculos', async (_req, res) => {
  try {
    const [rows] = await getPool().query(`
      SELECT VEH_PLACA AS placa, VEH_MARCA AS marca, VEH_MODELO AS modelo,
             VEH_PESO AS capacidad
      FROM adn_vehiculos
      WHERE VEH_ACTIVO = 1 AND VEH_PLACA != '000-000'
      ORDER BY VEH_PLACA
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/pdf - Eliminado: el frontend genera los PDFs directamente ──

// ── GET /api/dashboard/kpis - KPIs for the dashboard ──
app.get('/api/dashboard/kpis', async (_req, res) => {
  try {
    const [kpis] = await getPool().query(`
      SELECT
        COUNT(*)                                    AS total_guias,
        SUM(DCG_NETOGUIA)                           AS total_mercancia,
        SUM(CAST(REPLACE(REPLACE(DCG_DESCRIPCION, '.', ''), ',', '') AS UNSIGNED)) AS total_flete,
        COUNT(DISTINCT DCG_TRA_CODIGO)              AS transportistas_activos,
        COUNT(DISTINCT DCG_VEH_PLACA)               AS vehiculos_usados,
        MIN(DCG_FECHA)                              AS fecha_primera,
        MAX(DCG_FECHA)                              AS fecha_ultima
      FROM adn_doccliguia
      WHERE DCG_FECHA >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
    `);

    const [porMes] = await getPool().query(`
      SELECT
        DATE_FORMAT(DCG_FECHA, '%Y-%m') AS mes,
        COUNT(*) AS guias,
        SUM(DCG_NETOGUIA) AS mercancia
      FROM adn_doccliguia
      WHERE DCG_FECHA >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
      GROUP BY mes
      ORDER BY mes
    `);

    const [topRutas] = await getPool().query(`
      SELECT
        DCG_RUTA AS ruta,
        COUNT(*) AS viajes,
        SUM(DCG_NETOGUIA) AS mercancia_total
      FROM adn_doccliguia
      WHERE DCG_FECHA >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH) AND DCG_RUTA != ''
      GROUP BY DCG_RUTA
      ORDER BY viajes DESC
      LIMIT 8
    `);

    const [topTransp] = await getPool().query(`
      SELECT
        t.TRA_NOMBRE AS nombre,
        t.TRA_APELLIDO AS apellido,
        COUNT(*) AS viajes,
        SUM(g.DCG_NETOGUIA) AS mercancia_total
      FROM adn_doccliguia g
      JOIN adn_transportistas t ON g.DCG_TRA_CODIGO = t.TRA_CODIGO
      WHERE g.DCG_FECHA >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH) AND t.TRA_CODIGO != '000001'
      GROUP BY t.TRA_CODIGO, t.TRA_NOMBRE, t.TRA_APELLIDO
      ORDER BY viajes DESC
      LIMIT 8
    `);

    res.json({
      resumen: kpis[0],
      por_mes: porMes,
      top_rutas: topRutas,
      top_transportistas: topTransp,
    });
  } catch (err) {
    console.error('Error /api/dashboard/kpis:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/dashboard/guias - Paginated + filtered guias ──
app.get('/api/dashboard/guias', async (req, res) => {
  try {
    const { desde, hasta, transportista, ruta, page = 1, limit = 25 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    let where = ['1=1'];
    let params = [];

    if (desde) { where.push('g.DCG_FECHA >= ?'); params.push(desde); }
    if (hasta) { where.push('g.DCG_FECHA <= ?'); params.push(hasta); }
    if (transportista) { where.push('g.DCG_TRA_CODIGO = ?'); params.push(transportista); }
    if (ruta) { where.push('g.DCG_RUTA LIKE ?'); params.push(`%${ruta}%`); }

    const whereStr = where.join(' AND ');

    const [countRes] = await getPool().query(
      `SELECT COUNT(*) AS total FROM adn_doccliguia g WHERE ${whereStr}`, params
    );

    const [rows] = await getPool().query(`
      SELECT
        g.DCG_NUMERO        AS guia_numero,
        g.DCG_FECHA         AS fecha,
        g.DCG_DESCRIPCION   AS flete_desc,
        g.DCG_RUTA          AS ruta,
        g.DCG_NETOGUIA      AS valor_mercancia,
        g.DCG_PESO          AS peso,
        g.DCG_BULTOS        AS bultos,
        g.DCG_ESTADO        AS estado,
        t.TRA_CODIGO        AS tra_codigo,
        t.TRA_NOMBRE        AS transportista_nombre,
        t.TRA_APELLIDO      AS transportista_apellido,
        v.VEH_PLACA         AS placa,
        v.VEH_MARCA         AS marca
      FROM adn_doccliguia g
      LEFT JOIN adn_transportistas t ON g.DCG_TRA_CODIGO = t.TRA_CODIGO
      LEFT JOIN adn_vehiculos v ON g.DCG_VEH_PLACA = v.VEH_PLACA
      WHERE ${whereStr}
      ORDER BY g.DCG_FECHA DESC, g.DCG_NUMERO DESC
      LIMIT ? OFFSET ?
    `, [...params, parseInt(limit), offset]);

    res.json({
      total: countRes[0].total,
      page: parseInt(page),
      limit: parseInt(limit),
      data: rows,
    });
  } catch (err) {
    console.error('Error /api/dashboard/guias:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/facturas/dia/:fecha/referencias - Referencias de productos por factura ──
app.get('/api/facturas/dia/:fecha/referencias', async (req, res) => {
  try {
    const fecha = req.params.fecha;

    // Una sola query: facturas del día + sus líneas de detalle desde adn_movcli
    // MCL_DCL_NUMERO = número de factura (mismo formato que DCL_NUMERO)
    // MCL_UPP_PDT_CODIGO = código/referencia del producto
    const [lineas] = await getPool().query(`
      SELECT
        d.DCL_NUMERO          AS factura_numero,
        d.DCL_TDT_CODIGO      AS tipo_doc,
        d.DCL_FECHA           AS fecha,
        c.CLT_NOMBRE          AS cliente,
        cd.CDD_DESCRI         AS ciudad,
        m.MCL_UPP_PDT_CODIGO  AS referencia,
        m.MCL_DESCRI          AS descripcion,
        m.MCL_CANTIDAD        AS cantidad
      FROM adn_doccli d
      LEFT JOIN adn_clientes    c  ON d.DCL_CLT_CODIGO  = c.CLT_CODIGO
      LEFT JOIN adn_ciudades    cd ON c.CLT_CDD_CODIGO  = cd.CDD_CODIGO
      LEFT JOIN adn_movcli      m  ON m.MCL_DCL_NUMERO  = d.DCL_NUMERO
                                   AND m.MCL_DCL_TDT_CODIGO = d.DCL_TDT_CODIGO
      WHERE DATE(d.DCL_FECHA) = ?
        AND d.DCL_TDT_CODIGO IN ('FVELE','FVEP')
        AND d.DCL_ACTIVO = 1
      ORDER BY d.DCL_TDT_CODIGO, CAST(d.DCL_NUMERO AS UNSIGNED) ASC, m.MCL_UPP_PDT_CODIGO ASC
    `, [fecha]);

    if (!lineas.length) {
      return res.json({ fecha, total: 0, tabla_detalle_encontrada: 'adn_movcli', facturas: [] });
    }

    // Agrupar por factura
    const facturaMap = new Map();
    for (const row of lineas) {
      const key = row.factura_numero;
      if (!facturaMap.has(key)) {
        const num = key.replace(/^0+/, '') || '0';
        facturaMap.set(key, {
          factura_numero: num,
          factura_label: `${row.tipo_doc} ${num}`,   // ej: "FVELE 54089"
          tipo_doc: row.tipo_doc,
          factura_numero_raw: key,
          fecha: row.fecha,
          cliente: row.cliente || '',
          ciudad: row.ciudad || '',
          referencias: [],
          lineas_raw: 0,
        });
      }
      const entry = facturaMap.get(key);
      entry.lineas_raw++;
      const ref = (row.referencia || '').trim();
      if (ref && ref.length >= 2 && !entry.referencias.includes(ref)) {
        entry.referencias.push(ref);
      }
    }

    res.json({
      fecha,
      total: facturaMap.size,
      tabla_detalle_encontrada: 'adn_movcli',
      facturas: [...facturaMap.values()],
    });
  } catch (err) {
    console.error('Error /api/facturas/dia/:fecha/referencias:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/tablas - Explorar tablas disponibles en la BD ──
app.get('/api/tablas', async (_req, res) => {
  try {
    const [rows] = await getPool().query(
      `SELECT TABLE_NAME, TABLE_ROWS FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/tabla/:nombre/cols - Ver columnas de una tabla ──
app.get('/api/tabla/:nombre/cols', async (req, res) => {
  try {
    const [rows] = await getPool().query(
      `SELECT COLUMN_NAME, DATA_TYPE FROM information_schema.COLUMNS
       WHERE TABLE_NAME = ? AND TABLE_SCHEMA = DATABASE() ORDER BY ORDINAL_POSITION`,
      [req.params.nombre]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/tabla/:nombre/muestra - Ver 3 filas de muestra ──
app.get('/api/tabla/:nombre/muestra', async (req, res) => {
  try {
    const nombre = req.params.nombre.replace(/[^a-zA-Z0-9_]/g, '');
    const [rows] = await getPool().query(`SELECT * FROM ${nombre} LIMIT 3`);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/declaraciones/dia/:fecha - Facturas del día (solo FVE) ──────────
app.get('/api/declaraciones/dia/:fecha', async (req, res) => {
  try {
    const fecha = req.params.fecha; // formato YYYY-MM-DD

    // Solo facturas de venta electrónica (FVELE) y en papel (FVEP)
    // Se usa subquery para evitar duplicados del JOIN con guías
    const [facturas] = await getPool().query(`
      SELECT
        d.DCL_NUMERO        AS factura_numero_raw,
        d.DCL_TDT_CODIGO    AS tipo_doc,
        d.DCL_FECHA         AS fecha_factura,
        d.DCL_NUMGUIA       AS guia_numero,
        d.DCL_NETO          AS neto,
        d.DCL_BRUTO         AS bruto,
        d.DCL_BULTOS        AS bultos,
        d.DCL_PESO          AS peso,
        c.CLT_CODIGO        AS cliente_codigo,
        c.CLT_NOMBRE        AS cliente_nombre,
        c.CLT_DIRECCION1    AS cliente_direccion,
        c.CLT_TELEFONO1     AS cliente_telefono,
        cd.CDD_DESCRI       AS ciudad
      FROM adn_doccli d
      LEFT JOIN adn_clientes c  ON d.DCL_CLT_CODIGO = c.CLT_CODIGO
      LEFT JOIN adn_ciudades cd ON c.CLT_CDD_CODIGO = cd.CDD_CODIGO
      WHERE DATE(d.DCL_FECHA) = ?
        AND d.DCL_TDT_CODIGO IN ('FVELE','FVEP')
        AND d.DCL_ACTIVO = 1
      GROUP BY d.DCL_NUMERO, d.DCL_TDT_CODIGO
      ORDER BY d.DCL_TDT_CODIGO, CAST(d.DCL_NUMERO AS UNSIGNED) ASC
    `, [fecha]);

    if (!facturas.length) {
      return res.json({ fecha, total_facturas: 0, facturas: [], totales: { neto: 0, bultos: 0, peso: 0 } });
    }

    const totalNeto   = facturas.reduce((s, f) => s + (parseFloat(f.neto)   || 0), 0);
    const totalBultos = facturas.reduce((s, f) => s + (parseFloat(f.bultos) || 0), 0);
    const totalPeso   = facturas.reduce((s, f) => s + (parseFloat(f.peso)   || 0), 0);
    const ciudades    = [...new Set(facturas.map(f => f.ciudad).filter(Boolean))];
    const guias       = [...new Set(facturas.map(f => (f.guia_numero||'').replace(/^0+/,'')).filter(Boolean))];

    res.json({
      fecha,
      total_facturas: facturas.length,
      totales: {
        neto:   Math.round(totalNeto),
        bultos: totalBultos,
        peso:   Math.round(totalPeso),
      },
      ciudades,
      guias,
      facturas: facturas.map(f => {
        const num = (f.factura_numero_raw || '').replace(/^0+/, '') || '0';
        return {
          ...f,
          factura_numero: num,
          factura_label: `${f.tipo_doc} ${num}`,   // ej: "FVELE 54089"
          guia_numero: (f.guia_numero || '').replace(/^0+/, ''),
        };
      }),
    });
  } catch (err) {
    console.error('Error /api/declaraciones/dia/:fecha:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/almacenes ────────────────────────────────────────────────────────
app.get('/api/almacenes', async (_req, res) => {
  try {
    const [rows] = await getPool().query(`
      SELECT
        m.MCL_AMC_CODIGO        AS codigo,
        COUNT(DISTINCT m.MCL_UPP_PDT_CODIGO) AS referencias,
        SUM(m.MCL_CANTIDAD)     AS unidades_totales,
        COUNT(DISTINCT m.MCL_DCL_NUMERO) AS num_movimientos
      FROM adn_movcli m
      WHERE m.MCL_ACTIVO = 1
      GROUP BY m.MCL_AMC_CODIGO
      ORDER BY unidades_totales DESC
    `);
    res.json({ almacenes: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Lógica de asignación de zona ─────────────────────────────────────────────
function asignarZona(clase, rank) {
  if (clase === 'A') {
    return rank <= 50 ? 'A' : 'E';
  }
  if (clase === 'B') {
    return rank <= 200 ? 'E' : 'F';
  }
  // Clase C → segundo piso distribuido en 4 zonas
  if (rank <= 375)  return 'B';
  if (rank <= 750)  return 'D';
  if (rank <= 1125) return 'G';
  return 'H';
}

// ── GET /api/rotacion-bodega?meses=6 ─────────────────────────────────────────
// Rotación de productos: cuántas unidades y veces se vendió cada ref en N meses
app.get('/api/rotacion-bodega', async (req, res) => {
  const meses = Math.min(parseInt(req.query.meses || '6'), 24);
  try {
    const [rows] = await getPool().query(`
      SELECT
        m.MCL_UPP_PDT_CODIGO                          AS codigo,
        MAX(m.MCL_DESCRI)                             AS descripcion,
        SUM(m.MCL_CANTIDAD)                           AS unidades_vendidas,
        COUNT(DISTINCT m.MCL_DCL_NUMERO)              AS num_facturas,
        MAX(m.MCL_FECHAHORA)                          AS ultima_venta,
        MIN(m.MCL_FECHAHORA)                          AS primera_venta
      FROM adn_movcli m
      INNER JOIN adn_doccli d
        ON d.DCL_NUMERO     = m.MCL_DCL_NUMERO
        AND d.DCL_TDT_CODIGO = m.MCL_DCL_TDT_CODIGO
      WHERE d.DCL_TDT_CODIGO IN ('FVELE','FVEP')
        AND d.DCL_ACTIVO = 1
        AND m.MCL_ACTIVO = 1
        AND m.MCL_CANTIDAD > 0
        AND d.DCL_FECHA >= DATE_SUB(NOW(), INTERVAL ? MONTH)
      GROUP BY m.MCL_UPP_PDT_CODIGO
      ORDER BY unidades_vendidas DESC
    `, [meses]);

    // Clasificación ABC por unidades vendidas
    const total = rows.reduce((s, r) => s + parseFloat(r.unidades_vendidas || 0), 0);
    let acum = 0;
    const result = rows.map(r => {
      const units = parseFloat(r.unidades_vendidas || 0);
      acum += units;
      const pct = total > 0 ? (acum / total) * 100 : 0;
      const clase = pct <= 80 ? 'A' : pct <= 95 ? 'B' : 'C';
      return {
        codigo: r.codigo,
        descripcion: r.descripcion,
        unidades_vendidas: Math.round(units),
        num_facturas: parseInt(r.num_facturas),
        ultima_venta: r.ultima_venta,
        clase_rotacion: clase,
      };
    });

    // Asignar zona y rank global
    let rankC = 0;
    const resultConZona = result.map((r, idx) => {
      const rank = idx + 1;
      if (r.clase_rotacion === 'C') rankC++;
      const zona = asignarZona(r.clase_rotacion, r.clase_rotacion === 'C' ? rankC : rank);
      return { ...r, rank, zona };
    });

    res.json({
      meses_analizados: meses,
      total_referencias: resultConZona.length,
      total_unidades: Math.round(total),
      clase_A: resultConZona.filter(r => r.clase_rotacion === 'A').length,
      clase_B: resultConZona.filter(r => r.clase_rotacion === 'B').length,
      clase_C: resultConZona.filter(r => r.clase_rotacion === 'C').length,
      productos: resultConZona,
    });
  } catch (err) {
    console.error('Error /api/rotacion-bodega:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Alumar Contratos → http://localhost:${PORT}`);
  console.log(`API contrato:     http://localhost:${PORT}/api/contrato/19002`);
  console.log(`API guías:        http://localhost:${PORT}/api/guias`);
});
