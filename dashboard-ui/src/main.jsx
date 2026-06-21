import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <EmojiProvider>
            <App />
          </EmojiProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
