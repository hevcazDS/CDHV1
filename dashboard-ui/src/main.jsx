import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MantineProvider } from '@mantine/core';
import '@mantine/core/styles.css';
import { AuthProvider } from './context/AuthContext';
import { EmojiProvider } from './context/EmojiContext';
import App from './App';
import './styles.css';

// staleTime > 0 evita refetch automático al cambiar de pestaña del navegador
// en cada acción del operador — el dashboard ya refresca explícitamente tras
// cada mutación (invalidateQueries) y el widget de estatus tiene su propio
// refetchInterval; sin esto, TanStack Query reconsultaría todo de golpe cada
// vez que el operador vuelve a la pestaña del dashboard.
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000, retry: 1 } },
});

// Tipografía igual al stack de sistema que ya usa styles.css (sin Google
// Fonts, ver CLAUDE.md) — Mantine debe verse igual de minimalista que el
// resto del panel, no como una librería de UI distinta encima.
const FUENTE = '-apple-system, "Segoe UI", system-ui, Roboto, sans-serif';
const mantineTheme = {
  fontFamily: FUENTE,
  headings: { fontFamily: FUENTE, fontWeight: '700' },
  defaultRadius: 'md',
  primaryColor: 'blue',
};

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {/* defaultColorScheme="auto" + el ThemeSwitcher en Layout cubren los
        tres modos (claro/oscuro/auto); Mantine refleja el resultado en
        data-mantine-color-scheme sobre <html>, que styles.css usa para
        repintar TODO el panel (no solo los componentes Mantine) sin tener
        que migrar las 20 páginas de una sola vez. */}
    <MantineProvider defaultColorScheme="auto" theme={mantineTheme}>
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
