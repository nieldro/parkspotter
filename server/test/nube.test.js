// Fotos en Supabase Storage (simulado) y avisos de solicitudes por vencer.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import sharp from 'sharp';

// ── Storage falso ────────────────────────────────────────────────────────────────────────────
const objetos = new Map(); // nombre -> bytes
let buckets = 0;
let sinServicio = false;
const storage = http.createServer(async (req, res) => {
  const partes = [];
  for await (const p of req) partes.push(p);
  const cuerpo = Buffer.concat(partes);
  const fin = (estado, json = {}) => { res.writeHead(estado, { 'content-type': 'application/json' }); res.end(JSON.stringify(json)); };
  if (req.headers.authorization !== 'Bearer clave-de-servicio') return fin(401, { message: 'no autorizado' });
  if (sinServicio) return fin(500, { message: 'caído' });
  const u = new URL(req.url, 'http://x').pathname;
  if (u === '/storage/v1/bucket' && req.method === 'POST') {
    buckets += 1;
    return buckets === 1 ? fin(200, { name: 'parkspotter' }) : fin(409, { message: 'The resource already exists' });
  }
  const m = /^\/storage\/v1\/object\/parkspotter\/(.+)$/.exec(u);
  if (m && req.method === 'POST') { objetos.set(m[1], cuerpo); return fin(200, { Key: m[1] }); }
  if (m && req.method === 'DELETE') { objetos.delete(m[1]); return fin(200, {}); }
  fin(404, { message: 'no existe' });
});
await new Promise((r) => storage.listen(0, '127.0.0.1', r));

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = `http://127.0.0.1:${storage.address().port}`;
process.env.SUPABASE_ANON_KEY = 'anon';
process.env.SUPABASE_SERVICE_KEY = 'clave-de-servicio';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parkspotter-nube-'));
process.env.DATABASE_URL = new URL(`file:${path.join(dir, 'test.db').replace(/\\/g, '/')}`).href;
process.env.UPLOADS_DIR = path.join(dir, 'uploads');

const { crearApp } = await import('../src/app.js');
const { cerrarDb, getDb, initSchema, one, run } = await import('../src/db.js');
const { hashContrasena } = await import('../src/lib/auth.js');
const { recordarPendientes } = await import('../src/lib/recordatorios.js');
const { expirarPendientes } = await import('../src/lib/disponibilidad.js');

