import { useRef, type ReactNode } from 'react';
import { Icono } from './ui';

/**
 * Lee una foto del celular, corrige su orientación y la reduce (lado máximo, JPEG) antes de subirla:
 * una foto de cámara de 6 MB queda en unos 200 KB y la subida es rápida incluso con datos móviles.
 */
export async function reducirImagen(archivo: File, lado = 1280, calidad = 0.82): Promise<string> {
  if (!archivo.type.startsWith('image/')) throw new Error('Elige un archivo de imagen (JPG, PNG o WebP).');
  if (archivo.size > 30 * 1024 * 1024) throw new Error('Esa imagen es demasiado pesada.');
  let origen: ImageBitmap | HTMLImageElement;
  let url: string | null = null;
  try {
    origen = await createImageBitmap(archivo, { imageOrientation: 'from-image' });
  } catch {
    url = URL.createObjectURL(archivo);
    origen = await new Promise<HTMLImageElement>((ok, mal) => {
      const img = new Image();
      img.onload = () => ok(img);
      img.onerror = () => mal(new Error('No pudimos leer esa imagen. Prueba con otra foto.'));
      img.src = url!;
    });
  }
  try {
    const ancho = 'naturalWidth' in origen ? origen.naturalWidth : origen.width;
    const alto = 'naturalHeight' in origen ? origen.naturalHeight : origen.height;
    const escala = Math.min(1, lado / Math.max(ancho, alto));
    const lienzo = document.createElement('canvas');
    lienzo.width = Math.max(1, Math.round(ancho * escala));
    lienzo.height = Math.max(1, Math.round(alto * escala));
    const ctx = lienzo.getContext('2d');
    if (!ctx) throw new Error('Tu navegador no pudo procesar la imagen.');
    ctx.fillStyle = '#fff'; // las PNG con transparencia quedan sobre blanco
    ctx.fillRect(0, 0, lienzo.width, lienzo.height);
    ctx.drawImage(origen, 0, 0, lienzo.width, lienzo.height);
    return lienzo.toDataURL('image/jpeg', calidad);
  } finally {
    if ('close' in origen) origen.close();
    if (url) URL.revokeObjectURL(url);
  }
}

export function Avatar({ foto, nombre, apellido = '', tam = 44 }: { foto?: string | null; nombre: string; apellido?: string; tam?: number }) {
  const iniciales = `${nombre.charAt(0)}${apellido.charAt(0)}`.toUpperCase();
  return (
    <span className="avatar" style={{ width: tam, height: tam, fontSize: tam * 0.4 }} aria-hidden="true">
      {foto ? <img src={foto} alt="" width={tam} height={tam} loading="lazy" /> : iniciales}
    </span>
  );
}

/** Botón que abre la galería o la cámara y entrega las fotos ya reducidas (data URL). */
export function BotonFoto({
  onFotos,
  onError,
  multiple = false,
  disabled = false,
  lado,
  className = 'btn secundario s',
  children,
}: {
  onFotos: (fotos: string[]) => void | Promise<void>;
  onError: (mensaje: string) => void;
  multiple?: boolean;
  disabled?: boolean;
  lado?: number;
  className?: string;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className={className} disabled={disabled} onClick={() => ref.current?.click()}>
        {children ?? (
          <>
            <Icono n="camara" /> Agregar foto
          </>
        )}
      </button>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        multiple={multiple}
        hidden
        onChange={async (e) => {
          const archivos = [...(e.target.files ?? [])];
          e.target.value = ''; // permite elegir la misma foto otra vez
          if (!archivos.length) return;
          try {
            const fotos: string[] = [];
            for (const a of archivos) fotos.push(await reducirImagen(a, lado));
            await onFotos(fotos);
          } catch (err) {
            onError(err instanceof Error ? err.message : 'No pudimos subir la foto.');
          }
        }}
      />
    </>
  );
}

/** Portada de un garaje: su foto o, si no tiene, un fondo con ícono. */
export function Portada({ foto, alto = 150 }: { foto?: string | null; alto?: number }) {
  return (
    <div className="portada" style={{ height: alto }}>
      {foto ? <img src={foto} alt="" loading="lazy" /> : <Icono n="casa" />}
    </div>
  );
}
