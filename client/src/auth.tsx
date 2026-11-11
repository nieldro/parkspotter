import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { EVENTO_SESION_CADUCADA, api, borrarToken, guardarToken, obtenerToken } from './api';
import type { Usuario } from './types';

/** Al registrarse con verificación de correo no hay sesión todavía: solo se sabe a qué correo se mandó el código. */
export interface PendienteDeCodigo {
  requiere_verificacion: true;
  correo: string;
}

interface Sesion {
  usuario: Usuario | null;
  cargando: boolean;
  entrar: (correo: string, contrasena: string) => Promise<Usuario>;
  registrar: (datos: Record<string, unknown>) => Promise<Usuario | PendienteDeCodigo>;
  verificar: (correo: string, codigo: string) => Promise<Usuario>;
  restablecer: (correo: string, codigo: string, nueva: string) => Promise<Usuario>;
  entrarDemo: (rol: 'conductor' | 'propietario') => Promise<Usuario>;
  salir: () => void;
  actualizar: (u: Usuario) => void;
}

const Contexto = createContext<Sesion | null>(null);

// La foto de perfil elegida al registrarse espera aquí hasta que haya sesión (con verificación de correo, llega minutos después).
const CLAVE_FOTO_PENDIENTE = 'parkspotter.fotoPendiente';
export const guardarFotoPendiente = (dataUrl: string | null) => {
  try {
    if (dataUrl) sessionStorage.setItem(CLAVE_FOTO_PENDIENTE, dataUrl);
    else sessionStorage.removeItem(CLAVE_FOTO_PENDIENTE);
  } catch {
    /* sin almacenamiento: la persona la sube después desde el perfil */
  }
};

/** Si hay una foto esperando, la sube ahora que hay sesión. Si falla, no estorba: se puede subir desde el perfil. */
async function subirFotoPendiente(u: Usuario): Promise<Usuario> {
  let foto: string | null = null;
  try {
    foto = sessionStorage.getItem(CLAVE_FOTO_PENDIENTE);
  } catch {
    return u;
  }
  if (!foto) return u;
  guardarFotoPendiente(null);
  try {
    return (await api.post<{ usuario: Usuario }>('/auth/yo/foto', { imagen: foto })).usuario;
  } catch {
    return u;
  }
}

export function ProveedorSesion({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [cargando, setCargando] = useState(Boolean(obtenerToken()));

  const salir = useCallback(() => {
    borrarToken();
    setUsuario(null);
  }, []);

  useEffect(() => {
    if (!obtenerToken()) return;
    api
      .get<{ usuario: Usuario }>('/auth/yo')
      .then((r) => setUsuario(r.usuario))
      .catch(() => {})
      .finally(() => setCargando(false));
  }, []);

  useEffect(() => {
    window.addEventListener(EVENTO_SESION_CADUCADA, salir);
    return () => window.removeEventListener(EVENTO_SESION_CADUCADA, salir);
  }, [salir]);

  const valor = useMemo<Sesion>(() => {
    /** Guarda el token, sube la foto que estaba esperando y deja al usuario en sesión. */
    const abrir = async (r: { token: string; usuario: Usuario }) => {
      guardarToken(r.token);
      const u = await subirFotoPendiente(r.usuario);
      setUsuario(u);
      return u;
    };
    return {
      usuario,
      cargando,
      async entrar(correo, contrasena) {
        return abrir(await api.post<{ token: string; usuario: Usuario }>('/auth/login', { correo, contrasena }));
      },
      async registrar(datos) {
        const r = await api.post<{ token?: string; usuario?: Usuario; requiere_verificacion?: true; correo?: string }>('/auth/registro', datos);
        if (r.requiere_verificacion) return { requiere_verificacion: true, correo: r.correo ?? String(datos.correo) };
        return abrir({ token: r.token!, usuario: r.usuario! });
      },
      async verificar(correo, codigo) {
        return abrir(await api.post<{ token: string; usuario: Usuario }>('/auth/verificar', { correo, codigo }));
      },
      async restablecer(correo, codigo, nueva) {
        return abrir(await api.post<{ token: string; usuario: Usuario }>('/auth/restablecer', { correo, codigo, nueva }));
      },
      async entrarDemo(rol) {
        return abrir(await api.post<{ token: string; usuario: Usuario }>('/auth/demo', { rol }));
      },
      salir,
      actualizar: setUsuario,
    };
  }, [usuario, cargando, salir]);

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useSesion(): Sesion {
  const v = useContext(Contexto);
  if (!v) throw new Error('useSesion debe usarse dentro de ProveedorSesion');
  return v;
}
