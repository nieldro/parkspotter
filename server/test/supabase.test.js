// Cuentas en Supabase Auth: se prueba contra un servidor falso que imita la API de GoTrue
// (nunca se toca el proyecto real de Supabase desde las pruebas).
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

// ── GoTrue falso ────────────────────────────────────────────────────────────────────────────
const ANON = 'anon-de-prueba';
const SERVICIO = 'servicio-de-prueba';
const cuentas = new Map(); // id -> { id, email, password }
let caido = false; // simula que Supabase no responde
const llamadas = [];

const gotrue = http.createServer(async (req, res) => {
  const responder = (estado, cuerpo) => {
    res.writeHead(estado, { 'content-type': 'application/json' });
    res.end(JSON.stringify(cuerpo));
  };
  let texto = '';
  for await (const parte of req) texto += parte;
  const cuerpo = texto ? JSON.parse(texto) : {};
  const url = new URL(req.url, 'http://x');
  const clave = req.headers.apikey;
  llamadas.push(`${req.method} ${url.pathname}`);
  if (caido) return responder(500, { msg: 'caído' });

  if (url.pathname === '/auth/v1/token' && req.method === 'POST') {
    if (clave !== ANON) return responder(401, { msg: 'clave inválida' });
    const c = [...cuentas.values()].find((x) => x.email === cuerpo.email && x.password === cuerpo.password);
    if (!c) return responder(400, { error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
    return responder(200, { access_token: 'x', user: { id: c.id, email: c.email } });
  }
  if (url.pathname.startsWith('/auth/v1/admin/users')) {
    if (clave !== SERVICIO) return responder(401, { msg: 'se necesita la clave de servicio' });
    const id = url.pathname.split('/')[5];
    if (req.method === 'POST') {
      if ([...cuentas.values()].some((x) => x.email === cuerpo.email)) return responder(422, { error_code: 'email_exists' });
      if (cuerpo.password === 'Debil1234') return responder(422, { error_code: 'weak_password' });
      const c = { id: crypto.randomUUID(), email: cuerpo.email, password: cuerpo.password };
      cuentas.set(c.id, c);
      return responder(200, { id: c.id, email: c.email });
    }
    const c = cuentas.get(id);
    if (!c) return responder(404, { error_code: 'user_not_found' });
    if (req.method === 'DELETE') {
      cuentas.delete(id);
      return responder(200, {});
    }
    if (req.method === 'PUT') {
      if (cuerpo.email && [...cuentas.values()].some((x) => x.id !== id && x.email === cuerpo.email)) {
        return responder(422, { error_code: 'email_exists' });
      }
      if (cuerpo.email) c.email = cuerpo.email;
      if (cuerpo.password) c.password = cuerpo.password;
      return responder(200, { id: c.id });
    }
  }
  responder(404, { msg: 'no existe' });
});
await new Promise((r) => gotrue.listen(0, '127.0.0.1', r));

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = `http://127.0.0.1:${gotrue.address().port}`;
process.env.SUPABASE_ANON_KEY = ANON;
process.env.SUPABASE_SERVICE_KEY = SERVICIO;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parkspotter-supabase-'));
process.env.DATABASE_URL = new URL(`file:${path.join(dir, 'test.db').replace(/\\/g, '/')}`).href;
process.env.UPLOADS_DIR = path.join(dir, 'uploads');

const { crearApp } = await import('../src/app.js');
const { cerrarDb, getDb, initSchema, one, run } = await import('../src/db.js');
const { hashContrasena } = await import('../src/lib/auth.js');

let servidor;
let base;
async function api(metodo, ruta, cuerpo, token) {
  const r = await fetch(`${base}${ruta}`, {
    method: metodo,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
}
const registro = (correo, extra = {}) => ({
  nombre: 'Ana', apellido: 'Prueba', correo, contrasena: 'Clave12345', fecha_nacimiento: '1995-05-05',
  acepto_terminos: true, tipo_usuario: 'conductor', ...extra,
});

before(async () => {
  await initSchema();
  servidor = crearApp().listen(0);
  await new Promise((r) => servidor.once('listening', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(async () => {
  servidor.close();
  gotrue.close();
  await cerrarDb();
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    /* carpeta temporal */
  }
});

describe('Supabase Auth', () => {
  it('el registro crea la cuenta en Supabase y la contraseña no se guarda en la base de la app', async () => {
    const r = await api('POST', '/api/auth/registro', registro('ana@prueba.test'));
    assert.equal(r.status, 201);
    assert.ok(r.token);
    const enSupabase = [...cuentas.values()].find((c) => c.email === 'ana@prueba.test');
    assert.ok(enSupabase, 'la cuenta existe en Supabase');
    const fila = await one(getDb(), 'SELECT contrasena, auth_id FROM usuario WHERE correo = ?', ['ana@prueba.test']);
    assert.equal(fila.contrasena, '!supabase');
    assert.equal(fila.auth_id, enSupabase.id);
  });

  it('el login lo verifica Supabase (acepta la buena, rechaza la mala y no distingue mayúsculas del correo)', async () => {
    const ok = await api('POST', '/api/auth/login', { correo: 'ANA@prueba.test', contrasena: 'Clave12345' });
    assert.equal(ok.status, 200);
    assert.equal(ok.usuario.correo, 'ana@prueba.test');
    const mala = await api('POST', '/api/auth/login', { correo: 'ana@prueba.test', contrasena: 'OtraClave99' });
    assert.equal(mala.status, 401);
    const inexistente = await api('POST', '/api/auth/login', { correo: 'nadie@prueba.test', contrasena: 'Clave12345' });
    assert.equal(inexistente.status, 401);
  });

  it('un correo que ya existe en el proyecto de Supabase (otra app) se enlaza solo si la contraseña coincide', async () => {
    const id = crypto.randomUUID();
    cuentas.set(id, { id, email: 'otra@app.test', password: 'ClaveDeOtraApp1' });
    const distinta = await api('POST', '/api/auth/registro', registro('otra@app.test', { contrasena: 'Clave12345' }));
    assert.equal(distinta.status, 409);
    assert.equal(await one(getDb(), 'SELECT 1 AS x FROM usuario WHERE correo = ?', ['otra@app.test']), null);

    const igual = await api('POST', '/api/auth/registro', registro('otra@app.test', { contrasena: 'ClaveDeOtraApp1' }));
    assert.equal(igual.status, 201);
    const fila = await one(getDb(), 'SELECT auth_id FROM usuario WHERE correo = ?', ['otra@app.test']);
    assert.equal(fila.auth_id, id);
    assert.equal(cuentas.size, 2, 'no se creó una cuenta duplicada (solo ana y la de la otra app)');
  });

  it('una contraseña que Supabase considera débil se rechaza con un mensaje claro y no deja filas a medias', async () => {
    const r = await api('POST', '/api/auth/registro', registro('debil@prueba.test', { contrasena: 'Debil1234' }));
    assert.equal(r.status, 400);
    assert.match(r.error ?? r.mensaje ?? JSON.stringify(r), /fácil de adivinar/);
    assert.equal(await one(getDb(), 'SELECT 1 AS x FROM usuario WHERE correo = ?', ['debil@prueba.test']), null);
  });

  it('dos registros simultáneos con el mismo correo dejan una sola cuenta (en la app y en Supabase)', async () => {
    const antes = cuentas.size;
    const [a, b] = await Promise.all([
      api('POST', '/api/auth/registro', registro('doble@prueba.test')),
      api('POST', '/api/auth/registro', registro('doble@prueba.test')),
    ]);
    assert.deepEqual([a.status, b.status].sort(), [201, 409]);
    assert.equal(cuentas.size, antes + 1, 'no quedó una cuenta huérfana en Supabase');
    const filas = await one(getDb(), 'SELECT COUNT(*) AS n FROM usuario WHERE correo = ?', ['doble@prueba.test']);
    assert.equal(filas.n, 1);
    // Y el que ganó puede entrar.
    assert.equal((await api('POST', '/api/auth/login', { correo: 'doble@prueba.test', contrasena: 'Clave12345' })).status, 200);
  });

  it('un propietario se registra con su documento y queda enlazado a Supabase', async () => {
    const r = await api('POST', '/api/auth/registro', registro('duena@prueba.test', {
      tipo_usuario: 'propietario', tipo_documento: 'CC', numero_documento: '1020304050',
    }));
    assert.equal(r.status, 201);
    assert.equal(r.usuario.es_propietario, true);
  });

  it('cambiar la contraseña actualiza Supabase: la vieja deja de servir y la nueva sirve', async () => {
    const { token } = await api('POST', '/api/auth/login', { correo: 'ana@prueba.test', contrasena: 'Clave12345' });
    const mal = await api('POST', '/api/auth/yo/contrasena', { actual: 'NoEsEsta123', nueva: 'NuevaClave456' }, token);
    assert.equal(mal.status, 400);
    const ok = await api('POST', '/api/auth/yo/contrasena', { actual: 'Clave12345', nueva: 'NuevaClave456' }, token);
    assert.equal(ok.status, 200);
    assert.equal((await api('POST', '/api/auth/login', { correo: 'ana@prueba.test', contrasena: 'Clave12345' })).status, 401);
    assert.equal((await api('POST', '/api/auth/login', { correo: 'ana@prueba.test', contrasena: 'NuevaClave456' })).status, 200);
  });

  it('cambiar el correo actualiza Supabase y se puede entrar con el nuevo', async () => {
    const { token } = await api('POST', '/api/auth/login', { correo: 'ana@prueba.test', contrasena: 'NuevaClave456' });
    const usado = await api('POST', '/api/auth/yo/correo', { correo: 'otra@app.test', contrasena: 'NuevaClave456' }, token);
    assert.equal(usado.status, 409);
    const ok = await api('POST', '/api/auth/yo/correo', { correo: 'ana.nueva@prueba.test', contrasena: 'NuevaClave456' }, token);
    assert.equal(ok.status, 200);
    assert.equal((await api('POST', '/api/auth/login', { correo: 'ana.nueva@prueba.test', contrasena: 'NuevaClave456' })).status, 200);
    assert.equal((await api('POST', '/api/auth/login', { correo: 'ana@prueba.test', contrasena: 'NuevaClave456' })).status, 401);
  });

  it('las cuentas locales (demostración) siguen entrando con su hash aunque Supabase esté activo', async () => {
    await run(getDb(), 'INSERT INTO usuario (nombre, apellido, correo, contrasena, tipo_usuario) VALUES (?, ?, ?, ?, ?)', [
      'Demo', 'Local', 'demo@parkspotter.test', await hashContrasena('Demo2026!'), 'conductor',
    ]);
    const antes = llamadas.length;
    const r = await api('POST', '/api/auth/login', { correo: 'demo@parkspotter.test', contrasena: 'Demo2026!' });
    assert.equal(r.status, 200);
    assert.equal(llamadas.length, antes, 'no consultó a Supabase');
  });

  it('si Supabase no responde, el login avisa con 503 (no con «contraseña incorrecta»)', async () => {
    caido = true;
    try {
      const r = await api('POST', '/api/auth/login', { correo: 'ana.nueva@prueba.test', contrasena: 'NuevaClave456' });
      assert.equal(r.status, 503);
    } finally {
      caido = false;
    }
  });
});