let servidor;
let base;
async function api(metodo, ruta, cuerpo, token) {
  const r = await fetch(`${base}${ruta}`, {
    method: metodo,
    headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  return { status: r.status, headers: r.headers, ...(await r.json().catch(() => ({}))) };
}
async function usuario(nombre, tipo = 'conductor') {
  const correo = `${nombre}@nube.test`;
  const r = await run(getDb(), 'INSERT INTO usuario (nombre, apellido, correo, contrasena, tipo_usuario) VALUES (?, ?, ?, ?, ?)', [nombre, 'Nube', correo, await hashContrasena('Clave12345'), tipo]);
  if (tipo === 'propietario') await run(getDb(), "INSERT INTO propietario (id_usuario, tipo_documento, numero_documento) VALUES (?, 'CC', ?)", [r.lastInsertRowid, `99${r.lastInsertRowid}`]);
  const l = await api('POST', '/api/auth/login', { correo, contrasena: 'Clave12345' });
  return { token: l.token, id: l.usuario.id_usuario };
}
const dataUrl = async () => `data:image/jpeg;base64,${(await sharp({ create: { width: 300, height: 200, channels: 3, background: '#3a7' } }).jpeg().toBuffer()).toString('base64')}`;

before(async () => {
  await initSchema();
  servidor = crearApp().listen(0);
  await new Promise((r) => servidor.once('listening', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(async () => {
  servidor.close();
  storage.close();
  await cerrarDb();
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* temporal */ }
});

describe('fotos en Supabase Storage', () => {
  it('la foto de perfil va al bucket (no al disco), se ve por su URL pública y se borra al cambiarla', async () => {
    const u = await usuario('ana');
    const r = await api('POST', '/api/auth/yo/foto', { imagen: await dataUrl() }, u.token);
    assert.equal(r.status, 200);
    const url = r.usuario.foto;
    assert.match(url, new RegExp(`^${process.env.SUPABASE_URL}/storage/v1/object/public/parkspotter/avatar-[a-f0-9]{16}\\.jpg$`));
    const nombre = url.split('/').pop();
    assert.ok(objetos.has(nombre), 'está en el Storage');
    assert.ok(objetos.get(nombre).length > 100);
    assert.equal(fs.existsSync(path.join(process.env.UPLOADS_DIR, nombre)), false, 'no quedó en el disco');
    assert.equal(buckets, 1, 'el bucket se creó una sola vez');

    const r2 = await api('POST', '/api/auth/yo/foto', { imagen: await dataUrl() }, u.token);
    assert.ok(!objetos.has(nombre), 'la anterior se borró');
    assert.ok(objetos.has(r2.usuario.foto.split('/').pop()));
    assert.equal((await api('DELETE', '/api/auth/yo/foto', null, u.token)).usuario.foto, null);
    assert.equal(objetos.size, 0);
  });

  it('las fotos del garaje van al bucket y el CSP deja cargarlas', async () => {
    const d = await usuario('dueno', 'propietario');
    const g = await api('POST', '/api/propietario/garajes', {
      nombre: 'Garaje nube', direccion: 'Calle 1 # 2-3', latitud: 4.65, longitud: -74.06, tarifa_hora: 3000, capacidad_total: 1,
      tipo_vehiculo: 'ambos', disponibilidad: [{ dia_semana: 1, hora_inicio: '08:00', hora_fin: '18:00' }],
    }, d.token);
    assert.equal(g.status, 201, JSON.stringify(g));
    const f = await api('POST', `/api/propietario/garajes/${g.garaje.id_garaje}/fotos`, { imagen: await dataUrl() }, d.token);
    assert.equal(f.status, 201);
    assert.ok(f.fotos[0].url.startsWith(`${process.env.SUPABASE_URL}/storage/`));
    const detalle = await api('GET', `/api/garajes/${g.garaje.id_garaje}`);
    assert.equal(detalle.garaje.foto, f.fotos[0].url);
    const csp = (await fetch(`${base}/`)).headers.get('content-security-policy');
    assert.ok(csp.includes(new URL(process.env.SUPABASE_URL).origin), 'el CSP incluye el dominio del Storage');
    await api('DELETE', `/api/propietario/garajes/${g.garaje.id_garaje}/fotos/${f.fotos[0].id_foto}`, null, d.token);
    assert.equal(objetos.size, 0);
  });

  it('si el Storage no responde, avisa con 503 y no deja una foto a medias en la base', async () => {
    const u = await usuario('beto');
    sinServicio = true;
    try {
      const r = await api('POST', '/api/auth/yo/foto', { imagen: await dataUrl() }, u.token);
      assert.equal(r.status, 503);
      assert.match(r.error, /No pudimos guardar la foto/);
      assert.equal((await one(getDb(), 'SELECT foto FROM usuario WHERE id_usuario = ?', [u.id])).foto, null);
    } finally {
      sinServicio = false;
    }
  });
});

describe('solicitudes por vencer', () => {
  async function pendiente(minutosParaEntrar) {
    const d = await usuario(`dueno${Math.random().toString(36).slice(2, 7)}`, 'propietario');
    const c = await usuario(`cond${Math.random().toString(36).slice(2, 7)}`);
    const idProp = (await one(getDb(), 'SELECT id_propietario FROM propietario WHERE id_usuario = ?', [d.id])).id_propietario;
    const g = await run(getDb(), `INSERT INTO garaje (id_propietario, nombre, direccion, latitud, longitud, tarifa_hora) VALUES (?, 'Garaje aviso', 'x', 4.6, -74, 3000)`, [idProp]);
    const ini = new Date(Date.now() + minutosParaEntrar * 60000);
    const r = await run(getDb(), `INSERT INTO reserva (id_usuario, id_garaje, fecha_inicio, fecha_fin, costo_total, tipo_vehiculo, placa) VALUES (?, ?, ?, ?, 3000, 'carro', 'ABC123')`, [c.id, g.lastInsertRowid, ini.toISOString(), new Date(ini.getTime() + 3600e3).toISOString()]);
    return { d, c, id: Number(r.lastInsertRowid) };
  }
  const tipos = async (idReserva) => (await getDb().execute({ sql: 'SELECT tipo, id_usuario FROM notificacion WHERE id_reserva = ?', args: [idReserva] })).rows.map((f) => f[0]);

  it('avisa al propietario cuando faltan menos de 3 horas, una sola vez, y no antes', async () => {
    const lejos = await pendiente(5 * 60);
    const cerca = await pendiente(90);
    const n = await recordarPendientes(getDb());
    assert.ok(n >= 1);
    assert.deepEqual(await tipos(lejos.id), [], 'a 5 horas todavía no');
    assert.deepEqual(await tipos(cerca.id), ['recordatorio_solicitud']);
    await recordarPendientes(getDb());
    assert.deepEqual(await tipos(cerca.id), ['recordatorio_solicitud'], 'no se repite');
    const aviso = await one(getDb(), "SELECT id_usuario, mensaje FROM notificacion WHERE id_reserva = ? AND tipo = 'recordatorio_solicitud'", [cerca.id]);
    assert.equal(aviso.id_usuario, cerca.d.id);
    assert.match(aviso.mensaje, /espera tu respuesta/);
  });

  it('al vencer sin respuesta, la solicitud se cancela y el conductor recibe el aviso (una vez)', async () => {
    const v = await pendiente(-10);
    await expirarPendientes(getDb());
    await expirarPendientes(getDb());
    assert.equal((await one(getDb(), 'SELECT estado FROM reserva WHERE id_reserva = ?', [v.id])).estado, 'cancelada');
    const avisos = (await getDb().execute({ sql: "SELECT id_usuario, mensaje FROM notificacion WHERE id_reserva = ? AND tipo = 'reserva_vencida'", args: [v.id] })).rows;
    assert.equal(avisos.length, 1);
    assert.equal(avisos[0][0], v.c.id);
    assert.match(avisos[0][1], /no respondió a tiempo/);
  });
});
