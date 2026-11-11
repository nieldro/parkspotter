import { Router } from 'express';
import { z } from 'zod';
import { all, getDb, one, run } from '../db.js';
import { requiereAdmin, requiereSesion } from '../lib/auth.js';
import { conflicto, idDeParametro, noEncontrado, validar } from '../lib/http.js';
import { notificar } from '../lib/reservas.js';

export const rutasAdmin = Router();
rutasAdmin.use(requiereSesion, requiereAdmin);

rutasAdmin.get('/resumen', async (_req, res) => {
  const db = getDb();
  const [usuarios, garajes, reservas, ingresos, reportes] = await Promise.all([
    one(db, `SELECT COUNT(*) AS total,
                    COUNT(*) FILTER (WHERE tipo_usuario = 'conductor') AS conductores,
                    COUNT(*) FILTER (WHERE tipo_usuario = 'propietario') AS propietarios,
                    COUNT(*) FILTER (WHERE estado = 'inactivo') AS inactivos
               FROM usuario WHERE tipo_usuario != 'admin'`),
    one(db, `SELECT COUNT(*) AS total,
                    COUNT(*) FILTER (WHERE estado = 'activo') AS activos,
                    COUNT(*) FILTER (WHERE estado = 'suspendido') AS suspendidos
               FROM garaje`),
    all(db, 'SELECT estado, COUNT(*) AS total FROM reserva GROUP BY estado'),
    one(db, "SELECT COALESCE(SUM(costo_total), 0) AS total FROM reserva WHERE estado = 'confirmada'"),
    one(db, "SELECT COUNT(*) AS abiertos FROM reporte WHERE estado = 'abierto'"),
  ]);
  res.json({
    usuarios,
    garajes,
    reportes_abiertos: reportes.abiertos,
    reservas: Object.fromEntries(reservas.map((r) => [r.estado, r.total])),
    valor_reservas_confirmadas: ingresos.total,
  });
});

rutasAdmin.get('/usuarios', async (req, res) => {
  const { q } = validar(z.object({ q: z.string().trim().max(60).optional() }), req.query);
  const like = `%${q ?? ''}%`;
  const usuarios = await all(
    getDb(),
    `SELECT id_usuario, nombre, apellido, correo, telefono, tipo_usuario, estado, fecha_registro
       FROM usuario WHERE (nombre ILIKE ? OR apellido ILIKE ? OR correo ILIKE ?)
      ORDER BY fecha_registro DESC LIMIT 200`,
    [like, like, like],
  );
  res.json({ usuarios });
});

rutasAdmin.patch('/usuarios/:id', async (req, res) => {
  const id = idDeParametro(req.params.id);
  const { estado } = validar(z.object({ estado: z.enum(['activo', 'inactivo']) }), req.body);
  const u = await one(getDb(), 'SELECT id_usuario, tipo_usuario FROM usuario WHERE id_usuario = ?', [id]);
  if (!u) throw noEncontrado('Usuario');
  if (u.tipo_usuario === 'admin') throw conflicto('No se puede cambiar el estado de un administrador.');
  await run(getDb(), 'UPDATE usuario SET estado = ? WHERE id_usuario = ?', [estado, id]);
  res.json({ ok: true });
});

rutasAdmin.get('/garajes', async (_req, res) => {
  const garajes = await all(
    getDb(),
    `SELECT g.id_garaje, g.nombre, g.direccion, g.barrio, g.localidad, g.tarifa_hora, g.estado, g.fecha_creacion,
            u.nombre || ' ' || u.apellido AS propietario, u.correo AS correo_propietario
       FROM garaje g JOIN propietario p ON p.id_propietario = g.id_propietario
       JOIN usuario u ON u.id_usuario = p.id_usuario
      ORDER BY g.fecha_creacion DESC LIMIT 200`,
  );
  res.json({ garajes });
});

// Reportes de los usuarios sobre publicaciones: los abiertos primero.
rutasAdmin.get('/reportes', async (_req, res) => {
  const reportes = await all(
    getDb(),
    `SELECT r.id_reporte, r.motivo, r.detalle, r.estado, r.fecha,
            g.id_garaje, g.nombre AS garaje, g.estado AS garaje_estado,
            u.nombre || ' ' || u.apellido AS reportante,
            (SELECT COUNT(*) FROM reporte x WHERE x.id_garaje = r.id_garaje AND x.estado = 'abierto') AS abiertos_del_garaje
       FROM reporte r JOIN garaje g ON g.id_garaje = r.id_garaje JOIN usuario u ON u.id_usuario = r.id_usuario
      ORDER BY (r.estado = 'abierto') DESC, r.fecha DESC LIMIT 200`,
  );
  res.json({ reportes });
});

// Resolver un reporte; opcionalmente suspende la publicación en el mismo paso.
rutasAdmin.patch('/reportes/:id', async (req, res) => {
  const id = idDeParametro(req.params.id);
  const { suspender_garaje } = validar(z.object({ suspender_garaje: z.boolean().optional() }), req.body);
  const r = await one(
    getDb(),
    `SELECT r.id_reporte, r.id_garaje, g.nombre, p.id_usuario AS dueno FROM reporte r
       JOIN garaje g ON g.id_garaje = r.id_garaje JOIN propietario p ON p.id_propietario = g.id_propietario
      WHERE r.id_reporte = ?`,
    [id],
  );
  if (!r) throw noEncontrado('Reporte');
  if (suspender_garaje) {
    // Suspender cierra de una vez todos los reportes abiertos de esa publicación.
    await run(getDb(), "UPDATE reporte SET estado = 'resuelto' WHERE id_garaje = ? AND estado = 'abierto'", [r.id_garaje]);
    await run(getDb(), "UPDATE garaje SET estado = 'suspendido' WHERE id_garaje = ?", [r.id_garaje]);
    await notificar(getDb(), r.dueno, 'garaje_moderado', `Un administrador suspendió tu garaje "${r.nombre}" tras revisar un reporte.`);
  } else {
    await run(getDb(), "UPDATE reporte SET estado = 'resuelto' WHERE id_reporte = ?", [id]);
  }
  res.json({ ok: true });
});

// Moderación: suspender una publicación o volver a activarla.
rutasAdmin.patch('/garajes/:id', async (req, res) => {
  const id = idDeParametro(req.params.id);
  const { estado } = validar(z.object({ estado: z.enum(['activo', 'suspendido']) }), req.body);
  const g = await one(
    getDb(),
    `SELECT g.id_garaje, g.nombre, p.id_usuario AS dueno FROM garaje g
       JOIN propietario p ON p.id_propietario = g.id_propietario WHERE g.id_garaje = ?`,
    [id],
  );
  if (!g) throw noEncontrado('Garaje');
  await run(getDb(), 'UPDATE garaje SET estado = ? WHERE id_garaje = ?', [estado, id]);
  await notificar(
    getDb(),
    g.dueno,
    'garaje_moderado',
    estado === 'suspendido'
      ? `Un administrador suspendió tu garaje "${g.nombre}".`
      : `Tu garaje "${g.nombre}" fue reactivado por un administrador.`,
  );
  res.json({ ok: true });
});
