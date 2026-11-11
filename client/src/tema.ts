// Tema de la app: automático (sigue al teléfono), claro u oscuro. Se aplica antes de pintar para que no parpadee.
export type Tema = 'auto' | 'claro' | 'oscuro';
const CLAVE = 'parkspotter.tema';
const COLORES = { claro: '#ffffff', oscuro: '#0b1220' };

export const temaGuardado = (): Tema => {
  const t = localStorage.getItem(CLAVE);
  return t === 'claro' || t === 'oscuro' ? t : 'auto';
};

export function aplicarTema(tema: Tema) {
  const raiz = document.documentElement;
  if (tema === 'auto') {
    raiz.removeAttribute('data-tema');
    localStorage.removeItem(CLAVE);
  } else {
    raiz.setAttribute('data-tema', tema);
    localStorage.setItem(CLAVE, tema);
  }
  // La barra de estado del navegador toma este color: se alinea con el tema elegido.
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
    const original = m.getAttribute('data-original') ?? m.getAttribute('content') ?? '';
    m.setAttribute('data-original', original);
    m.setAttribute('content', tema === 'auto' ? original : COLORES[tema]);
  });
}
