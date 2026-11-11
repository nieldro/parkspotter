import { crearApp } from './app.js';
import { config } from './config.js';
import { cerrarDb, getDb, initSchema } from './db.js';
import { detenerTareas, iniciarTareas } from './lib/recordatorios.js';
import { supabaseActivo } from './lib/supabase.js';

const enNube = /^postgres(?:ql)?:\/\//i.test(config.databaseUrl || '');
if (config.supabase.url && !supabaseActivo()) {
  throw new Error('Supabase incompleto: hacen falta SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_KEY.');
}
if (config.enProduccion && !enNube) {
  console.warn('AVISO: sin DATABASE_URL (Postgres/Supabase) los datos se guardan en una carpeta local (server/data/pglite).');
}
await initSchema();
iniciarTareas(getDb()); // avisos de solicitudes por vencer, aunque nadie tenga la app abierta
const app = crearApp();
const servidor = app.listen(config.puerto, '0.0.0.0', () => {
  console.log(
    `ParkSpotter escuchando en http://localhost:${config.puerto} · datos: ${enNube ? 'Postgres (Supabase)' : 'PGlite local'} · cuentas: ${supabaseActivo() ? 'Supabase Auth' : 'locales'}`,
  );
});

// Al apagar (SIGTERM al reiniciar) se cierra la conexión con la base antes de salir.
let cerrando = false;
for (const senal of ['SIGTERM', 'SIGINT']) {
  process.on(senal, async () => {
    if (cerrando) return;
    cerrando = true;
    servidor.close();
    detenerTareas();
    await cerrarDb().catch((e) => console.error(e.message));
    process.exit(0);
  });
}
