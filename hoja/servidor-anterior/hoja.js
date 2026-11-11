// Persistencia en una Hoja de cálculo de Google (a través de un Apps Script publicado como web app).
// El servidor trabaja sobre una copia SQLite temporal y la Hoja es la fuente de verdad:
//   · al arrancar se lee cada pestaña de la Hoja y se carga en la copia;
//   · cada escritura marca su tabla como «sucia» y, con una pequeña espera, se reescribe esa pestaña.
// Solo debe haber UNA instancia del servidor (dos instancias se pisarían las pestañas).
import { config } from './config.js';

export const TABLAS = ['usuario', 'propietario', 'garaje', 'disponibilidad', 'reserva', 'pago', 'calificacion', 'notificacion', 'garaje_foto', 'mensaje', 'favorito', 'bloqueo', 'reporte'];

const ESPERA_MS = 1500;
const sucias = new Set();
let temporizador = null;
let enCurso = null;
let consultar = null; // función (sql) => filas; la registra db.js

export const hojaActiva = () => Boolean(config.hojaUrl);

async function llamar(cuerpo) {
  const resp = await fetch(config.hojaUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // evita el preflight; Apps Script lee el texto
    body: JSON.stringify({ token: config.hojaToken, ...cuerpo }),
    redirect: 'follow',
    signal: AbortSignal.timeout(60_000),
  });
  const texto = await resp.text();
  let datos;
  try {
    datos = JSON.parse(texto);
  } catch {
    throw new Error(`La Hoja no respondió JSON (¿la web app está publicada para «Cualquier persona»?): ${texto.slice(0, 120)}`);
  }
  if (!datos.ok) throw new Error(`La Hoja rechazó la petición: ${datos.error ?? 'error desconocido'}`);
  return datos;
}

// Lee todas las pestañas: { tabla: { columnas: [...], filas: [[...]] } }
export async function leerHoja() {
  return (await llamar({ accion: 'leer' })).tablas ?? {};
}

export function registrarLector(fn) {
  consultar = fn;
}

export function marcarSucia(tablas) {
  if (!hojaActiva()) return;
  for (const t of tablas) sucias.add(t);
  if (!temporizador) temporizador = setTimeout(() => void vaciar().catch(() => {}), ESPERA_MS);
}

export function marcarTodas() {
  marcarSucia(TABLAS);
}

async function vaciarUna() {
  while (sucias.size) {
    const tabla = [...sucias][0];
    sucias.delete(tabla);
    try {
      const { columnas, filas } = await consultar(tabla);
      const texto = filas.map((f) => f.map((v) => (v === null || v === undefined ? '' : String(v))));
      await llamar({ accion: 'escribir', tabla, columnas, filas: texto });
    } catch (e) {
      sucias.add(tabla);
      throw e;
    }
  }
}

// Escribe en la Hoja las pestañas pendientes. Una sola escritura a la vez; si algo falla, reintenta.
export async function vaciar() {
  if (!hojaActiva()) return;
  clearTimeout(temporizador);
  temporizador = null;
  if (enCurso) return enCurso.then(() => (sucias.size ? vaciar() : undefined));
  enCurso = vaciarUna()
    .catch((e) => {
      console.error(`No se pudo escribir en la Hoja (se reintenta en 10 s): ${e.message}`);
      temporizador = setTimeout(() => void vaciar().catch(() => {}), 10_000);
    })
    .finally(() => {
      enCurso = null;
    });
  await enCurso;
  if (sucias.size && !temporizador) temporizador = setTimeout(() => void vaciar().catch(() => {}), ESPERA_MS);
}

export function pendientes() {
  return sucias.size;
}
