import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from './api';
import { useSesion } from './auth';
import { useAvisos } from './avisos';

interface Favoritos {
  ids: Set<number>;
  alternar: (idGaraje: number) => Promise<void>;
}

const Contexto = createContext<Favoritos | null>(null);

export function ProveedorFavoritos({ children }: { children: ReactNode }) {
  const { usuario } = useSesion();
  const avisos = useAvisos();
  const [ids, setIds] = useState<Set<number>>(new Set());

  // Toques hechos mientras la lista inicial aún se descarga: se reaplican encima de lo que responda el servidor.
  const pendientes = useRef(new Map<number, boolean>());

  useEffect(() => {
    if (!usuario) return setIds(new Set());
    let vivo = true;
    pendientes.current.clear();
    api
      .get<{ ids: number[] }>('/favoritos/ids')
      .then((r) => {
        if (!vivo) return;
        const s = new Set(r.ids);
        for (const [id, guardado] of pendientes.current) {
          if (guardado) s.add(id);
          else s.delete(id);
        }
        pendientes.current.clear();
        setIds(s);
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [usuario]);

  // Cambio optimista: el corazón responde al instante y se revierte si el servidor falla.
  const alternar = useCallback(
    async (id: number) => {
      const guardado = ids.has(id);
      pendientes.current.set(id, !guardado);
      setIds((s) => {
        const n = new Set(s);
        if (guardado) n.delete(id);
        else n.add(id);
        return n;
      });
      try {
        if (guardado) await api.delete(`/favoritos/${id}`);
        else await api.post(`/favoritos/${id}`);
        if (!guardado) avisos.ok('Guardado en favoritos.');
      } catch (e) {
        pendientes.current.delete(id);
        setIds((s) => {
          const n = new Set(s);
          if (guardado) n.add(id);
          else n.delete(id);
          return n;
        });
        avisos.error(e instanceof Error ? e.message : 'No se pudo actualizar tus favoritos.');
      }
    },
    [ids, avisos],
  );

  const valor = useMemo(() => ({ ids, alternar }), [ids, alternar]);
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useFavoritos(): Favoritos {
  const v = useContext(Contexto);
  if (!v) throw new Error('useFavoritos debe usarse dentro de ProveedorFavoritos');
  return v;
}
