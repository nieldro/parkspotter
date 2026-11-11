// Datos personales, fotos, chat de reservas y asistente de IA.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import sharp from 'sharp';

process.env.NODE_ENV = 'test';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parkspotter-pci-'));
process.env.DATABASE_URL = new URL(`file:${path.join(dir, 'test.db').replace(/\\/g, '/')}`).href;
process.env.UPLOADS_DIR = path.join(dir, 'uploads');

// «Modelo de lenguaje» simulado: solo contesta cuando el mensaje contiene la palabra MODELO; si no, falla (500)
// y el asistente debe seguir funcionando con su intérprete local.
let llamadasModelo = 0;
const modelo = http.createServer((req, res) => {
  let cuerpo = '';
  req.on('data', (c) => (cuerpo += c));
  req.on('end', () => {
    llamadasModelo += 1;
    const msg = JSON.parse(cuerpo).messages.at(-1).content;
    if (!/MODELO/.test(msg)) return res.writeHead(500).end('error');
    const j = { intencion: 'buscar', vehiculo: 'moto', fecha: '2999-01-01', desde: '10:00', hasta: '11:00', precio_max: 3000, lugar: 'Chapinero', orden: 'precio', cerca_de_mi: false };
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(j) } }] }));
  });
});
await new Promise((ok) => modelo.listen(0, '127.0.0.1', ok));
process.env.AI_BASE_URL = `http://127.0.0.1:${modelo.address().port}`;
process.env.AI_MODEL = 'modelo-de-prueba';

const { crearApp } = await import('../src/app.js');
const { cerrarDb, getDb, initSchema, run } = await import('../src/db.js');
const { hashContrasena } = await import('../src/lib/auth.js');
const { interpretarLocal } = await import('../src/lib/asistente.js');
const { aUtc, hoyBogota } = await import('../src/lib/tiempo.js');

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

const CLAVE = 'Clave12345';
let n = 0;
async function registrar(tipo = 'conductor', extra = {}) {
  n += 1;
  const r = await api('POST', '/api/auth/registro', {
    nombre: 'Persona', apellido: `Prueba${n}`, correo: `p${n}@prueba.test`, contrasena: CLAVE, telefono: '3001234567',
    fecha_nacimiento: '1990-03-20', acepto_terminos: true, tipo_usuario: tipo,
    ...(tipo === 'propietario' && { tipo_documento: 'CC', numero_documento: `20000${n}` }),
    ...extra,
  });
  assert.equal(r.status, 201, JSON.stringify(r));
  return { token: r.token, usuario: r.usuario };
}

const sumarDias = (k) => new Date(Date.parse(`${hoyBogota()}T00:00:00Z`) + k * 86400e3).toISOString().slice(0, 10);
const garajeBase = (extra = {}) => ({
  nombre: 'Garaje de prueba', direccion: 'Calle 1 # 2-3', barrio: 'Chapinero', localidad: 'Chapinero',
  latitud: 4.6486, longitud: -74.0628, tarifa_hora: 4000, capacidad_total: 1, tipo_vehiculo: 'ambos',
  descripcion: 'Garaje cubierto', instrucciones_acceso: 'Timbre 2',
  disponibilidad: [1, 2, 3, 4, 5, 6, 7].map((d) => ({ dia_semana: d, hora_inicio: '06:00', hora_fin: '22:00' })),
  ...extra,
});
async function crearGaraje(token, extra) {
  const r = await api('POST', '/api/propietario/garajes', garajeBase(extra), token);
  assert.equal(r.status, 201, JSON.stringify(r));
  return r.garaje;
}
let placa = 700;
async function reservar(token, idGaraje, extra = {}) {
  const r = await api('POST', '/api/reservas', {
    id_garaje: idGaraje, fecha: sumarDias(10 + (n % 40)), hora_inicio: '10:00', hora_fin: '12:00',
    tipo_vehiculo: 'carro', placa: `QWE${placa++}`, metodo_pago: 'tarjeta', ...extra,
  }, token);
  return r;
}

async function imagenDataUrl(ancho = 300, alto = 200, formato = 'png') {
  const buf = await sharp({ create: { width: ancho, height: alto, channels: 3, background: '#336699' } })[formato]().toBuffer();
  return `data:image/${formato};base64,${buf.toString('base64')}`;
}

