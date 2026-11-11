import { Router } from 'express';
import { all, getDb, one, run } from '../db.js';
import { requiereSesion } from '../lib/auth.js';
import { idDeParametro, noEncontrado } from '../lib/http.js';
import { SELECT_GARAJE, garajePublico } from './garajes.js';

export const rutasFavoritos = Router();
rutasFavoritos.use(requiereSesion);

// GET /api/favoritos/ids — solo los identificadores (para pintar los corazones en toda la app)
rutasFavoritos.get('/ids', async (req, res) => {
  const filas = await all(getDb(), 'SELECT id_garaje FROM favorito WHERE id_usuario = ?', [req.usuario.id_usuario]);
  res.json({ ids: filas.map((f) => f.id_garaje) });
});

// GET /api/favoritos — los garajes guardados (los que dejaron de estar disponibles se marcan, no se ocultan)
rutasFavoritos.get('/', async (req, res) => {
  const filas = await all(
    getDb(),
    `${SELECT_GARAJE} JOIN favorito fav ON fav.id_garaje = g.id_garaje
      WHERE fav.id_usuario = ? ORDER BY fav.fecha DESC`,
    [req.usuario.id_usuario],
  );
  res.json({ garajes: filas.map((g) => ({ ...garajePublico(g), disponible: g.estado === 'activo' })) });
});

// POST /api/favoritos/:id — idempotente
rutasFavoritos.post('/:id', async (req, res) => {
  const id = idDeParametro(req.params.id);
  const g = await one(getDb(), "SELECT id_garaje FROM garaje WHERE id_garaje = ? AND estado = 'activo'", [id]);
  if (!g) throw noEncontrado('Garaje');
  await run(getDb(), 'INSERT INTO favorito (id_usuario, id_garaje) VALUES (?, ?) ON CONFLICT DO NOTHING', [req.usuario.id_usuario, id]);
  res.status(201).json({ favorito: true });
});

// DELETE /api/favoritos/:id — idempotente
rutasFavoritos.delete('/:id', async (req, res) => {
  const id = idDeParametro(req.params.id);
  await run(getDb(), 'DELETE FROM favorito WHERE id_usuario = ? AND id_garaje = ?', [req.usuario.id_usuario, id]);
  res.json({ favorito: false });
});
