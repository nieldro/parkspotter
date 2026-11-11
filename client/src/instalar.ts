import { useEffect, useState } from 'react';

interface EventoInstalacion extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let eventoGuardado: EventoInstalacion | null = null;
const oyentes = new Set<() => void>();

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    eventoGuardado = e as EventoInstalacion;
    oyentes.forEach((f) => f());
  });
  window.addEventListener('appinstalled', () => {
    eventoGuardado = null;
    oyentes.forEach((f) => f());
  });
}

const esStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

const esIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const esAndroid = () => /android/i.test(navigator.userAgent);

const esMovil = () => esAndroid() || esIOS() || /mobile/i.test(navigator.userAgent);

// El navegador que abre WhatsApp, Instagram, Facebook, Telegram, etc. no puede instalar apps:
// hay que abrir el link en Chrome (o Safari en iPhone).
const esNavegadorIntegrado = () => /FBAN|FBAV|Instagram|WhatsApp|Line\/|Telegram|Snapchat|MicroMessenger|; wv\)/i.test(navigator.userAgent);

/** Estado de instalación de la PWA: Chrome/Android la ofrece con un botón; iOS requiere pasos manuales. */
export function useInstalacion() {
  const [, forzar] = useState(0);
  useEffect(() => {
    const f = () => forzar((n) => n + 1);
    oyentes.add(f);
    return () => void oyentes.delete(f);
  }, []);

  return {
    instalada: esStandalone(),
    puedeInstalar: eventoGuardado !== null,
    esIOS: esIOS(),
    esAndroid: esAndroid(),
    esMovil: esMovil(),
    integrado: esNavegadorIntegrado(),
    async instalar() {
      if (!eventoGuardado) return false;
      await eventoGuardado.prompt();
      const r = await eventoGuardado.userChoice;
      eventoGuardado = null;
      oyentes.forEach((f) => f());
      return r.outcome === 'accepted';
    },
  };
}
