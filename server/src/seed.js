// Datos de DEMOSTRACIÓN para que la app no salga vacía. Los garajes, direcciones y personas son
// ficticios (las coordenadas solo ubican barrios reales de Bogotá). No lo ejecutes sobre una
// base con datos reales: si ya existe el administrador, no hace nada.
import { cerrarDb, getDb, initSchema, one, run } from './db.js';
import { completarDemo } from './demo-fotos.js';
import { hashContrasena } from './lib/auth.js';
import { aUtc, hoyBogota } from './lib/tiempo.js';

await initSchema();
const db = getDb();

if (await one(db, "SELECT 1 AS x FROM usuario WHERE tipo_usuario = 'admin'")) {
  console.log('La base ya tiene datos (existe un administrador). No se siembra nada.');
  await cerrarDb();
  process.exit(0);
}

const CLAVE_DEMO = 'Demo2026!';
const CLAVE_ADMIN = process.env.ADMIN_PASSWORD || 'Admin2026!';

async function crearUsuario(nombre, apellido, correo, clave, tipo, telefono, documento) {
  const r = await run(
    db,
    'INSERT INTO usuario (nombre, apellido, correo, contrasena, telefono, tipo_usuario) VALUES (?, ?, ?, ?, ?, ?)',
    [nombre, apellido, correo, await hashContrasena(clave), telefono, tipo],
  );
  const id = Number(r.lastInsertRowid);
  let idPropietario = null;
  if (documento) {
    const p = await run(db, 'INSERT INTO propietario (id_usuario, tipo_documento, numero_documento) VALUES (?, ?, ?)', [
      id,
      'CC',
      documento,
    ]);
    idPropietario = Number(p.lastInsertRowid);
  }
  return { id, idPropietario };
}

await crearUsuario('Admin', 'ParkSpotter', 'admin@parkspotter.test', CLAVE_ADMIN, 'admin', null, null);
const laura = await crearUsuario('Laura', 'Moreno', 'propietario@parkspotter.test', CLAVE_DEMO, 'propietario', '3001234567', '1010101010');
const camilo = await crearUsuario('Camilo', 'Rojas', 'camilo@parkspotter.test', CLAVE_DEMO, 'propietario', '3009876543', '1020202020');
const daniel = await crearUsuario('Daniel', 'Conductor', 'conductor@parkspotter.test', CLAVE_DEMO, 'conductor', '3101112233', null);
const sofia = await crearUsuario('Sofía', 'Vargas', 'sofia@parkspotter.test', CLAVE_DEMO, 'conductor', '3104445566', null);
const mateo = await crearUsuario('Mateo', 'Herrera', 'mateo@parkspotter.test', CLAVE_DEMO, 'conductor', '3107778899', null);

const SEMANA = [1, 2, 3, 4, 5];
const FIN_SEMANA = [6, 7];
const TODOS = [1, 2, 3, 4, 5, 6, 7];

