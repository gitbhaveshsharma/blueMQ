import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';

const AuthContext = createContext(null);

const STORAGE_KEY = 'bluemq_auth';

function loadAuth() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveAuth(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function clearAuth() {
  localStorage.removeItem(STORAGE_KEY);
}

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState(() => {
    const stored = loadAuth();
    if (stored?.apiKey) {
      api.setApiKey(stored.apiKey);
    }
    return stored;
  });

  const login = useCallback((apiKey, appId, appName, email) => {
    const data = { apiKey, appId, appName, email };
    api.setApiKey(apiKey);
    saveAuth(data);
    setAuth(data);
  }, []);

  const logout = useCallback(() => {
    api.setApiKey('');
    clearAuth();
    setAuth(null);
  }, []);

  const isAuthenticated = Boolean(auth?.apiKey);

  return (
    <AuthContext.Provider value={{ auth, login, logout, isAuthenticated }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
