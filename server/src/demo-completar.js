// Agrega fotos/avatares/datos personales de demostración a una base que ya tiene el seed (idempotente).
import { completarDemo } from './demo-fotos.js';
import { cerrarDb, getDb, initSchema } from './db.js';

await initSchema();
const r = await completarDemo(getDb());
console.log(`Listo: ${r.fotos} ilustraciones de garajes y ${r.avatares} avatares nuevos.`);
await cerrarDb();
