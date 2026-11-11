import type { NombreIcono } from './ui';

// Servicios que puede ofrecer un garaje (los mismos identificadores que valida el servidor).
export const SERVICIOS: { id: string; etiqueta: string; icono: NombreIcono }[] = [
  { id: 'cubierto', etiqueta: 'Cubierto', icono: 'casa' },
  { id: 'vigilancia', etiqueta: 'Vigilancia', icono: 'escudo' },
  { id: 'camaras', etiqueta: 'Cámaras', icono: 'ojo' },
  { id: 'porton_electrico', etiqueta: 'Portón eléctrico', icono: 'porton' },
  { id: 'techo_alto', etiqueta: 'Techo alto', icono: 'altura' },
  { id: 'cargador_ev', etiqueta: 'Cargador eléctrico', icono: 'rayo' },
  { id: 'abierto_24h', etiqueta: 'Acceso 24 h', icono: 'reloj' },
];
export const servicioDe = (id: string) => SERVICIOS.find((s) => s.id === id);
