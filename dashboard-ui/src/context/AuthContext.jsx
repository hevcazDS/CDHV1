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