before(async () => {
  await initSchema();
  servidor = crearApp().listen(0);
  await new Promise((r) => servidor.once('listening', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(async () => {
  servidor.close();
  modelo.close();
  await cerrarDb();
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    /* carpeta temporal */
  }
});

describe('datos personales', () => {
  const datos = (extra) => ({
    nombre: 'Ana', apellido: 'Pérez', correo: `ana${++n}@prueba.test`, contrasena: CLAVE, tipo_usuario: 'conductor',
    fecha_nacimiento: '1990-03-20', acepto_terminos: true, ...extra,
  });

  it('exige mayoría de edad, términos aceptados y placa válida', async () => {
    const hoy = hoyBogota();
    const menor = `${Number(hoy.slice(0, 4)) - 17}-01-01`;
    assert.match((await api('POST', '/api/auth/registro', datos({ fecha_nacimiento: menor }))).error, /18 años/);
    assert.equal((await api('POST', '/api/auth/registro', datos({ fecha_nacimiento: '1850-01-01' }))).status, 400);
    assert.equal((await api('POST', '/api/auth/registro', datos({ fecha_nacimiento: undefined }))).status, 400);
    assert.match((await api('POST', '/api/auth/registro', datos({ acepto_terminos: false }))).error, /términos/);
    const placaMala = await api('POST', '/api/auth/registro', datos({ vehiculo: { tipo: 'moto', placa: 'ABC123' } }));
    assert.equal(placaMala.status, 400);
  });

  it('guarda el vehículo y el perfil se puede actualizar o limpiar', async () => {
    const r = await api('POST', '/api/auth/registro', datos({ vehiculo: { tipo: 'carro', placa: 'abc-123', detalle: 'Mazda 2 rojo' } }));
    assert.equal(r.status, 201);
    assert.deepEqual(r.usuario.vehiculo, { tipo: 'carro', placa: 'ABC123', detalle: 'Mazda 2 rojo' });
    assert.equal(r.usuario.fecha_nacimiento, '1990-03-20');

    const cambio = await api('PATCH', '/api/auth/yo', {
      nombre: 'Ana María', apellido: 'Pérez', telefono: '3109998877', vehiculo: { tipo: 'moto', placa: 'xyz12a', detalle: '' },
    }, r.token);
    assert.equal(cambio.status, 200, JSON.stringify(cambio));
    assert.equal(cambio.usuario.nombre, 'Ana María');
    assert.equal(cambio.usuario.telefono, '3109998877');
    assert.equal(cambio.usuario.vehiculo.placa, 'XYZ12A');
    assert.equal(cambio.usuario.fecha_nacimiento, '1990-03-20'); // no enviada = no se borra

    const sin = await api('PATCH', '/api/auth/yo', { nombre: 'Ana María', apellido: 'Pérez', vehiculo: null }, r.token);
    assert.equal(sin.usuario.vehiculo, null);
  });

  it('cambiar el correo exige la contraseña y no admite uno ya usado', async () => {
    const a = await registrar();
    const b = await registrar();
    assert.equal((await api('POST', '/api/auth/yo/correo', { correo: 'nuevo@prueba.test', contrasena: 'incorrecta1' }, a.token)).status, 400);
    assert.equal((await api('POST', '/api/auth/yo/correo', { correo: b.usuario.correo, contrasena: CLAVE }, a.token)).status, 409);
    const ok = await api('POST', '/api/auth/yo/correo', { correo: 'Nuevo@Prueba.test', contrasena: CLAVE }, a.token);
    assert.equal(ok.usuario.correo, 'nuevo@prueba.test');
    assert.equal((await api('POST', '/api/auth/login', { correo: 'nuevo@prueba.test', contrasena: CLAVE })).status, 200);
  });
});

describe('fotos', () => {
  it('foto de perfil: se re-codifica, se sirve, se reemplaza y se borra', async () => {
    const { token } = await registrar();
    const subida = await api('POST', '/api/auth/yo/foto', { imagen: await imagenDataUrl(800, 500, 'png') }, token);
    assert.equal(subida.status, 200, JSON.stringify(subida));
    const url = subida.usuario.foto;
    assert.match(url, /^\/uploads\/avatar-[a-f0-9]{16}\.jpg$/);
    const archivo = path.join(process.env.UPLOADS_DIR, path.basename(url));
    assert.ok(fs.existsSync(archivo));
    const meta = await sharp(archivo).metadata();
    assert.deepEqual([meta.format, meta.width, meta.height], ['jpeg', 400, 400]); // cuadrada, sin importar el original
    const img = await fetch(`${base}${url}`);
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/jpeg');

    const otra = await api('POST', '/api/auth/yo/foto', { imagen: await imagenDataUrl(300, 300, 'webp') }, token);
    assert.notEqual(otra.usuario.foto, url);
    assert.ok(!fs.existsSync(archivo), 'la foto anterior se borra del disco');

    const sin = await api('DELETE', '/api/auth/yo/foto', null, token);
    assert.equal(sin.usuario.foto, null);
    assert.equal((await fetch(`${base}${otra.usuario.foto}`)).status, 404);
  });

  it('rechaza lo que no es una imagen real, es muy pequeño o no tiene sesión', async () => {
    const { token } = await registrar();
    assert.equal((await api('POST', '/api/auth/yo/foto', { imagen: 'hola' }, token)).status, 400);
    const falsa = `data:image/png;base64,${Buffer.from('<script>alert(1)</script>').toString('base64')}`;
    assert.equal((await api('POST', '/api/auth/yo/foto', { imagen: falsa }, token)).status, 400);
    assert.equal((await api('POST', '/api/auth/yo/foto', { imagen: await imagenDataUrl(20, 20) }, token)).status, 400);
    assert.equal((await api('POST', '/api/auth/yo/foto', { imagen: await imagenDataUrl() })).status, 401);
    const svg = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64')}`;
    assert.equal((await api('POST', '/api/auth/yo/foto', { imagen: svg }, token)).status, 400);
  });

  it('fotos de garaje: hasta 6, principal, borrar y solo el dueño', async () => {
    const dueno = await registrar('propietario');
    const otro = await registrar('propietario');
    const g = await crearGaraje(dueno.token);
    const ruta = `/api/propietario/garajes/${g.id_garaje}/fotos`;

    assert.equal((await api('POST', ruta, { imagen: await imagenDataUrl() }, otro.token)).status, 404);
    const a = await api('POST', ruta, { imagen: await imagenDataUrl(1600, 1200) }, dueno.token);
    assert.equal(a.status, 201);
    const meta = await sharp(path.join(process.env.UPLOADS_DIR, path.basename(a.fotos[0].url))).metadata();
    assert.ok(meta.width <= 1280 && meta.height <= 1280, 'se reduce a 1280 px');
    const b = await api('POST', ruta, { imagen: await imagenDataUrl(640, 480, 'webp') }, dueno.token);
    assert.equal(b.fotos.length, 2);

    // la segunda pasa a ser la principal y se ve en la búsqueda y en el detalle público
    const principal = await api('POST', `${ruta}/${b.fotos[1].id_foto}/principal`, null, dueno.token);
    assert.equal(principal.fotos[0].id_foto, b.fotos[1].id_foto);
    const lista = await api('GET', '/api/garajes?q=Garaje de prueba');
    assert.equal(lista.garajes.find((x) => x.id_garaje === g.id_garaje).foto, principal.fotos[0].url);
    const detalle = await api('GET', `/api/garajes/${g.id_garaje}`);
    assert.equal(detalle.garaje.fotos.length, 2);

    for (let i = 0; i < 4; i++) assert.equal((await api('POST', ruta, { imagen: await imagenDataUrl(200, 200) }, dueno.token)).status, 201);
    assert.equal((await api('POST', ruta, { imagen: await imagenDataUrl() }, dueno.token)).status, 409); // máximo 6

    assert.equal((await api('DELETE', `${ruta}/${b.fotos[1].id_foto}`, null, otro.token)).status, 404);
    const borrada = await api('DELETE', `${ruta}/${b.fotos[1].id_foto}`, null, dueno.token);
    assert.equal(borrada.fotos.length, 5);
    assert.ok(!fs.existsSync(path.join(process.env.UPLOADS_DIR, path.basename(b.fotos[1].url))));
  });
});

describe('chat de la reserva', () => {
  it('solo conversan conductor y propietario, con avisos y mensajes sin leer', async () => {
    const dueno = await registrar('propietario');
    const cond = await registrar('conductor');
    const intruso = await registrar('conductor');
    const g = await crearGaraje(dueno.token);
    const r = await reservar(cond.token, g.id_garaje);
    assert.equal(r.status, 201, JSON.stringify(r));
    const id = r.reserva.id_reserva;
    assert.equal(r.reserva.puede_chatear, true);

    assert.equal((await api('GET', `/api/reservas/${id}/mensajes`, null, intruso.token)).status, 404);
    assert.equal((await api('POST', `/api/reservas/${id}/mensajes`, { texto: 'hola' }, intruso.token)).status, 404);
    assert.equal((await api('GET', `/api/reservas/${id}/mensajes`)).status, 401);

    assert.equal((await api('POST', `/api/reservas/${id}/mensajes`, { texto: '   ' }, cond.token)).status, 400);
    assert.equal((await api('POST', `/api/reservas/${id}/mensajes`, { texto: 'x'.repeat(501) }, cond.token)).status, 400);
    const m1 = await api('POST', `/api/reservas/${id}/mensajes`, { texto: '¿Hay espacio para una camioneta?' }, cond.token);
    assert.equal(m1.status, 201);
    assert.equal(m1.mensaje.mio, true);
    await api('POST', `/api/reservas/${id}/mensajes`, { texto: 'Y el portón, ¿es automático?' }, cond.token);

    // el propietario ve 2 sin leer, una sola notificación de mensaje y, al abrir, queda al día
    const antes = await api('GET', `/api/propietario/reservas`, null, dueno.token);
    assert.equal(antes.reservas.find((x) => x.id_reserva === id).mensajes_sin_leer, 2);
    const avisos = await api('GET', '/api/notificaciones', null, dueno.token);
    assert.equal(avisos.notificaciones.filter((x) => x.tipo === 'mensaje').length, 1);

    const hilo = await api('GET', `/api/reservas/${id}/mensajes`, null, dueno.token);
    assert.equal(hilo.mensajes.length, 2);
    assert.equal(hilo.mensajes[0].mio, false);
    assert.equal(hilo.puede_escribir, true);
    const despues = await api('GET', `/api/propietario/reservas`, null, dueno.token);
    assert.equal(despues.reservas.find((x) => x.id_reserva === id).mensajes_sin_leer, 0);

    const resp = await api('POST', `/api/reservas/${id}/mensajes`, { texto: 'Sí, cabe sin problema.' }, dueno.token);
    assert.equal(resp.status, 201);
    const mias = await api('GET', `/api/reservas/${id}`, null, cond.token);
    assert.equal(mias.reserva.mensajes_sin_leer, 1);
    const nuevos = await api('GET', `/api/reservas/${id}/mensajes?despues=${hilo.mensajes.at(-1).id_mensaje}`, null, cond.token);
    assert.deepEqual(nuevos.mensajes.map((x) => x.texto), ['Sí, cabe sin problema.']);
  });

  it('se cierra cuando la reserva se rechaza o se cancela', async () => {
    const dueno = await registrar('propietario');
    const cond = await registrar('conductor');
    const g = await crearGaraje(dueno.token);
    const r = await reservar(cond.token, g.id_garaje);
    const id = r.reserva.id_reserva;
    assert.equal((await api('POST', `/api/reservas/${id}/responder`, { accion: 'rechazar', motivo: 'No disponible' }, dueno.token)).status, 200);
    const hilo = await api('GET', `/api/reservas/${id}/mensajes`, null, cond.token);
    assert.equal(hilo.puede_escribir, false);
    assert.equal((await api('POST', `/api/reservas/${id}/mensajes`, { texto: 'hola' }, cond.token)).status, 409);
  });
});

describe('asistente: interpretación en español', () => {
  const hoy = '2026-11-06'; // viernes
  const ver = (txt, vocabulario = ['Chapinero', 'Usaquén', 'Zona T']) => interpretarLocal(txt, { vocabulario, hoy });

  it('entiende vehículo, lugar, día, horas y precio', () => {
    const r = ver('Busco parqueadero para moto en Chapinero mañana de 8 a 12 por menos de 5 mil');
    assert.deepEqual(
      [r.vehiculo, r.q, r.fecha, r.desde, r.hasta, r.precio_max],
      ['moto', 'Chapinero', '2026-11-07', '08:00', '12:00', 5000],
    );
  });

  it('resuelve la tarde (de 2 a 5 = 14:00–17:00), la duración y los días de la semana', () => {
    const a = ver('carro hoy a las 3 pm por 2 horas');
    assert.deepEqual([a.fecha, a.desde, a.hasta], ['2026-11-06', '15:00', '17:00']);
    const b = ver('el 15 de diciembre de 2 a 5');
    assert.deepEqual([b.fecha, b.desde, b.hasta], ['2026-12-15', '14:00', '17:00']);
    const c = ver('garaje el lunes por la tarde');
    assert.deepEqual([c.fecha, c.desde, c.hasta], ['2026-11-09', '14:00', '18:00']);
    const d = ver('el viernes'); // hoy es viernes: se entiende el próximo
    assert.equal(d.fecha, '2026-11-13');
  });

  it('«por la mañana» no es «mañana» y «de 8 hasta 12» no es un precio', () => {
    const a = ver('hoy por la mañana');
    assert.deepEqual([a.fecha, a.desde, a.hasta], ['2026-11-06', '08:00', '12:00']);
    const b = ver('hoy de 8 hasta 12');
    assert.equal(b.precio_max, undefined);
    assert.deepEqual([b.desde, b.hasta], ['08:00', '12:00']);
    assert.equal(ver('hasta 6000 pesos').precio_max, 6000);
    assert.equal(ver('máximo $4.500').precio_max, 4500);
    assert.equal(ver('lo más barato').orden, 'precio');
    assert.equal(ver('cerca de mí').cerca_de_mi, true);
  });
});

describe('asistente: API', () => {
  const pregunta = (mensaje, token, extra = {}) => api('POST', '/api/asistente', { mensaje, ...extra }, token);

  it('busca garajes reales con los filtros entendidos y recuerda la conversación', async () => {
    const dueno = await registrar('propietario');
    await crearGaraje(dueno.token, { nombre: 'Cupo Moto Barato', barrio: 'Chapinero', tipo_vehiculo: 'moto', tarifa_hora: 2000 });
    await crearGaraje(dueno.token, { nombre: 'Garaje Caro', barrio: 'Chapinero', tipo_vehiculo: 'ambos', tarifa_hora: 9000 });

    const r = await pregunta('moto en Chapinero mañana de 8 a 12');
    assert.equal(r.status, 200, JSON.stringify(r));
    assert.equal(r.motor, 'local'); // el «modelo» simulado falló y el intérprete local respondió
    assert.ok(r.total >= 2);
    assert.equal(r.garajes[0].nombre, 'Cupo Moto Barato'); // el más barato primero
    assert.equal(r.garajes[0].costo_estimado, 8000);
    assert.match(r.respuesta, /Encontré/);
    assert.match(r.garajes[0].enlace, /^\/garaje\/\d+\?fecha=\d{4}-\d{2}-\d{2}&desde=08%3A00&hasta=12%3A00&vehiculo=moto$/);
    assert.match(r.enlace, /donde=Chapinero/);

    // seguimiento: «solo hasta 3 mil» conserva moto, Chapinero y horario
    const s = await pregunta('solo hasta 3 mil', undefined, { contexto: r.contexto });
    assert.equal(s.contexto.vehiculo, 'moto');
    assert.equal(s.contexto.q, 'Chapinero');
    assert.equal(s.contexto.precio_max, 3000);
    assert.deepEqual(s.garajes.map((g) => g.nombre), ['Cupo Moto Barato']);
  });

  it('explica cuando no hay resultados, cuando la hora ya pasó y cuando falta la ubicación', async () => {
    const sinNada = await pregunta('moto en Chapinero mañana de 8 a 12 por menos de 500');
    assert.equal(sinNada.total, 0);
    assert.match(sinNada.respuesta, /No encontré/);
    const pasada = await pregunta('moto hoy a las 12 am por 1 hora');
    assert.match(pasada.respuesta, /ya pasó|No pude buscar/);
    const cerca = await pregunta('parqueadero cerca de mí');
    assert.equal(cerca.pedirUbicacion, true);
    const conUbi = await pregunta('parqueadero cerca de mí', undefined, { ubicacion: { lat: 4.6486, lng: -74.0628 } });
    assert.ok(conUbi.total >= 1 && conUbi.garajes[0].distancia_km !== null);
  });

  it('responde preguntas frecuentes, saluda y no inventa lo que no sabe', async () => {
    assert.match((await pregunta('¿Cómo cancelo una reserva?')).respuesta, /Cancelar/);
    assert.match((await pregunta('¿Los pagos son reales?')).respuesta, /simulados/);
    assert.match((await pregunta('hola')).respuesta, /asistente de ParkSpotter/);
    const nada = await pregunta('cuál es la capital de Francia');
    assert.match(nada.respuesta, /No estoy seguro/);
    assert.ok(nada.sugerencias.length >= 3);
    assert.equal((await pregunta('')).status, 400);
  });

  it('muestra «mis reservas» solo con sesión', async () => {
    const anonimo = await pregunta('muéstrame mis reservas');
    assert.equal(anonimo.accion.tipo, 'login');
    const dueno = await registrar('propietario');
    const cond = await registrar('conductor');
    const g = await crearGaraje(dueno.token);
    assert.equal((await reservar(cond.token, g.id_garaje)).status, 201);
    const mias = await pregunta('mis reservas', cond.token);
    assert.equal(mias.reservas.length, 1);
    assert.match(mias.respuesta, /Tienes 1 reserva/);
  });

  it('usa el modelo de lenguaje cuando está configurado y valida lo que devuelve', async () => {
    const antes = llamadasModelo;
    const r = await pregunta('MODELO busca algo');
    assert.ok(llamadasModelo > antes);
    assert.equal(r.motor, 'modelo');
    // el modelo dijo año 2999: la fecha es válida y futura, pero no hay horarios cargados ese día → se explica sin romper
    assert.equal(r.status, 200);
    assert.ok(r.respuesta.length > 10);
  });
});
