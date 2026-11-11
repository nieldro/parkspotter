// Búsqueda de direcciones con Nominatim (OpenStreetMap). Solo se consulta cuando la persona lo pide
// (sin autocompletar y con una pausa entre consultas), como exige la política de uso del servicio público.
export interface Lugar {
  lat: number;
  lng: number;
  nombre: string;
}

/**
 * Qué tan precisa fue la ubicación encontrada:
 *  · exacta: el edificio o la casa;  · calle: la vía, no el número;  · zona: solo el barrio o la localidad.
 * Las direcciones colombianas («Cra. 7 # 40-30») están poco mapeadas en OpenStreetMap, por eso casi nunca sale «exacta».
 */
export type Precision = 'exacta' | 'calle' | 'zona';
export interface Ubicacion extends Lugar {
  precision: Precision;
}

export const CENTRO_BOGOTA: [number, number] = [4.6533, -74.0836];

const ABREVIATURAS: [RegExp, string][] = [
  [/\b(?:cra|cr|kr|kra|carr)\.?(?=\s*\d)/gi, 'Carrera'],
  [/\b(?:cl|cll|cale)\.?(?=\s*\d)/gi, 'Calle'],
  [/\b(?:av|avda|ave)\.?(?=\s)/gi, 'Avenida'],
  [/\b(?:tv|trv|transv)\.?(?=\s*\d)/gi, 'Transversal'],
  [/\b(?:dg|diag)\.?(?=\s*\d)/gi, 'Diagonal'],
];

/** «Cra. 7 # 40-30 Apto 2» → «Carrera 7 40-30»: lo que Nominatim sí entiende. */
export function normalizarDireccion(d: string): string {
  let t = d.replace(/\b(?:apto|apartamento|casa|local|interior|int|torre|piso|of|oficina)\b\.?\s*\w*/gi, ' ');
  for (const [re, nombre] of ABREVIATURAS) t = t.replace(re, nombre);
  return t
    .replace(/\b(?:no|nro|num)\.?\s*(?=\d)/gi, ' ')
    .replace(/[#°º]/g, ' ')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

const TIPOS_EXACTOS = new Set(['house', 'building', 'amenity', 'shop', 'office', 'place', 'residential_building', 'apartments']);
const TIPOS_ZONA = new Set(['neighbourhood', 'quarter', 'suburb', 'city_district', 'borough', 'city', 'town', 'administrative']);

function precisionDe(tipo: string | undefined): Precision {
  if (tipo && TIPOS_EXACTOS.has(tipo)) return 'exacta';
  if (tipo && TIPOS_ZONA.has(tipo)) return 'zona';
  return 'calle';
}

const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function consultar(q: string): Promise<Ubicacion | null> {
  const url =
    'https://nominatim.openstreetmap.org/search?' +
    new URLSearchParams({
      format: 'jsonv2',
      q,
      countrycodes: 'co',
      viewbox: '-74.25,4.85,-73.98,4.45',
      bounded: '1',
      limit: '1',
      addressdetails: '1',
      'accept-language': 'es',
    });
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error('No se pudo consultar el buscador de direcciones.');
  const datos = (await r.json()) as { lat: string; lon: string; display_name: string; addresstype?: string; type?: string }[];
  if (!datos.length) return null;
  const d = datos[0];
  return {
    lat: Number(d.lat),
    lng: Number(d.lon),
    nombre: d.display_name.split(',').slice(0, 2).join(',').trim(),
    precision: precisionDe(d.addresstype ?? d.type),
  };
}

/**
 * Busca una dirección de Bogotá probando, de la más a la menos específica: dirección + localidad, dirección + barrio,
 * solo la dirección, el barrio y la localidad. Devuelve el primer resultado y qué tan preciso es, para que la
 * persona confirme (o corrija) el pin en el mapa.
 */
export async function ubicarDireccion(partes: { direccion: string; barrio?: string; localidad?: string }): Promise<Ubicacion | null> {
  const dir = normalizarDireccion(partes.direccion);
  const barrio = partes.barrio?.trim();
  const loc = partes.localidad?.trim();
  const candidatas = [
    dir && loc && `${dir}, ${loc}, Bogotá`,
    dir && barrio && `${dir}, ${barrio}, Bogotá`,
    dir && `${dir}, Bogotá`,
    barrio && `${barrio}${loc ? `, ${loc}` : ''}, Bogotá`,
    barrio && `${barrio}, Bogotá`,
    loc && `${loc}, Bogotá`,
  ].filter((q): q is string => Boolean(q));
  let primera = true;
  for (const q of [...new Set(candidatas)]) {
    if (!primera) await pausa(1100); // máximo una consulta por segundo
    primera = false;
    const u = await consultar(q);
    if (u) return u;
  }
  return null;
}

/** Compatibilidad: búsqueda libre de un lugar (barrio, universidad…) para el buscador de garajes. */
export async function geocodificar(consulta: string): Promise<Lugar | null> {
  const q = /bogot/i.test(consulta) ? consulta : `${consulta}, Bogotá`;
  return consultar(q);
}

export function ubicacionActual(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolver, rechazar) => {
    if (!('geolocation' in navigator)) return rechazar(new Error('Tu dispositivo no permite obtener la ubicación.'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolver({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (e) =>
        rechazar(
          new Error(
            e.code === e.PERMISSION_DENIED
              ? 'Permite el acceso a tu ubicación en el navegador, o escribe una dirección.'
              : 'No pudimos obtener tu ubicación. Escribe una dirección.',
          ),
        ),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
    );
  });
}
