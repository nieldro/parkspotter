import { all } from '../db.js';

/** Identificadores de los garajes (entre `ids`) que el propietario bloqueó para ese día de Bogotá. */
export async function bloqueadosEn(ex, ids, fecha) {
  if (!ids.length) return new Set();
  const filas = await all(
    ex,
    `SELECT id_garaje FROM bloqueo WHERE fecha = ? AND id_garaje IN (${ids.map(() => '?').join(',')})`,
    [fecha, ...ids],
  );
  return new Set(filas.map((f) => f.id_garaje));
}
