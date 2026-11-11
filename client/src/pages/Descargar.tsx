import { useState } from 'react';
import { useInstalacion } from '../instalar';
import { Icono, Logo } from '../ui';

/** Lo único que ve quien abre el link desde un celular: presentación de la app y botón para instalarla. */
export function Descargar() {
  const { puedeInstalar, esIOS, integrado, instalar } = useInstalacion();
  const [pasos, setPasos] = useState(false);
  const [listo, setListo] = useState(false);
  const [copiado, setCopiado] = useState(false);

  async function descargar() {
    if (puedeInstalar) {
      if (await instalar()) setListo(true);
    } else {
      setPasos(true); // Chrome no ofreció el diálogo (o es iPhone): se muestran los pasos manuales
    }
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(location.origin);
      setCopiado(true);
    } catch {
      window.prompt('Copia este enlace y pégalo en Chrome:', location.origin);
    }
  }

  const abrirEnChrome = `intent://${location.host}/#Intent;scheme=https;package=com.android.chrome;end`;

  return (
    <main className="landing">
      <div className="landing-logo">
        <Logo />
      </div>
      <h1>ParkSpotter</h1>
      <p className="landing-lema">Alquila garajes como parqueadero en Bogotá.</p>

      <ul className="landing-puntos">
        <li><Icono n="pin" /> Encuentra parqueadero cerca de tu destino</li>
        <li><Icono n="reloj" /> Reserva por horas, en minutos</li>
        <li><Icono n="casa" /> O publica tu garaje y genera ingresos</li>
      </ul>

      {listo ? (
        <div className="landing-listo" role="status">
          <Icono n="check" />
          <div>
            <b>¡Listo! ParkSpotter ya está instalada.</b>
            <div>Ábrela desde el ícono en tu pantalla de inicio.</div>
          </div>
        </div>
      ) : integrado ? (
        <div className="landing-integrado">
          <p>
            Este enlace se abrió dentro de otra app (WhatsApp, Instagram…) y desde ahí no se puede instalar.
            Ábrelo en {esIOS ? 'Safari' : 'Chrome'}:
          </p>
          {!esIOS && (
            <a className="btn bloque" href={abrirEnChrome}>
              <Icono n="ruta" /> Abrir en Chrome
            </a>
          )}
          <button className="btn secundario bloque" onClick={() => void copiar()}>
            {copiado ? 'Enlace copiado: pégalo en el navegador' : 'Copiar enlace'}
          </button>
        </div>
      ) : (
        <button className="btn bloque landing-boton" onClick={() => void descargar()}>
          <Icono n="descargar" /> Descargar e instalar
        </button>
      )}

      {pasos && !listo && !integrado && (
        <ol className="landing-pasos">
          {esIOS ? (
            <>
              <li>Abre este enlace en <b>Safari</b>.</li>
              <li>Toca <b>Compartir</b> (el cuadro con la flecha hacia arriba).</li>
              <li>Elige <b>Agregar a la pantalla de inicio</b> y confirma.</li>
            </>
          ) : (
            <>
              <li>Toca el menú <b>⋮</b> de Chrome (arriba a la derecha).</li>
              <li>Elige <b>Instalar app</b> o <b>Agregar a la pantalla de inicio</b>.</li>
              <li>Confirma con <b>Instalar</b>.</li>
            </>
          )}
        </ol>
      )}

      <p className="landing-nota">Es gratis, no ocupa casi espacio y no necesita tiendas de apps.</p>
      <a className="landing-enlace" href="/?web=1">Usar en el navegador, sin instalar</a>
    </main>
  );
}
