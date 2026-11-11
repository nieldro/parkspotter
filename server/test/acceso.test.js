// Bloqueo por intentos fallidos y entrada de demostración.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.DEMO = '1';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parkspotter-acceso-'));
process.env.DATABASE_URL = new URL(`file:${path.join(dir, 'test.db').replace(/\\/g, '/')}`).href;

const { crearApp } = await import('../src/app.js');
const { cerrarDb, getDb, initSchema, run } = await import('../src/db.js');
const { hashContrasena } = await import('../src/lib/auth.js');

let servidor;
let base;
const api = async (ruta, cuerpo) => {
  const r = await fetch(`${base}${ruta}`, {
    method: cuerpo ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json' },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
};

describe('acceso', () => {
  before(async () => {
    await initSchema();
    await run(getDb(), 'INSERT INTO usuario (nombre, apellido, correo, contrasena, tipo_usuario) VALUES (?, ?, ?, ?, ?)', [
      'Ana', 'Prueba', 'ana@prueba.test', await hashContrasena('Clave12345'), 'conductor',
    ]);
    await run(getDb(), 'INSERT INTO usuario (nombre, apellido, correo, contrasena, tipo_usuario) VALUES (?, ?, ?, ?, ?)', [
      'Demo', 'Conductor', 'conductor@parkspotter.test', await hashContrasena('Demo2026!'), 'conductor',
    ]);
    servidor = crearApp().listen(0);
    await new Promise((r) => servidor.once('listening', r));
    base = `http://127.0.0.1:${servidor.address().port}`;
  });
  after(async () => {
    servidor.close();
    await cerrarDb();
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      /* carpeta temporal */
    }
  });

  it('tras 8 contraseñas erróneas bloquea la cuenta, incluso con la clave correcta', async () => {
    for (let i = 0; i < 8; i++) {
      const r = await api('/api/auth/login', { correo: 'ana@prueba.test', contrasena: 'incorrecta1' });
      assert.equal(r.status, 401);
    }
    const bloqueada = await api('/api/auth/login', { correo: 'ana@prueba.test', contrasena: 'Clave12345' });
    assert.equal(bloqueada.status, 429);
    assert.match(bloqueada.error, /espera/i);
  });

  it('el bloqueo no distingue cuentas que existen de las que no', async () => {
    for (let i = 0; i < 8; i++) await api('/api/auth/login', { correo: 'nadie@prueba.test', contrasena: 'incorrecta1' });
    const r = await api('/api/auth/login', { correo: 'nadie@prueba.test', contrasena: 'incorrecta1' });
    assert.equal(r.status, 429);
  });

  it('un acierto antes del límite reinicia el contador', async () => {
    await run(getDb(), 'INSERT INTO usuario (nombre, apellido, correo, contrasena, tipo_usuario) VALUES (?, ?, ?, ?, ?)', [
      'Beto', 'Prueba', 'beto@prueba.test', await hashContrasena('Clave12345'), 'conductor',
    ]);
    for (let i = 0; i < 5; i++) await api('/api/auth/login', { correo: 'beto@prueba.test', contrasena: 'incorrecta1' });
    assert.equal((await api('/api/auth/login', { correo: 'beto@prueba.test', contrasena: 'Clave12345' })).status, 200);
    for (let i = 0; i < 5; i++) await api('/api/auth/login', { correo: 'beto@prueba.test', contrasena: 'incorrecta1' });
    assert.equal((await api('/api/auth/login', { correo: 'beto@prueba.test', contrasena: 'Clave12345' })).status, 200);
  });

  it('con DEMO=1 se entra a la cuenta demo de un toque; sin la cuenta responde 404', async () => {
    assert.equal((await api('/api/auth/config')).demo, true);
    const ok = await api('/api/auth/demo', { rol: 'conductor' });
    assert.equal(ok.status, 200);
    assert.equal(ok.usuario.correo, 'conductor@parkspotter.test');
    assert.ok(ok.token);
    assert.equal((await api('/api/auth/demo', { rol: 'propietario' })).status, 404); // no existe en esta base
    assert.equal((await api('/api/auth/demo', { rol: 'admin' })).status, 400); // el admin nunca se ofrece
  });
});
