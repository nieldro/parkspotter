// Pruebas de integración: levantan la API real contra una base PGlite (Postgres embebido) temporal.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parkspotter-test-'));
process.env.DATABASE_URL = new URL(`file:${path.join(dir, 'test.db').replace(/\\/g, '/')}`).href;

const { crearApp } = await import('../src/app.js');
const { cerrarDb, getDb, initSchema, run } = await import('../src/db.js');
const { hashContrasena } = await import('../src/lib/auth.js');
const { aUtc, hoyBogota } = await import('../src/lib/tiempo.js');
const { maxConcurrencia, tramosLlenos } = await import('../src/lib/disponibilidad.js');

let servidor;
let base;

async function api(metodo, ruta, cuerpo, token) {
  const r = await fetch(`${base}${ruta}`, {
    method: metodo,
    headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const json = await r.json().catch(() => ({}));
  return { status: r.status, ...json };
}

const CLAVE = 'Clave12345';
let contador = 0;
async function registrar(tipo = 'conductor', extra = {}) {
  contador += 1;
  const r = await api('POST', '/api/auth/registro', {
    nombre: 'Persona',
    apellido: `Prueba${contador}`,
    correo: `persona${contador}@prueba.test`,
    contrasena: CLAVE,
    telefono: '3001234567',
    fecha_nacimiento: '1995-06-15',
    acepto_terminos: true,
    tipo_usuario: tipo,
    ...(tipo === 'propietario' && { tipo_documento: 'CC', numero_documento: `10000${contador}` }),
    ...extra,
  });
  assert.equal(r.status, 201, JSON.stringify(r));
  return { token: r.token, usuario: r.usuario };
}

const sumarDias = (n) => new Date(Date.parse(`${hoyBogota()}T00:00:00Z`) + n * 86400e3).toISOString().slice(0, 10);
const todosLosDias = (ini, fin) => [1, 2, 3, 4, 5, 6, 7].map((d) => ({ dia_semana: d, hora_inicio: ini, hora_fin: fin }));

const garajeBase = (extra = {}) => ({
  nombre: 'Garaje de prueba',
  direccion: 'Calle 1 # 2-3',
  barrio: 'Chapinero',
  localidad: 'Chapinero',
  latitud: 4.6486,
  longitud: -74.0628,
  tarifa_hora: 4000,
  capacidad_total: 1,
  tipo_vehiculo: 'carro',
  descripcion: 'Garaje cubierto',
  instrucciones_acceso: 'Timbre 2, portón verde',
  disponibilidad: todosLosDias('06:00', '22:00'),
  ...extra,
});

async function crearGaraje(token, extra) {
  const r = await api('POST', '/api/propietario/garajes', garajeBase(extra), token);
  assert.equal(r.status, 201, JSON.stringify(r));
  return r.garaje;
}

let placaN = 100;
const reservaBase = (id_garaje, extra = {}) => ({
  id_garaje,
  fecha: sumarDias(3),
  hora_inicio: '10:00',
  hora_fin: '12:00',
  tipo_vehiculo: 'carro',
  placa: `TST${placaN++}`,
  metodo_pago: 'tarjeta',
  ...extra,
});

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
    // En Windows SQLite puede retener el archivo unos instantes; es una carpeta temporal, no importa.
  }
});

