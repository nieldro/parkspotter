// Prueba la persistencia en la Hoja de Google con un Apps Script simulado (mismo protocolo,
// incluida la redirección 302 que hace Google al responder un POST).
import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';

const TOKEN = 'token-de-prueba';
const hoja = new Map(); // pestaña -> { columnas, filas } (todo texto, como en la Hoja real)
const respuestas = new Map();
let n = 0;

const servidor = http.createServer((req, res) => {
  if (req.method === 'GET') {
    const r = respuestas.get(new URL(req.url, 'http://x').searchParams.get('id'));
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(r ?? '{}');
    return;
  }
  let cuerpo = '';
  req.on('data', (c) => (cuerpo += c));
  req.on('end', () => {
    const p = JSON.parse(cuerpo);
    let salida;
    if (p.token !== TOKEN) salida = { ok: false, error: 'token inválido' };
    else if (p.accion === 'leer') salida = { ok: true, tablas: Object.fromEntries(hoja) };
    else {
      hoja.set(p.tabla, { columnas: p.columnas, filas: p.filas });
      salida = { ok: true };
    }
    const id = String(++n);
    respuestas.set(id, JSON.stringify(salida));
    res.writeHead(302, { Location: `/eco?id=${id}` }).end();
  });
});
await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
process.env.HOJA_URL = `http://127.0.0.1:${servidor.address().port}/exec`;
process.env.HOJA_TOKEN = TOKEN;

const { all, cerrarDb, getDb, initSchema, run } = await import('../src/db.js');
const { vaciar } = await import('../src/hoja.js');

describe('persistencia en la Hoja', () => {
  before(async () => {
    await initSchema(); // Hoja vacía: crea todas las pestañas
    await vaciar();
  });
  after(async () => {
    await cerrarDb();
    servidor.close();
  });

  it('crea una pestaña por tabla con sus encabezados', () => {
    for (const t of ['usuario', 'propietario', 'garaje', 'disponibilidad', 'reserva', 'pago', 'calificacion', 'notificacion']) {
      assert.ok(hoja.has(t), `falta la pestaña ${t}`);
    }
    assert.ok(hoja.get('usuario').columnas.includes('correo'));
  });

  it('escribe los cambios como texto y los recupera al reiniciar', async () => {
    const db = getDb();
    await run(db, 'INSERT INTO usuario (nombre, apellido, correo, contrasena, telefono, tipo_usuario) VALUES (?, ?, ?, ?, ?, ?)', [
      'Ana', 'Pérez', 'ana@prueba.test', 'hash', '3001234567', 'propietario',
    ]);
    await run(db, 'INSERT INTO propietario (id_usuario, tipo_documento, numero_documento) VALUES (1, ?, ?)', ['CC', '0123456']);
    await run(
      db,
      `INSERT INTO garaje (id_propietario, nombre, direccion, latitud, longitud, tarifa_hora, capacidad_total, descripcion)
       VALUES (1, 'Garaje = prueba', 'Calle 1', 4.6533, -74.0836, 5000, 2, NULL)`,
    );
    await vaciar();
    const fila = hoja.get('usuario').filas[0];
    assert.ok(fila.includes('3001234567') && fila.every((v) => typeof v === 'string'));

    // «Reinicio»: se descarta la copia local y se vuelve a cargar todo desde la Hoja.
    await cerrarDb();
    await initSchema();
    const u = await all(getDb(), 'SELECT * FROM usuario');
    assert.equal(u.length, 1);
    assert.equal(u[0].telefono, '3001234567'); // el teléfono sigue siendo texto
    const g = (await all(getDb(), 'SELECT * FROM garaje'))[0];
    assert.equal(g.latitud, 4.6533);
    assert.equal(g.tarifa_hora, 5000);
    assert.equal(g.nombre, 'Garaje = prueba'); // una «fórmula» no se interpreta
    assert.equal(g.descripcion, null); // celda vacía = NULL
    assert.equal((await all(getDb(), 'SELECT * FROM propietario'))[0].numero_documento, '0123456'); // conserva el cero inicial
  });

  it('los ids nuevos continúan después de los cargados', async () => {
    const r = await run(
      getDb(),
      'INSERT INTO usuario (nombre, apellido, correo, contrasena, tipo_usuario) VALUES (?, ?, ?, ?, ?)',
      ['Beto', 'Gómez', 'beto@prueba.test', 'hash', 'conductor'],
    );
    assert.equal(Number(r.lastInsertRowid), 2);
  });

  it('un DELETE reescribe las pestañas hijas', async () => {
    await run(getDb(), 'DELETE FROM garaje WHERE id_garaje = 1');
    await vaciar();
    assert.equal(hoja.get('garaje').filas.length, 0);
    assert.equal(hoja.get('usuario').filas.length, 2);
  });
});
