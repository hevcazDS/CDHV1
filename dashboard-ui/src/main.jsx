import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MantineProvider } from '@mantine/core';
import '@mantine/core/styles.css';
// Fuentes self-hosteadas (@fontsource, nunca Google Fonts CDN: la CSP es 'self')
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/poppins/latin-500.css';
import '@fontsource/poppins/latin-600.css';
import '@fontsource/poppins/latin-700.css';
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-sans/latin-700.css';
import '@fontsource/source-sans-3/latin-400.css';
import '@fontsource/source-sans-3/latin-600.css';
import '@fontsource/source-sans-3/latin-700.css';
import { AuthProvider } from './context/AuthContext';
import { EmojiProvider } from './context/EmojiContext';
import App from './App';
import './styles.css';
import './temaF.css';   // tema F (rediseño) — solo aplica bajo html[data-tema-ui="f"]
import { cargarPreferenciasFuente } from './lib/fontPrefs';

cargarPreferenciasFuente();

// Tema de instancia (rediseño F por default; 'clasico' = reversión desde Prime).
// Se aplica ANTES del primer render con el valor cacheado; Layout lo confirma
// contra /api/negocio al cargar. Ver REDISENO_UI_F.md.
try {
  document.documentElement.setAttribute('data-tema-ui', localStorage.getItem('tema-ui') === 'clasico' ? 'clasico' : 'f');
  // Tono del tema F (preferencia de este equipo): papel | oscuro | confort | azul
  const tono = localStorage.getItem('tono-f');
  document.documentElement.setAttribute('data-tono-f', ['oscuro', 'confort', 'azul'].includes(tono) ? tono : 'papel');
} catch (_) { document.documentElement.setAttribute('data-tema-ui', 'f'); }

// staleTime > 0: el panel refresca vía invalidateQueries tras cada mutación,
// no al recuperar foco la pestaña
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000, retry: 1 } },
});

const FUENTE = '"Inter", -apple-system, "Segoe UI", system-ui, Roboto, sans-serif';
const FUENTE_TITULOS = '"Poppins", "Inter", -apple-system, "Segoe UI", system-ui, sans-serif';
// ═══ UNA SOLA FUENTE DE VERDAD DE DISEÑO (candado F1 — CONVENCIONES_UI.md §10) ═══
// La marca del PRODUCTO (verde bosque #1a4d3e, la misma --brand del tema claro en
// styles.css) vive AQUÍ como paleta Mantine de 10 tonos → primaryColor 'brand'.
// Antes primaryColor era 'dark' (botones negros genéricos) mientras la marca solo
// existía en CSS: dos sistemas peleando. Radios y sombras se alinean a los tokens
// CSS (--radius 10 / --radius-lg 14; sombra 1px) — nunca dos esquinas distintas.
const mantineTheme = {
  fontFamily: FUENTE,
  headings: { fontFamily: FUENTE_TITULOS, fontWeight: '600' },
  colors: {
    brand: [
      '#e8f1ee', '#d0e3dd', '#a8cabf', '#7fb0a2', '#5b9384',
      '#3f7a69', '#2c6a56', '#1a4d3e', '#123c30', '#0e2b22',
    ],
  },
  primaryColor: 'brand',
  primaryShade: { light: 7, dark: 4 },   // claro = tinta firma #1a4d3e; oscuro = tono legible
  radius: { xs: '4px', sm: '6px', md: '10px', lg: '14px', xl: '20px' },
  defaultRadius: 'md',                    // = --radius (10px) de styles.css
  shadows: {
    // sombra mínima 1px (regla del dueño) — idéntica a la de .card en styles.css
    xs: '0 1px 2px rgba(16,17,20,0.04)',
    sm: '0 1px 2px rgba(16,17,20,0.06)',
    md: '0 1px 3px rgba(16,17,20,0.08)',
    lg: '0 2px 8px rgba(16,17,20,0.10)',
    xl: '0 4px 16px rgba(16,17,20,0.12)',
  },
};

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <MantineProvider defaultColorScheme="light" theme={mantineTheme}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <EmojiProvider>
              <App />
            </EmojiProvider>
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </MantineProvider>
  </StrictMode>,
);