describe('cuentas', () => {
  it('registra, inicia sesión y devuelve el perfil sin exponer la contraseña', async () => {
    const { token, usuario } = await registrar('conductor');
    assert.equal(usuario.contrasena, undefined);
    const yo = await api('GET', '/api/auth/yo', null, token);
    assert.equal(yo.usuario.correo, usuario.correo);
    const login = await api('POST', '/api/auth/login', { correo: usuario.correo.toUpperCase(), contrasena: CLAVE });
    assert.equal(login.status, 200);
  });

  it('rechaza datos inválidos y duplicados', async () => {
    const debil = await api('POST', '/api/auth/registro', {
      nombre: 'Ana', apellido: 'Pérez', correo: 'ana@prueba.test', contrasena: '123', tipo_usuario: 'conductor',
    });
    assert.equal(debil.status, 400);
    const sinDoc = await api('POST', '/api/auth/registro', {
      nombre: 'Ana', apellido: 'Pérez', correo: 'ana2@prueba.test', contrasena: CLAVE, tipo_usuario: 'propietario', fecha_nacimiento: '1995-06-15', acepto_terminos: true,
    });
    assert.equal(sinDoc.status, 400);
    const { usuario } = await registrar('conductor');
    const dup = await api('POST', '/api/auth/registro', {
      nombre: 'Otra', apellido: 'Persona', correo: usuario.correo, contrasena: CLAVE, tipo_usuario: 'conductor', fecha_nacimiento: '1995-06-15', acepto_terminos: true,
    });
    assert.equal(dup.status, 409);
  });

  it('no revela si el correo existe y exige sesión válida', async () => {
    const mal = await api('POST', '/api/auth/login', { correo: 'nadie@prueba.test', contrasena: 'Clave12345' });
    assert.equal(mal.status, 401);
    assert.equal((await api('GET', '/api/reservas')).status, 401);
    assert.equal((await api('GET', '/api/reservas', null, 'token-falso')).status, 401);
  });

  it('un conductor puede pasar a propietario sin crear otra cuenta', async () => {
    const { token } = await registrar('conductor');
    assert.equal((await api('GET', '/api/propietario/garajes', null, token)).status, 403);
    const r = await api('POST', '/api/auth/yo/propietario', { tipo_documento: 'CC', numero_documento: '555666777' }, token);
    assert.equal(r.status, 200);
    assert.equal(r.usuario.es_propietario, true);
    assert.equal((await api('GET', '/api/propietario/garajes', null, token)).status, 200);
  });
});

describe('garajes y búsqueda', () => {
  it('solo propietarios publican y se valida la ubicación y los horarios', async () => {
    const conductor = await registrar('conductor');
    assert.equal((await api('POST', '/api/propietario/garajes', garajeBase(), conductor.token)).status, 403);

    const dueno = await registrar('propietario');
    const fueraDeBogota = await api('POST', '/api/propietario/garajes', garajeBase({ latitud: 6.2, longitud: -75.5 }), dueno.token);
    assert.equal(fueraDeBogota.status, 400);
    const cruzados = await api('POST', '/api/propietario/garajes', garajeBase({
      disponibilidad: [
        { dia_semana: 1, hora_inicio: '08:00', hora_fin: '12:00' },
        { dia_semana: 1, hora_inicio: '11:00', hora_fin: '15:00' },
      ],
    }), dueno.token);
    assert.equal(cruzados.status, 400);
    const sinHorario = await api('POST', '/api/propietario/garajes', garajeBase({ disponibilidad: [] }), dueno.token);
    assert.equal(sinHorario.status, 400);
    const g = await crearGaraje(dueno.token);
    assert.equal(g.disponibilidad.length, 7);
  });

  it('busca por texto sin importar tildes, por vehículo, precio y distancia', async () => {
    const dueno = await registrar('propietario');
    const moto = await crearGaraje(dueno.token, { nombre: 'Cupo Candelaria', barrio: 'La Candelaria', tipo_vehiculo: 'moto', tarifa_hora: 2000, latitud: 4.598, longitud: -74.076 });
    await crearGaraje(dueno.token, { nombre: 'Garaje Usaquén', barrio: 'Usaquén', tarifa_hora: 9000, latitud: 4.711, longitud: -74.03 });

    const porTexto = await api('GET', '/api/garajes?q=usaquen');
    assert.ok(porTexto.garajes.some((g) => g.nombre === 'Garaje Usaquén'));
    assert.ok(!porTexto.garajes.some((g) => g.nombre === 'Cupo Candelaria'));

    const soloMoto = await api('GET', '/api/garajes?vehiculo=moto&q=candelaria');
    assert.deepEqual(soloMoto.garajes.map((g) => g.id_garaje), [moto.id_garaje]);
    const carroNoMoto = await api('GET', '/api/garajes?vehiculo=carro&q=candelaria');
    assert.equal(carroNoMoto.garajes.length, 0);

    const barato = await api('GET', '/api/garajes?precio_max=2500&q=candelaria');
    assert.equal(barato.garajes.length, 1);

    const cerca = await api('GET', '/api/garajes?lat=4.598&lng=-74.076&radio_km=1');
    assert.ok(cerca.garajes.length >= 1);
    assert.ok(cerca.garajes.every((g) => g.distancia_km <= 1));
    assert.ok(!cerca.garajes.some((g) => g.nombre === 'Garaje Usaquén'));
    assert.equal((await api('GET', '/api/garajes?lat=4.6')).status, 400);
  });

  it('el detalle oculta instrucciones y teléfono a quien no tiene una reserva confirmada', async () => {
    const dueno = await registrar('propietario');
    const g = await crearGaraje(dueno.token);
    const publico = await api('GET', `/api/garajes/${g.id_garaje}`);
    assert.equal(publico.garaje.instrucciones_acceso, undefined);
    assert.equal(publico.garaje.telefono_propietario, undefined);
    const propio = await api('GET', `/api/garajes/${g.id_garaje}`, null, dueno.token);
    assert.equal(propio.garaje.instrucciones_acceso, 'Timbre 2, portón verde');
  });
});

