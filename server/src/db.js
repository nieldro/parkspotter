import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite, types as tiposLite } from '@electric-sql/pglite';
import pg from 'pg';
import { config, SERVER_DIR } from './config.js';

// Postgres devuelve COUNT/SUM (bigint) y AVG (numeric) como texto: aquí siempre llegan como número.
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));

// Clave primaria de cada tabla: los INSERT devuelven su valor como `lastInsertRowid`.
const PK = {
  usuario: 'id_usuario', propietario: 'id_propietario', garaje: 'id_garaje', disponibilidad: 'id_disponibilidad',
  reserva: 'id_reserva', pago: 'id_pago', calificacion: 'id_calificacion', notificacion: 'id_notificacion',
  garaje_foto: 'id_foto', mensaje: 'id_mensaje', bloqueo: 'id_bloqueo', reporte: 'id_reporte',
};

/** Pasa los `?` a `$1, $2…` (sin tocar los que estén dentro de un texto entre comillas) y pide el id de los INSERT. */
function preparar(sql) {
  let texto = '';
  let n = 0;
  let enTexto = false;
  for (const c of sql) {
    if (c === "'") enTexto = !enTexto;
    texto += c === '?' && !enTexto ? `$${++n}` : c;
  }
  let pk = null;
  const ins = /^\s*INSERT\s+INTO\s+(\w+)/i.exec(texto);
  if (ins && PK[ins[1].toLowerCase()] && !/\bRETURNING\b/i.test(texto)) {
    pk = PK[ins[1].toLowerCase()];
    texto = `${texto.trimEnd().replace(/;$/, '')} RETURNING ${pk}`;
  }
  return { texto, pk };
}

/** Ejecutor con la interfaz que usa toda la app: execute({ sql, args }) → { columns, rows, rowsAffected, lastInsertRowid }. */
function envolver(consulta) {
  return {
    async execute(arg) {
      const { sql, args = [] } = typeof arg === 'string' ? { sql: arg } : arg;
      const { texto, pk } = preparar(sql);
      const r = await consulta(texto, args);
      return {
        columns: r.columns,
        rows: r.rows,
        rowsAffected: r.afectadas ?? r.rows.length,
        lastInsertRowid: pk && r.rows[0] ? Number(r.rows[0][0]) : undefined,
      };
    },
  };
}

const esPostgres = (url) => /^postgres(?:ql)?:\/\//i.test(url || '');

function crearPostgres(url) {
  const local = /@(?:localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/.test(url);
  const pool = new pg.Pool({
    connectionString: url.replace(/([?&])sslmode=[^&]*&?/i, '$1').replace(/[?&]$/, ''),
    ssl: local ? false : { rejectUnauthorized: false }, // Supabase exige SSL; su certificado no está en el almacén de Node
    max: 8,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
  });
  pool.on('error', (e) => console.error('Conexión inactiva con la base cerrada:', e.message));

  // El esquema propio se fija una vez por conexión física. Requiere el «Session pooler» (o la conexión directa)
  // de Supabase, no el «Transaction pooler», que no conserva el estado de la sesión.
  const conectar = async () => {
    const c = await pool.connect();
    if (!c._psListo) {
      try {
        await c.query(`SET search_path TO "${config.dbEsquema}", public`);
        c._psListo = true;
      } catch (e) {
        c.release(e);
        throw e;
      }
    }
    return c;
  };
  const consultaEn = (c) => async (texto, args) => {
    const r = await c.query({ text: texto, values: args, rowMode: 'array' });
    return { columns: r.fields.map((f) => f.name), rows: r.rows, afectadas: r.rowCount };
  };

  return {
    ...envolver(async (texto, args) => {
      const c = await conectar();
      try {
        return await consultaEn(c)(texto, args);
      } finally {
        c.release();
      }
    }),
    async exec(sql) {
      const c = await conectar();
      try {
        await c.query(sql);
      } finally {
        c.release();
      }
    },
    async transaction(fn) {
      const c = await conectar();
      try {
        await c.query('BEGIN');
        const resultado = await fn(envolver(consultaEn(c)));
        await c.query('COMMIT');
        return resultado;
      } catch (e) {
        await c.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    },
    close: () => pool.end(),
  };
}

function rutaLocal() {
  const url = config.databaseUrl;
  if (!url) return path.join(SERVER_DIR, 'data', 'pglite');
  if (/^(?:memory|pglite):\/\/?$/i.test(url)) return 'memory://';
  if (/^file:/i.test(url)) return decodeURIComponent(fileURLToPath(url));
  return url; // una ruta suelta
}

function crearPglite() {
  const ruta = rutaLocal();
  if (ruta !== 'memory://') fs.mkdirSync(path.dirname(ruta), { recursive: true });
  const lite = new PGlite(ruta, {
    parsers: { [tiposLite.INT8]: (v) => Number(v), [tiposLite.NUMERIC]: (v) => Number(v) },
  });
  const consultaEn = (c) => async (texto, args) => {
    const r = await c.query(texto, args, { rowMode: 'array' });
    return { columns: r.fields.map((f) => f.name), rows: r.rows, afectadas: r.affectedRows };
  };
  return {
    ...envolver(consultaEn(lite)),
    exec: (sql) => lite.exec(sql),
    transaction: (fn) => lite.transaction((tx) => fn(envolver(consultaEn(tx)))),
    close: () => lite.close(),
    esLocal: true,
  };
}

let cliente = null;

export function getDb() {
  if (!cliente) cliente = esPostgres(config.databaseUrl) ? crearPostgres(config.databaseUrl) : crearPglite();
  return cliente;
}

export async function cerrarDb() {
  if (!cliente) return;
  const c = cliente;
  cliente = null;
  await c.close();
}

export async function initSchema() {
  const db = getDb();
  const esquema = `"${config.dbEsquema}"`;
  // PGlite tiene una sola sesión (el search_path se fija aquí); en Postgres lo fija cada conexión (ver crearPostgres).
  await db.exec(`CREATE SCHEMA IF NOT EXISTS ${esquema}; SET search_path TO ${esquema}, public;`);
  await db.exec(fs.readFileSync(path.join(SERVER_DIR, 'sql', 'schema.sql'), 'utf8'));
}

// Las reservas sin código (no debería haber: la columna lo genera sola) reciben uno.
export async function completarCodigos() {
  await getDb().execute("UPDATE reserva SET codigo = upper(substr(md5(random()::text || id_reserva::text), 1, 6)) WHERE codigo IS NULL");
}

// `ex` puede ser el cliente o una transacción: ambos exponen execute().
export async function all(ex, sql, args = []) {
  const rs = await ex.execute({ sql, args });
  return rs.rows.map((fila) => Object.fromEntries(rs.columns.map((col, i) => [col, fila[i]])));
}

export async function one(ex, sql, args = []) {
  return (await all(ex, sql, args))[0] ?? null;
}

export async function run(ex, sql, args = []) {
  return ex.execute({ sql, args });
}

// Ejecuta `fn(tx)` en una transacción. Las escrituras que compiten por el mismo cupo se serializan
// bloqueando la fila del garaje (SELECT … FOR UPDATE), ver routes/reservas.js.
export function transaccion(fn) {
  return getDb().transaction(fn);
}
