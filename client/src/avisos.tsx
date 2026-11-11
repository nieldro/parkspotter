import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

interface Aviso {
  id: number;
  texto: string;
  tipo: 'ok' | 'error';
}

interface Avisos {
  ok: (texto: string) => void;
  error: (texto: string) => void;
}

const Contexto = createContext<Avisos | null>(null);

export function ProveedorAvisos({ children }: { children: ReactNode }) {
  const [lista, setLista] = useState<Aviso[]>([]);
  const siguiente = useRef(1);

  const mostrar = useCallback((texto: string, tipo: Aviso['tipo']) => {
    const id = siguiente.current++;
    setLista((l) => [...l.slice(-2), { id, texto, tipo }]);
    setTimeout(() => setLista((l) => l.filter((a) => a.id !== id)), tipo === 'error' ? 6000 : 3500);
  }, []);

  const valor = useMemo<Avisos>(() => ({ ok: (t) => mostrar(t, 'ok'), error: (t) => mostrar(t, 'error') }), [mostrar]);

  return (
    <Contexto.Provider value={valor}>
      {children}
      <div className="avisos" aria-live="polite">
        {lista.map((a) => (
          <div key={a.id} className={`aviso ${a.tipo === 'error' ? 'error' : ''}`} role={a.tipo === 'error' ? 'alert' : 'status'}>
            {a.texto}
          </div>
        ))}
      </div>
    </Contexto.Provider>
  );
}

export function useAvisos(): Avisos {
  const v = useContext(Contexto);
  if (!v) throw new Error('useAvisos debe usarse dentro de ProveedorAvisos');
  return v;
}
