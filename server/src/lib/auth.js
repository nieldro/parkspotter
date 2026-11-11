import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { getDb, one } from '../db.js';
import { HttpError, prohibido } from './http.js';
import { urlDeImagen } from './imagenes.js';
import { supabaseActivo, verificarCredenciales } from './supabase.js';

export const hashContrasena = (clave) => bcrypt.hash(clave, 10);
export const verificarContrasena = (clave, hash) => bcrypt.compare(clave, hash);

// Hash de relleno para que el login tarde igual exista o no el correo.
const HASH_FALSO = bcrypt.hashSync('relleno-no-es-una-clave', 10);

/**
 * ¿La contraseña es la de esta cuenta? Si la cuenta vive en Supabase Auth (auth_id) lo decide Supabase;
 * las cuentas locales (pruebas, demostración) se comparan con su hash bcrypt. Sin usuario, gasta el mismo tiempo.
 */
export async function credencialValida(usuario, clave) {
  if (usuario?.auth_id && supabaseActivo()) return Boolean(await verificarCredenciales(usuario.correo, clave));
  return verificarContrasena(clave, usuario?.contrasena ?? HASH_FALSO);
}

export function firmarToken(usuario) {
  return jwt.sign({ sub: String(usuario.id_usuario) }, config.jwtSecret, {
    expiresIn: `${config.jwtDias}d`,
  });
}

/** Forma pública del usuario: nunca incluye el hash de la contraseña. */
export function usuarioPublico(u) {
  return {
    id_usuario: u.id_usuario,
    nombre: u.nombre,
    apellido: u.apellido,
    correo: u.correo,
    telefono: u.telefono ?? null,
    foto: urlDeImagen(u.foto),
    fecha_nacimiento: u.fecha_nacimiento ?? null,
    vehiculo: u.vehiculo_tipo
      ? { tipo: u.vehiculo_tipo, placa: u.vehiculo_placa ?? '', detalle: u.vehiculo_detalle ?? '' }
      : null,
    tipo_usuario: u.tipo_usuario,
    es_propietario: u.id_propietario != null,
    estado: u.estado,
  };
}

export async function cargarUsuario(id) {
  return one(
    getDb(),
    `SELECT u.*, p.id_propietario
       FROM usuario u LEFT JOIN propietario p ON p.id_usuario = u.id_usuario
      WHERE u.id_usuario = ?`,
    [id],
  );
}

async function usuarioDeRequest(req) {
  const cab = req.headers.authorization || '';
  if (!cab.startsWith('Bearer ')) return null;
  let carga;
  try {
    carga = jwt.verify(cab.slice(7), config.jwtSecret);
  } catch {
    throw new HttpError(401, 'Tu sesión expiró. Inicia sesión de nuevo.');
  }
  const u = await cargarUsuario(Number(carga.sub));
  if (!u) throw new HttpError(401, 'Tu sesión ya no es válida. Inicia sesión de nuevo.');
  if (u.estado !== 'activo') throw prohibido('Tu cuenta está inactiva.');
  return u;
}

/** Si trae token válido, deja el usuario en req.usuario; si no, sigue como anónimo. */
export async function autenticacionOpcional(req, _res, next) {
  req.usuario = await usuarioDeRequest(req);
  next();
}

export async function requiereSesion(req, _res, next) {
  req.usuario = await usuarioDeRequest(req);
  if (!req.usuario) throw new HttpError(401, 'Inicia sesión para continuar.');
  next();
}

export function requierePropietario(req, _res, next) {
  if (req.usuario?.id_propietario == null) {
    throw prohibido('Esta función es solo para propietarios de garajes.');
  }
  next();
}

export function requiereAdmin(req, _res, next) {
  if (req.usuario?.tipo_usuario !== 'admin') throw prohibido('Solo para administradores.');
  next();
}
