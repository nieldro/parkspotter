// Asistente de ParkSpotter: entiende frases en español («moto en Chapinero mañana de 8 a 12 por menos de
// 5 mil») y las convierte en filtros de búsqueda; también responde preguntas frecuentes.
// Funciona sin claves (intérprete local). Si se configura AI_BASE_URL/AI_API_KEY/AI_MODEL, un modelo de
// lenguaje hace la interpretación y, ante cualquier fallo, se vuelve al intérprete local.
import { config } from '../config.js';
import { SERVICIOS } from './servicios.js';
import { esFechaValida, hoyBogota, diaSemanaIso, HORA_RE } from './tiempo.js';

const quita = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const sumarDias = (fecha, n) => new Date(Date.parse(`${fecha}T00:00:00Z`) + n * 86400e3).toISOString().slice(0, 10);
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS = { lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6, domingo: 7 };
const NUM_PALABRA = { una: 1, un: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 };
const dos = (n) => String(n).padStart(2, '0');

// ---------- Extracción de cada dato ----------

function extraerPrecio(t) {
  const num = (s, mil) => {
    let v = s.replace(/\s/g, '');
    v = /^\d{1,3}([.,]\d{3})+$/.test(v) ? v.replace(/[.,]/g, '') : v.replace(',', '.');
    let n = Number(v);
    if (mil) n *= 1000;
    return Math.round(n);
  };
  const con = /(menos de|maximo|max\.?|presupuesto de|no mas de|por debajo de|hasta|bajo)\s*\$?\s*(\d[\d.,]*)\s*(mil|k)?/.exec(t);
  const sin = /\$\s*(\d[\d.,]*)\s*(mil|k)?|\b(\d[\d.,]*)\s*(mil|k)\b/.exec(t);
  const m = con ?? sin;
  if (!m) return { precio: null, resto: t };
  const bruto = con ? m[2] : (m[1] ?? m[3]);
  const mil = con ? m[3] : (m[2] ?? m[4]);
  let precio = num(bruto, Boolean(mil));
  // «menos de 5» se entiende como 5 mil; pero «de 8 hasta 12» es un horario, no un precio.
  if (con && !mil && precio > 0 && precio < 100 && /menos de|maximo|max|presupuesto|no mas de|por debajo/.test(m[1])) precio *= 1000;
  const valido = precio >= 500 && precio <= 100000;
  return { precio: valido ? precio : null, resto: valido ? t.replace(m[0], ' ') : t };
}

function extraerFecha(t, hoy) {
  // Las franjas «por la mañana» no son «mañana» (el día siguiente).
  const franjaAm = /\b(?:por|en|de|durante) la manana\b|\besta manana\b/.test(t);
  const limpio = t.replace(/\b(?:por|en|de|durante) la manana\b|\besta manana\b/g, ' ');
  let m;
  if (/\bpasado manana\b/.test(limpio)) return { fecha: sumarDias(hoy, 2), franjaAm, resto: limpio.replace('pasado manana', ' ') };
  if (/\bhoy\b/.test(limpio)) return { fecha: hoy, franjaAm, resto: limpio.replace(/\bhoy\b/, ' ') };
  if (/\bmanana\b/.test(limpio)) return { fecha: sumarDias(hoy, 1), franjaAm, resto: limpio.replace(/\bmanana\b/, ' ') };
  if ((m = new RegExp(`\\b(\\d{1,2}) de (${MESES.join('|')})(?: de (\\d{4}))?\\b`).exec(limpio))) {
    const mes = MESES.indexOf(m[2]) + 1;
    let anio = m[3] ? Number(m[3]) : Number(hoy.slice(0, 4));
    let f = `${anio}-${dos(mes)}-${dos(m[1])}`;
    if (!m[3] && f < hoy) f = `${anio + 1}-${dos(mes)}-${dos(m[1])}`;
    if (esFechaValida(f)) return { fecha: f, franjaAm, resto: limpio.replace(m[0], ' ') };
  }
  if ((m = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(limpio))) {
    const anioTxt = m[3] ? (m[3].length === 2 ? `20${m[3]}` : m[3]) : hoy.slice(0, 4);
    let f = `${anioTxt}-${dos(m[2])}-${dos(m[1])}`;
    if (!m[3] && esFechaValida(f) && f < hoy) f = `${Number(anioTxt) + 1}-${dos(m[2])}-${dos(m[1])}`;
    if (esFechaValida(f)) return { fecha: f, franjaAm, resto: limpio.replace(m[0], ' ') };
  }
  if ((m = new RegExp(`\\b(?:el |este |proximo )?(${Object.keys(DIAS).join('|')})\\b`).exec(limpio))) {
    const delta = (DIAS[m[1]] - diaSemanaIso(hoy) + 7) % 7 || 7;
    return { fecha: sumarDias(hoy, delta), franjaAm, resto: limpio.replace(m[0], ' ') };
  }
  return { fecha: null, franjaAm, resto: limpio };
}