// [dueño, nombre, dirección, barrio, localidad, lat, lng, tarifa, cupos, vehículo, descripción, acceso, ventanas]
const GARAJES = [
  [laura, 'Garaje cerca de la Javeriana', 'Cra. 7 # 40-30 (demo)', 'La Magdalena', 'Chapinero', 4.6286, -74.0644, 4500, 2, 'ambos', 'Garaje cubierto, portón eléctrico y vigilancia del conjunto.', 'Llama al llegar; el portón abre con control remoto. Piso -1.', [[SEMANA, '06:00', '20:00'], [FIN_SEMANA, '08:00', '14:00']]],
  [laura, 'Cupo en Zona T', 'Cl. 82 # 12-10 (demo)', 'Zona T', 'Chapinero', 4.6678, -74.0537, 7000, 1, 'carro', 'Cupo sencillo y amplio, ideal para camionetas medianas.', 'Entrada por la calle trasera, portón negro.', [[TODOS, '07:00', '23:00']]],
  [laura, 'Garaje para moto en Chapinero', 'Cl. 57 # 9-25 (demo)', 'Chapinero Central', 'Chapinero', 4.6486, -74.0628, 2000, 4, 'moto', 'Espacio techado para motos, con anclaje.', 'Pregunta por Laura en portería.', [[TODOS, '00:00', '24:00']]],
  [camilo, 'Parqueadero en el Parque 93', 'Cl. 93A # 13-40 (demo)', 'El Chicó', 'Chapinero', 4.6762, -74.0486, 8000, 2, 'carro', 'Dos cupos seguidos en edificio residencial, cerca de restaurantes.', 'Timbre del apartamento 101.', [[SEMANA, '08:00', '22:00'], [FIN_SEMANA, '10:00', '20:00']]],
  [camilo, 'Garaje junto a la Universidad Nacional', 'Cl. 45 # 30-20 (demo)', 'Teusaquillo', 'Teusaquillo', 4.6382, -74.084, 3000, 3, 'ambos', 'A pocas cuadras de la universidad. Buen precio para el día completo.', 'Portón azul, llamar al 3009876543.', [[SEMANA, '05:30', '22:00']]],
  [camilo, 'Cupo en el Centro Internacional', 'Cra. 10 # 28-40 (demo)', 'Centro Internacional', 'Santa Fe', 4.6155, -74.07, 5000, 2, 'ambos', 'Cerca de la Torre Colpatria y del TransMilenio.', 'Acceso por la carrera 10, puerta metálica.', [[SEMANA, '06:00', '19:00']]],
  [laura, 'Garaje en Usaquén', 'Cra. 6 # 119-30 (demo)', 'Usaquén', 'Usaquén', 4.711, -74.03, 6000, 1, 'carro', 'Cupo cubierto a una cuadra del parque de Usaquén y su mercado.', 'Citófono: Laura.', [[FIN_SEMANA, '09:00', '22:00'], [[5], '17:00', '23:30']]],
  [camilo, 'Parqueadero cerca de Corferias', 'Cra. 37 # 24-67 (demo)', 'Quinta Paredes', 'Teusaquillo', 4.63, -74.093, 5500, 3, 'ambos', 'Útil en ferias y eventos: entrada y salida rápidas.', 'Portón gris sobre la carrera 37.', [[TODOS, '06:00', '24:00']]],
  [laura, 'Garaje en Cedritos', 'Cl. 140 # 9-50 (demo)', 'Cedritos', 'Usaquén', 4.726, -74.042, 3500, 2, 'ambos', 'Conjunto residencial tranquilo, cerca del centro comercial.', 'Dile al vigilante que vienes por el garaje de Laura.', [[SEMANA, '07:00', '21:00']]],
  [camilo, 'Cupo en La Candelaria', 'Cl. 11 # 3-15 (demo)', 'La Candelaria', 'La Candelaria', 4.598, -74.076, 4000, 1, 'moto', 'Cupo para moto en casa antigua restaurada, cerca de museos.', 'Zaguán de madera, golpea fuerte.', [[TODOS, '08:00', '20:00']]],
  [laura, 'Garaje en el Salitre', 'Av. Cl. 26 # 68C-50 (demo)', 'Salitre', 'Fontibón', 4.65, -74.1, 4200, 2, 'carro', 'Cerca de Compensar y del Parque Simón Bolívar.', 'Torre B, sótano 1.', [[SEMANA, '06:00', '20:00'], [[6], '08:00', '18:00']]],
  [camilo, 'Garaje cerca a los Andes', 'Cl. 19 # 3-30 (demo)', 'Las Aguas', 'La Candelaria', 4.6015, -74.0655, 4800, 2, 'ambos', 'A 5 minutos a pie del campus. Cupo con techo.', 'Pulsa el timbre del local 2.', [[SEMANA, '06:00', '21:00']]],
];

