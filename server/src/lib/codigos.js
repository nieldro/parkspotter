// Códigos de 6 dígitos de un solo uso (verificar correo, restablecer contraseña).
// En la base solo queda un HMAC del código: aunque alguien lea la tabla no puede usarlo.
import crypto from 'node:crypto';
import { config } from '../config.js';
import { one, run } from '../db.js';

const VIGENCIA_MS = 15 * 60 * 1000;
const MAX_INTENTOS = 5;
export const ESPERA_REENVIO_MS = 60 * 1000;

const hashDe = (idUsuario, proposito, codigo) =>
  crypto.createHmac('sha256', config.jwtSecret).update(`${idUsuario}:${proposito}:${codigo}`).digest('hex');

/** Crea (o reemplaza) el código vigente del usuario para ese propósito y lo devuelve en claro, solo para enviarlo. */
export async function crearCodigo(ex, idUsuario, proposito) {
  const codigo = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  await run(
    ex,
    `INSERT INTO codigo_correo (id_usuario, proposito, hash, expira) VALUES (?, ?, ?, ?)
     ON CONFLICT (id_usuario, proposito) DO UPDATE
       SET hash = EXCLUDED.hash, expira = EXCLUDED.expira, intentos = 0, creado = ahora_iso()`,
    [idUsuario, proposito, hashDe(idUsuario, proposito, codigo), new Date(Date.now() + VIGENCIA_MS).toISOString()],
  );
  return codigo;
}

/** ¿Pasó el tiempo mínimo desde el último envío? (evita que alguien llene el buzón de otra persona). */
export async function puedeReenviar(ex, idUsuario, proposito) {
  const f = await one(ex, 'SELECT creado FROM codigo_correo WHERE id_usuario = ? AND proposito = ?', [idUsuario, proposito]);
  return !f || Date.now() - Date.parse(f.creado) >= ESPERA_REENVIO_MS;
}

/** Comprueba el código y lo gasta si es correcto. Vence a los 15 min y se anula tras 5 intentos fallidos. */
export async function consumirCodigo(ex, idUsuario, proposito, codigo) {
  const f = await one(ex, 'SELECT * FROM codigo_correo WHERE id_usuario = ? AND proposito = ?', [idUsuario, proposito]);
  if (!f) return false;
  if (f.expira < new Date().toISOString() || f.intentos >= MAX_INTENTOS) {
    await run(ex, 'DELETE FROM codigo_correo WHERE id_codigo = ?', [f.id_codigo]);
    return false;
  }
  const esperado = Buffer.from(f.hash, 'hex');
  const recibido = Buffer.from(hashDe(idUsuario, proposito, String(codigo)), 'hex');
  if (esperado.length === recibido.length && crypto.timingSafeEqual(esperado, recibido)) {
    await run(ex, 'DELETE FROM codigo_correo WHERE id_codigo = ?', [f.id_codigo]);
    return true;
  }
  if (f.intentos + 1 >= MAX_INTENTOS) await run(ex, 'DELETE FROM codigo_correo WHERE id_codigo = ?', [f.id_codigo]);
  else await run(ex, 'UPDATE codigo_correo SET intentos = intentos + 1 WHERE id_codigo = ?', [f.id_codigo]);
  return false;
}
