// Días bloqueados, respuestas a opiniones, código de llegada y reportes de publicaciones.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parkspotter-funciones-'));
process.env.DATABASE_URL = new URL(`file:${path.join(dir, 'test.db').replace(/\\/g, '/')}`).href;
process.env.UPLOADS_DIR = path.join(dir, 'uploads');

const { crearApp } = await import('../src/app.js');
const { cerrarDb, getDb, initSchema, one, run } = await import('../src/db.js');
const { hashContrasena } = await import('../src/lib/auth.js');
const { hoyBogota } = await import('../src/lib/tiempo.js');

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

let n = 0;
async function registrar(tipo = 'conductor') {
  n += 1;
  const r = await api('POST', '/api/auth/registro', {
    nombre: 'Persona', apellido: `Func${n}`, correo: `f${n}@prueba.test`, contrasena: 'Clave12345', fecha_nacimiento: '1990-03-20',
    acepto_terminos: true, tipo_usuario: tipo, ...(tipo === 'propietario' && { tipo_documento: 'CC', numero_documento: `40000${n}` }),
  });
  assert.equal(r.status, 201, JSON.stringify(r));
  return { token: r.token, usuario: r.usuario };
}
const sumarDias = (k) => new Date(Date.parse(`${hoyBogota()}T00:00:00Z`) + k * 86400e3).toISOString().slice(0, 10);
async function crearGaraje(token, extra = {}) {
  const r = await api('POST', '/api/propietario/garajes', {
    nombre: 'Garaje de prueba', direccion: 'Calle 1 # 2-3', barrio: 'Chapinero', localidad: 'Chapinero', latitud: 4.6486, longitud: -74.0628,
    tarifa_hora: 4000, capacidad_total: 1, tipo_vehiculo: 'ambos', descripcion: 'x', instrucciones_acceso: 'Timbre 2',
    disponibilidad: [1, 2, 3, 4, 5, 6, 7].map((d) => ({ dia_semana: d, hora_inicio: '06:00', hora_fin: '22:00' })), ...extra,
  }, token);
  assert.equal(r.status, 201, JSON.stringify(r));
  return r.garaje;
}
let placa = 100;
const reservar = (token, idGaraje, dia, extra = {}) =>
  api('POST', '/api/reservas', {
    id_garaje: idGaraje, fecha: sumarDias(dia), hora_inicio: '10:00', hora_fin: '12:00', tipo_vehiculo: 'carro',
    placa: `QWE${placa++}`, metodo_pago: 'tarjeta', ...extra,
  }, token);
const responder = (token, id, accion = 'aceptar') => api('POST', `/api/reservas/${id}/responder`, { accion }, token);
const avisos = async (idUsuario) => (await one(getDb(), 'SELECT COUNT(*) AS n FROM notificacion WHERE id_usuario = ? AND leida = 0', [idUsuario])).n;
const tipoAvisos = async (idUsuario) => (await getDb().execute({ sql: 'SELECT tipo FROM notificacion WHERE id_usuario = ?', args: [idUsuario] })).rows.map((f) => f[0]);

