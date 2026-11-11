import { useEffect, useRef, type ReactNode } from 'react';
import { etiquetaEstado } from './format';

const ICONOS = {
  buscar: 'M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16Zm10 2-4.3-4.3',
  calendario: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z',
  casa: 'm3 11 9-8 9 8M5 10v10h14V10M10 20v-6h4v6',
  usuario: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  campana: 'M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0',
  pin: 'M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Zm-8 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  mira: 'M12 2v4m0 12v4M2 12h4m12 0h4m-10 4a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  mas: 'M12 5v14M5 12h14',
  check: 'M20 6 9 17l-5-5',
  x: 'M18 6 6 18M6 6l12 12',
  reloj: 'M12 6v6l4 2m6-2a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
  telefono: 'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z',
  ruta: 'M3 11 22 2l-9 19-2-8-8-2Z',
  alerta: 'M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  info: 'M12 16v-4m0-4h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
  escudo: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z',
  carro: 'M5 17h14M3 13l2-6a2 2 0 0 1 1.9-1.4h10.2A2 2 0 0 1 19 7l2 6v4a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1v-1H7v1a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-4Zm4 0h.01M17 13h.01',
  moto: 'M5 18a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm14 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM12 18h4l-3-8H9m3 0 2-3h3',
  tarjeta: 'M2 7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7Zm0 3h20',
  descargar: 'M12 3v12m0 0 4-4m-4 4-4-4M4 21h16',
  salir: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 14 5-5-5-5m5 5H9',
  editar: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z',
  pausa: 'M10 4H6v16h4V4Zm8 0h-4v16h4V4Z',
  play: 'M6 3l14 9-14 9V3Z',
  panel: 'M3 3h7v9H3V3Zm11 0h7v5h-7V3ZM14 12h7v9h-7v-9ZM3 16h7v5H3v-5Z',
  ojo: 'M2 12s4-8 10-8 10 8 10 8-4 8-10 8S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  chispa: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Zm7 11 .9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9L19 14ZM5 15l.7 1.6L7.5 17l-1.8.4L5 19l-.7-1.6L2.5 17l1.8-.4L5 15Z',
  enviar: 'M22 2 11 13m11-11-7 20-4-9-9-4 20-7Z',
  camara: 'M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2Zm-11-2a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  imagen: 'M21 15l-5-5L5 21M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm4 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z',
  chat: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z',
  basura: 'M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14M10 11v6m4-6v6',
  estrella: 'M12 2.5 14.9 9l7.1.6-5.4 4.7 1.7 7-6.3-3.8L5.7 21.3l1.7-7L2 9.6 9.1 9 12 2.5Z',
  corazon: 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21.2l7.8-7.7 1-1.1a5.5 5.5 0 0 0 0-7.8Z',
  compartir: 'M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v13',
  rayo: 'M13 2 3 14h9l-1 8 10-12h-9l1-8Z',
  altura: 'M12 3v18m0-18-4 4m4-4 4 4m-4 14-4-4m4 4 4-4',
  porton: 'M4 21V6l8-3 8 3v15M4 21h16M8 21v-9h8v9M8 15h8',
  sol: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0-15v2m0 16v2M4.2 4.2l1.4 1.4m12.8 12.8 1.4 1.4M2 12h2m16 0h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  micro: 'M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm7-3a7 7 0 0 1-14 0m7 7v3',
  ojoNo: 'm3 3 18 18M10.6 10.6a3 3 0 0 0 4.2 4.2M9.9 5.1A9.6 9.6 0 0 1 12 4c6 0 10 8 10 8a17 17 0 0 1-3.2 4.2M6.6 6.6C3.6 8.6 2 12 2 12s4 8 10 8a9.7 9.7 0 0 0 4.4-1',
} as const;

export type NombreIcono = keyof typeof ICONOS;