function a24(h, merid, resto) {
  if (merid) {
    const pm = merid.startsWith('p');
    return pm ? (h < 12 ? h + 12 : h) : h === 12 ? 0 : h;
  }
  if (h >= 1 && h <= 6) return h + 12; // «a las 3» al hablar de parqueo se entiende como la tarde
  return resto ?? h;
}

function redondear(h, mi) {
  let total = h * 60 + (mi ?? 0);
  total = Math.round(total / 30) * 30;
  return Math.min(total, 24 * 60);
}
const hhmm = (min) => `${dos(Math.floor(min / 60))}:${dos(min % 60)}`;

function extraerHoras(t, franjaAm) {
  let m = /(?:de|entre|desde)\s*(?:las\s*)?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\s*(?:a|hasta|y|-)\s*(?:las\s*)?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?/.exec(t);
  if (m) {
    const mer = (x) => (x ? x.replace(/\./g, '') : null);
    const mi1 = mer(m[3]);
    const mi2 = mer(m[6]) ?? mi1;
    let ini = a24(Number(m[1]), mi1);
    let fin = a24(Number(m[4]), mi2);
    if (!mi1 && !mi2 && fin <= ini && fin + 12 <= 24) fin += 12; // «de 10 a 2» → 10–14
    let a = redondear(ini, m[2] ? Number(m[2]) : 0);
    let b = redondear(fin, m[5] ? Number(m[5]) : 0);
    if (b === 0) b = 24 * 60; // «hasta las 12 de la noche»
    if (a < b) return { desde: hhmm(a), hasta: hhmm(b), resto: t.replace(m[0], ' ') };
  }
  m = /a las\s*(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?/.exec(t);
  if (m) {
    const mer = m[3] ? m[3].replace(/\./g, '') : null;
    const dur = /(?:por|durante)\s*(\d{1,2}|una|un|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s*horas?/.exec(t);
    const horas = dur ? (NUM_PALABRA[dur[1]] ?? Number(dur[1])) : 2;
    const a = redondear(a24(Number(m[1]), mer), m[2] ? Number(m[2]) : 0);
    const b = a + horas * 60;
    if (b <= 24 * 60) {
      return { desde: hhmm(a), hasta: hhmm(b), duracionSupuesta: !dur, resto: t.replace(m[0], ' ').replace(dur?.[0] ?? '', ' ') };
    }
  }
  if (franjaAm || /\b(?:por|en|de) la manana\b/.test(t)) return { desde: '08:00', hasta: '12:00', resto: t };
  if (/\b(?:por|en|de) la tarde\b/.test(t)) return { desde: '14:00', hasta: '18:00', resto: t };
  if (/\b(?:por|en|de) la noche\b/.test(t)) return { desde: '18:00', hasta: '22:00', resto: t };
  return { desde: null, hasta: null, resto: t };
}

const PARAR = /\b(?:para|las|por|con|que|menos|maximo|hasta|manana|hoy|pasado|este|proximo|moto|carro|desde|entre|barato|economico|y|a)\b/;

function extraerLugar(t, vocabulario) {
  const ordenado = [...vocabulario].sort((a, b) => b.length - a.length);
  for (const v of ordenado) {
    const n = quita(v);
    if (n.length >= 3 && new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(t)) return { lugar: v, vocabulario: true };
  }
  const m = /(?:\ben|\bpor|cerca de|cerca a|zona|barrio|sector)\s+(?:la |el |los |las )?([a-z0-9][a-z0-9 ]{2,28})/.exec(t);
  if (m) {
    const corte = m[1].search(PARAR);
    const cand = (corte > 0 ? m[1].slice(0, corte) : m[1]).trim();
    if (cand.length >= 3 && !/^(moto|carro|auto|bogota|parqueadero|garaje|\d)/.test(cand)) return { lugar: cand, vocabulario: false };
  }
  return { lugar: null, vocabulario: false };
}

const PALABRAS_SERVICIO = [
  ['techo_alto', /\b(techo alto|techo elevado|altura|camioneta alta|furgon)\b/],
  ['porton_electrico', /\b(porton (electrico|automatico)|puerta (electrica|automatica)|control remoto)\b/],
  ['cargador_ev', /\b(cargador|carga electrica|carga para (carro|moto|vehiculo)s? electric|punto de carga|carro electrico|moto electrica|vehiculo electrico)\b/],
  ['camaras', /\b(camara|camaras|cctv)\b/],
  ['vigilancia', /\b(vigilancia|vigilado|vigilante|vigilantes|seguridad|porteria)\b/],
  ['abierto_24h', /\b(24 ?h(oras)?|24\/7|todo el dia y la noche|toda la noche|veinticuatro horas)\b/],
  ['cubierto', /\b(cubierto|cubierta|techado|techada|bajo techo|con techo|sotano)\b/],
];

function extraerServicios(t) {
  return PALABRAS_SERVICIO.filter(([, re]) => re.test(t)).map(([s]) => s);
}

/** Interpreta una frase: devuelve lo que entendió, sin tocar la base de datos. */
export function interpretarLocal(mensaje, { vocabulario = [], hoy = hoyBogota() } = {}) {
  let t = ` ${quita(mensaje).replace(/[¿?¡!,;]/g, ' ').replace(/\s+/g, ' ')} `;
  const r = {};

  if (/\bmoto(s|cicleta)?\b/.test(t)) r.vehiculo = 'moto';
  else if (/\b(carro|carros|auto|autos|automovil|camioneta|coche|vehiculo)\b/.test(t)) r.vehiculo = 'carro';

  const servicios = extraerServicios(t);
  if (servicios.length) r.servicios = servicios;

  const p = extraerPrecio(t);
  if (p.precio) r.precio_max = p.precio;
  t = p.resto;

  const f = extraerFecha(t, hoy);
  if (f.fecha) r.fecha = f.fecha;
  t = f.resto;

  const h = extraerHoras(t, f.franjaAm);
  if (h.desde) {
    r.desde = h.desde;
    r.hasta = h.hasta;
    if (h.duracionSupuesta) r.duracionSupuesta = true;
  }
  t = h.resto;

  if (/\b(barato|baratos|economico|economicos|menor precio|mas barato)\b/.test(t)) r.orden = 'precio';
  else if (/\b(mejor calificado|mejores calificados|mejor valorado|mejor puntuado)\b/.test(t)) r.orden = 'calificacion';
  else if (/\b(mas cerca|mas cercano|cercanos)\b/.test(t)) r.orden = 'distancia';

  if (/cerca de mi\b|cerca mio|cerca de aqui|mi ubicacion|donde estoy|cerca de donde estoy/.test(t)) r.cerca_de_mi = true;
  else {
    const l = extraerLugar(t, vocabulario);
    if (l.lugar) {
      r.q = l.lugar;
      r.lugarConocido = l.vocabulario;
    }
  }
  return r;
}

// ---------- Preguntas frecuentes (los datos son los mismos que aplica la app) ----------

export const PREGUNTAS = [
  {
    claves: [/\b(pag|tarjeta|pse\b|efectivo|cobr|dinero|plata)/],
    texto:
      'Los pagos en esta versión son simulados: no se cobra dinero ni se piden datos de tarjeta. Al reservar eliges tarjeta, PSE o efectivo; con tarjeta o PSE el pago queda «aprobado» cuando el propietario acepta, y en efectivo se paga al llegar.',
  },
  {
    claves: [/\bcancel/],
    texto:
      'Puedes cancelar mientras la reserva no haya empezado: entra a Reservas, abre la reserva y toca «Cancelar». El horario se libera y el pago simulado pasa a «reembolsado». Después de la hora de entrada ya no se puede cancelar.',
  },
  {
    claves: [/\b(confirm|acept|respond|respuesta|tard|esperar)/, /\bpendiente/],
    texto:
      'Cada reserva queda «pendiente» hasta que el propietario la acepta o la rechaza. Mientras está pendiente el horario ya queda apartado para ti. Si el propietario no responde antes de la hora de entrada, la solicitud se cancela sola.',
  },
  {
    claves: [/\b(public|ofrec|alquilar mi|mi garaje|tengo un garaje|propietario|ganar|ingreso)/],
    texto:
      'Para ofrecer tu garaje: ve a «Ofrecer» → «Publicar garaje», ponle nombre, ubícalo en el mapa, define tarifa por hora, capacidad y horarios, y sube fotos (hasta 6). Cuando lo publiques aparece en las búsquedas y recibirás solicitudes para aceptar o rechazar.',
  },
  {
    claves: [/\b(privacidad|datos|telefono|numero|acceso|instruccion|direccion exacta|segur|confianza)/],
    texto:
      'Tu privacidad está protegida: las instrucciones de acceso al garaje y el teléfono de la otra persona solo se muestran cuando la reserva está confirmada. Las contraseñas se guardan cifradas y las fotos se limpian de datos como la ubicación GPS.',
  },
  {
    claves: [/\b(calific|puntu|opinion|resena|estrella)/],
    texto:
      'Cuando termina una reserva confirmada, el conductor puede calificar el garaje de 1 a 5 estrellas y dejar un comentario, una sola vez por reserva. Las calificaciones se muestran en el garaje y ayudan a ordenar la búsqueda.',
  },
  {
    claves: [/\b(chat|mensaje|escrib|hablar|contact|comunic)/],
    texto:
      'Cada reserva tiene su chat con la otra persona: abre la reserva en «Reservas» y escribe en la sección «Chat». Está disponible mientras la reserva esté pendiente o confirmada (y hasta 24 horas después de terminar).',
  },
  {
    claves: [/\b(instal|descarg|app\b|aplicacion|celular)/],
    texto:
      'ParkSpotter se instala como una app desde el navegador: en Android abre el link en Chrome y toca «Instalar» (o menú ⋮ → Instalar app); en iPhone, en Safari toca Compartir → «Agregar a la pantalla de inicio». Queda con su ícono y a pantalla completa.',
  },
  {
    claves: [/\b(cost|cuesta|cuanto|tarifa|precio|valor)/],
    texto:
      'El costo es la tarifa por hora del garaje por el tiempo que reserves (en bloques de 30 minutos). Por ejemplo, 3 horas a $4.000 por hora son $12.000. Puedes ver el total antes de confirmar.',
  },
  {
    claves: [/\b(como funciona|que es|como reservo|como reservar|como se usa|ayuda|que puedes hacer)\b/],
    texto:
      'ParkSpotter conecta a conductores con dueños de garajes en desuso en Bogotá. Buscas por destino, día y hora, eliges un garaje, solicitas la reserva (placa y forma de pago) y el propietario la acepta. Al llegar ves las instrucciones de acceso. Si tienes garaje, también puedes publicarlo.',
  },
];

function responderFaq(t) {
  return PREGUNTAS.find((p) => p.claves.some((c) => c.test(t)))?.texto ?? null;
}

export const SUGERENCIAS = [
  'Parqueadero para moto mañana de 8 a 12',
  'Garaje barato en Chapinero hoy a las 3 pm por 2 horas',
  '¿Cómo cancelo una reserva?',
  'Muéstrame mis reservas',
];

// ---------- Modelo de lenguaje opcional ----------

const iaActiva = () => Boolean(config.ia.url && config.ia.modelo);

async function interpretarConModelo(mensaje, contexto, hoy, vocabulario) {
  const sistema = [
    'Eres el asistente de ParkSpotter, una app para alquilar garajes en desuso como parqueadero en Bogotá.',
    `Hoy es ${hoy} (hora de Bogotá). Responde SOLO un objeto JSON, sin texto adicional, con estas claves:`,
    '"intencion": "buscar" | "mis_reservas" | "faq" | "saludo" | "otro";',
    '"vehiculo": "carro" | "moto" | null; "fecha": "AAAA-MM-DD" | null; "desde": "HH:MM" | null; "hasta": "HH:MM" | null (bloques de 30 min);',
    '"servicios": lista con cualquiera de cubierto, vigilancia, camaras, porton_electrico, techo_alto, cargador_ev, abierto_24h (vacía si no pidió);',
    '"precio_max": entero en pesos | null; "lugar": barrio, localidad o sitio mencionado | null; "orden": "precio" | "calificacion" | "distancia" | null; "cerca_de_mi": true | false;',
    '"respuesta": para "faq", "saludo" u "otro", una respuesta breve y amable en español (máximo 3 frases) usando SOLO estos hechos:',
    PREGUNTAS.map((p) => `- ${p.texto}`).join(' '),
    'Si algo no está en esos hechos, di que no lo sabes. Nunca inventes precios ni garajes. Barrios que existen en la plataforma: ' + vocabulario.slice(0, 40).join(', ') + '.',
    contexto && Object.keys(contexto).length ? `Búsqueda anterior de la conversación: ${JSON.stringify(contexto)}. Si el mensaje la modifica, conserva lo no mencionado.` : '',
  ].join('\n');
  const resp = await fetch(`${config.ia.url}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(config.ia.clave && { authorization: `Bearer ${config.ia.clave}` }) },
    body: JSON.stringify({
      model: config.ia.modelo,
      temperature: 0.2,
      max_tokens: 400,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: sistema }, { role: 'user', content: mensaje }],
    }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!resp.ok) throw new Error(`modelo respondió ${resp.status}`);
  const cuerpo = await resp.json();
  const bruto = cuerpo?.choices?.[0]?.message?.content ?? '';
  const j = JSON.parse(bruto.replace(/^```(?:json)?|```$/g, '').trim());

  const r = { intencion: ['buscar', 'mis_reservas', 'faq', 'saludo', 'otro'].includes(j.intencion) ? j.intencion : 'otro' };
  if (['carro', 'moto'].includes(j.vehiculo)) r.vehiculo = j.vehiculo;
  if (typeof j.fecha === 'string' && esFechaValida(j.fecha) && j.fecha >= hoy) r.fecha = j.fecha;
  if (typeof j.desde === 'string' && typeof j.hasta === 'string' && HORA_RE.test(j.desde) && HORA_RE.test(j.hasta) && j.desde < j.hasta) {
    r.desde = j.desde;
    r.hasta = j.hasta;
  }
  if (Number.isInteger(j.precio_max) && j.precio_max >= 500 && j.precio_max <= 100000) r.precio_max = j.precio_max;
  if (Array.isArray(j.servicios)) {
    const validos = j.servicios.filter((s) => SERVICIOS.includes(s));
    if (validos.length) r.servicios = [...new Set(validos)];
  }
  if (typeof j.lugar === 'string' && j.lugar.trim().length >= 3) {
    r.q = j.lugar.trim().slice(0, 60);
    r.lugarConocido = vocabulario.some((v) => quita(v) === quita(r.q));
  }
  if (['precio', 'calificacion', 'distancia'].includes(j.orden)) r.orden = j.orden;
  if (j.cerca_de_mi === true) r.cerca_de_mi = true;
  if (typeof j.respuesta === 'string' && j.respuesta.trim()) r.respuesta = j.respuesta.trim().slice(0, 700);
  return r;
}

// ---------- Orquestación ----------

const CAMPOS_BUSQUEDA = ['vehiculo', 'fecha', 'desde', 'hasta', 'precio_max', 'q', 'orden', 'cerca_de_mi', 'servicios'];

/**
 * Entiende el mensaje y decide qué hacer. No consulta la base: devuelve `intencion` y los filtros
 * resultantes (mezclados con los de la conversación anterior), listos para que la ruta busque.
 */
export async function entender(mensaje, { contexto = {}, vocabulario = [], hoy = hoyBogota() } = {}) {
  const t = ` ${quita(mensaje).replace(/[¿?¡!,;.]/g, ' ').replace(/\s+/g, ' ')} `;
  let nuevo = null;
  let motor = 'local';
  if (iaActiva()) {
    try {
      nuevo = await interpretarConModelo(mensaje, contexto, hoy, vocabulario);
      motor = 'modelo';
    } catch (e) {
      console.warn(`Asistente: el modelo falló (${e.message}); se usa el intérprete local.`);
    }
  }
  const local = interpretarLocal(mensaje, { vocabulario, hoy });
  // Un «lugar» adivinado de la frase no basta para decir que es una búsqueda (podría ser una pregunta).
  const hayBusqueda = CAMPOS_BUSQUEDA.some((k) => (k === 'q' ? local.q && local.lugarConocido : local[k] !== undefined));

  let intencion = nuevo?.intencion;
  if (!intencion) {
    if (/^ ?(hola|buenas|buenos dias|buen dia|buenas tardes|buenas noches|hey|ey|saludos|que mas)( .{0,20})? $/.test(t) && !hayBusqueda) intencion = 'saludo';
    else if (/\b(mis reservas|mi reserva|proxima reserva|reservas que tengo|que reservas|mis solicitudes|tengo reservas)\b/.test(t)) intencion = 'mis_reservas';
    else if (!hayBusqueda && responderFaq(t)) intencion = 'faq';
    else if (hayBusqueda || /\b(busco|buscar|necesito|quiero|donde|hay|parqueadero|parqueo|garaje|estacionar|parquear|aparcar)\b/.test(t)) intencion = 'buscar';
    else intencion = 'otro';
  }

  const fuente = nuevo ?? local;
  const seguimiento = intencion === 'buscar' && contexto && Object.keys(contexto).length > 0;
  const filtros = {};
  for (const k of CAMPOS_BUSQUEDA) {
    const v = fuente[k] ?? (nuevo ? local[k] : undefined); // lo que el modelo no vio, lo completa el intérprete local
    if (v !== undefined) filtros[k] = v;
    else if (seguimiento && contexto[k] !== undefined) filtros[k] = contexto[k];
  }
  // El horario va en pareja y exige fecha.
  if (!filtros.desde || !filtros.hasta) {
    delete filtros.desde;
    delete filtros.hasta;
  }
  return {
    intencion,
    filtros,
    motor,
    lugarConocido: fuente.lugarConocido ?? local.lugarConocido ?? false,
    duracionSupuesta: Boolean(local.duracionSupuesta && !nuevo),
    respuestaLibre: nuevo?.respuesta ?? null,
    faq: responderFaq(t),
  };
}
