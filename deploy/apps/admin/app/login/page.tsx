'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';

export default function LoginPage() {
  const { login, logout, loading, error, isAuthenticated } = useAuth();
  const router = useRouter();

  const [ready, setReady] = useState(false);

  // On mount: clear old session, then mark ready
  useEffect(() => {
    logout();
    setReady(true);
  }, []);

  // Redirect to dashboard ONLY after fresh login (not from stale JWT)
  useEffect(() => {
    if (ready && isAuthenticated) {
      router.push('/');
    }
  }, [ready, isAuthenticated, router]);

  const handleConnect = async () => {
    if (loading) return;
    await login();
  };

  return (
    <div className="login-screen">
      <div className="login-orb" style={{ width: 600, height: 500, background: 'rgba(59,20,100,.25)', top: -150, left: -150 }} />
      <div className="login-orb" style={{ width: 400, height: 400, background: 'rgba(107,20,40,.18)', bottom: -100, right: '5%' }} />

      <div className="login-box">
        <img src="/images/mission-chain-logo-clear.png" alt="Mission Chain"
          style={{ width: 100, height: 100, borderRadius: 20, objectFit: 'contain', marginBottom: 8 }} />
        <div className="login-brand">MISSION CHAIN</div>
        <div className="login-sub">Admin Console &middot; Governing Board Only</div>
        <div className="login-divider" />
        <div className="login-restricted">Restricted Access</div>
        <p style={{ fontSize: '11.5px', color: 'var(--gray)', marginBottom: 22, lineHeight: 1.7 }}>
          This system is exclusively reserved for <strong style={{ color: 'var(--white)' }}>Governing Board members</strong> of Mission Chain. Unauthorized access is prohibited and logged on-chain.
        </p>

        {error && (
          <div className="login-reject show">{'\u26D4'} &nbsp;{error}</div>
        )}

        <button className="btn-login" onClick={handleConnect} disabled={loading}>
          {loading ? 'Authenticating...' : 'Connect Wallet'}
        </button>

        <p className="login-note">
          Network: <span style={{ color: 'var(--gold)' }}>BSC Mainnet</span> &nbsp;&middot;&nbsp;
          Supports all BSC-compatible wallets &nbsp;&middot;&nbsp; v1.0.0-alpha
        </p>
      </div>
    </div>
  );
}
