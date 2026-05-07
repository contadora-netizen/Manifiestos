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

// ── GET /api/declaraciones/dia/:fecha - Guías + facturas de un día para declaraciones ──
app.get('/api/declaraciones/dia/:fecha', async (req, res) => {
  try {
    const fecha = req.params.fecha; // formato YYYY-MM-DD

    // 1. Traer todas las guías del día
    const [guias] = await getPool().query(`
      SELECT
        g.DCG_NUMERO      AS guia_numero,
        g.DCG_FECHA       AS fecha,
        g.DCG_RUTA        AS ruta,
        g.DCG_DESCRIPCION AS flete_descripcion,
        g.DCG_NETOGUIA    AS valor_mercancia,
        g.DCG_PESO        AS peso_total,
        g.DCG_BULTOS      AS bultos,
        g.DCG_ESTADO      AS estado,
        t.TRA_NOMBRE      AS transportista_nombre,
        t.TRA_APELLIDO    AS transportista_apellido,
        t.TRA_CEDULA      AS transportista_cc,
        v.VEH_PLACA       AS placa
      FROM adn_doccliguia g
      LEFT JOIN adn_transportistas t ON g.DCG_TRA_CODIGO = t.TRA_CODIGO
      LEFT JOIN adn_vehiculos v      ON g.DCG_VEH_PLACA = v.VEH_PLACA
      WHERE DATE(g.DCG_FECHA) = ?
      ORDER BY g.DCG_NUMERO
    `, [fecha]);

    if (!guias.length) {
      return res.json({ fecha, total_guias: 0, declaraciones: [] });
    }

    // 2. Para cada guía, traer sus facturas
    const declaraciones = [];
    for (const g of guias) {
      const [facturas] = await getPool().query(`
        SELECT
          d.DCL_NUMERO      AS factura_numero,
          d.DCL_FECHA       AS fecha_factura,
          d.DCL_NETO        AS neto,
          d.DCL_BRUTO       AS bruto,
          d.DCL_BULTOS      AS bultos,
          d.DCL_PESO        AS peso,
          d.DCL_TDT_CODIGO  AS tipo_doc,
          c.CLT_CODIGO      AS cliente_codigo,
          c.CLT_NOMBRE      AS cliente_nombre,
          c.CLT_DIRECCION1  AS cliente_direccion,
          c.CLT_TELEFONO1   AS cliente_telefono,
          c.CLT_NIT         AS cliente_nit,
          cd.CDD_DESCRI     AS ciudad,
          cd.CDD_DPTO       AS departamento
        FROM adn_doccli d
        LEFT JOIN adn_clientes  c  ON d.DCL_CLT_CODIGO = c.CLT_CODIGO
        LEFT JOIN adn_ciudades  cd ON c.CLT_CDD_CODIGO = cd.CDD_CODIGO
        WHERE d.DCL_NUMGUIA = ?
        ORDER BY d.DCL_FECHA, d.DCL_NUMERO
      `, [g.guia_numero]);

      const totalNeto   = facturas.reduce((s, f) => s + (parseFloat(f.neto)   || 0), 0);
      const totalBultos = facturas.reduce((s, f) => s + (parseFloat(f.bultos) || 0), 0);
      const totalPeso   = facturas.reduce((s, f) => s + (parseFloat(f.peso)   || 0), 0);
      const ciudades    = [...new Set(facturas.map(f => f.ciudad).filter(Boolean))];
      const clientes    = [...new Set(facturas.map(f => f.cliente_nombre).filter(Boolean))];

      declaraciones.push({
        id: `DEC-${g.guia_numero.replace(/^0+/, '')}`,
        guia_numero: g.guia_numero,
        guia_num_limpio: g.guia_numero.replace(/^0+/, ''),
        fecha: g.fecha,
        ruta: g.ruta,
        flete: g.flete_descripcion,
        transportista: `${g.transportista_nombre || ''} ${g.transportista_apellido || ''}`.trim(),
        transportista_cc: g.transportista_cc,
        placa: g.placa,
        estado_guia: g.estado,
        total_facturas: facturas.length,
        total_neto: Math.round(totalNeto),
        total_bultos: totalBultos,
        total_peso: totalPeso,
        ciudades,
        clientes,
        facturas,
        // Campos compatibles con la pestaña Procesados
        archivo_origen: `Guía CTT-${g.guia_numero.replace(/^0+/, '').padStart(5,'0')} — ${g.ruta || 'Sin ruta'}`,
        fecha_procesado: new Date().toISOString(),
        estado: 'ok',
        num_matches: facturas.length,
        num_no_match: 0,
        fuente: 'base_de_datos',
      });
    }

    // 3. Totales generales del día
    const totalNeto   = declaraciones.reduce((s, d) => s + d.total_neto,   0);
    const totalBultos = declaraciones.reduce((s, d) => s + d.total_bultos, 0);
    const totalPeso   = declaraciones.reduce((s, d) => s + d.total_peso,   0);
    const totalFact   = declaraciones.reduce((s, d) => s + d.total_facturas, 0);

    res.json({
      fecha,
      total_guias: guias.length,
      total_facturas: totalFact,
      total_neto: Math.round(totalNeto),
      total_bultos: totalBultos,
      total_peso: Math.round(totalPeso),
      declaraciones,
    });
  } catch (err) {
    console.error('Error /api/declaraciones/dia/:fecha:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Alumar Contratos → http://localhost:${PORT}`);
  console.log(`API contrato:     http://localhost:${PORT}/api/contrato/19002`);
  console.log(`API guías:        http://localhost:${PORT}/api/guias`);
});
