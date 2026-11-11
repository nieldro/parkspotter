import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { getDb, one, run, transaccion } from '../db.js';
import {
  cargarUsuario,
  credencialValida,
  firmarToken,
  hashContrasena,
  requiereSesion,
  usuarioPublico,
} from '../lib/auth.js';
import { HttpError, conflicto, validar } from '../lib/http.js';
import { borrarImagen, guardarImagen } from '../lib/imagenes.js';
import { consumirCodigo, crearCodigo, puedeReenviar } from '../lib/codigos.js';
import { correoActivo, enviarCodigo, verificacionActiva } from '../lib/correo.js';
import {
  borrarCuenta,
  cambiarContrasenaCuenta,
  cambiarCorreoCuenta,
  crearCuenta,
  supabaseActivo,
  verificarCredenciales,
} from '../lib/supabase.js';
import { esFechaValida, hoyBogota } from '../lib/tiempo.js';

export const rutasAuth = Router();

const texto = (min, max) => z.string().trim().min(min).max(max);
const telefono = z
  .string()
  .trim()
  .regex(/^\+?[\d\s-]{7,15}$/, 'Teléfono inválido.')
  .optional()
  .or(z.literal('').transform(() => undefined));
const contrasena = z
  .string()
  .min(8, 'La contraseña debe tener al menos 8 caracteres.')
  .max(72, 'La contraseña es demasiado larga.')
  .refine((c) => /[A-Za-z]/.test(c) && /\d/.test(c), 'Usa letras y al menos un número.');
const documento = {
  tipo_documento: z.enum(['CC', 'CE', 'NIT', 'PASAPORTE']),
  numero_documento: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9-]{5,20}$/, 'Número de documento inválido.'),
};

const PLACA = { carro: /^[A-Z]{3}\d{3}$/, moto: /^[A-Z]{3}\d{2}[A-Z]$/ };

// Mayor de edad (18+) y una fecha razonable (hasta 110 años).
const fechaNacimiento = z.string().superRefine((f, ctx) => {
  if (!esFechaValida(f)) return ctx.addIssue({ code: 'custom', message: 'Fecha inválida (usa AAAA-MM-DD).' });
  const hoy = hoyBogota();
  const edad = Number(hoy.slice(0, 4)) - Number(f.slice(0, 4)) - (hoy.slice(5) < f.slice(5) ? 1 : 0);
  if (edad < 18) ctx.addIssue({ code: 'custom', message: 'Debes ser mayor de 18 años para usar ParkSpotter.' });
  else if (edad > 110) ctx.addIssue({ code: 'custom', message: 'Revisa tu fecha de nacimiento.' });
});

const vehiculoEsquema = z
  .object({
    tipo: z.enum(['carro', 'moto']),
    placa: z
      .string()
      .trim()
      .transform((p) => p.replace(/[\s-]/g, '').toUpperCase()),
    detalle: z.string().trim().max(60).optional().default(''),
  })
  .superRefine((v, ctx) => {
    if (!PLACA[v.tipo].test(v.placa)) {
      ctx.addIssue({
        code: 'custom',
        path: ['placa'],
        message: v.tipo === 'carro' ? 'Placa de carro inválida (ej. ABC123).' : 'Placa de moto inválida (ej. ABC12D).',
      });
    }
  });

const esquemaRegistro = z
  .object({
    nombre: texto(2, 50),
    apellido: texto(2, 50),
    correo: z.email('Correo inválido.').max(100),
    contrasena,
    telefono,
    fecha_nacimiento: fechaNacimiento,
    acepto_terminos: z.literal(true, { error: 'Debes aceptar los términos y el tratamiento de datos.' }),
    vehiculo: vehiculoEsquema.nullish(),
    tipo_usuario: z.enum(['conductor', 'propietario']),
    tipo_documento: documento.tipo_documento.optional(),
    numero_documento: documento.numero_documento.optional(),
  })
  .refine(
    (d) => d.tipo_usuario !== 'propietario' || (d.tipo_documento && d.numero_documento),
    { message: 'Los propietarios deben indicar su tipo y número de documento.', path: ['numero_documento'] },
  );

// Bloqueo temporal por cuenta: tras 8 contraseñas erróneas seguidas se espera 15 minutos.
// Se cuenta por correo exista o no, para no revelar qué cuentas existen.
const MAX_INTENTOS = 8;
const BLOQUEO_MS = 15 * 60 * 1000;
const fallos = new Map(); // correo -> { n, desde }

