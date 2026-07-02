import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api, AUTH_ERROR_EVENT, setToken } from '../api/client';
import type { User, Warehouse } from '../api/types';

interface AuthContextValue {
  user: User | null;
  activeWarehouse: Warehouse | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  selectWarehouse: (warehouseId: number) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [activeWarehouse, setActiveWarehouse] = useState<Warehouse | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await api.get<{ user: User; activeWarehouse: Warehouse | null }>('/auth/me');
      setUser(res.user);
      setActiveWarehouse(res.activeWarehouse);
    } catch {
      setUser(null);
      setActiveWarehouse(null);
      setToken(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onAuthError = () => {
      setToken(null);
      setUser(null);
      setActiveWarehouse(null);
    };
    window.addEventListener(AUTH_ERROR_EVENT, onAuthError);
    return () => window.removeEventListener(AUTH_ERROR_EVENT, onAuthError);
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.post<{ token: string; user: User }>('/auth/login', { email, password });
    setToken(res.token);
    setUser(res.user);
    setActiveWarehouse(null);
    return res.user;
  }, []);

  const selectWarehouse = useCallback(async (warehouseId: number) => {
    const res = await api.post<{ token: string; activeWarehouse: Warehouse }>('/auth/select-warehouse', {
      warehouseId,
    });
    setToken(res.token);
    setActiveWarehouse(res.activeWarehouse);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      /* ignore network errors on logout */
    }
    setToken(null);
    setUser(null);
    setActiveWarehouse(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, activeWarehouse, loading, login, selectWarehouse, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
