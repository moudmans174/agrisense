import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, getToken, setToken } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(Boolean(getToken()));

  useEffect(() => {
    if (!getToken()) return;
    api.get('/auth/me').then(setUser).catch(() => setToken(null)).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const onLogout = () => setUser(null);
    window.addEventListener('agrisense:logout', onLogout);
    return () => window.removeEventListener('agrisense:logout', onLogout);
  }, []);

  const login = useCallback(async (email, password) => {
    const { token, user: u } = await api.post('/auth/login', { email, password });
    setToken(token); setUser(u); return u;
  }, []);

  const register = useCallback(async (data) => {
    const { token, user: u } = await api.post('/auth/register', data);
    setToken(token); setUser(u); return u;
  }, []);

  const logout = useCallback(() => { setToken(null); setUser(null); }, []);

  const isStaff = user?.role === 'admin' || user?.role === 'agronomist';
  return (
    <AuthContext.Provider value={{ user, setUser, loading, login, register, logout, isStaff, isAdmin: user?.role === 'admin' }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
