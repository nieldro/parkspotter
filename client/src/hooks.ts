import { useCallback, useEffect, useRef, useState } from 'react';
import { mensajeDeError } from './api';

/** Carga datos al montar (y cuando cambian las dependencias) con estados de carga y error. */
export function useCarga<T>(cargar: () => Promise<T>, deps: unknown[]) {
  const [datos, setDatos] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const version = useRef(0);
  const cargarRef = useRef(cargar);
  cargarRef.current = cargar;

  const recargar = useCallback(async (silencioso = false) => {
    const mia = ++version.current;
    if (!silencioso) setCargando(true);
    try {
      const r = await cargarRef.current();
      if (mia === version.current) {
        setDatos(r);
        setError(null);
      }
    } catch (e) {
      if (mia === version.current) setError(mensajeDeError(e));
    } finally {
      if (mia === version.current) setCargando(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void recargar(), deps);
  return { datos, error, cargando, recargar, setDatos };
}

export function useTitulo(titulo: string) {
  useEffect(() => {
    document.title = titulo ? `${titulo} · ParkSpotter` : 'ParkSpotter · Alquila garajes como parqueadero en Bogotá';
  }, [titulo]);
}
