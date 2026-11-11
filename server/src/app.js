import fs from 'node:fs';
import path from 'node:path';
import compression from 'compression';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { config } from './config.js';
import { almacenEnNube } from './lib/almacen.js';
import { HttpError } from './lib/http.js';
import { rutasAdmin } from './routes/admin.js';
import { rutasAsistente } from './routes/asistente.js';
import { rutasAuth } from './routes/auth.js';
import { rutasFavoritos } from './routes/favoritos.js';
import { rutasGarajes } from './routes/garajes.js';
import { rutasNotificaciones } from './routes/notificaciones.js';
import { rutasPropietario } from './routes/propietario.js';
import { rutasReservas } from './routes/reservas.js';

const enPruebas = process.env.NODE_ENV === 'test';

export function crearApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // detrás del proxy de Render/Fly/etc. para que el límite use la IP real
  const origenStorage = almacenEnNube() ? [new URL(config.supabase.url).origin] : [];

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"], // Leaflet posiciona el mapa con estilos en línea
          // OSM pide usar «tile.openstreetmap.org» sin subdominios; el comodín no cubre el dominio base, por eso van los dos.
          // Con Supabase Storage las fotos se sirven desde el dominio del proyecto (https://xxxx.supabase.co).
          imgSrc: ["'self'", 'data:', 'blob:', 'https://tile.openstreetmap.org', 'https://*.tile.openstreetmap.org', ...origenStorage],
          // Los mosaicos del mapa también van en connect-src: el service worker los pide con fetch() y esa
          // petición se rige por esta directiva (img-src solo vale para <img>). Sin esto el mapa queda en blanco
          // en cuanto la app está instalada.
          connectSrc: ["'self'", 'https://nominatim.openstreetmap.org', 'https://tile.openstreetmap.org', 'https://*.tile.openstreetmap.org', ...origenStorage],
          workerSrc: ["'self'"],
          manifestSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: config.enProduccion ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
      // helmet pone «no-referrer» por defecto, y OpenStreetMap rechaza (403 «Access blocked») las teselas que llegan
      // sin Referer: su política de uso exige identificar el sitio. Solo viaja el origen (nunca la ruta ni parámetros).
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  );
  app.use(compression());
  // Las fotos llegan como data URL (la app ya las reduce): solo esas rutas aceptan cuerpos grandes.
  app.use(['/api/auth/yo/foto', '/api/propietario/garajes/:id/fotos'], express.json({ limit: '7mb' }));
  app.use(express.json({ limit: '100kb' }));
  app.use('/uploads', express.static(config.uploadsDir, { maxAge: '30d', immutable: true, fallthrough: false, index: false }));

  const limite = (max) =>
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: max,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      skip: () => enPruebas,
      message: { error: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.' },
    });

  app.get('/api/salud', (_req, res) => res.json({ ok: true, servicio: 'parkspotter' }));
  // General: holgado a propósito, porque varias personas pueden compartir una IP (un salón, una oficina) y
  // el chat y la campana consultan cada pocos segundos. Los puntos sensibles tienen su propio límite más bajo.
  app.use('/api', limite(6000));
  app.use('/api/auth/login', limite(30));
  app.use('/api/auth/registro', limite(20));
  app.use('/api/auth/verificar', limite(20));
  app.use('/api/auth/reenviar', limite(10));
  app.use('/api/auth/olvide', limite(10));
  app.use('/api/auth/restablecer', limite(20));
  app.use('/api/auth/yo/foto', limite(60));
  app.use('/api/propietario/garajes/:id/fotos', limite(60));
  app.use('/api/asistente', limite(120));
  app.use('/api/auth', rutasAuth);
  app.use('/api/asistente', rutasAsistente);
  app.use('/api/favoritos', rutasFavoritos);
  app.use('/api/garajes', rutasGarajes);
  app.use('/api/reservas', rutasReservas);
  app.use('/api/propietario', rutasPropietario);
  app.use('/api/notificaciones', rutasNotificaciones);
  app.use('/api/admin', rutasAdmin);
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Ruta no encontrada.')));

  // Interfaz compilada (client/web): se sirve desde el mismo servicio, así hay una sola URL.
  const indice = path.join(config.clienteDist, 'index.html');
  if (fs.existsSync(indice)) {
    app.use(
      '/assets',
      express.static(path.join(config.clienteDist, 'assets'), { immutable: true, maxAge: '1y', fallthrough: false }),
    );
    app.use(express.static(config.clienteDist, { index: false, setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(indice);
    });
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...err.extra });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'El cuerpo de la solicitud no es JSON válido.' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'La solicitud es demasiado grande.' });
    if (err.status === 404 && err.code === 'ENOENT') return res.status(404).json({ error: 'Archivo no encontrado.' });
    console.error(err);
    res.status(500).json({ error: 'Ocurrió un error inesperado. Inténtalo de nuevo.' });
  });

  return app;
}
