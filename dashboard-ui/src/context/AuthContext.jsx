import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api } from '../api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [cargando, setCargando] = useState(true);

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
    const onUnauthorized = () => setUser(null);
    window.addEventListener('dashboard:unauthorized', onUnauthorized);
    return () => window.removeEventListener('dashboard:unauthorized', onUnauthorized);
  }, []);

  const login = async (username, password) => {
    const data = await api.post('/api/login', { username, password });
    setUser({ username: data.username, rol: data.rol });
  };

  const logout = async () => {
    await api.post('/api/logout');
    setUser(null);
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