describe('reservas', () => {
  it('flujo completo: solicitar, aceptar, ver acceso, cancelar con reembolso', async () => {
    const dueno = await registrar('propietario');
    const cond = await registrar('conductor');
    const g = await crearGaraje(dueno.token);

    const nueva = await api('POST', '/api/reservas', reservaBase(g.id_garaje), cond.token);
    assert.equal(nueva.status, 201, JSON.stringify(nueva));
    assert.equal(nueva.reserva.estado, 'pendiente');
    assert.equal(nueva.reserva.costo_total, 8000); // 2 h x $4.000
    assert.equal(nueva.reserva.pago.estado_pago, 'pendiente');
    assert.equal(nueva.reserva.garaje.instrucciones_acceso, undefined);

    const avisos = await api('GET', '/api/notificaciones', null, dueno.token);
    assert.equal(avisos.no_leidas, 1);
    assert.equal(avisos.notificaciones[0].tipo, 'solicitud_nueva');

    const id = nueva.reserva.id_reserva;
    assert.equal((await api('POST', `/api/reservas/${id}/responder`, { accion: 'aceptar' }, cond.token)).status, 404);
    const ok = await api('POST', `/api/reservas/${id}/responder`, { accion: 'aceptar' }, dueno.token);
    assert.equal(ok.reserva.estado, 'confirmada');
    assert.equal(ok.reserva.pago.estado_pago, 'aprobado');
    assert.equal((await api('POST', `/api/reservas/${id}/responder`, { accion: 'rechazar' }, dueno.token)).status, 409);

    const vista = await api('GET', `/api/reservas/${id}`, null, cond.token);
    assert.equal(vista.reserva.garaje.instrucciones_acceso, 'Timbre 2, portón verde');
    const detalle = await api('GET', `/api/garajes/${g.id_garaje}`, null, cond.token);
    assert.equal(detalle.garaje.instrucciones_acceso, 'Timbre 2, portón verde');

    const cancelada = await api('POST', `/api/reservas/${id}/cancelar`, {}, cond.token);
    assert.equal(cancelada.reserva.estado, 'cancelada');
    assert.equal(cancelada.reserva.pago.estado_pago, 'reembolsado');
    assert.equal((await api('POST', `/api/reservas/${id}/cancelar`, {}, cond.token)).status, 409);
  });

  it('rechazar libera el horario para otra persona', async () => {
    const dueno = await registrar('propietario');
    const a = await registrar('conductor');
    const b = await registrar('conductor');
    const g = await crearGaraje(dueno.token);

    const r1 = await api('POST', '/api/reservas', reservaBase(g.id_garaje), a.token);
    assert.equal((await api('POST', '/api/reservas', reservaBase(g.id_garaje), b.token)).status, 409);
    await api('POST', `/api/reservas/${r1.reserva.id_reserva}/responder`, { accion: 'rechazar', motivo: 'No estaré' }, dueno.token);
    const r2 = await api('POST', '/api/reservas', reservaBase(g.id_garaje), b.token);
    assert.equal(r2.status, 201);
    const rechazada = await api('GET', `/api/reservas/${r1.reserva.id_reserva}`, null, a.token);
    assert.equal(rechazada.reserva.estado, 'rechazada');
    assert.equal(rechazada.reserva.motivo, 'No estaré');
  });

  it('nunca confirma dos reservas en un cupo único, ni con peticiones simultáneas', async () => {
    const dueno = await registrar('propietario');
    const g = await crearGaraje(dueno.token);
    const conductores = await Promise.all(Array.from({ length: 6 }, () => registrar('conductor')));
    const resultados = await Promise.all(
      conductores.map((c) => api('POST', '/api/reservas', reservaBase(g.id_garaje), c.token)),
    );
    assert.equal(resultados.filter((r) => r.status === 201).length, 1);
    assert.equal(resultados.filter((r) => r.status === 409).length, 5);
  });

  it('con capacidad 2 admite dos y rechaza la tercera; horarios contiguos no chocan', async () => {
    const dueno = await registrar('propietario');
    const g = await crearGaraje(dueno.token, { capacidad_total: 2 });
    const [a, b, c] = await Promise.all([registrar(), registrar(), registrar()]);
    assert.equal((await api('POST', '/api/reservas', reservaBase(g.id_garaje, { hora_inicio: '08:00', hora_fin: '10:00' }), a.token)).status, 201);
    assert.equal((await api('POST', '/api/reservas', reservaBase(g.id_garaje, { hora_inicio: '10:00', hora_fin: '12:00' }), b.token)).status, 201);
    assert.equal((await api('POST', '/api/reservas', reservaBase(g.id_garaje, { hora_inicio: '09:00', hora_fin: '11:00' }), c.token)).status, 201);
    const cuarta = await registrar();
    assert.equal((await api('POST', '/api/reservas', reservaBase(g.id_garaje, { hora_inicio: '09:30', hora_fin: '10:30' }), cuarta.token)).status, 409);
  });

  it('valida horario, vehículo, placa, fecha y propietario', async () => {
    const dueno = await registrar('propietario');
    const cond = await registrar('conductor');
    const g = await crearGaraje(dueno.token, { disponibilidad: todosLosDias('08:00', '18:00') });

    const casos = [
      [reservaBase(g.id_garaje, { hora_inicio: '07:00', hora_fin: '09:00' }), 409, 'fuera del horario ofrecido'],
      [reservaBase(g.id_garaje, { hora_inicio: '17:00', hora_fin: '19:00' }), 409, 'termina fuera del horario'],
      [reservaBase(g.id_garaje, { tipo_vehiculo: 'moto', placa: 'ABC12D' }), 409, 'tipo de vehículo no admitido'],
      [reservaBase(g.id_garaje, { placa: 'XX1' }), 400, 'placa inválida'],
      [reservaBase(g.id_garaje, { hora_inicio: '12:00', hora_fin: '10:00' }), 400, 'salida antes de entrada'],
      [reservaBase(g.id_garaje, { hora_inicio: '10:15', hora_fin: '11:00' }), 400, 'no es bloque de 30 min'],
      [reservaBase(g.id_garaje, { fecha: sumarDias(-1) }), 400, 'fecha pasada'],
      [reservaBase(g.id_garaje, { fecha: sumarDias(90) }), 400, 'demasiado adelante'],
      [reservaBase(g.id_garaje, { fecha: '2026-02-30' }), 400, 'fecha inexistente'],
      [reservaBase(9999), 404, 'garaje inexistente'],
    ];
    for (const [cuerpo, esperado, nombre] of casos) {
      const r = await api('POST', '/api/reservas', cuerpo, cond.token);
      assert.equal(r.status, esperado, `${nombre}: ${JSON.stringify(r)}`);
    }
    assert.equal((await api('POST', '/api/reservas', reservaBase(g.id_garaje), dueno.token)).status, 403);
  });

  it('un mismo vehículo no puede estar en dos reservas a la vez', async () => {
    const dueno = await registrar('propietario');
    const g1 = await crearGaraje(dueno.token);
    const g2 = await crearGaraje(dueno.token, { nombre: 'Otro garaje' });
    const cond = await registrar('conductor');
    assert.equal((await api('POST', '/api/reservas', reservaBase(g1.id_garaje, { placa: 'ZZZ999' }), cond.token)).status, 201);
    assert.equal((await api('POST', '/api/reservas', reservaBase(g2.id_garaje, { placa: 'zzz-999' }), cond.token)).status, 409);
  });

  it('la búsqueda por horario excluye los garajes ya llenos y muestra el costo', async () => {
    const dueno = await registrar('propietario');
    const cond = await registrar('conductor');
    const g = await crearGaraje(dueno.token, { nombre: 'Garaje filtro horario Único' });
    const fecha = sumarDias(4);
    const filtro = `q=filtro%20horario%20unico&fecha=${fecha}&desde=09:00&hasta=11:00`;
    const antes = await api('GET', `/api/garajes?${filtro}`);
    assert.equal(antes.garajes.length, 1);
    assert.equal(antes.garajes[0].costo_estimado, 8000);
    assert.equal(antes.garajes[0].cupos_libres, 1);
    await api('POST', '/api/reservas', reservaBase(g.id_garaje, { fecha, hora_inicio: '10:00', hora_fin: '11:00' }), cond.token);
    assert.equal((await api('GET', `/api/garajes?${filtro}`)).garajes.length, 0);
    const ocupacion = await api('GET', `/api/garajes/${g.id_garaje}/ocupacion?fecha=${fecha}`);
    assert.deepEqual(ocupacion.llenos, [{ hora_inicio: '10:00', hora_fin: '11:00' }]);
  });

  it('cada quien ve solo lo suyo', async () => {
    const duenoA = await registrar('propietario');
    const duenoB = await registrar('propietario');
    const cond = await registrar('conductor');
    const otro = await registrar('conductor');
    const g = await crearGaraje(duenoA.token);
    const r = await api('POST', '/api/reservas', reservaBase(g.id_garaje), cond.token);
    const id = r.reserva.id_reserva;

    assert.equal((await api('GET', `/api/reservas/${id}`, null, otro.token)).status, 404);
    assert.equal((await api('GET', `/api/reservas/${id}`, null, duenoB.token)).status, 404);
    assert.equal((await api('POST', `/api/reservas/${id}/cancelar`, {}, otro.token)).status, 404);
    assert.equal((await api('POST', `/api/reservas/${id}/responder`, { accion: 'aceptar' }, duenoB.token)).status, 404);
    assert.equal((await api('PUT', `/api/propietario/garajes/${g.id_garaje}`, garajeBase(), duenoB.token)).status, 404);
    assert.equal((await api('GET', '/api/propietario/reservas', null, duenoB.token)).reservas.length, 0);
    assert.equal((await api('GET', '/api/propietario/reservas', null, duenoA.token)).reservas.length, 1);
    assert.equal((await api('GET', '/api/reservas', null, otro.token)).reservas.length, 0);
  });
});

