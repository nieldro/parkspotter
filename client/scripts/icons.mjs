// Genera los íconos PNG de la app (PWA, iOS) a partir de public/favicon.svg.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const pub = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const svg = fs.readFileSync(path.join(pub, 'favicon.svg'));

const salidas = [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
];
for (const [nombre, tam] of salidas) {
  await sharp(svg, { density: 384 }).resize(tam, tam).png().toFile(path.join(pub, nombre));
}

// Ícono "maskable": Android lo recorta en círculo/gota, así que el dibujo va dentro del 80 % central.
const interior = await sharp(svg, { density: 384 }).resize(410, 410).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: '#0b5fff' } })
  .composite([{ input: interior, gravity: 'center' }])
  .png()
  .toFile(path.join(pub, 'icon-maskable-512.png'));

console.log('Íconos generados en client/public');
