import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { ProveedorSesion } from './auth';
import { ProveedorAvisos } from './avisos';
import { useInstalacion } from './instalar';
import { Layout, RequiereSesion } from './Layout';
import { Admin } from './pages/Admin';
import { ProveedorFavoritos } from './favoritos';
import { Asistente } from './pages/Asistente';
import { Favoritos } from './pages/Favoritos';
import { Login, Registro } from './pages/Auth';
import { Buscar } from './pages/Buscar';
import { Recuperar, Verificar } from './pages/Codigo';
import { Notificaciones, Perfil } from './pages/Cuenta';
import { Descargar } from './pages/Descargar';
import { GarajeDetalle } from './pages/GarajeDetalle';
import { GarajeForm } from './pages/GarajeForm';
import { Propietario } from './pages/Propietario';
import { DetalleReserva, MisReservas } from './pages/Reservas';
import { Vacio } from './ui';

function NoEncontrada() {
  return (
    <div className="card" style={{ maxWidth: 480, margin: '40px auto' }}>
      <Vacio icono="pin" titulo="No encontramos esa página">
        <Link to="/" className="btn">Ir al inicio</Link>
      </Vacio>
    </div>
  );
}

// ?web=1 salta la presentación (para revisar la versión web desde un celular); se recuerda mientras dure la pestaña.
if (new URLSearchParams(location.search).has('web')) sessionStorage.setItem('parkspotter.web', '1');

export default function App() {
  const { esMovil, instalada } = useInstalacion();
  // En un celular, fuera de la app instalada, solo se muestra la presentación con el botón de instalar.
  if (esMovil && !instalada && !sessionStorage.getItem('parkspotter.web')) return <Descargar />;
  return (
    <BrowserRouter>
      <ProveedorSesion>
        <ProveedorAvisos>
          <ProveedorFavoritos>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Buscar />} />
              <Route path="asistente" element={<Asistente />} />
              <Route path="garaje/:id" element={<GarajeDetalle />} />
              <Route path="login" element={<Login />} />
              <Route path="registro" element={<Registro />} />
              <Route path="verificar" element={<Verificar />} />
              <Route path="recuperar" element={<Recuperar />} />
              <Route path="propietario" element={<Propietario />} />
              <Route element={<RequiereSesion />}>
                <Route path="reservas" element={<MisReservas />} />
                <Route path="reservas/:id" element={<DetalleReserva />} />
                <Route path="propietario/garajes/nuevo" element={<GarajeForm />} />
                <Route path="propietario/garajes/:id/editar" element={<GarajeForm />} />
                <Route path="favoritos" element={<Favoritos />} />
                <Route path="notificaciones" element={<Notificaciones />} />
                <Route path="perfil" element={<Perfil />} />
              </Route>
              <Route element={<RequiereSesion admin />}>
                <Route path="admin" element={<Admin />} />
              </Route>
              <Route path="*" element={<NoEncontrada />} />
            </Route>
          </Routes>
          </ProveedorFavoritos>
        </ProveedorAvisos>
      </ProveedorSesion>
    </BrowserRouter>
  );
}
