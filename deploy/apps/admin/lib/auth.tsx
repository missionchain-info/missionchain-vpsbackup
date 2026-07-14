'use client';

import React, { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
const JWT_KEY = 'mc-admin-jwt';

export type Role = 'ADMIN';

const OWNER_WALLETS: Set<string> = new Set(
  (process.env.NEXT_PUBLIC_OWNER_WALLETS || '')
    .split(',')
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean)
);

export function isOwnerWallet(wallet?: string | null): boolean {
  if (!wallet) return false;
  return OWNER_WALLETS.has(wallet.toLowerCase());
}

interface AuthUser {
  wallet: string;
  role: string;
  userId?: string;
}

interface AuthContextType {
  user: AuthUser | null;
  isAuthenticated: boolean;
  loading: boolean;
  error: string | null;
  login: () => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isAuthenticated: false,
  loading: false,
  error: null,
  login: async () => {},
  logout: () => {},
});

// Collect all providers: legacy window.ethereum + EIP-6963 announced providers
function collectProviders(): Promise<any[]> {
  return new Promise((resolve) => {
    const providers: any[] = [];
    const w = window as any;

    // Legacy: check common injection points
    if (w.trustwallet?.ethereum) providers.push(w.trustwallet.ethereum);
    if (w.trustWallet?.ethereum) providers.push(w.trustWallet.ethereum);
    if (w.ethereum) {
      // window.ethereum might have multiple providers (EIP-1193 multi-inject)
      if (w.ethereum.providers?.length) {
        providers.push(...w.ethereum.providers);
      } else {
        providers.push(w.ethereum);
      }
    }

    // EIP-6963: modern wallet discovery
    const handleAnnounce = (event: any) => {
      if (event.detail?.provider) {
        providers.push(event.detail.provider);
      }
    };
    window.addEventListener('eip6963:announceProvider', handleAnnounce);
    window.dispatchEvent(new Event('eip6963:requestProvider'));

    // Give EIP-6963 providers 500ms to announce, then resolve
    setTimeout(() => {
      window.removeEventListener('eip6963:announceProvider', handleAnnounce);
      // Deduplicate
      const unique = [...new Set(providers)].filter(Boolean);
      resolve(unique);
    }, 500);
  });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // On mount, check if JWT exists
  useEffect(() => {
    const jwt = localStorage.getItem(JWT_KEY);
    if (jwt) {
      try {
        const payload = JSON.parse(atob(jwt.split('.')[1]));
        const isExpired = typeof payload.exp === 'number' && payload.exp * 1000 <= Date.now();
        if (!isExpired && payload.wallet && payload.role === 'ADMIN') {
          setUser({ wallet: payload.wallet, role: payload.role, userId: payload.userId });
        } else {
          localStorage.removeItem(JWT_KEY);
        }
      } catch {
        localStorage.removeItem(JWT_KEY);
      }
    }
  }, []);

  const login = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Step 1: Find any ethereum provider
      const providers = await collectProviders();

      if (providers.length === 0) {
        throw new Error('No wallet detected. Please install MetaMask or Trust Wallet browser extension and refresh the page.');
      }

      // Use the first available provider
      const provider = providers[0];

      // Step 2: Request accounts
      let accounts: string[];
      try {
        accounts = await provider.request({ method: 'eth_requestAccounts' });
      } catch (e: any) {
        if (e.code === 4001) throw new Error('Connection rejected by user.');
        throw new Error('Failed to connect wallet: ' + (e.message || 'unknown error'));
      }

      const wallet = accounts[0];
      if (!wallet) throw new Error('No wallet address returned');
      const walletLower = wallet.toLowerCase();

      // Step 3: Get nonce
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      let nonceRes: Response;
      try {
        nonceRes = await fetch(`${API_BASE}/auth/nonce?wallet=${walletLower}`, { signal: controller.signal });
      } catch (e: any) {
        clearTimeout(timeout);
        throw new Error(e.name === 'AbortError' ? 'API timeout — check network' : `Network error: ${e.message}`);
      }
      clearTimeout(timeout);

      if (nonceRes.status === 404) {
        throw new Error('Wallet not registered — contact admin for access.');
      }
      if (!nonceRes.ok) throw new Error(`Failed to get nonce (${nonceRes.status})`);

      const nonceData = await nonceRes.json();
      const nonce = nonceData.data?.nonce || nonceData.nonce;
      if (!nonce) throw new Error('No nonce received');

      // Step 4: Sign message
      const message = `Mission Chain Authentication\nNonce: ${nonce}`;
      const msgHex = '0x' + Array.from(new TextEncoder().encode(message)).map(b => b.toString(16).padStart(2, '0')).join('');
      let signature: string;
      try {
        signature = await provider.request({
          method: 'personal_sign',
          params: [msgHex, walletLower],
        });
      } catch (e: any) {
        if (e.code === 4001) throw new Error('Signature rejected by user.');
        throw new Error('Failed to sign message: ' + (e.message || 'unknown error'));
      }

      // Step 5: Verify signature → get JWT
      const verifyRes = await fetch(`${API_BASE}/auth/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet: walletLower, signature }),
      });

      if (!verifyRes.ok) {
        const errData = await verifyRes.json().catch(() => ({}));
        throw new Error(errData.message || `Verification failed: ${verifyRes.status}`);
      }

      const verifyData = await verifyRes.json();
      const jwt = verifyData.jwt || verifyData.data?.token || verifyData.token;
      const userData = verifyData.user || verifyData.data?.user;

      if (!jwt) throw new Error('No token received');

      // Step 6: Check if role is ADMIN
      const role = userData?.role;
      if (role !== 'ADMIN') {
        throw new Error('Access Denied — Your wallet is not authorized as Admin.');
      }

      // Step 7: Store JWT and set user
      localStorage.setItem(JWT_KEY, jwt);
      setUser({ wallet: walletLower, role, userId: userData?.userId });

    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    localStorage.removeItem(JWT_KEY);
    setUser(null);
    setError(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, loading, error, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

export function getJWT(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(JWT_KEY);
}

export function getRoleBadgeClass(role: string): string {
  return role === 'ADMIN' ? 'role-admin' : 'role-guardian';
}

export function getRoleLabel(role: string): string {
  return role.toUpperCase();
}

export function OwnerCrown({ wallet, size = '0.9em' }: { wallet?: string | null; size?: string }) {
  if (!isOwnerWallet(wallet)) return null;
  return <span style={{ fontSize: size, marginLeft: 4 }} aria-hidden="true">👑</span>;
}
