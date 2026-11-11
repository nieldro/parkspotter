// Dónde viven los archivos (fotos). Con Supabase configurado van al «Storage» (un bucket público propio de la app),
// así no dependen del disco del servidor, que en la nube gratuita se borra al reiniciar. Sin Supabase, a la carpeta local.
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { HttpError } from './http.js';

const BUCKET = config.supabase.bucket;
export const almacenEnNube = () => Boolean(config.supabase.url && config.supabase.serviceKey);

const cab = () => ({ apikey: config.supabase.serviceKey, authorization: `Bearer ${config.supabase.serviceKey}` });
const base = () => `${config.supabase.url}/storage/v1`;

/** Dirección pública de un archivo guardado. */
export function urlPublica(archivo) {
  if (!archivo) return null;
  return almacenEnNube() ? `${base()}/object/public/${BUCKET}/${archivo}` : `/uploads/${archivo}`;
}

let bucketListo = null;
/** Crea el bucket la primera vez (si ya existe, no pasa nada). */
function asegurarBucket() {
  bucketListo ??= (async () => {
    const r = await fetch(`${base()}/bucket`, {
      method: 'POST',
      headers: { ...cab(), 'content-type': 'application/json' },
      body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true, file_size_limit: 5 * 1024 * 1024, allowed_mime_types: ['image/jpeg'] }),
      signal: AbortSignal.timeout(15_000),
    });
    if (r.ok || r.status === 409) return;
    const d = await r.json().catch(() => ({}));
    if (/already exists|Duplicate/i.test(`${d.message ?? ''} ${d.error ?? ''}`)) return;
    throw new Error(`bucket HTTP ${r.status} ${d.message ?? ''}`);
  })().catch((e) => {
    bucketListo = null; // se reintenta en la próxima subida
    throw e;
  });
  return bucketListo;
}

/** Guarda los bytes de un archivo con ese nombre. */
export async function guardarArchivo(nombre, buffer) {
  if (!almacenEnNube()) {
    fs.mkdirSync(config.uploadsDir, { recursive: true });
    await fs.promises.writeFile(path.join(config.uploadsDir, nombre), buffer);
    return;
  }
  try {
    await asegurarBucket();
    const r = await fetch(`${base()}/object/${BUCKET}/${nombre}`, {
      method: 'POST',
      headers: { ...cab(), 'content-type': 'image/jpeg', 'cache-control': 'max-age=31536000' },
      body: buffer,
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status} ${(await r.text().catch(() => '')).slice(0, 120)}`);
  } catch (e) {
    console.error('No se pudo guardar el archivo en Supabase Storage:', String(e.message).slice(0, 200));
    throw new HttpError(503, 'No pudimos guardar la foto en este momento. Inténtalo de nuevo en un momento.');
  }
}

/** Borra un archivo; un fallo aquí nunca debe tumbar la operación que lo pidió. */
export async function quitarArchivo(nombre) {
  try {
    if (!almacenEnNube()) return await fs.promises.rm(path.join(config.uploadsDir, nombre), { force: true });
    await fetch(`${base()}/object/${BUCKET}/${nombre}`, { method: 'DELETE', headers: cab(), signal: AbortSignal.timeout(15_000) });
  } catch {
    /* queda huérfano: no afecta a nadie */
  }
}
