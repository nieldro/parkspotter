import { z } from 'zod';

z.config(z.locales.es());

export class HttpError extends Error {
  /** `extra` se agrega al JSON de la respuesta (p. ej. { codigo: 'correo_sin_verificar' }) para que la app decida qué mostrar. */
  constructor(status, mensaje, extra) {
    super(mensaje);
    this.status = status;
    this.extra = extra;
  }
}

export const noEncontrado = (que = 'Recurso') => new HttpError(404, `${que} no encontrado.`);
export const prohibido = (m = 'No tienes permiso para hacer esto.') => new HttpError(403, m);
export const conflicto = (m) => new HttpError(409, m);

/** Valida con zod y lanza un 400 con un mensaje legible en español. */
export function validar(esquema, datos) {
  const r = esquema.safeParse(datos ?? {});
  if (r.success) return r.data;
  const i = r.error.issues[0];
  const campo = i.path.length ? `${i.path.join('.')}: ` : '';
  throw new HttpError(400, `${campo}${i.message}`);
}

export function idDeParametro(valor) {
  const n = Number(valor);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'Identificador inválido.');
  return n;
}