const ids = [];
for (const [dueno, nombre, direccion, barrio, localidad, lat, lng, tarifa, cupos, vehiculo, descripcion, acceso, ventanas] of GARAJES) {
  const r = await run(
    db,
    `INSERT INTO garaje (id_propietario, nombre, direccion, barrio, localidad, latitud, longitud, tarifa_hora,
                         capacidad_total, tipo_vehiculo, descripcion, instrucciones_acceso)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [dueno.idPropietario, nombre, direccion, barrio, localidad, lat, lng, tarifa, cupos, vehiculo, `${descripcion} (Dato de demostración)`, acceso],
  );
  const id = Number(r.lastInsertRowid);
  ids.push(id);
  for (const [dias, ini, fin] of ventanas) {
    for (const dia of dias) {
      await run(db, 'INSERT INTO disponibilidad (id_garaje, dia_semana, hora_inicio, hora_fin) VALUES (?, ?, ?, ?)', [id, dia, ini, fin]);
    }
  }
}

// Reservas ya terminadas (con calificación) para que haya reseñas, y alguna futura para ver el flujo.
const hoy = hoyBogota();
const sumarDias = (n) => new Date(Date.parse(`${hoy}T00:00:00Z`) + n * 86400e3).toISOString().slice(0, 10);

async function reserva(usuario, idxGaraje, fecha, ini, fin, estado, placa, vehiculo, metodo, calif) {
  const [, , , , , , , tarifa] = GARAJES[idxGaraje];
  const horas = (Number(fin.slice(0, 2)) * 60 + Number(fin.slice(3)) - Number(ini.slice(0, 2)) * 60 - Number(ini.slice(3))) / 60;
  const costo = Math.round(tarifa * horas);
  const r = await run(
    db,
    `INSERT INTO reserva (id_usuario, id_garaje, fecha_inicio, fecha_fin, estado, costo_total, tipo_vehiculo, placa)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [usuario.id, ids[idxGaraje], aUtc(fecha, ini), aUtc(fecha, fin), estado, costo, vehiculo, placa],
  );
  const id = Number(r.lastInsertRowid);
  await run(db, 'INSERT INTO pago (id_reserva, metodo_pago, monto, estado_pago, fecha_pago, referencia) VALUES (?, ?, ?, ?, ?, ?)', [
    id,
    metodo,
    costo,
    estado === 'confirmada' && metodo !== 'efectivo' ? 'aprobado' : 'pendiente',
    estado === 'confirmada' && metodo !== 'efectivo' ? aUtc(fecha, ini) : null,
    `SIM-DEMO${id}`,
  ]);
  if (calif) {
    await run(db, 'INSERT INTO calificacion (id_reserva, id_usuario, id_garaje, puntuacion, comentario) VALUES (?, ?, ?, ?, ?)', [
      id, usuario.id, ids[idxGaraje], calif[0], calif[1],
    ]);
  }
}

await reserva(sofia, 0, sumarDias(-12), '08:00', '12:00', 'confirmada', 'ABC123', 'carro', 'tarjeta', [5, 'Muy fácil de encontrar y el portón abrió rápido.']);
await reserva(mateo, 0, sumarDias(-8), '09:00', '11:00', 'confirmada', 'DEF456', 'carro', 'pse', [4, 'Buen lugar, un poco estrecho el giro.']);
await reserva(sofia, 4, sumarDias(-6), '07:00', '17:00', 'confirmada', 'ABC123', 'carro', 'pse', [5, 'Perfecto para estudiar todo el día.']);
await reserva(mateo, 1, sumarDias(-5), '19:00', '22:00', 'confirmada', 'GHI789', 'carro', 'tarjeta', [4, 'Cupo amplio. Llegué y estaba todo tal cual.']);
await reserva(daniel, 3, sumarDias(-3), '12:00', '15:00', 'confirmada', 'JKL012', 'carro', 'efectivo', [5, 'Excelente ubicación, trato amable.']);
await reserva(sofia, 7, sumarDias(-2), '10:00', '14:00', 'confirmada', 'ABC123', 'carro', 'tarjeta', [3, 'Estaba bien, pero la salida se demoró.']);

// Una confirmada y una pendiente para el conductor demo, en días laborales futuros.
const manana = sumarDias(1);
const diaSiguienteHabil = [6, 0].includes(new Date(`${manana}T00:00:00Z`).getUTCDay()) ? sumarDias(3) : manana;
await reserva(daniel, 4, diaSiguienteHabil, '08:00', '12:00', 'confirmada', 'MNO345', 'carro', 'tarjeta', null);
await reserva(daniel, 8, diaSiguienteHabil, '14:00', '17:00', 'pendiente', 'MNO345', 'carro', 'pse', null);
await run(db, 'INSERT INTO notificacion (id_usuario, tipo, mensaje) VALUES (?, ?, ?)', [
  laura.id, 'solicitud_nueva', 'Daniel solicitó "Garaje en Cedritos".',
]);

const extra = await completarDemo(db);
console.log(`Datos de demostración creados (${extra.fotos} ilustraciones de garajes, ${extra.avatares} avatares).\n`);
console.log('Cuentas de prueba (clave de las demo: ' + CLAVE_DEMO + '):');
console.log('  Conductor:   conductor@parkspotter.test');
console.log('  Propietaria: propietario@parkspotter.test');
console.log('  Propietario: camilo@parkspotter.test');
console.log('  Admin:       admin@parkspotter.test  (clave: ' + (process.env.ADMIN_PASSWORD ? 'la de ADMIN_PASSWORD' : CLAVE_ADMIN) + ')');
await cerrarDb();
