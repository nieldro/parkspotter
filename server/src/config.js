import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_DIR = path.resolve(here, '..');
export const ROOT_DIR = path.resolve(SERVER_DIR, '..');

// Las pruebas nunca leen el .env real: así no pueden mandar correos de verdad ni tocar el Supabase de verdad.
if (process.env.NODE_ENV !== 'test') dotenv.config({ path: path.join(ROOT_DIR, '.env'), quiet: true });

const enProduccion = process.env.NODE_ENV === 'production';

if (enProduccion && !process.env.JWT_SECRET) {
  throw new Error('Falta JWT_SECRET: defínelo como variable de entorno antes de arrancar en producción.');
}

export const config = {
  enProduccion,
  puerto: Number(process.env.PORT) || 3000,
  // Base de datos. DATABASE_URL=postgresql://... usa Postgres (Supabase). Sin ella se usa PGlite, un Postgres
  // embebido que guarda todo en server/data/pglite (sirve para desarrollar sin conexión). Las pruebas pasan
  // una ruta file:... para tener su propia copia.
  databaseUrl: process.env.DATABASE_URL || null,
  // Esquema donde viven las tablas (así no se mezcla con otras apps en el mismo proyecto de Supabase).
  dbEsquema: /^[a-z_][a-z0-9_]*$/.test(process.env.DB_SCHEMA || '') ? process.env.DB_SCHEMA : 'parkspotter',
  // Supabase Auth guarda y verifica las credenciales (contraseñas, correos). Se activa con la URL, la clave
  // pública (anon) y la clave de servicio (service_role, SECRETA: solo en el servidor).
  supabase: {
    url: (process.env.SUPABASE_URL || '').replace(/\/+$/, ''),
    anonKey: process.env.SUPABASE_ANON_KEY || '',
    serviceKey: process.env.SUPABASE_SERVICE_KEY || '',
    // Bucket de Storage (público) donde van las fotos; propio de ParkSpotter para no mezclarlo con otras apps.
    bucket: /^[a-z0-9_-]{3,60}$/.test(process.env.SUPABASE_BUCKET || '') ? process.env.SUPABASE_BUCKET : 'parkspotter',
  },
  // Correo saliente (códigos de verificación y recuperación de contraseña) por SMTP: Gmail, Brevo, Mailgun…
  // Con SMTP_HOST definido, las cuentas nuevas deben verificar su correo con un código de 6 dígitos
  // (VERIFICAR_CORREO=0 lo desactiva aunque haya SMTP).
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === '1' || Number(process.env.SMTP_PORT) === 465,
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || (process.env.SMTP_USER ? `ParkSpotter <${process.env.SMTP_USER}>` : 'ParkSpotter <no-responder@parkspotter.app>'),
    // Solo para pruebas con un servidor SMTP local de certificado propio.
    permitirAutofirmado: process.env.SMTP_AUTOFIRMADO === '1',
  },
  verificarCorreo: process.env.VERIFICAR_CORREO !== '0',
  // DEMO=1 muestra en el inicio de sesión los botones «Probar como conductor/propietario» (cuentas del seed).
  demo: process.env.DEMO === '1',
  // Fotos subidas (perfil y garajes). En la nube gratuita el disco se borra al reiniciar: ver README.
  uploadsDir: process.env.UPLOADS_DIR || path.join(SERVER_DIR, 'data', 'uploads'),
  // Modelo de lenguaje opcional para el asistente (cualquier API compatible con «chat/completions»:
  // OpenAI, DeepSeek, OpenRouter, Ollama…). Sin esto el asistente usa su intérprete local.
  ia: {
    url: (process.env.AI_BASE_URL || '').replace(/\/+$/, ''),
    clave: process.env.AI_API_KEY || '',
    modelo: process.env.AI_MODEL || '',
  },
  jwtSecret: process.env.JWT_SECRET || 'secreto-solo-para-desarrollo-local',
  jwtDias: 7,
  clienteDist: process.env.CLIENT_DIST || path.join(ROOT_DIR, 'client', 'web'),
  zonaHoraria: 'America/Bogota',
};
