'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Role } from './rbac';

interface User {
  chatId: string;
  name: string;
  role: Role;
  token: string;
}

interface AuthContextType {
  user: User | null;
  login: (user: User) => void;
  logout: () => void;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  login: () => {},
  logout: () => {},
  isLoading: true,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem('mc_admin_user');
    if (stored) {
      try {
        setUser(JSON.parse(stored));
      } catch {}
    }
    setIsLoading(false);
  }, []);

  const loginFn = (u: User) => {
    setUser(u);
    localStorage.setItem('mc_admin_user', JSON.stringify(u));
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('mc_admin_user');
  };

  return (
    <AuthContext.Provider value={{ user, login: loginFn, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
