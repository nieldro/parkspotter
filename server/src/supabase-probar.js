// Comprueba la conexión con Supabase paso a paso, sin imprimir ninguna clave:
//   npm run supabase:probar
import { config } from './config.js';
import { cerrarDb, getDb, initSchema, one } from './db.js';

const ok = (m) => console.log(`  ✔ ${m}`);
const mal = (m) => {
  console.log(`  ✖ ${m}`);
  fallos += 1;
};
let fallos = 0;
const { url, anonKey, serviceKey } = config.supabase;

console.log('Supabase Auth');
if (!url || !anonKey || !serviceKey) {
  mal(`Faltan variables en .env: ${[!url && 'SUPABASE_URL', !anonKey && 'SUPABASE_ANON_KEY', !serviceKey && 'SUPABASE_SERVICE_KEY'].filter(Boolean).join(', ')}`);
} else {
  const pedir = (ruta, clave) =>
    fetch(`${url}/auth/v1${ruta}`, { headers: { apikey: clave, authorization: `Bearer ${clave}` }, signal: AbortSignal.timeout(12_000) });
  try {
    const a = await pedir('/settings', anonKey);
    if (a.ok) {
      ok('la URL y la clave pública (anon) funcionan');
      const s = await a.json().catch(() => ({}));
      if (s.mailer_autoconfirm === false) console.log('    (el proyecto exige confirmar correo, pero ParkSpotter crea las cuentas ya confirmadas)');
    } else mal(`la clave pública fue rechazada (HTTP ${a.status}): revisa SUPABASE_URL y SUPABASE_ANON_KEY`);
    const s = await pedir('/admin/users?per_page=1', serviceKey);
    if (s.ok) ok('la clave de servicio (service_role) funciona');
    else mal(`la clave de servicio fue rechazada (HTTP ${s.status}): debe ser la «service_role», no la «anon»`);
  } catch (e) {
    mal(`no se pudo llegar a ${url}: ${e.cause?.code ?? e.message}`);
  }
}

console.log('Base de datos');
if (!/^postgres(?:ql)?:\/\//i.test(config.databaseUrl || '')) {
  mal('DATABASE_URL no está definida (o no empieza por postgresql://): ahora mismo se usaría la base local PGlite');
} else {
  try {
    await initSchema();
    ok(`conexión correcta y tablas listas en el esquema «${config.dbEsquema}»`);
    const r = await one(getDb(), 'SELECT current_schema() AS esquema, COUNT(*) AS usuarios FROM usuario');
    ok(`el esquema activo es «${r.esquema}» y hay ${r.usuarios} usuario(s)`);
    if (r.esquema !== config.dbEsquema) mal('el esquema activo no es el esperado: usa el «Session pooler», no el «Transaction pooler»');
  } catch (e) {
    mal(`${e.code ?? ''} ${e.message}`.trim());
    if (/ENOTFOUND|ENETUNREACH|EHOSTUNREACH/.test(`${e.code} ${e.message}`)) {
      console.log('    (la conexión directa de Supabase es solo IPv6; usa la cadena del «Session pooler»)');
    }
  }
}

await cerrarDb().catch(() => {});
console.log(fallos ? `\n${fallos} problema(s). Corrígelos en .env y vuelve a correr el comando.` : '\nTodo listo: reinicia el servidor y ParkSpotter usará Supabase.');
process.exit(fallos ? 1 : 0);