export function Icono({ n, relleno = false }: { n: NombreIcono; relleno?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={relleno ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={ICONOS[n]} />
    </svg>
  );
}

export function Logo() {
  return (
    <svg viewBox="0 0 512 512" aria-hidden="true" focusable="false">
      <rect width="512" height="512" rx="112" fill="#0b5fff" />
      <path d="M96 232 256 108l160 124v188H96z" fill="#fff" />
      <path
        transform="translate(-40 8)"
        d="M236 200h60c36 0 60 22 60 54s-24 54-60 54h-34v52h-26zm26 26v56h32c20 0 32-11 32-28s-12-28-32-28z"
        fill="#0b5fff"
        fillRule="evenodd"
      />
      <rect x="96" y="400" width="320" height="20" fill="#ffb703" />
    </svg>
  );
}

const ESTRELLA = 'M12 2.5 14.9 9l7.1.6-5.4 4.7 1.7 7-6.3-3.8L5.7 21.3l1.7-7L2 9.6 9.1 9 12 2.5Z';

export function Estrellas({ valor, total }: { valor: number | null; total?: number }) {
  if (valor == null) return <span className="muted pequeno">Sin calificaciones</span>;
  return (
    <span className="fila" style={{ gap: 6 }} title={`${valor} de 5`}>
      <span className="estrellas" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d={ESTRELLA} /></svg>
      </span>
      <b>{valor.toFixed(1)}</b>
      {total !== undefined && <span className="muted pequeno">({total})</span>}
      <span className="sr-only">{`Calificación ${valor} de 5`}</span>
    </span>
  );
}

export function SelectorEstrellas({ valor, onChange }: { valor: number; onChange: (n: number) => void }) {
  return (
    <div className="selector-estrellas" role="group" aria-label="Puntuación">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className={n <= valor ? 'on' : ''}
          aria-pressed={n === valor}
          aria-label={`${n} ${n === 1 ? 'estrella' : 'estrellas'}`}
          onClick={() => onChange(n)}
        >
          <svg viewBox="0 0 24 24" fill="currentColor"><path d={ESTRELLA} /></svg>
        </button>
      ))}
    </div>
  );
}

export function Estado({ valor }: { valor: string }) {
  return <span className={`estado ${valor}`}>{etiquetaEstado[valor] ?? valor}</span>;
}

export function Vacio({ icono, titulo, children }: { icono: NombreIcono; titulo: string; children?: ReactNode }) {
  return (
    <div className="vacio">
      <Icono n={icono} />
      <h3>{titulo}</h3>
      {children}
    </div>
  );
}

export function Esqueletos({ n = 3 }: { n?: number }) {
  return (
    <div className="lista" aria-busy="true" aria-label="Cargando">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="esqueleto" />
      ))}
    </div>
  );
}

export function Alerta({ tipo = 'error', children }: { tipo?: 'error' | 'aviso' | 'ok'; children: ReactNode }) {
  const clase = tipo === 'error' ? 'error-caja' : tipo === 'aviso' ? 'aviso-caja' : 'ok-caja';
  return (
    <div className={clase} role={tipo === 'error' ? 'alert' : 'status'}>
      <Icono n={tipo === 'ok' ? 'check' : tipo === 'aviso' ? 'info' : 'alerta'} />
      <div>{children}</div>
    </div>
  );
}

/** Diálogo modal nativo (<dialog>): maneja foco, Escape y fondo por sí solo. */
export function Dialogo({ abierto, onCerrar, titulo, children }: { abierto: boolean; onCerrar: () => void; titulo: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (abierto && !d.open) d.showModal();
    if (!abierto && d.open) d.close();
  }, [abierto]);
  return (
    <dialog
      ref={ref}
      className="dialogo"
      aria-label={titulo}
      onClose={onCerrar}
      onClick={(e) => {
        if (e.target === ref.current) onCerrar();
      }}
    >
      {abierto && (
        <div className="dialogo-in">
          <div className="fila entre">
            <h2>{titulo}</h2>
            <button type="button" className="btn icono fantasma" onClick={onCerrar} aria-label="Cerrar">
              <Icono n="x" />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
