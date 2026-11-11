// Fotos subidas: llegan como data URL (el cliente ya las reduce), se validan por contenido real,
// se re-codifican con sharp (quita metadatos/GPS y cualquier carga maliciosa) y se guardan en disco.
import crypto from 'node:crypto';
import sharp from 'sharp';
import { guardarArchivo, quitarArchivo, urlPublica } from './almacen.js';
import { HttpError } from './http.js';

const MAX_BYTES = 5 * 1024 * 1024;
const FORMATOS = new Set(['jpeg', 'png', 'webp']);
const NOMBRE_VALIDO = /^[a-z]+-[a-f0-9]{16}\.jpg$/;

export const urlDeImagen = urlPublica;

/** @param {'avatar'|'garaje'} tipo avatar = cuadrado 400 px; garaje = hasta 1280 px de lado */
export async function guardarImagen(dataUrl, tipo) {
  const m = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl ?? ''));
  if (!m) throw new HttpError(400, 'La imagen debe ser JPG, PNG o WebP.');
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > MAX_BYTES) throw new HttpError(413, 'La imagen pesa más de 5 MB.');

  let canal = sharp(buf, { limitInputPixels: 40e6, failOn: 'error' });
  try {
    const meta = await canal.metadata();
    if (!FORMATOS.has(meta.format)) throw new Error('formato');
    if (!meta.width || !meta.height || meta.width < 64 || meta.height < 64) {
      throw new HttpError(400, 'La imagen es demasiado pequeña (mínimo 64 × 64 px).');
    }
    canal = canal.rotate(); // respeta la orientación de la cámara y luego se descartan los metadatos
    canal =
      tipo === 'avatar'
        ? canal.resize(400, 400, { fit: 'cover', position: 'attention' })
        : canal.resize(1280, 1280, { fit: 'inside', withoutEnlargement: true });
    const salida = await canal.flatten({ background: '#ffffff' }).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
    const archivo = `${tipo}-${crypto.randomBytes(8).toString('hex')}.jpg`;
    await guardarArchivo(archivo, salida);
    return archivo;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, 'No pudimos leer esa imagen. Prueba con otra foto.');
  }
}

export async function borrarImagen(archivo) {
  if (!archivo || !NOMBRE_VALIDO.test(archivo)) return; // nunca se borra nada fuera de la carpeta de fotos
  await quitarArchivo(archivo);
}