describe('calificaciones', () => {
  it('solo se califica una reserva confirmada que ya terminó, una sola vez', async () => {
    const dueno = await registrar('propietario');
    const cond = await registrar('conductor');
    const g = await crearGaraje(dueno.token);
    const futura = await api('POST', '/api/reservas', reservaBase(g.id_garaje), cond.token);
    await api('POST', `/api/reservas/${futura.reserva.id_reserva}/responder`, { accion: 'aceptar' }, dueno.token);
    assert.equal((await api('POST', `/api/reservas/${futura.reserva.id_reserva}/calificar`, { puntuacion: 5 }, cond.token)).status, 409);

    // Reserva ya terminada (hace 2 días), insertada directamente porque la API no permite fechas pasadas.
    const db = getDb();
    const ayer = sumarDias(-2);
    const r = await run(
      db,
      `INSERT INTO reserva (id_usuario, id_garaje, fecha_inicio, fecha_fin, estado, costo_total, tipo_vehiculo, placa)
       VALUES (?, ?, ?, ?, 'confirmada', 4000, 'carro', 'OLD123')`,
      [cond.usuario.id_usuario, g.id_garaje, aUtc(ayer, '10:00'), aUtc(ayer, '11:00')],
    );
    const id = Number(r.lastInsertRowid);
    const lista = await api('GET', '/api/reservas', null, cond.token);
    const terminada = lista.reservas.find((x) => x.id_reserva === id);
    assert.equal(terminada.estado_efectivo, 'finalizada');
    assert.equal(terminada.puede_calificar, true);
    assert.equal((await api('POST', `/api/reservas/${id}/calificar`, { puntuacion: 6 }, cond.token)).status, 400);
    assert.equal((await api('POST', `/api/reservas/${id}/calificar`, { puntuacion: 4, comentario: 'Bien' }, dueno.token)).status, 404);
    assert.equal((await api('POST', `/api/reservas/${id}/calificar`, { puntuacion: 4, comentario: 'Bien' }, cond.token)).status, 201);
    assert.equal((await api('POST', `/api/reservas/${id}/calificar`, { puntuacion: 5 }, cond.token)).status, 409);

    const detalle = await api('GET', `/api/garajes/${g.id_garaje}`);
    assert.equal(detalle.garaje.calificacion_promedio, 4);
    assert.equal(detalle.garaje.total_calificaciones, 1);
    assert.match(detalle.calificaciones[0].autor, /^Persona P\.$/);
    assert.equal((await api('POST', `/api/reservas/${id}/cancelar`, {}, cond.token)).status, 409);
  });
});

