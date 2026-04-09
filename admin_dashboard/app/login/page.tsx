'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { login as apiLogin } from '@/lib/api';
import { getFirstAccessibleModule, Role } from '@/lib/rbac';

export default function LoginPage() {
  const [chatId, setChatId] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      // DEV MODE: bypass API auth for testing
      const name = chatId || 'Thani Dusit';
      login({
        chatId: chatId || 'dev',
        name,
        role: 'SUPER_ADMIN',
        token: 'dev-token',
      });
      const module = getFirstAccessibleModule('SUPER_ADMIN' as Role);
      router.replace(`/${module}`);
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <div className="login-logo-icon">⛓</div>
          <div className="login-logo-title">MISSION CHAIN</div>
          <div className="login-logo-sub">UNIFIED ADMIN CONSOLE</div>
        </div>
        {error && <div className="login-error">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Telegram Chat ID</label>
            <input
              type="text"
              className="form-input"
              value={chatId}
              onChange={e => setChatId(e.target.value)}
              placeholder="Enter your Telegram Chat ID (optional for dev)"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Passphrase</label>
            <input
              type="password"
              className="form-input"
              value={passphrase}
              onChange={e => setPassphrase(e.target.value)}
              placeholder="Enter passphrase (optional for dev)"
            />
          </div>
          <button type="submit" className="login-btn" disabled={loading}>
            {loading ? 'Authenticating...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