function minutosDeBloqueo(correo) {
  const f = fallos.get(correo);
  if (!f) return 0;
  if (Date.now() - f.desde > BLOQUEO_MS) {
    fallos.delete(correo);
    return 0;
  }
  return f.n >= MAX_INTENTOS ? Math.ceil((f.desde + BLOQUEO_MS - Date.now()) / 60000) : 0;
}

function registrarFallo(correo) {
  const f = fallos.get(correo);
  if (!f || Date.now() - f.desde > BLOQUEO_MS) {
    if (fallos.size > 5000) fallos.clear(); // tope de memoria
    fallos.set(correo, { n: 1, desde: Date.now() });
  } else {
    f.n += 1;
    if (f.n === MAX_INTENTOS) f.desde = Date.now(); // el bloqueo cuenta desde el último intento
  }
}

/** Crea un código nuevo y lo envía al correo de la cuenta. Lanza 503 si el correo no sale. */
async function enviarCodigoA(u, proposito) {
  const codigo = await crearCodigo(getDb(), u.id_usuario, proposito);
  await enviarCodigo({ para: u.correo, nombre: u.nombre, codigo, proposito });
}

/** Si el correo con el código no pudo salir, la cuenta recién creada no sirve de nada: se borra para poder reintentar. */
async function deshacerRegistro(idUsuario, authId) {
  await run(getDb(), 'DELETE FROM propietario WHERE id_usuario = ?', [idUsuario]);
  await run(getDb(), 'DELETE FROM usuario WHERE id_usuario = ?', [idUsuario]);
  if (authId) await borrarCuenta(authId);
}

const MENSAJE_CODIGO = 'El código no es correcto o ya venció. Pide uno nuevo.';

