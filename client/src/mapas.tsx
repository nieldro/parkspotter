import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect } from 'react';
import { MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import { Link } from 'react-router-dom';
import { dinero } from './format';
import { CENTRO_BOGOTA } from './geocodificar';
import type { Garaje } from './types';

const ATRIBUCION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
// La política de OpenStreetMap pide el dominio sin subdominios y que la petición lleve Referer (si no, responde
// 403 «Access blocked»): por eso se fija la política de referrer también en la capa.
const MOSAICOS = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const CAPA = { attribution: ATRIBUCION, url: MOSAICOS, maxZoom: 19, referrerPolicy: 'strict-origin-when-cross-origin' } as const;

const pinPrecio = (g: Garaje) =>
  L.divIcon({
    className: '',
    html: `<div class="pin-precio">${dinero(g.tarifa_hora).replace(/\s/g, '')}</div>`,
    iconSize: [74, 26],
    iconAnchor: [37, 13],
    popupAnchor: [0, -14],
  });

const pinYo = L.divIcon({ className: '', html: '<div class="pin-yo"></div>', iconSize: [18, 18], iconAnchor: [9, 9] });

const pinGaraje = L.divIcon({
  className: '',
  html: `<svg class="pin-garaje" width="38" height="46" viewBox="0 0 24 29" fill="currentColor"><path d="M12 0C5.9 0 1 4.8 1 10.8 1 19 12 29 12 29s11-10 11-18.2C23 4.8 18.1 0 12 0Z"/><circle cx="12" cy="11" r="5" fill="#fff"/></svg>`,
  iconSize: [38, 46],
  iconAnchor: [19, 44],
});

function AjustarVista({ garajes, yo }: { garajes: Garaje[]; yo?: { lat: number; lng: number } | null }) {
  const mapa = useMap();
  useEffect(() => {
    const puntos: [number, number][] = garajes.map((g) => [g.latitud, g.longitud]);
    if (yo) puntos.push([yo.lat, yo.lng]);
    if (puntos.length === 0) mapa.setView(CENTRO_BOGOTA, 12);
    else if (puntos.length === 1) mapa.setView(puntos[0], 15);
    else mapa.fitBounds(L.latLngBounds(puntos), { padding: [36, 36], maxZoom: 16 });
  }, [garajes, yo, mapa]);
  // Al mostrar el mapa tras estar oculto, Leaflet necesita recalcular su tamaño.
  useEffect(() => {
    const t = setTimeout(() => mapa.invalidateSize(), 60);
    return () => clearTimeout(t);
  }, [mapa]);
  return null;
}

export function MapaGarajes({ garajes, yo, className = 'mapa' }: { garajes: Garaje[]; yo?: { lat: number; lng: number } | null; className?: string }) {
  return (
    <MapContainer center={CENTRO_BOGOTA} zoom={12} className={className} scrollWheelZoom aria-label="Mapa de garajes">
      <TileLayer {...CAPA} />
      <AjustarVista garajes={garajes} yo={yo} />
      {yo && <Marker position={[yo.lat, yo.lng]} icon={pinYo} interactive={false} />}
      {garajes.map((g) => (
        <Marker key={g.id_garaje} position={[g.latitud, g.longitud]} icon={pinPrecio(g)}>
          <Popup>
            <div className="col s" style={{ minWidth: 150 }}>
              <b>{g.nombre}</b>
              <span>{dinero(g.tarifa_hora)} / hora</span>
              <Link to={`/garaje/${g.id_garaje}${window.location.search}`}>Ver garaje</Link>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}

/** Mapa pequeño de solo lectura para la ficha del garaje. */
export function MapaFijo({ lat, lng }: { lat: number; lng: number }) {
  return (
    <MapContainer
      center={[lat, lng]}
      zoom={16}
      className="mapa bajo"
      scrollWheelZoom={false}
      dragging={!L.Browser.mobile}
      aria-label="Ubicación del garaje"
    >
      <TileLayer {...CAPA} />
      <Marker position={[lat, lng]} icon={pinGaraje} interactive={false} />
    </MapContainer>
  );
}

function Clics({ onElegir }: { onElegir: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onElegir(e.latlng.lat, e.latlng.lng) });
  return null;
}

function Centrar({ lat, lng }: { lat: number; lng: number }) {
  const mapa = useMap();
  useEffect(() => {
    mapa.setView([lat, lng], Math.max(mapa.getZoom(), 16));
  }, [lat, lng, mapa]);
  return null;
}

/** Selector de ubicación: toca el mapa o arrastra el pin. */
export function MapaSelector({ lat, lng, onElegir }: { lat: number | null; lng: number | null; onElegir: (lat: number, lng: number) => void }) {
  const hay = lat != null && lng != null;
  return (
    <MapContainer center={hay ? [lat, lng] : CENTRO_BOGOTA} zoom={hay ? 16 : 12} className="mapa picker" scrollWheelZoom={false} aria-label="Elige la ubicación del garaje">
      <TileLayer {...CAPA} />
      <Clics onElegir={onElegir} />
      {hay && (
        <>
          <Centrar lat={lat} lng={lng} />
          <Marker
            position={[lat, lng]}
            icon={pinGaraje}
            draggable
            eventHandlers={{
              dragend: (e) => {
                const p = (e.target as L.Marker).getLatLng();
                onElegir(p.lat, p.lng);
              },
            }}
          />
        </>
      )}
    </MapContainer>
  );
}
