// Completa los datos de DEMOSTRACIÓN: ilustraciones de garajes y avatares generadas con sharp (no son fotos
// reales de nadie) y datos personales de las cuentas demo. Es idempotente: no toca lo que ya tiene foto.
import crypto from 'node:crypto';
import sharp from 'sharp';
import { all, completarCodigos, run } from './db.js';
import { guardarArchivo } from './lib/almacen.js';

const hsl = (h, s, l) => `hsl(${h % 360} ${s}% ${l}%)`;

function svgGaraje(indice, variante) {
  const h = (indice * 47 + variante * 23) % 360;
  const pared = hsl(h, 28, 78);
  const techo = hsl(h + 12, 35, 36);
  const puerta = hsl(h + 200, 12, 70);
  const carro = hsl(h + 150, 55, 45);
  const carroSvg =
    variante === 1
      ? `<g transform="translate(390 520)">
           <rect x="0" y="60" width="500" height="110" rx="34" fill="${carro}"/>
           <path d="M80 62 L150 0 H360 L430 62 Z" fill="${carro}"/>
           <path d="M120 58 L168 14 H255 V58 Z M270 58 V14 H345 L392 58 Z" fill="#cfe8ff"/>
           <circle cx="120" cy="172" r="42" fill="#222"/><circle cx="120" cy="172" r="18" fill="#bbb"/>
           <circle cx="380" cy="172" r="42" fill="#222"/><circle cx="380" cy="172" r="18" fill="#bbb"/>
         </g>`
      : '';
  const tablillas = Array.from({ length: 7 }, (_, i) => `<rect x="300" y="${330 + i * 40}" width="680" height="6" fill="${hsl(h + 200, 10, 58)}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800" viewBox="0 0 1280 800">
    <defs><linearGradient id="c" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${hsl(h + 190, 70, 82)}"/><stop offset="1" stop-color="${hsl(h + 190, 60, 94)}"/></linearGradient></defs>
    <rect width="1280" height="800" fill="url(#c)"/>
    <circle cx="1060" cy="150" r="64" fill="#fff6c9" opacity="0.9"/>
    <rect y="640" width="1280" height="160" fill="${hsl(h, 8, 46)}"/>
    <rect y="636" width="1280" height="10" fill="${hsl(h, 8, 60)}"/>
    <rect x="230" y="210" width="820" height="430" fill="${pared}"/>
    <path d="M190 220 L640 80 L1090 220 Z" fill="${techo}"/>
    <rect x="300" y="310" width="680" height="330" rx="6" fill="${puerta}"/>
    ${tablillas}
    <rect x="1000" y="330" width="40" height="120" rx="6" fill="${hsl(h + 30, 40, 40)}" opacity="0.0"/>
    ${carroSvg}
    <rect x="250" y="520" width="26" height="120" fill="${hsl(h + 100, 40, 38)}"/>
    <circle cx="263" cy="500" r="52" fill="${hsl(h + 100, 45, 42)}"/>
  </svg>`;
}

function svgAvatar(indice) {
  const h = (indice * 61 + 200) % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
    <rect width="400" height="400" fill="${hsl(h, 55, 52)}"/>
    <circle cx="200" cy="158" r="74" fill="#fff" opacity="0.92"/>
    <path d="M60 400 C60 290 130 250 200 250 C270 250 340 290 340 400 Z" fill="#fff" opacity="0.92"/>
  </svg>`;
}

async function guardar(svg) {
  const archivo = `demo-${crypto.randomBytes(8).toString('hex')}.jpg`;
  await guardarArchivo(archivo, await sharp(Buffer.from(svg)).jpeg({ quality: 84 }).toBuffer()); // disco local o Supabase Storage
  return archivo;
}

export async function completarDemo(db) {
  // Los archivos de demostración usan el prefijo «demo-» (borrarImagen solo toca los que sube la app).
  const sinFoto = await all(
    db,
    `SELECT g.id_garaje FROM garaje g
      WHERE g.descripcion LIKE '%(Dato de demostración)%' AND NOT EXISTS (SELECT 1 FROM garaje_foto f WHERE f.id_garaje = g.id_garaje)
      ORDER BY g.id_garaje`,
  );
  let fotos = 0;
  for (const [i, g] of sinFoto.entries()) {
    for (const variante of [1, 0]) {
      await run(db, 'INSERT INTO garaje_foto (id_garaje, archivo, orden) VALUES (?, ?, ?)', [
        g.id_garaje,
        await guardar(svgGaraje(i, variante)),
        variante === 1 ? 0 : 1,
      ]);
      fotos += 1;
    }
  }

  // Servicios de los garajes demo (en el mismo orden en que los crea el seed).
  const SERVICIOS_DEMO = [
    'cubierto,porton_electrico,vigilancia', 'vigilancia,camaras', 'cubierto', 'cubierto,vigilancia,camaras,cargador_ev',
    'cubierto', 'vigilancia,camaras', 'cubierto,cargador_ev', 'abierto_24h,vigilancia,techo_alto',
    'cubierto,vigilancia', 'cubierto', 'porton_electrico,camaras', 'cubierto,techo_alto',
  ];
  const sinServicios = await all(
    db,
    "SELECT id_garaje FROM garaje WHERE descripcion LIKE '%(Dato de demostración)%' AND servicios IS NULL ORDER BY id_garaje",
  );
  for (const [i, g] of sinServicios.entries()) {
    await run(db, 'UPDATE garaje SET servicios = ? WHERE id_garaje = ?', [SERVICIOS_DEMO[i % SERVICIOS_DEMO.length], g.id_garaje]);
  }

  const demos = await all(
    db,
    "SELECT id_usuario, correo, foto FROM usuario WHERE correo LIKE '%@parkspotter.test' AND foto IS NULL ORDER BY id_usuario",
  );
  for (const [i, u] of demos.entries()) {
    await run(db, 'UPDATE usuario SET foto = ? WHERE id_usuario = ?', [await guardar(svgAvatar(i)), u.id_usuario]);
  }

  await completarCodigos(); // las reservas que inserta el seed no traen código propio

  // Datos personales de las cuentas demo (para ver el perfil completo y la reserva con vehículo prellenado).
  await run(db, "UPDATE usuario SET fecha_nacimiento = '1992-08-14' WHERE correo LIKE '%@parkspotter.test' AND fecha_nacimiento IS NULL");
  await run(
    db,
    `UPDATE usuario SET vehiculo_tipo = 'carro', vehiculo_placa = 'MNO345', vehiculo_detalle = 'Mazda 2 gris'
      WHERE correo = 'conductor@parkspotter.test' AND vehiculo_tipo IS NULL`,
  );
  return { fotos, avatares: demos.length };
}