rutasAuth.post('/registro', async (req, res) => {
  const d = validar(esquemaRegistro, req.body);
  const correo = d.correo.toLowerCase();
  const verificar = verificacionActiva();
  if (await one(getDb(), 'SELECT 1 AS x FROM usuario WHERE lower(correo) = ?', [correo])) {
    throw conflicto('Ya existe una cuenta con ese correo.');
  }

  // La contraseña la guarda Supabase Auth (aquí queda solo un marcador); sin Supabase, un hash bcrypt local.
  let authId = null;
  let cuentaNueva = false;
  if (supabaseActivo()) {
    authId = await crearCuenta({ correo, contrasena: d.contrasena, nombre: d.nombre });
    cuentaNueva = authId != null;
    // El proyecto de Supabase puede tener ya ese correo (p. ej. de otra app tuya): si la contraseña coincide, se enlaza.
    authId ??= await verificarCredenciales(correo, d.contrasena);
    if (!authId) throw conflicto('Ya existe una cuenta con ese correo. Si es tuya, usa su contraseña; si no, prueba con otro correo.');
  }
  const hash = authId ? '!supabase' : await hashContrasena(d.contrasena);

  let id;
  try {
    id = await transaccion(async (tx) => {
      const r = await run(
        tx,
        `INSERT INTO usuario (nombre, apellido, correo, contrasena, telefono, tipo_usuario, fecha_nacimiento,
                              vehiculo_tipo, vehiculo_placa, vehiculo_detalle, acepto_terminos, auth_id, correo_verificado)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          d.nombre, d.apellido, correo, hash, d.telefono ?? null, d.tipo_usuario, d.fecha_nacimiento,
          d.vehiculo?.tipo ?? null, d.vehiculo?.placa ?? null, d.vehiculo?.detalle || null, new Date().toISOString(), authId, !verificar,
        ],
      );
      const idUsuario = Number(r.lastInsertRowid);
      if (d.tipo_usuario === 'propietario') {
        await run(
          tx,
          'INSERT INTO propietario (id_usuario, tipo_documento, numero_documento) VALUES (?, ?, ?)',
          [idUsuario, d.tipo_documento, d.numero_documento],
        );
      }
      return idUsuario;
    });
  } catch (e) {
    if (cuentaNueva) await borrarCuenta(authId); // no dejar una cuenta huérfana en Supabase
    if (e?.code === '23505') throw conflicto('Ya existe una cuenta con ese correo.'); // dos registros a la vez
    throw e;
  }

  const usuario = await cargarUsuario(id);
  if (verificar) {
    // Hasta confirmar el código no hay sesión: el correo tiene que ser de quien se registra.
    try {
      await enviarCodigoA(usuario, 'verificar');
    } catch (e) {
      await deshacerRegistro(id, cuentaNueva ? authId : null);
      throw e;
    }
    return res.status(201).json({ requiere_verificacion: true, correo });
  }
  res.status(201).json({ token: firmarToken(usuario), usuario: usuarioPublico(usuario) });
});

const esquemaCodigo = z.object({ correo: z.email('Correo inválido.'), codigo: z.string().trim().regex(/^\d{6}$/, 'El código tiene 6 dígitos.') });

// POST /api/auth/verificar — confirma el correo con el código y abre la sesión
rutasAuth.post('/verificar', async (req, res) => {
  const { correo, codigo } = validar(esquemaCodigo, req.body);
  const u = await one(getDb(), 'SELECT * FROM usuario WHERE lower(correo) = ?', [correo.toLowerCase()]);
  if (!u || u.correo_verificado || !(await consumirCodigo(getDb(), u.id_usuario, 'verificar', codigo))) {
    throw new HttpError(400, MENSAJE_CODIGO);
  }
  if (u.estado !== 'activo') throw new HttpError(403, 'Tu cuenta está inactiva.');
  await run(getDb(), 'UPDATE usuario SET correo_verificado = TRUE WHERE id_usuario = ?', [u.id_usuario]);
  const usuario = await cargarUsuario(u.id_usuario);
  res.json({ token: firmarToken(usuario), usuario: usuarioPublico(usuario) });
});

// POST /api/auth/reenviar — otro código de verificación (como mucho uno por minuto; la respuesta no revela si el correo existe)
rutasAuth.post('/reenviar', async (req, res) => {
  const { correo } = validar(z.object({ correo: z.email('Correo inválido.') }), req.body);
  if (!correoActivo()) throw new HttpError(503, 'El envío de correos no está disponible.');
  const u = await one(getDb(), 'SELECT * FROM usuario WHERE lower(correo) = ?', [correo.toLowerCase()]);
  if (u && !u.correo_verificado && u.estado === 'activo' && (await puedeReenviar(getDb(), u.id_usuario, 'verificar'))) {
    await enviarCodigoA(u, 'verificar');
  }
  res.json({ ok: true });
});

// POST /api/auth/olvide — manda un código para cambiar la contraseña (siempre responde igual: no revela qué correos existen)
rutasAuth.post('/olvide', async (req, res) => {
  const { correo } = validar(z.object({ correo: z.email('Correo inválido.') }), req.body);
  if (!correoActivo()) throw new HttpError(503, 'La recuperación por correo no está disponible por ahora.');
  const u = await one(getDb(), 'SELECT * FROM usuario WHERE lower(correo) = ?', [correo.toLowerCase()]);
  if (u && u.estado === 'activo' && (await puedeReenviar(getDb(), u.id_usuario, 'restablecer'))) {
    try {
      await enviarCodigoA(u, 'restablecer');
    } catch {
      /* ya quedó registrado en el log; a quien pregunta no se le dice si el correo existe */
    }
  }
  res.json({ ok: true });
});

// POST /api/auth/restablecer — con el código del correo fija una contraseña nueva y abre la sesión
rutasAuth.post('/restablecer', async (req, res) => {
  const d = validar(esquemaCodigo.extend({ nueva: contrasena }), req.body);
  const llave = d.correo.toLowerCase();
  const u = await one(getDb(), 'SELECT * FROM usuario WHERE lower(correo) = ?', [llave]);
  if (!u || u.estado !== 'activo' || !(await consumirCodigo(getDb(), u.id_usuario, 'restablecer', d.codigo))) {
    throw new HttpError(400, MENSAJE_CODIGO);
  }
  if (u.auth_id && supabaseActivo()) {
    await cambiarContrasenaCuenta(u.auth_id, d.nueva);
  } else {
    await run(getDb(), 'UPDATE usuario SET contrasena = ? WHERE id_usuario = ?', [await hashContrasena(d.nueva), u.id_usuario]);
  }
  // Recibir el código en ese correo también prueba que es suyo; y se levanta el bloqueo por intentos fallidos.
  await run(getDb(), 'UPDATE usuario SET correo_verificado = TRUE WHERE id_usuario = ?', [u.id_usuario]);
  fallos.delete(llave);
  const usuario = await cargarUsuario(u.id_usuario);
  res.json({ token: firmarToken(usuario), usuario: usuarioPublico(usuario) });
});

const esquemaLogin = z.object({ correo: z.email('Correo inválido.'), contrasena: z.string().min(1) });

rutasAuth.post('/login', async (req, res) => {
  const { correo, contrasena: clave } = validar(esquemaLogin, req.body);
  const llave = correo.toLowerCase();
  const espera = minutosDeBloqueo(llave);
  if (espera) {
    throw new HttpError(429, `Demasiados intentos fallidos. Por seguridad, espera ${espera} min e inténtalo de nuevo.`);
  }
  const u = await one(
    getDb(),
    `SELECT u.*, p.id_propietario FROM usuario u
       LEFT JOIN propietario p ON p.id_usuario = u.id_usuario WHERE lower(u.correo) = ?`,
    [llave],
  );
  const ok = await credencialValida(u, clave);
  if (!u || !ok) {
    registrarFallo(llave);
    throw new HttpError(401, 'Correo o contraseña incorrectos.');
  }
  if (u.estado !== 'activo') throw new HttpError(403, 'Tu cuenta está inactiva.');
  fallos.delete(llave);
  if (u.correo_verificado === false) {
    // La contraseña es correcta pero el correo aún no se confirmó: se manda un código nuevo (si toca) y la app abre la pantalla de verificación.
    if (correoActivo() && (await puedeReenviar(getDb(), u.id_usuario, 'verificar'))) {
      await enviarCodigoA(u, 'verificar').catch(() => {});
    }
    throw new HttpError(403, 'Primero confirma tu correo: te enviamos un código de 6 dígitos.', { codigo: 'correo_sin_verificar', correo: u.correo });
  }
  res.json({ token: firmarToken(u), usuario: usuarioPublico(u) });
});

// El cliente pregunta si debe mostrar los botones de demostración.
rutasAuth.get('/config', (_req, res) => res.json({ demo: config.demo, verificacion_correo: verificacionActiva(), recuperacion: correoActivo() }));

const CUENTAS_DEMO = { conductor: 'conductor@parkspotter.test', propietario: 'propietario@parkspotter.test' };

// Entrada de un toque a las cuentas de demostración (solo con DEMO=1 y si el seed las creó).
rutasAuth.post('/demo', async (req, res) => {
  if (!config.demo) throw new HttpError(404, 'No disponible.');
  const { rol } = validar(z.object({ rol: z.enum(['conductor', 'propietario']) }), req.body);
  const u = await one(
    getDb(),
    `SELECT u.*, p.id_propietario FROM usuario u
       LEFT JOIN propietario p ON p.id_usuario = u.id_usuario WHERE lower(u.correo) = ? AND u.estado = 'activo'`,
    [CUENTAS_DEMO[rol]],
  );
  if (!u) throw new HttpError(404, 'Las cuentas de demostración no existen en esta base.');
  res.json({ token: firmarToken(u), usuario: usuarioPublico(u) });
});

rutasAuth.get('/yo', requiereSesion, (req, res) => {
  res.json({ usuario: usuarioPublico(req.usuario) });
});

const esquemaPerfil = z.object({
  nombre: texto(2, 50),
  apellido: texto(2, 50),
  telefono,
  fecha_nacimiento: fechaNacimiento.optional(),
  vehiculo: vehiculoEsquema.nullish(), // null = quitar el vehículo guardado
});

rutasAuth.patch('/yo', requiereSesion, async (req, res) => {
  const d = validar(esquemaPerfil, req.body);
  await run(
    getDb(),
    `UPDATE usuario SET nombre = ?, apellido = ?, telefono = ?,
            fecha_nacimiento = COALESCE(?, fecha_nacimiento),
            vehiculo_tipo = ?, vehiculo_placa = ?, vehiculo_detalle = ?
      WHERE id_usuario = ?`,
    [
      d.nombre,
      d.apellido,
      d.telefono ?? null,
      d.fecha_nacimiento ?? null,
      d.vehiculo?.tipo ?? null,
      d.vehiculo?.placa ?? null,
      d.vehiculo?.detalle || null,
      req.usuario.id_usuario,
    ],
  );
  res.json({ usuario: usuarioPublico(await cargarUsuario(req.usuario.id_usuario)) });
});

// Foto de perfil: llega como data URL ya reducida por la app; aquí se valida y se re-codifica.
rutasAuth.post('/yo/foto', requiereSesion, async (req, res) => {
  const { imagen } = validar(z.object({ imagen: z.string().max(8_000_000) }), req.body);
  const archivo = await guardarImagen(imagen, 'avatar');
  const anterior = req.usuario.foto;
  await run(getDb(), 'UPDATE usuario SET foto = ? WHERE id_usuario = ?', [archivo, req.usuario.id_usuario]);
  await borrarImagen(anterior);
  res.json({ usuario: usuarioPublico(await cargarUsuario(req.usuario.id_usuario)) });
});

rutasAuth.delete('/yo/foto', requiereSesion, async (req, res) => {
  const anterior = req.usuario.foto;
  await run(getDb(), 'UPDATE usuario SET foto = NULL WHERE id_usuario = ?', [req.usuario.id_usuario]);
  await borrarImagen(anterior);
  res.json({ usuario: usuarioPublico(await cargarUsuario(req.usuario.id_usuario)) });
});

// Cambiar el correo exige la contraseña actual (es la llave de la cuenta).
rutasAuth.post('/yo/correo', requiereSesion, async (req, res) => {
  const d = validar(z.object({ correo: z.email('Correo inválido.').max(100), contrasena: z.string().min(1) }), req.body);
  if (!(await credencialValida(req.usuario, d.contrasena))) {
    throw new HttpError(400, 'La contraseña no es correcta.');
  }
  const correo = d.correo.toLowerCase();
  const anterior = req.usuario.correo;
  const enSupabase = Boolean(req.usuario.auth_id) && supabaseActivo();
  let cambiadoAfuera = false;
  try {
    await transaccion(async (tx) => {
      if (await one(tx, 'SELECT 1 AS x FROM usuario WHERE lower(correo) = ? AND id_usuario <> ?', [correo, req.usuario.id_usuario])) {
        throw conflicto('Ya existe una cuenta con ese correo.');
      }
      if (enSupabase) {
        if (!(await cambiarCorreoCuenta(req.usuario.auth_id, correo))) throw conflicto('Ya existe una cuenta con ese correo.');
        cambiadoAfuera = true;
      }
      await run(tx, 'UPDATE usuario SET correo = ? WHERE id_usuario = ?', [correo, req.usuario.id_usuario]);
    });
  } catch (e) {
    if (cambiadoAfuera) await cambiarCorreoCuenta(req.usuario.auth_id, anterior).catch(() => {}); // deshacer
    throw e;
  }
  res.json({ usuario: usuarioPublico(await cargarUsuario(req.usuario.id_usuario)) });
});

// Un conductor puede pasar a publicar garajes sin crear otra cuenta.
rutasAuth.post('/yo/propietario', requiereSesion, async (req, res) => {
  const d = validar(z.object(documento), req.body);
  if (req.usuario.id_propietario != null) throw conflicto('Ya eres propietario.');
  if (req.usuario.tipo_usuario === 'admin') throw conflicto('Una cuenta de administrador no puede publicar garajes.');
  await transaccion(async (tx) => {
    await run(tx, 'INSERT INTO propietario (id_usuario, tipo_documento, numero_documento) VALUES (?, ?, ?)', [
      req.usuario.id_usuario,
      d.tipo_documento,
      d.numero_documento,
    ]);
    await run(tx, "UPDATE usuario SET tipo_usuario = 'propietario' WHERE id_usuario = ?", [req.usuario.id_usuario]);
  });
  res.json({ usuario: usuarioPublico(await cargarUsuario(req.usuario.id_usuario)) });
});

const esquemaClave = z.object({ actual: z.string().min(1), nueva: contrasena });

rutasAuth.post('/yo/contrasena', requiereSesion, async (req, res) => {
  const d = validar(esquemaClave, req.body);
  if (!(await credencialValida(req.usuario, d.actual))) {
    throw new HttpError(400, 'La contraseña actual no es correcta.');
  }
  if (req.usuario.auth_id && supabaseActivo()) {
    await cambiarContrasenaCuenta(req.usuario.auth_id, d.nueva);
  } else {
    await run(getDb(), 'UPDATE usuario SET contrasena = ? WHERE id_usuario = ?', [
      await hashContrasena(d.nueva),
      req.usuario.id_usuario,
    ]);
  }
  res.json({ ok: true });
});
