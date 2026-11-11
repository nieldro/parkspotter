import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './styles.css';
import { aplicarTema, temaGuardado } from './tema';

aplicarTema(temaGuardado()); // antes de pintar, para que no parpadee el tema equivocado

// La app se actualiza sola: cuando hay una versión nueva, se recarga en el siguiente arranque.
registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
