import { Link } from 'react-router-dom';
import { api } from '../api';
import { useFavoritos } from '../favoritos';
import { useCarga, useTitulo } from '../hooks';
import type { Garaje } from '../types';
import { Alerta, Esqueletos, Vacio } from '../ui';
import { TarjetaGaraje } from './Buscar';

type GarajeFavorito = Garaje & { disponible: boolean };

export function Favoritos() {
  useTitulo('Favoritos');
  const { ids } = useFavoritos();
  const { datos, error, cargando } = useCarga(() => api.get<{ garajes: GarajeFavorito[] }>('/favoritos'), []);
  // Al quitar un corazón, el garaje sale de la lista al instante (sin esperar otra consulta).
  const lista = (datos?.garajes ?? []).filter((g) => ids.has(g.id_garaje));

  return (
    <>
      <div className="cabecera-pagina">
        <div>
          <h1>Favoritos</h1>
          <p>Los garajes que guardaste para volver a ellos.</p>
        </div>
      </div>
      {error && <Alerta>{error}</Alerta>}
      {cargando && !datos ? (
        <Esqueletos />
      ) : lista.length === 0 ? (
        <div className="card">
          <Vacio icono="corazon" titulo="Aún no tienes favoritos">
            <p>Toca el corazón en un garaje para guardarlo aquí.</p>
            <Link to="/" className="btn">Buscar parqueadero</Link>
          </Vacio>
        </div>
      ) : (
        <div className="lista">
          {lista.map((g) => (
            <div key={g.id_garaje} className={g.disponible ? '' : 'no-disponible'}>
              <ul className="lista">
                <TarjetaGaraje g={g} busqueda="" />
              </ul>
              {!g.disponible && <p className="ayuda" style={{ margin: '4px 4px 0' }}>Este garaje está pausado por ahora y no recibe reservas.</p>}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