before(async () => {
  await initSchema();
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

describe('días bloqueados', () => {
  it('un día bloqueado no admite reservas, no aparece en la búsqueda y la ocupación lo avisa', async () => {
    const dueno = await registrar('propietario');
    const cond = await registrar();
    const g = await crearGaraje(dueno.token);

    const ok = await api('POST', `/api/propietario/garajes/${g.id_garaje}/bloqueos`, { fecha: sumarDias(3), motivo: 'Vacaciones' }, dueno.token);
    assert.equal(ok.status, 201);
    const lista = await api('GET', `/api/propietario/garajes/${g.id_garaje}/bloqueos`, null, dueno.token);
    assert.deepEqual(lista.bloqueos, [{ fecha: sumarDias(3), motivo: 'Vacaciones' }]);

    const r = await reservar(cond.token, g.id_garaje, 3);
    assert.equal(r.status, 409);
    assert.match(r.error, /no recibe reservas ese día \(Vacaciones\)/);

    const oc = await api('GET', `/api/garajes/${g.id_garaje}/ocupacion?fecha=${sumarDias(3)}`);
    assert.equal(oc.bloqueado, true);
    assert.deepEqual(oc.ventanas, []);

    const busca = await api('GET', `/api/garajes?fecha=${sumarDias(3)}&desde=10:00&hasta=12:00`);
    assert.ok(!busca.garajes.some((x) => x.id_garaje === g.id_garaje), 'el garaje bloqueado no sale en la búsqueda de ese día');
    const otroDia = await api('GET', `/api/garajes?fecha=${sumarDias(4)}&desde=10:00&hasta=12:00`);
    assert.ok(otroDia.garajes.some((x) => x.id_garaje === g.id_garaje));

    // Se desbloquea y ya se puede reservar.
    assert.equal((await api('DELETE', `/api/propietario/garajes/${g.id_garaje}/bloqueos/${sumarDias(3)}`, null, dueno.token)).status, 200);
    assert.equal((await reservar(cond.token, g.id_garaje, 3)).status, 201);
    assert.equal((await api('DELETE', `/api/propietario/garajes/${g.id_garaje}/bloqueos/${sumarDias(3)}`, null, dueno.token)).status, 404);
  });

  it('no se bloquea un día con reservas vivas, ni uno pasado, ni el garaje de otro', async () => {
    const dueno = await registrar('propietario');
    const otro = await registrar('propietario');
    const cond = await registrar();
    const g = await crearGaraje(dueno.token);
    assert.equal((await reservar(cond.token, g.id_garaje, 5)).status, 201); // pendiente

    const vivo = await api('POST', `/api/propietario/garajes/${g.id_garaje}/bloqueos`, { fecha: sumarDias(5) }, dueno.token);
    assert.equal(vivo.status, 409);
    assert.match(vivo.error, /1 reserva/);

    assert.equal((await api('POST', `/api/propietario/garajes/${g.id_garaje}/bloqueos`, { fecha: sumarDias(-1) }, dueno.token)).status, 400);
    assert.equal((await api('POST', `/api/propietario/garajes/${g.id_garaje}/bloqueos`, { fecha: '2026-02-30' }, dueno.token)).status, 400);
    assert.equal((await api('POST', `/api/propietario/garajes/${g.id_garaje}/bloqueos`, { fecha: sumarDias(400) }, dueno.token)).status, 400);
    assert.equal((await api('POST', `/api/propietario/garajes/${g.id_garaje}/bloqueos`, { fecha: sumarDias(7) }, otro.token)).status, 404);
    assert.equal((await api('POST', `/api/propietario/garajes/${g.id_garaje}/bloqueos`, { fecha: sumarDias(7) }, cond.token)).status, 403);
    // Bloquear dos veces el mismo día solo actualiza el motivo.
    await api('POST', `/api/propietario/garajes/${g.id_garaje}/bloqueos`, { fecha: sumarDias(7), motivo: 'Uno' }, dueno.token);
    await api('POST', `/api/propietario/garajes/${g.id_garaje}/bloqueos`, { fecha: sumarDias(7), motivo: 'Dos' }, dueno.token);
    const l = await api('GET', `/api/propietario/garajes/${g.id_garaje}/bloqueos`, null, dueno.token);
    assert.deepEqual(l.bloqueos, [{ fecha: sumarDias(7), motivo: 'Dos' }]);
  });
});

describe('respuestas a las opiniones', () => {
  it('el propietario responde en público, avisa a quien calificó y puede corregir o borrar', async () => {
    const dueno = await registrar('propietario');
    const otro = await registrar('propietario');
    const cond = await registrar();
    const g = await crearGaraje(dueno.token);
    const r = await reservar(cond.token, g.id_garaje, 2);
    await responder(dueno.token, r.reserva.id_reserva);
    // La reserva «ya terminó» para poder calificarla.
    await run(getDb(), 'UPDATE reserva SET fecha_inicio = ?, fecha_fin = ? WHERE id_reserva = ?', [
      new Date(Date.now() - 4 * 3600e3).toISOString(), new Date(Date.now() - 2 * 3600e3).toISOString(), r.reserva.id_reserva,
    ]);
    assert.equal((await api('POST', `/api/reservas/${r.reserva.id_reserva}/calificar`, { puntuacion: 3, comentario: 'Se demoró la salida' }, cond.token)).status, 201);

    const lista = await api('GET', '/api/propietario/opiniones', null, dueno.token);
    assert.equal(lista.sin_responder, 1);
    const op = lista.opiniones[0];
    assert.equal(op.comentario, 'Se demoró la salida');
    assert.equal(op.respuesta, null);

    // Reglas: texto obligatorio, y solo el dueño del garaje responde.
    assert.equal((await api('PUT', `/api/propietario/opiniones/${op.id_calificacion}/respuesta`, { texto: ' ' }, dueno.token)).status, 400);
    assert.equal((await api('PUT', `/api/propietario/opiniones/${op.id_calificacion}/respuesta`, { texto: 'Gracias por avisar' }, otro.token)).status, 404);
    assert.equal((await api('PUT', `/api/propietario/opiniones/${op.id_calificacion}/respuesta`, { texto: 'Gracias por avisar' }, cond.token)).status, 403);

    const antes = await avisos(cond.usuario.id_usuario);
    const ok = await api('PUT', `/api/propietario/opiniones/${op.id_calificacion}/respuesta`, { texto: 'Gracias por avisar, ya lo mejoramos.' }, dueno.token);
    assert.equal(ok.status, 200);
    assert.equal(await avisos(cond.usuario.id_usuario), antes + 1);
    assert.ok((await tipoAvisos(cond.usuario.id_usuario)).includes('opinion_respondida'));

    // Se ve en el detalle público del garaje.
    const det = await api('GET', `/api/garajes/${g.id_garaje}`);
    assert.equal(det.calificaciones[0].respuesta.texto, 'Gracias por avisar, ya lo mejoramos.');
    assert.equal((await api('GET', '/api/propietario/opiniones', null, dueno.token)).sin_responder, 0);

    // Corregirla no vuelve a avisar; borrarla la quita.
    await api('PUT', `/api/propietario/opiniones/${op.id_calificacion}/respuesta`, { texto: 'Versión corregida.' }, dueno.token);
    assert.equal(await avisos(cond.usuario.id_usuario), antes + 1);
    assert.equal((await api('DELETE', `/api/propietario/opiniones/${op.id_calificacion}/respuesta`, null, dueno.token)).status, 200);
    assert.equal((await api('GET', `/api/garajes/${g.id_garaje}`)).calificaciones[0].respuesta, null);
  });
});

describe('código de llegada', () => {
  async function reservaConfirmada() {
    const dueno = await registrar('propietario');
    const cond = await registrar();
    const g = await crearGaraje(dueno.token);
    const r = await reservar(cond.token, g.id_garaje, 2);
    return { dueno, cond, g, id: r.reserva.id_reserva, r };
  }
  const empiezaEn = (id, minutos) =>
    run(getDb(), 'UPDATE reserva SET fecha_inicio = ?, fecha_fin = ? WHERE id_reserva = ?', [
      new Date(Date.now() + minutos * 60000).toISOString(), new Date(Date.now() + (minutos + 120) * 60000).toISOString(), id,
    ]);

  it('el código lo ve solo el conductor y solo con la reserva confirmada', async () => {
    const { dueno, cond, id, r } = await reservaConfirmada();
    assert.equal(r.reserva.codigo, undefined, 'pendiente: sin código');
    await responder(dueno.token, id);
    const comoConductor = await api('GET', `/api/reservas/${id}`, null, cond.token);
    assert.match(comoConductor.reserva.codigo, /^[0-9A-F]{6}$/);
    const comoDueno = await api('GET', `/api/reservas/${id}`, null, dueno.token);
    assert.equal(comoDueno.reserva.codigo, undefined, 'el propietario nunca ve el código');
    const lista = await api('GET', '/api/propietario/reservas', null, dueno.token);
    assert.ok(lista.reservas.every((x) => x.codigo === undefined));
  });

  it('el propietario registra la llegada con el código correcto, dentro de la ventana y una sola vez', async () => {
    const { dueno, cond, id } = await reservaConfirmada();
    await responder(dueno.token, id);
    const codigo = (await api('GET', `/api/reservas/${id}`, null, cond.token)).reserva.codigo;

    const temprano = await api('POST', `/api/reservas/${id}/llegada`, { codigo }, dueno.token);
    assert.equal(temprano.status, 409);
    assert.match(temprano.error, /muy pronto/);
    assert.equal((await api('GET', `/api/reservas/${id}`, null, dueno.token)).reserva.puede_registrar_llegada, false);

    await empiezaEn(id, 10); // faltan 10 min: la ventana ya abrió
    assert.equal((await api('GET', `/api/reservas/${id}`, null, dueno.token)).reserva.puede_registrar_llegada, true);
    assert.equal((await api('POST', `/api/reservas/${id}/llegada`, { codigo }, cond.token)).status, 404, 'el conductor no registra su propia llegada');
    const mal = await api('POST', `/api/reservas/${id}/llegada`, { codigo: 'ZZZZZZ' }, dueno.token);
    assert.equal(mal.status, 400);

    const antes = await avisos(cond.usuario.id_usuario);
    const ok = await api('POST', `/api/reservas/${id}/llegada`, { codigo: codigo.toLowerCase() }, dueno.token); // no distingue mayúsculas
    assert.equal(ok.status, 200);
    assert.ok(ok.reserva.llegada);
    assert.equal(ok.reserva.puede_registrar_llegada, false);
    assert.equal(await avisos(cond.usuario.id_usuario), antes + 1);
    assert.equal((await api('POST', `/api/reservas/${id}/llegada`, { codigo }, dueno.token)).status, 409, 'una sola vez');
    assert.ok((await api('GET', `/api/reservas/${id}`, null, cond.token)).reserva.llegada, 'el conductor también la ve');
  });

  it('tras 5 códigos incorrectos se bloquea el intento, y no sirve en reservas sin confirmar o ya terminadas', async () => {
    const { dueno, cond, id } = await reservaConfirmada();
    assert.equal((await api('POST', `/api/reservas/${id}/llegada`, { codigo: 'ABCDEF' }, dueno.token)).status, 409, 'pendiente');
    await responder(dueno.token, id);
    const codigo = (await api('GET', `/api/reservas/${id}`, null, cond.token)).reserva.codigo;
    await empiezaEn(id, 5);
    for (let i = 0; i < 5; i += 1) assert.equal((await api('POST', `/api/reservas/${id}/llegada`, { codigo: 'ABCDEF' }, dueno.token)).status, 400);
    const bloqueado = await api('POST', `/api/reservas/${id}/llegada`, { codigo }, dueno.token);
    assert.equal(bloqueado.status, 429, 'ni con el código bueno mientras dura el bloqueo');

    const otra = await reservaConfirmada();
    await responder(otra.dueno.token, otra.id);
    const cod2 = (await api('GET', `/api/reservas/${otra.id}`, null, otra.cond.token)).reserva.codigo;
    await empiezaEn(otra.id, -300); // ya terminó
    const t = await api('POST', `/api/reservas/${otra.id}/llegada`, { codigo: cod2 }, otra.dueno.token);
    assert.equal(t.status, 409);
    assert.match(t.error, /ya terminó/);
  });
});

describe('reportes de publicaciones', () => {
  it('se reporta una vez, no el propio garaje; el administrador revisa y puede suspender', async () => {
    const dueno = await registrar('propietario');
    const cond = await registrar();
    const g = await crearGaraje(dueno.token, { nombre: 'Garaje dudoso' });
    await run(getDb(), 'INSERT INTO usuario (nombre, apellido, correo, contrasena, tipo_usuario) VALUES (?, ?, ?, ?, ?)', [
      'Admin', 'Func', 'admin-func@prueba.test', await hashContrasena('Clave12345'), 'admin',
    ]);
    const admin = await api('POST', '/api/auth/login', { correo: 'admin-func@prueba.test', contrasena: 'Clave12345' });

    assert.equal((await api('POST', `/api/garajes/${g.id_garaje}/reportar`, { motivo: 'no_existe' })).status, 401);
    assert.equal((await api('POST', `/api/garajes/${g.id_garaje}/reportar`, { motivo: 'no_existe' }, dueno.token)).status, 403, 'el propio garaje');
    assert.equal((await api('POST', `/api/garajes/${g.id_garaje}/reportar`, { motivo: 'otro' }, cond.token)).status, 400, '«otro» pide detalle');
    assert.equal((await api('POST', `/api/garajes/${g.id_garaje}/reportar`, { motivo: 'ladrones' }, cond.token)).status, 400);
    assert.equal((await api('POST', '/api/garajes/9999/reportar', { motivo: 'no_existe' }, cond.token)).status, 404);

    assert.equal((await api('POST', `/api/garajes/${g.id_garaje}/reportar`, { motivo: 'informacion_falsa', detalle: 'La dirección no es' }, cond.token)).status, 201);
    assert.equal((await api('POST', `/api/garajes/${g.id_garaje}/reportar`, { motivo: 'cobro' }, cond.token)).status, 409, 'ya hay uno abierto');

    assert.equal((await api('GET', '/api/admin/reportes', null, cond.token)).status, 403);
    const resumen = await api('GET', '/api/admin/resumen', null, admin.token);
    assert.equal(resumen.reportes_abiertos, 1);
    const lista = await api('GET', '/api/admin/reportes', null, admin.token);
    const rep = lista.reportes[0];
    assert.equal(rep.garaje, 'Garaje dudoso');
    assert.equal(rep.estado, 'abierto');
    assert.equal(rep.detalle, 'La dirección no es');

    const antes = await avisos(dueno.usuario.id_usuario);
    assert.equal((await api('PATCH', `/api/admin/reportes/${rep.id_reporte}`, { suspender_garaje: true }, admin.token)).status, 200);
    assert.equal((await api('GET', '/api/admin/resumen', null, admin.token)).reportes_abiertos, 0);
    assert.equal((await one(getDb(), 'SELECT estado FROM garaje WHERE id_garaje = ?', [g.id_garaje])).estado, 'suspendido');
    assert.equal(await avisos(dueno.usuario.id_usuario), antes + 1);

    // Resuelto el anterior, el usuario puede volver a reportar otra cosa; y «resolver» sin suspender deja el garaje activo.
    const g2 = await crearGaraje(dueno.token, { nombre: 'Otro garaje' });
    await api('POST', `/api/garajes/${g2.id_garaje}/reportar`, { motivo: 'inseguro' }, cond.token);
    const rep2 = (await api('GET', '/api/admin/reportes', null, admin.token)).reportes.find((x) => x.garaje === 'Otro garaje');
    assert.equal((await api('PATCH', `/api/admin/reportes/${rep2.id_reporte}`, {}, admin.token)).status, 200);
    assert.equal((await one(getDb(), 'SELECT estado FROM garaje WHERE id_garaje = ?', [g2.id_garaje])).estado, 'activo');
    assert.equal((await api('PATCH', '/api/admin/reportes/9999', {}, admin.token)).status, 404);
  });
});
