// Verificación del correo con código y recuperación de contraseña, contra un servidor SMTP simulado
// (nunca se envía un correo de verdad desde las pruebas).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { SMTPServer } from 'smtp-server';

// ── SMTP falso: guarda cada mensaje recibido ─────────────────────────────────────────────────
const buzon = []; // { para, raw }
const smtp = new SMTPServer({
  authOptional: true,
  disabledCommands: ['STARTTLS'],
  onRcptTo(direccion, _sesion, cb) {
    if (direccion.address.startsWith('rechaza@')) return cb(new Error('550 Buzón inexistente'));
    cb();
  },
  onData(stream, sesion, cb) {
    const partes = [];
    stream.on('data', (d) => partes.push(d));
    stream.on('end', () => {
      buzon.push({ para: sesion.envelope.rcptTo.map((r) => r.address), raw: Buffer.concat(partes).toString('utf8') });
      cb();
    });
  },
});
await new Promise((r) => smtp.listen(0, '127.0.0.1', r));

process.env.NODE_ENV = 'test';
process.env.SMTP_HOST = '127.0.0.1';
process.env.SMTP_PORT = String(smtp.server.address().port);
process.env.SMTP_FROM = 'ParkSpotter <prueba@parkspotter.test>';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parkspotter-correo-'));
process.env.DATABASE_URL = new URL(`file:${path.join(dir, 'test.db').replace(/\\/g, '/')}`).href;
process.env.UPLOADS_DIR = path.join(dir, 'uploads');

const { crearApp } = await import('../src/app.js');
const { cerrarDb, getDb, initSchema, one, run } = await import('../src/db.js');
const { cerrarCorreo } = await import('../src/lib/correo.js');