describe('administración', () => {
  it('modera garajes y usuarios; los no administradores quedan fuera', async () => {
    const db = getDb();
    await run(db, "INSERT INTO usuario (nombre, apellido, correo, contrasena, tipo_usuario) VALUES ('Ada', 'Admin', 'admin@prueba.test', ?, 'admin')", [await hashContrasena(CLAVE)]);
    const admin = await api('POST', '/api/auth/login', { correo: 'admin@prueba.test', contrasena: CLAVE });
    const dueno = await registrar('propietario');
    const cond = await registrar('conductor');
    const g = await crearGaraje(dueno.token, { nombre: 'Garaje moderable Único' });

    assert.equal((await api('GET', '/api/admin/resumen', null, cond.token)).status, 403);
    assert.equal((await api('GET', '/api/admin/resumen', null, admin.token)).status, 200);

    await api('PATCH', `/api/admin/garajes/${g.id_garaje}`, { estado: 'suspendido' }, admin.token);
    assert.equal((await api('GET', '/api/garajes?q=moderable')).garajes.length, 0);
    assert.equal((await api('GET', `/api/garajes/${g.id_garaje}`)).status, 404);
    assert.equal((await api('POST', '/api/reservas', reservaBase(g.id_garaje), cond.token)).status, 404);
    assert.equal((await api('PATCH', `/api/propietario/garajes/${g.id_garaje}/estado`, { estado: 'activo' }, dueno.token)).status, 403);
    await api('PATCH', `/api/admin/garajes/${g.id_garaje}`, { estado: 'activo' }, admin.token);
    assert.equal((await api('GET', '/api/garajes?q=moderable')).garajes.length, 1);

    await api('PATCH', `/api/admin/usuarios/${cond.usuario.id_usuario}`, { estado: 'inactivo' }, admin.token);
    assert.equal((await api('POST', '/api/auth/login', { correo: cond.usuario.correo, contrasena: CLAVE })).status, 403);
    assert.equal((await api('GET', '/api/auth/yo', null, cond.token)).status, 403);
  });
});

describe('reglas de disponibilidad (unidad)', () => {
  const t = (h) => aUtc('2026-12-01', h);
  it('cuenta concurrencia real, no cruces', () => {
    const reservas = [
      { fecha_inicio: t('08:00'), fecha_fin: t('10:00') },
      { fecha_inicio: t('10:00'), fecha_fin: t('12:00') },
    ];
    assert.equal(maxConcurrencia(reservas, t('09:00'), t('11:00')), 1);
    assert.equal(maxConcurrencia([...reservas, { fecha_inicio: t('09:00'), fecha_fin: t('11:00') }], t('09:00'), t('11:00')), 2);
    assert.equal(maxConcurrencia(reservas, t('12:00'), t('13:00')), 0);
  });
  it('calcula los tramos llenos y los une si son contiguos', () => {
    const tramos = tramosLlenos(
      [
        { fecha_inicio: t('08:00'), fecha_fin: t('10:00') },
        { fecha_inicio: t('10:00'), fecha_fin: t('12:00') },
      ],
      1,
    );
    assert.equal(tramos.length, 1);
    assert.equal(tramos[0][1] - tramos[0][0], 4 * 3600e3);
  });
});
