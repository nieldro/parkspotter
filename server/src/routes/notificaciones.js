import { Router } from 'express';
import { z } from 'zod';
import { all, getDb, one, run } from '../db.js';
import { requiereSesion } from '../lib/auth.js';
import { validar } from '../lib/http.js';

export const rutasNotificaciones = Router();
rutasNotificaciones.use(requiereSesion);

async function noLeidas(idUsuario) {
  const f = await one(getDb(), 'SELECT COUNT(*) AS n FROM notificacion WHERE id_usuario = ? AND leida = 0', [idUsuario]);
  return f.n;
}

rutasNotificaciones.get('/', async (req, res) => {
  const notificaciones = await all(
    getDb(),
    `SELECT id_notificacion, id_reserva, tipo, mensaje, leida, fecha FROM notificacion
      WHERE id_usuario = ? ORDER BY fecha DESC, id_notificacion DESC LIMIT 50`,
    [req.usuario.id_usuario],
  );
  res.json({ notificaciones, no_leidas: await noLeidas(req.usuario.id_usuario) });
});

// Se consulta cada cierto tiempo para mostrar el numerito en la campana.
rutasNotificaciones.get('/conteo', async (req, res) => {
  res.json({ no_leidas: await noLeidas(req.usuario.id_usuario) });
});

rutasNotificaciones.post('/leer', async (req, res) => {
  const { ids } = validar(z.object({ ids: z.array(z.number().int()).max(100).optional() }), req.body);
  if (ids?.length) {
    await run(
      getDb(),
      `UPDATE notificacion SET leida = 1 WHERE id_usuario = ? AND id_notificacion IN (${ids.map(() => '?').join(',')})`,
      [req.usuario.id_usuario, ...ids],
    );
  } else {
    await run(getDb(), 'UPDATE notificacion SET leida = 1 WHERE id_usuario = ?', [req.usuario.id_usuario]);
  }
  res.json({ no_leidas: await noLeidas(req.usuario.id_usuario) });
});
