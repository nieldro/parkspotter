import { cerrarDb, initSchema } from './db.js';

await initSchema();
console.log('Esquema de base de datos listo.');
await cerrarDb();
