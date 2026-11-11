const cop = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
export const dinero = (n: number) => cop.format(n);

export const DIAS_CORTOS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
export const DIAS_LARGOS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
export const INICIALES_DIAS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

/** "14:30" -> "2:30 p. m."; "24:00" -> "12:00 a. m." */
export function hora12(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const hh = h % 24;
  const sufijo = hh >= 12 ? 'p. m.' : 'a. m.';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${sufijo}`;
}

export const rangoHoras = (a: string, b: string) => `${hora12(a)} – ${hora12(b)}`;

export function fechaLarga(fecha: string): string {
  const d = new Date(`${fecha}T12:00:00`);
  return new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: 'numeric', month: 'long' }).format(d);
}

export function fechaCorta(fecha: string): string {
  const d = new Date(`${fecha}T12:00:00`);
  return new Intl.DateTimeFormat('es-CO', { weekday: 'short', day: 'numeric', month: 'short' }).format(d).replace('.', '');
}

export function fechaHora(iso: string): string {
  return new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

/** Fecha de hoy en Bogotá (AAAA-MM-DD), sin depender de la zona del dispositivo. */
export function hoyBogota(): string {
  return new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10);
}

export function sumarDias(fecha: string, n: number): string {
  return new Date(Date.parse(`${fecha}T00:00:00Z`) + n * 86400e3).toISOString().slice(0, 10);
}

export function minutosAhoraBogota(): number {
  const d = new Date(Date.now() - 5 * 3600e3);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

export const aMinutos = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
export const deMinutos = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** Día ISO (1 = lunes ... 7 = domingo) de una fecha AAAA-MM-DD. */
export function diaIso(fecha: string): number {
  const d = new Date(`${fecha}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

export interface Segmento {
  ini: number;
  fin: number;
}

/** Ventanas ofrecidas menos los tramos llenos, en minutos. */
export function segmentosLibres(
  ventanas: { hora_inicio: string; hora_fin: string }[],
  llenos: { hora_inicio: string; hora_fin: string }[],
  desdeMin = 0,
): Segmento[] {
  let libres: Segmento[] = ventanas.map((v) => ({ ini: Math.max(aMinutos(v.hora_inicio), desdeMin), fin: aMinutos(v.hora_fin) }));
  for (const l of llenos) {
    const a = aMinutos(l.hora_inicio);
    const b = aMinutos(l.hora_fin);
    libres = libres.flatMap((s) => {
      if (b <= s.ini || a >= s.fin) return [s];
      const partes: Segmento[] = [];
      if (a > s.ini) partes.push({ ini: s.ini, fin: a });
      if (b < s.fin) partes.push({ ini: b, fin: s.fin });
      return partes;
    });
  }
  // Se redondea al siguiente bloque de 30 minutos: las reservas van de media en media hora.
  return libres
    .map((s) => ({ ini: Math.ceil(s.ini / 30) * 30, fin: Math.floor(s.fin / 30) * 30 }))
    .filter((s) => s.fin - s.ini >= 30)
    .sort((x, y) => x.ini - y.ini);
}

/** Resume ventanas semanales: "Lun–Vie · 6:00 a. m. – 8:00 p. m." */
export function resumirHorarios(ventanas: { dia_semana: number; hora_inicio: string; hora_fin: string }[]): { dias: string; horas: string }[] {
  const porHorario = new Map<string, number[]>();
  for (const v of ventanas) {
    const k = `${v.hora_inicio}|${v.hora_fin}`;
    porHorario.set(k, [...(porHorario.get(k) ?? []), v.dia_semana]);
  }
  return [...porHorario.entries()]
    .map(([k, dias]) => {
      const [a, b] = k.split('|');
      dias.sort((x, y) => x - y);
      const grupos: number[][] = [];
      for (const d of dias) {
        const ultimo = grupos[grupos.length - 1];
        if (ultimo && ultimo[ultimo.length - 1] === d - 1) ultimo.push(d);
        else grupos.push([d]);
      }
      const texto = grupos
        .map((g) => (g.length === 1 ? DIAS_CORTOS[g[0] - 1] : g.length === 7 ? 'Todos los días' : `${DIAS_CORTOS[g[0] - 1]}–${DIAS_CORTOS[g[g.length - 1] - 1]}`))
        .join(', ');
      return { dias: texto, horas: a === '00:00' && b === '24:00' ? 'Las 24 horas' : rangoHoras(a, b), orden: dias[0] };
    })
    .sort((x, y) => x.orden - y.orden)
    .map(({ dias, horas }) => ({ dias, horas }));
}

export const etiquetaVehiculo = (v: string) => (v === 'carro' ? 'Carros' : v === 'moto' ? 'Motos' : 'Carros y motos');
export const etiquetaPago = (m: string) => (m === 'tarjeta' ? 'Tarjeta' : m === 'pse' ? 'PSE' : 'Efectivo');
export const etiquetaEstado: Record<string, string> = {
  pendiente: 'Pendiente',
  confirmada: 'Confirmada',
  rechazada: 'Rechazada',
  cancelada: 'Cancelada',
  finalizada: 'Finalizada',
  activo: 'Activo',
  inactivo: 'Pausado',
  suspendido: 'Suspendido',
  abierto: 'Abierto',
  resuelto: 'Resuelto',
};

export function enlaceComoLlegar(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}
