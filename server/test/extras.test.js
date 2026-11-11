// Servicios del garaje, favoritos, estadísticas del propietario y calendario (.ics).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parkspotter-extras-'));
process.env.DATABASE_URL = new URL(`file:${path.join(dir, 'test.db').replace(/\\/g, '/')}`).href;
process.env.UPLOADS_DIR = path.join(dir, 'uploads');

const { crearApp } = await import('../src/app.js');
const { cerrarDb, getDb, initSchema, run } = await import('../src/db.js');
const { interpretarLocal } = await import('../src/lib/asistente.js');
const { hoyBogota } = await import('../src/lib/tiempo.js');

let servidor;
let base;
async function api(metodo, ruta, cuerpo, token, crudo = false) {
  const r = await fetch(`${base}${ruta}`, {
    method: metodo,
    headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  if (crudo) return { status: r.status, tipo: r.headers.get('content-type'), disposicion: r.headers.get('content-disposition'), texto: await r.text() };
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
}

let n = 0;
async function registrar(tipo = 'conductor') {
  n += 1;
  const r = await api('POST', '/api/auth/registro', {
    nombre: 'Persona', apellido: `Extra${n}`, correo: `x${n}@prueba.test`, contrasena: 'Clave12345', fecha_nacimiento: '1990-03-20',
    acepto_terminos: true, tipo_usuario: tipo, ...(tipo === 'propietario' && { tipo_documento: 'CC', numero_documento: `30000${n}` }),
  });
  assert.equal(r.status, 201, JSON.stringify(r));
  return { token: r.token, usuario: r.usuario };
}
const sumarDias = (k) => new Date(Date.parse(`${hoyBogota()}T00:00:00Z`) + k * 86400e3).toISOString().slice(0, 10);
const garajeBase = (extra = {}) => ({
  nombre: 'Garaje de prueba', direccion: 'Calle 1 # 2-3', barrio: 'Chapinero', localidad: 'Chapinero', latitud: 4.6486, longitud: -74.0628,
  tarifa_hora: 4000, capacidad_total: 1, tipo_vehiculo: 'ambos', descripcion: 'x', instrucciones_acceso: 'Timbre 2, portón verde',
  disponibilidad: [1, 2, 3, 4, 5, 6, 7].map((d) => ({ dia_semana: d, hora_inicio: '06:00', hora_fin: '22:00' })), ...extra,
});
async function crearGaraje(token, extra) {
  const r = await api('POST', '/api/propietario/garajes', garajeBase(extra), token);
  assert.equal(r.status, 201, JSON.stringify(r));
  return r.garaje;
}
let placa = 900;
async function reservar(token, idGaraje, dia, extra = {}) {
  return api('POST', '/api/reservas', {
    id_garaje: idGaraje, fecha: sumarDias(dia), hora_inicio: '10:00', hora_fin: '12:00', tipo_vehiculo: 'carro',
    placa: `ZXC${placa++}`, metodo_pago: 'tarjeta', ...extra,
  }, token);
}

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

describe('servicios del garaje', () => {
  it('se guardan, se muestran y filtran la búsqueda (todos los pedidos deben cumplirse)', async () => {
    const d = await registrar('propietario');
    const a = await crearGaraje(d.token, { nombre: 'Con todo SRV', servicios: ['cubierto', 'vigilancia', 'camaras', 'cubierto'] });
    const b = await crearGaraje(d.token, { nombre: 'Solo techo SRV', servicios: ['cubierto'] });
    await crearGaraje(d.token, { nombre: 'Sin nada SRV' });
    assert.deepEqual(a.servicios, ['cubierto', 'vigilancia', 'camaras']); // sin repetidos

    const todos = await api('GET', '/api/garajes?q=SRV');
    assert.equal(todos.total, 3);
    const conTecho = await api('GET', '/api/garajes?q=SRV&servicios=cubierto');
    assert.deepEqual(conTecho.garajes.map((g) => g.nombre).sort(), ['Con todo SRV', 'Solo techo SRV']);
    const ambos = await api('GET', '/api/garajes?q=SRV&servicios=cubierto,vigilancia');
    assert.deepEqual(ambos.garajes.map((g) => g.nombre), ['Con todo SRV']);
    assert.equal((await api('GET', '/api/garajes?servicios=jacuzzi')).status, 400);

    const detalle = await api('GET', `/api/garajes/${b.id_garaje}`);
    assert.deepEqual(detalle.garaje.servicios, ['cubierto']);
    const edit = await api('PUT', `/api/propietario/garajes/${b.id_garaje}`, garajeBase({ nombre: 'Solo techo SRV', servicios: ['cargador_ev'] }), d.token);
    assert.deepEqual(edit.garaje.servicios, ['cargador_ev']);
    assert.equal((await api('POST', '/api/propietario/garajes', garajeBase({ servicios: ['piscina'] }), d.token)).status, 400);
  });

  it('el asistente entiende los servicios en la frase', async () => {
    const hoy = '2026-11-06';
    assert.deepEqual(interpretarLocal('garaje cubierto con vigilancia', { hoy }).servicios.sort(), ['cubierto', 'vigilancia']);
    assert.deepEqual(interpretarLocal('quiero cargar mi carro eléctrico, con cargador', { hoy }).servicios, ['cargador_ev']);
    assert.deepEqual(interpretarLocal('necesito techo alto para una camioneta', { hoy }).servicios, ['techo_alto']);
    assert.equal(interpretarLocal('moto en Chapinero', { hoy }).servicios, undefined);

    const d = await registrar('propietario');
    await crearGaraje(d.token, { nombre: 'Asistente techo AST', barrio: 'Barrio AST', servicios: ['cubierto', 'vigilancia'] });
    await crearGaraje(d.token, { nombre: 'Asistente abierto AST', barrio: 'Barrio AST', tarifa_hora: 1000 });
    const r = await api('POST', '/api/asistente', { mensaje: 'garaje cubierto y con vigilancia en Barrio AST' });
    assert.deepEqual(r.garajes.map((g) => g.nombre), ['Asistente techo AST']);
    assert.match(r.respuesta, /con (vigilancia y techo|techo y vigilancia)/);
    assert.match(r.enlace, /servicios=(cubierto%2Cvigilancia|vigilancia%2Ccubierto)/);
  });
});

describe('favoritos', () => {
  it('guardar, listar, quitar; idempotente y solo con sesión', async () => {
    const d = await registrar('propietario');
    const g = await crearGaraje(d.token, { nombre: 'Favorito FAV' });
    const otro = await crearGaraje(d.token, { nombre: 'Otro FAV' });
    const u = await registrar();
    const v = await registrar();

    assert.equal((await api('GET', '/api/favoritos/ids')).status, 401);
    assert.equal((await api('POST', `/api/favoritos/${g.id_garaje}`)).status, 401);
    assert.equal((await api('POST', `/api/favoritos/${g.id_garaje}`, null, u.token)).status, 201);
    assert.equal((await api('POST', `/api/favoritos/${g.id_garaje}`, null, u.token)).status, 201); // repetir no duplica
    await api('POST', `/api/favoritos/${otro.id_garaje}`, null, u.token);
    assert.equal((await api('POST', '/api/favoritos/99999', null, u.token)).status, 404);

    assert.deepEqual((await api('GET', '/api/favoritos/ids', null, u.token)).ids.sort(), [g.id_garaje, otro.id_garaje].sort());
    const lista = await api('GET', '/api/favoritos', null, u.token);
    assert.equal(lista.garajes.length, 2);
    assert.equal(lista.garajes[0].nombre, 'Otro FAV'); // el más reciente primero
    assert.deepEqual((await api('GET', '/api/favoritos/ids', null, v.token)).ids, []); // cada quien los suyos

    assert.equal((await api('DELETE', `/api/favoritos/${g.id_garaje}`, null, u.token)).favorito, false);
    assert.equal((await api('DELETE', `/api/favoritos/${g.id_garaje}`, null, u.token)).status, 200); // idempotente
    assert.equal((await api('GET', '/api/favoritos', null, u.token)).garajes.length, 1);

    // si el dueño pausa el garaje, sigue en favoritos pero marcado como no disponible
    await api('PATCH', `/api/propietario/garajes/${otro.id_garaje}/estado`, { estado: 'inactivo' }, d.token);
    const pausado = await api('GET', '/api/favoritos', null, u.token);
    assert.equal(pausado.garajes[0].disponible, false);
    assert.equal((await api('POST', `/api/favoritos/${otro.id_garaje}`, null, v.token)).status, 404); // pero no se puede guardar uno pausado
  });
});

describe('estadísticas del propietario', () => {
  it('suma ingresos realizados y proyectados, por semana y por garaje', async () => {
    const d = await registrar('propietario');
    const g1 = await crearGaraje(d.token, { nombre: 'Estadística uno', tarifa_hora: 5000 });
    const g2 = await crearGaraje(d.token, { nombre: 'Estadística dos', tarifa_hora: 2000 });
    const c = await registrar();

    const ids = [];
    for (const [garaje, dia] of [[g1, 5], [g1, 6], [g2, 7], [g2, 8]]) {
      const r = await reservar(c.token, garaje.id_garaje, dia);
      assert.equal(r.status, 201, JSON.stringify(r));
      ids.push(r.reserva.id_reserva);
    }
    // 0,1,2 confirmadas; 3 rechazada
    for (const id of ids.slice(0, 3)) await api('POST', `/api/reservas/${id}/responder`, { accion: 'aceptar' }, d.token);
    await api('POST', `/api/reservas/${ids[3]}/responder`, { accion: 'rechazar', motivo: 'No' }, d.token);

    // dos de las confirmadas ya «ocurrieron»: una esta semana y otra hace 2 semanas
    const hace = (dias, h) => new Date(Date.now() - dias * 86400e3 + h * 3600e3).toISOString();
    await run(getDb(), 'UPDATE reserva SET fecha_inicio = ?, fecha_fin = ? WHERE id_reserva = ?', [hace(1, -2), hace(1, 0), ids[0]]); // g1: 2 h × 5000 = 10000
    await run(getDb(), 'UPDATE reserva SET fecha_inicio = ?, fecha_fin = ? WHERE id_reserva = ?', [hace(15, -3), hace(15, 0), ids[2]]); // g2: el costo se fijó al reservar (2 h × 2000 = 4000)

    const e = await api('GET', '/api/propietario/estadisticas', null, d.token);
    assert.equal(e.status, 200, JSON.stringify(e));
    assert.equal(e.totales.ingresos_realizados, 14000); // 10000 + 4000
    assert.equal(e.totales.ingresos_proyectados, 10000); // ids[1]: g1 futura, 2 h × 5000
    assert.equal(e.totales.reservas_confirmadas, 3);
    assert.equal(e.totales.horas_reservadas, 5);
    assert.equal(e.totales.tasa_aceptacion, 75); // 3 confirmadas, 1 rechazada
    assert.deepEqual(e.estados, { pendiente: 0, confirmada: 3, rechazada: 1, cancelada: 0 });
    assert.equal(e.semanas.length, 8);
    assert.equal(e.semanas.reduce((s, w) => s + w.ingresos, 0), 14000);
    assert.equal(e.por_garaje[0].nombre, 'Estadística uno'); // el que más aporta, primero
    assert.equal(e.por_garaje[0].ingresos, 10000);
    assert.equal(e.por_garaje[0].proyectados, 10000);

    assert.equal((await api('GET', '/api/propietario/estadisticas', null, c.token)).status, 403); // un conductor no entra
    assert.equal((await api('GET', '/api/propietario/estadisticas')).status, 401);
  });
});

describe('calendario (.ics)', () => {
  it('genera un evento válido, con la privacidad de siempre', async () => {
    const d = await registrar('propietario');
    const c = await registrar();
    const intruso = await registrar();
    const g = await crearGaraje(d.token, { nombre: 'Garaje, con; símbolos' });
    const r = await reservar(c.token, g.id_garaje, 12);
    const id = r.reserva.id_reserva;

    const pendiente = await api('GET', `/api/reservas/${id}/calendario`, null, c.token, true);
    assert.equal(pendiente.status, 200);
    assert.match(pendiente.tipo, /text\/calendar/);
    assert.match(pendiente.disposicion, new RegExp(`reserva-${id}\\.ics`));
    assert.match(pendiente.texto, /^BEGIN:VCALENDAR\r\n/);
    assert.match(pendiente.texto, /DTSTART:\d{8}T\d{6}Z\r\n/);
    assert.match(pendiente.texto, /DTEND:\d{8}T\d{6}Z\r\n/);
    assert.match(pendiente.texto, /SUMMARY:Parqueadero: Garaje\\, con\\; símbolos/); // se escapan , y ;
    assert.match(pendiente.texto, /STATUS:TENTATIVE/);
    assert.ok(!pendiente.texto.includes('portón verde'), 'sin confirmar no se filtran las instrucciones de acceso');
    assert.ok(pendiente.texto.split('\r\n').every((l) => Buffer.byteLength(l) <= 75), 'líneas plegadas a 75 bytes');

    await api('POST', `/api/reservas/${id}/responder`, { accion: 'aceptar' }, d.token);
    const confirmada = await api('GET', `/api/reservas/${id}/calendario`, null, c.token, true);
    assert.match(confirmada.texto.replace(/\r\n /g, ''), /STATUS:CONFIRMED/);
    assert.match(confirmada.texto.replace(/\r\n /g, ''), /Cómo entrar: Timbre 2\\, portón verde/);
    assert.match(confirmada.texto, /END:VCALENDAR\r\n$/);

    assert.equal((await api('GET', `/api/reservas/${id}/calendario`, null, intruso.token, true)).status, 404);
    assert.equal((await api('GET', `/api/reservas/${id}/calendario`, null, undefined, true)).status, 401);
    await api('POST', `/api/reservas/${id}/cancelar`, {}, c.token);
    assert.equal((await api('GET', `/api/reservas/${id}/calendario`, null, c.token, true)).status, 409);
  });
});