let servidor;
let base;
async function api(metodo, ruta, cuerpo, token) {
  const r = await fetch(`${base}${ruta}`, {
    method: metodo,
    headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
}
const registro = (correo, extra = {}) => ({
  nombre: 'Ana', apellido: 'Correo', correo, contrasena: 'Clave12345', fecha_nacimiento: '1995-05-05', acepto_terminos: true,
  tipo_usuario: 'conductor', ...extra,
});
/** El código que llegó en el último correo para esa dirección. */
const ultimoCodigo = (correo) => {
  const m = [...buzon].reverse().find((x) => x.para.includes(correo));
  assert.ok(m, `no llegó ningún correo a ${correo}`);
  const c = /^ {4}(\d{6})\s*$/m.exec(m.raw);
  assert.ok(c, 'el correo no trae el código en el texto');
  return c[1];
};
const correosA = (correo) => buzon.filter((x) => x.para.includes(correo)).length;
// «Pasa un minuto»: se envejece el último envío para saltarse la espera entre reenvíos.
const envejecer = (correo) =>
  run(getDb(), "UPDATE codigo_correo SET creado = '2020-01-01T00:00:00.000Z' WHERE id_usuario = (SELECT id_usuario FROM usuario WHERE correo = ?)", [correo]);

before(async () => {
  await initSchema();
  servidor = crearApp().listen(0);
  await new Promise((r) => servidor.once('listening', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(async () => {
  servidor.close();
  cerrarCorreo();
  smtp.close();
  await cerrarDb();
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    /* carpeta temporal */
  }
});

describe('verificación del correo', () => {
  it('la app avisa que pide verificar y que se puede recuperar la contraseña', async () => {
    const c = await api('GET', '/api/auth/config');
    assert.equal(c.verificacion_correo, true);
    assert.equal(c.recuperacion, true);
  });

  it('registrarse manda el código al correo y NO abre sesión hasta confirmarlo', async () => {
    const r = await api('POST', '/api/auth/registro', registro('ana@prueba.test'));
    assert.equal(r.status, 201);
    assert.equal(r.requiere_verificacion, true);
    assert.equal(r.token, undefined, 'sin código no hay sesión');
    assert.equal(correosA('ana@prueba.test'), 1);
    const m = buzon.at(-1);
    assert.match(m.raw, /Subject: =\?UTF-8\?Q\?\d{6}_es_tu_c/, 'el código también va en el asunto, para verlo sin abrir el correo');
    assert.match(m.raw, /From: .*prueba@parkspotter\.test/);
    assert.match(ultimoCodigo('ana@prueba.test'), /^\d{6}$/);
    // En la base no queda el código, solo su hash.
    const fila = await one(getDb(), 'SELECT hash FROM codigo_correo');
    assert.ok(fila.hash && !fila.hash.includes(ultimoCodigo('ana@prueba.test')));
  });

  it('con la clave correcta pero sin verificar, el ingreso pide el código; con clave mala sigue siendo «incorrectos»', async () => {
    const sin = await api('POST', '/api/auth/login', { correo: 'ana@prueba.test', contrasena: 'Clave12345' });
    assert.equal(sin.status, 403);
    assert.equal(sin.codigo, 'correo_sin_verificar');
    assert.equal(sin.correo, 'ana@prueba.test');
    const mala = await api('POST', '/api/auth/login', { correo: 'ana@prueba.test', contrasena: 'OtraClave99' });
    assert.equal(mala.status, 401, 'quien no sabe la clave no se entera de que la cuenta está sin verificar');
    assert.equal(correosA('ana@prueba.test'), 1, 'no se manda otro correo si acaba de enviarse uno');
  });

  it('un código incorrecto se rechaza; el correcto abre la sesión y solo sirve una vez', async () => {
    const codigo = ultimoCodigo('ana@prueba.test');
    const malo = codigo === '000000' ? '111111' : '000000';
    assert.equal((await api('POST', '/api/auth/verificar', { correo: 'ana@prueba.test', codigo: malo })).status, 400);
    assert.equal((await api('POST', '/api/auth/verificar', { correo: 'ana@prueba.test', codigo: '12' })).status, 400, 'formato');
    const ok = await api('POST', '/api/auth/verificar', { correo: 'ANA@prueba.test', codigo });
    assert.equal(ok.status, 200);
    assert.ok(ok.token);
    assert.equal(ok.usuario.correo, 'ana@prueba.test');
    assert.equal((await api('GET', '/api/auth/yo', null, ok.token)).usuario.nombre, 'Ana');
    assert.equal((await api('POST', '/api/auth/verificar', { correo: 'ana@prueba.test', codigo })).status, 400, 'ya se gastó');
    assert.equal((await api('POST', '/api/auth/login', { correo: 'ana@prueba.test', contrasena: 'Clave12345' })).status, 200);
  });

  it('tras 5 intentos fallidos el código se anula; pedir otro (pasado el minuto) lo arregla', async () => {
    await api('POST', '/api/auth/registro', registro('beto@prueba.test', { nombre: 'Beto' }));
    const codigo = ultimoCodigo('beto@prueba.test');
    const malo = codigo === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i += 1) assert.equal((await api('POST', '/api/auth/verificar', { correo: 'beto@prueba.test', codigo: malo })).status, 400);
    assert.equal((await api('POST', '/api/auth/verificar', { correo: 'beto@prueba.test', codigo })).status, 400, 'ni el bueno sirve ya');

    // Reenviar antes de un minuto no manda nada (y no revela nada); pasado el minuto, sí.
    const antes = correosA('beto@prueba.test');
    assert.equal((await api('POST', '/api/auth/reenviar', { correo: 'beto@prueba.test' })).status, 200);
    assert.equal(correosA('beto@prueba.test'), antes + 1, 'no había código vigente: se envía uno nuevo');
    assert.equal((await api('POST', '/api/auth/reenviar', { correo: 'beto@prueba.test' })).status, 200);
    assert.equal(correosA('beto@prueba.test'), antes + 1, 'segundo pedido seguido: no llega otro correo');
    await envejecer('beto@prueba.test');
    await api('POST', '/api/auth/reenviar', { correo: 'beto@prueba.test' });
    assert.equal(correosA('beto@prueba.test'), antes + 2);
    const ok = await api('POST', '/api/auth/verificar', { correo: 'beto@prueba.test', codigo: ultimoCodigo('beto@prueba.test') });
    assert.equal(ok.status, 200);
  });

  it('reenviar no delata qué correos existen ni reenvía a cuentas ya verificadas', async () => {
    const antes = buzon.length;
    assert.equal((await api('POST', '/api/auth/reenviar', { correo: 'nadie@prueba.test' })).status, 200);
    assert.equal((await api('POST', '/api/auth/reenviar', { correo: 'ana@prueba.test' })).status, 200); // ya verificada
    assert.equal(buzon.length, antes, 'no se mandó nada');
  });

  it('el código vence a los 15 minutos', async () => {
    await api('POST', '/api/auth/registro', registro('caro@prueba.test'));
    const codigo = ultimoCodigo('caro@prueba.test');
    await run(getDb(), "UPDATE codigo_correo SET expira = '2020-01-01T00:00:00.000Z' WHERE id_usuario = (SELECT id_usuario FROM usuario WHERE correo = ?)", ['caro@prueba.test']);
    assert.equal((await api('POST', '/api/auth/verificar', { correo: 'caro@prueba.test', codigo })).status, 400);
  });

  it('si el correo no puede enviarse (buzón rechazado), el registro se deshace y se puede reintentar', async () => {
    const r = await api('POST', '/api/auth/registro', registro('rechaza@prueba.test'));
    assert.equal(r.status, 503);
    assert.match(r.error, /No pudimos enviar el correo/);
    assert.equal(await one(getDb(), 'SELECT 1 AS x FROM usuario WHERE correo = ?', ['rechaza@prueba.test']), null, 'no queda una cuenta huérfana');
    const otra = await api('POST', '/api/auth/registro', registro('rechaza@prueba.test'));
    assert.equal(otra.status, 503, 'y sigue sin poder enviarse, sin «ya existe una cuenta»');
  });

  it('un propietario también verifica y su documento queda guardado', async () => {
    const r = await api('POST', '/api/auth/registro', registro('duena@prueba.test', { tipo_usuario: 'propietario', tipo_documento: 'CC', numero_documento: '1020304050' }));
    assert.equal(r.status, 201);
    const ok = await api('POST', '/api/auth/verificar', { correo: 'duena@prueba.test', codigo: ultimoCodigo('duena@prueba.test') });
    assert.equal(ok.usuario.es_propietario, true);
  });
});

describe('recuperar la contraseña', () => {
  it('un correo desconocido recibe la misma respuesta y no se envía nada', async () => {
    const antes = buzon.length;
    const r = await api('POST', '/api/auth/olvide', { correo: 'fantasma@prueba.test' });
    assert.equal(r.status, 200);
    assert.deepEqual(r, { status: 200, ok: true });
    assert.equal(buzon.length, antes);
  });

  it('con el código del correo se cambia la contraseña, se abre la sesión y se levanta el bloqueo por intentos', async () => {
    // Bloqueo por intentos: 8 contraseñas malas.
    for (let i = 0; i < 8; i += 1) await api('POST', '/api/auth/login', { correo: 'ana@prueba.test', contrasena: 'Mala12345' });
    assert.equal((await api('POST', '/api/auth/login', { correo: 'ana@prueba.test', contrasena: 'Clave12345' })).status, 429, 'bloqueada');

    assert.equal((await api('POST', '/api/auth/olvide', { correo: 'ana@prueba.test' })).status, 200);
    const mensajes = correosA('ana@prueba.test');
    assert.match(buzon.at(-1).raw, /cambiar la contrase/i);
    await api('POST', '/api/auth/olvide', { correo: 'ana@prueba.test' });
    assert.equal(correosA('ana@prueba.test'), mensajes, 'pedido seguido: no llega otro');

    const codigo = ultimoCodigo('ana@prueba.test');
    const malo = codigo === '000000' ? '111111' : '000000';
    assert.equal((await api('POST', '/api/auth/restablecer', { correo: 'ana@prueba.test', codigo: malo, nueva: 'NuevaClave456' })).status, 400);
    assert.equal((await api('POST', '/api/auth/restablecer', { correo: 'ana@prueba.test', codigo, nueva: 'corta' })).status, 400, 'la nueva clave debe cumplir las reglas');
    const ok = await api('POST', '/api/auth/restablecer', { correo: 'ana@prueba.test', codigo, nueva: 'NuevaClave456' });
    assert.equal(ok.status, 200);
    assert.ok(ok.token);
    assert.equal((await api('POST', '/api/auth/restablecer', { correo: 'ana@prueba.test', codigo, nueva: 'OtraMas789' })).status, 400, 'el código se gasta');
    assert.equal((await api('POST', '/api/auth/login', { correo: 'ana@prueba.test', contrasena: 'Clave12345' })).status, 401, 'la vieja ya no sirve');
    assert.equal((await api('POST', '/api/auth/login', { correo: 'ana@prueba.test', contrasena: 'NuevaClave456' })).status, 200, 'la nueva sí, y sin bloqueo');
  });

  it('quien olvidó la clave antes de verificar el correo queda verificado al restablecerla', async () => {
    await api('POST', '/api/auth/registro', registro('dora@prueba.test'));
    await envejecer('dora@prueba.test');
    await api('POST', '/api/auth/olvide', { correo: 'dora@prueba.test' });
    const ok = await api('POST', '/api/auth/restablecer', { correo: 'dora@prueba.test', codigo: ultimoCodigo('dora@prueba.test'), nueva: 'ClaveNueva123' });
    assert.equal(ok.status, 200);
    assert.equal((await api('POST', '/api/auth/login', { correo: 'dora@prueba.test', contrasena: 'ClaveNueva123' })).status, 200);
  });
});
