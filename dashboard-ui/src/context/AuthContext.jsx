import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [cargando, setCargando] = useState(true);
  // AuthProvider vive dentro de QueryClientProvider (ver main.jsx), así que
  // useQueryClient() toma la misma instancia module-level de ahí.
  const queryClient = useQueryClient();

  const revisarSesion = useCallback(async () => {
    try {
      const data = await api.get('/api/me');
      setUser({ username: data.username, rol: data.rol });
    } catch {
      setUser(null);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { revisarSesion(); }, [revisarSesion]);

  // Cualquier llamada a la API desde cualquier página puede recibir un 401
  // si la sesión expiró a media navegación (api.js dispara este evento) —
  // antes cada página solo mostraba un alert('Error 401') confuso y se
  // quedaba en la misma pantalla. Esto regresa al login de forma consistente.
  useEffect(() => {
    // Termina la sesión igual que logout(): también limpia el cache
    // compartido de React Query para que el siguiente usuario en esta
    // máquina no vea datos cacheados de la sesión que acaba de expirar.
    const onUnauthorized = () => { setUser(null); queryClient.clear(); };
    window.addEventListener('dashboard:unauthorized', onUnauthorized);
    return () => window.removeEventListener('dashboard:unauthorized', onUnauthorized);
  }, [queryClient]);

  const login = async (username, password, recordar = false) => {
    const data = await api.post('/api/login', { username, password, recordar });
    setUser({ username: data.username, rol: data.rol });
  };

  const logout = async () => {
    await api.post('/api/logout');
    setUser(null);
    // Limpia el cache de React Query (KPIs, clientes, pedidos...) para que
    // en una máquina compartida el siguiente login no arrastre ~10s de
    // datos del usuario anterior (staleTime en main.jsx).
    queryClient.clear();
  };

  return (
    <AuthContext.Provider value={{ user, cargando, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
