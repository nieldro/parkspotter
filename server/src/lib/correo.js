// Envío de correos por SMTP (nodemailer). Sirve con cualquier proveedor: Gmail (contraseña de aplicación), Brevo, Mailgun…
import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { HttpError } from './http.js';

/** ¿Hay un servidor SMTP configurado? Sin él no se envían códigos y las cuentas no piden verificación. */
export const correoActivo = () => Boolean(config.smtp.host);
/** Las cuentas nuevas verifican su correo solo si se puede enviar el código. */
export const verificacionActiva = () => correoActivo() && config.verificarCorreo;

let transporte = null;
function obtener() {
  transporte ??= nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    tls: { rejectUnauthorized: !config.smtp.permitirAutofirmado },
  });
  return transporte;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const TEXTOS = {
  verificar: {
    asunto: (c) => `${c} es tu código de ParkSpotter`,
    titulo: 'Confirma tu correo',
    intro: 'Usa este código para terminar de crear tu cuenta en ParkSpotter:',
  },
  restablecer: {
    asunto: (c) => `${c} es tu código para cambiar la contraseña`,
    titulo: 'Cambia tu contraseña',
    intro: 'Alguien (esperamos que tú) pidió cambiar la contraseña de tu cuenta de ParkSpotter. Usa este código:',
  },
};

/** Envía el código de 6 dígitos. Lanza 503 si el correo no sale (SMTP caído, clave mala, destinatario rechazado). */
export async function enviarCodigo({ para, nombre, codigo, proposito }) {
  const t = TEXTOS[proposito];
  const saludo = nombre ? `Hola, ${nombre}.` : 'Hola.';
  const texto = `${saludo}\n\n${t.intro}\n\n    ${codigo}\n\nVence en 15 minutos. Si no fuiste tú, ignora este mensaje: nadie puede entrar a tu cuenta sin el código.\n\nParkSpotter`;
  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#f3f6fb;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0f1729">
<div style="max-width:440px;margin:0 auto;padding:24px 16px">
  <div style="background:#fff;border-radius:16px;padding:28px 24px;border:1px solid #dde3ef">
    <div style="font-weight:800;font-size:18px;color:#0b5fff;margin-bottom:18px">ParkSpotter</div>
    <h1 style="font-size:20px;margin:0 0 10px">${esc(t.titulo)}</h1>
    <p style="margin:0 0 6px">${esc(saludo)}</p>
    <p style="margin:0 0 18px;color:#566178">${esc(t.intro)}</p>
    <div style="font-size:34px;font-weight:800;letter-spacing:10px;text-align:center;background:#e6efff;color:#0b5fff;border-radius:12px;padding:16px 8px 16px 18px;font-family:ui-monospace,Menlo,Consolas,monospace">${esc(codigo)}</div>
    <p style="margin:18px 0 0;color:#566178;font-size:14px">Vence en 15 minutos. Si no fuiste tú, ignora este mensaje: nadie puede entrar a tu cuenta sin el código.</p>
  </div>
</div></body></html>`;
  try {
    await obtener().sendMail({ from: config.smtp.from, to: para, subject: t.asunto(codigo), text: texto, html });
  } catch (e) {
    // Nunca se imprime la configuración (lleva la clave): solo el motivo.
    console.error('No se pudo enviar el correo:', e.code ?? '', e.responseCode ?? '', String(e.message).slice(0, 160));
    throw new HttpError(503, 'No pudimos enviar el correo con tu código. Revisa que esté bien escrito o inténtalo de nuevo en un momento.');
  }
}

/** Para cerrar la conexión al apagar o al terminar las pruebas. */
export function cerrarCorreo() {
  transporte?.close();
  transporte = null;
}
