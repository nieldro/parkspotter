import { useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';
import { api } from './api';
import { useSesion } from './auth';
import { Avatar } from './fotos';
import { Esqueletos, Icono, Logo, type NombreIcono } from './ui';

interface Item {
  a: string;
  texto: string;
  icono: NombreIcono;
  fin?: boolean;
}

function useItems(): Item[] {
  const { usuario } = useSesion();
  if (!usuario) {
    return [
      { a: '/', texto: 'Buscar', icono: 'buscar', fin: true },
      { a: '/asistente', texto: 'Asistente', icono: 'chispa' },
      { a: '/propietario', texto: 'Ofrecer', icono: 'casa' },
      { a: '/login', texto: 'Ingresar', icono: 'usuario' },
    ];
  }
  const items: Item[] = [
    { a: '/', texto: 'Buscar', icono: 'buscar', fin: true },
    { a: '/asistente', texto: 'Asistente', icono: 'chispa' },
    // Para quien también es arrendador, «Mis viajes» (lo que él reservó) se distingue de «Mis garajes» (lo que le reservan)
    { a: '/reservas', texto: usuario.es_propietario ? 'Mis viajes' : 'Reservas', icono: 'calendario' },
  ];
  if (usuario.tipo_usuario === 'admin') items.push({ a: '/admin', texto: 'Admin', icono: 'panel' });
  else items.push({ a: '/propietario', texto: usuario.es_propietario ? 'Mis garajes' : 'Ofrecer', icono: 'casa' });
  items.push({ a: '/perfil', texto: 'Perfil', icono: 'usuario' });
  return items;
}

function useAvisosSinLeer(activo: boolean) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!activo) return;
    let vivo = true;
    const consultar = () => {
      if (document.visibilityState !== 'visible') return;
      api
        .get<{ no_leidas: number }>('/notificaciones/conteo')
        .then((r) => vivo && setN(r.no_leidas))
        .catch(() => {});
    };
    consultar();
    const t = setInterval(consultar, 30000);
    document.addEventListener('visibilitychange', consultar);
    window.addEventListener('parkspotter:avisos', consultar);
    return () => {
      vivo = false;
      clearInterval(t);
      document.removeEventListener('visibilitychange', consultar);
      window.removeEventListener('parkspotter:avisos', consultar);
    };
  }, [activo]);
  return activo ? n : 0;
}

export function Layout() {
  const { usuario } = useSesion();
  const items = useItems();
  const sinLeer = useAvisosSinLeer(Boolean(usuario));
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-in">
          <Link to="/" className="marca" aria-label="ParkSpotter, inicio">
            <Logo />
            <span>ParkSpotter</span>
          </Link>
          <nav className="nav-escritorio" aria-label="Principal">
            {items.map((i) => (
              <NavLink key={i.a} to={i.a} end={i.fin}>
                {i.texto}
              </NavLink>
            ))}
          </nav>
          <div className="grow" />
          {usuario ? (
            <>
              <Link to="/favoritos" className="btn icono fantasma solo-escritorio" aria-label="Favoritos">
                <Icono n="corazon" />
              </Link>
              <Link to="/notificaciones" className="btn icono fantasma campana" aria-label={sinLeer ? `Notificaciones, ${sinLeer} sin leer` : 'Notificaciones'}>
                <Icono n="campana" />
                {sinLeer > 0 && <span className="insignia">{sinLeer > 9 ? '9+' : sinLeer}</span>}
              </Link>
              <Link to="/perfil" className="avatar-enlace" aria-label="Mi perfil">
                <Avatar foto={usuario.foto} nombre={usuario.nombre} apellido={usuario.apellido} tam={34} />
              </Link>
            </>
          ) : (
            <Link to="/login" className="btn s">
              Ingresar
            </Link>
          )}
        </div>
      </header>
      <main className="pagina">
        <Outlet />
      </main>
      <nav className="tabbar" aria-label="Principal">
        <ul>
          {items.map((i) => (
            <li key={i.a}>
              <NavLink to={i.a} end={i.fin}>
                <Icono n={i.icono} />
                {i.texto}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

export function RequiereSesion({ admin = false }: { admin?: boolean }) {
  const { usuario, cargando } = useSesion();
  const { pathname, search } = useLocation();
  if (cargando) return <Esqueletos n={2} />;
  if (!usuario) return <Navigate to={`/login?volver=${encodeURIComponent(pathname + search)}`} replace />;
  if (admin && usuario.tipo_usuario !== 'admin') return <Navigate to="/" replace />;
  return <Outlet />;
}
