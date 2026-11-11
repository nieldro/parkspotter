// Deja ParkSpotter accesible por un link público temporal desde este computador y lo mantiene vivo:
// si el servidor o el túnel se caen, los vuelve a levantar solos.
//
//   npm run demo:publico
//
// Requiere cloudflared (https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/);
// si no está en el PATH, indica su ruta con CLOUDFLARED=C:\ruta\cloudflared.exe
// El link cambia cada vez que el túnel se reinicia; el nuevo se imprime y se guarda en server/data/enlace-publico.txt
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUERTO = process.env.PORT || '3000';
const ARCHIVO_ENLACE = path.join(RAIZ, 'server', 'data', 'enlace-publico.txt');
const CLOUDFLARED = process.env.CLOUDFLARED || 'cloudflared';

// La clave de las sesiones se conserva entre reinicios para no cerrarle la sesión a nadie.
const ARCHIVO_CLAVE = path.join(RAIZ, 'server', 'data', 'jwt-secret.txt');
fs.mkdirSync(path.dirname(ARCHIVO_CLAVE), { recursive: true });
if (!fs.existsSync(ARCHIVO_CLAVE)) fs.writeFileSync(ARCHIVO_CLAVE, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
const JWT_SECRET = process.env.JWT_SECRET || fs.readFileSync(ARCHIVO_CLAVE, 'utf8').trim();

const hora = () => new Date().toLocaleTimeString('es-CO');
const log = (m) => console.log(`[${hora()}] ${m}`);

// Reinicia un proceso hijo cada vez que termina, con espera creciente (máx. 30 s) si falla seguido.
function mantener(nombre, comando, args, opciones, alLinea) {
  let fallos = 0;
  let actual = null;
  const lanzar = () => {
    const inicio = Date.now();
    const hijo = spawn(comando, args, { ...opciones, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    actual = hijo;
    for (const flujo of [hijo.stdout, hijo.stderr]) {
      let resto = '';
      flujo.on('data', (d) => {
        resto += d.toString();
        const lineas = resto.split(/\r?\n/);
        resto = lineas.pop() ?? '';
        for (const l of lineas) alLinea?.(l);
      });
    }
    hijo.on('error', (e) => log(`${nombre}: no se pudo iniciar (${e.message}).`));
    hijo.on('exit', (codigo) => {
      fallos = Date.now() - inicio > 60_000 ? 0 : fallos + 1;
      const espera = Math.min(30_000, 1000 * 2 ** fallos);
      log(`${nombre} terminó (código ${codigo}); se reinicia en ${Math.round(espera / 1000)} s.`);
      setTimeout(lanzar, espera);
    });
    log(`${nombre} iniciado.`);
  };
  lanzar();
  return { reiniciar: () => actual?.kill() }; // al terminar, el 'exit' de arriba lo vuelve a lanzar
}

mantener(
  'Servidor',
  process.execPath,
  ['server/src/index.js'],
  { cwd: RAIZ, env: { ...process.env, NODE_ENV: 'production', DEMO: process.env.DEMO ?? '1', JWT_SECRET, PORT: PUERTO } },
  (l) => l.trim() && console.log(`   servidor: ${l}`),
);

let enlace = null;
const tunel = mantener('Túnel', CLOUDFLARED, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${PUERTO}`], { cwd: RAIZ }, (l) => {
  const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(l);
  if (m) {
    enlace = m[0];
    fs.writeFileSync(ARCHIVO_ENLACE, `${m[0]}\n`);
    log(`LINK PÚBLICO: ${m[0]}`);
  }
});

// Los túneles gratuitos a veces pierden su dirección en internet aunque el programa siga corriendo (la app
// del celular dice «sin conexión»). Se comprueba el link desde fuera y, si no responde, se pide uno nuevo.
let sinRespuesta = 0;
setInterval(async () => {
  if (!enlace) return;
  try {
    const r = await fetch(`${enlace}/api/salud`, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    sinRespuesta = 0;
  } catch (e) {
    sinRespuesta += 1;
    log(`El link no responde (${sinRespuesta}/3): ${e.cause?.code ?? e.message}`);
    if (sinRespuesta >= 3) {
      sinRespuesta = 0;
      enlace = null;
      log('Se pide un link nuevo (el anterior ya no sirve).');
      tunel.reiniciar();
    }
  }
}, 30_000);
