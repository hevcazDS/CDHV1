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
import { cargarPreferenciasFuente } from './lib/fontPrefs';

cargarPreferenciasFuente();

// staleTime > 0: el panel refresca vía invalidateQueries tras cada mutación,
// no al recuperar foco la pestaña
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000, retry: 1 } },
});

const FUENTE = '"Inter", -apple-system, "Segoe UI", system-ui, Roboto, sans-serif';
const FUENTE_TITULOS = '"Poppins", "Inter", -apple-system, "Segoe UI", system-ui, sans-serif';
const mantineTheme = {
  fontFamily: FUENTE,
  headings: { fontFamily: FUENTE_TITULOS, fontWeight: '600' },
  defaultRadius: 'lg',
  primaryColor: 'dark',
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
