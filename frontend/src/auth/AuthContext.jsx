import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api, getAuthToken, setAuthToken } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(Boolean(getAuthToken()));

  useEffect(() => {
    let active = true;
    async function restoreSession() {
      if (!getAuthToken()) {
        setLoading(false);
        return;
      }
      try {
        const response = await api.me();
        if (active) setUser(response.user);
      } catch {
        setAuthToken('');
        if (active) setUser(null);
      } finally {
        if (active) setLoading(false);
      }
    }
    restoreSession();
    return () => {
      active = false;
    };
  }, []);

  const value = useMemo(() => ({
    user,
    loading,
    isSectionHead: user?.role === 'SECTION_HEAD',
    async login(username, password) {
      const response = await api.login({ username, password });
      setAuthToken(response.token);
      setUser(response.user);
      return response.user;
    },
    async logout() {
      try {
        if (getAuthToken()) await api.logout();
      } catch {
        // Local logout should still complete when the server session is already gone.
      }
      setAuthToken('');
      setUser(null);
    },
    canAccessModule(moduleKey) {
      return Boolean(user?.authorizedModules?.includes(moduleKey));
    },
  }), [loading, user]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider.');
  return context;
}
