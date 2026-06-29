'use client';

/**
 * ExportButton — Reusable Excel export trigger for any admin list page.
 *
 * Usage:
 *   <ExportButton
 *     endpoint="/admin/users/export"
 *     query={{ search, kycStatus, role }}
 *     fallbackFilename="members.xlsx"
 *   />
 *
 * Pattern: GET request with JWT Authorization header, response is a binary
 * Excel file. Filename is read from Content-Disposition; falls back to the
 * `fallbackFilename` prop if missing. RBAC (ANALYST+) is enforced server-side
 * — the button assumes the caller already passed admin auth.
 */
import { useState } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface ExportButtonProps {
  /** Backend path, e.g. '/admin/users/export'. */
  endpoint: string;
  /** Optional filter query params; falsy values are skipped. */
  query?: Record<string, string | number | undefined | null | ''>;
  /** Filename to use if Content-Disposition is missing. */
  fallbackFilename?: string;
  /** Optional label override. Default: "Export Excel". */
  label?: string;
  /** Optional disabled state (e.g. while parent is loading). */
  disabled?: boolean;
}

const buttonStyle: React.CSSProperties = {
  padding: '6px 14px',
  borderRadius: 6,
  background: 'var(--gold, #B8860B)',
  color: '#fff',
  border: 'none',
  fontSize: '0.65rem',
  fontFamily: 'var(--font-d, sans-serif)',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  cursor: 'pointer',
  fontWeight: 600,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
};

const buttonDisabledStyle: React.CSSProperties = {
  ...buttonStyle,
  opacity: 0.5,
  cursor: 'not-allowed',
};

export default function ExportButton({
  endpoint,
  query,
  fallbackFilename = 'export.xlsx',
  label = 'Export Excel',
  disabled,
}: ExportButtonProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    if (busy || disabled) return;
    setBusy(true);
    setError(null);
    try {
      // Build URL with non-empty query params
      const url = new URL(`${API_BASE}${endpoint}`);
      if (query) {
        for (const [k, v] of Object.entries(query)) {
          if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
        }
      }

      const jwt = typeof window !== 'undefined' ? localStorage.getItem('mc-admin-jwt') : null;
      const res = await fetch(url.toString(), {
        method: 'GET',
        headers: jwt ? { Authorization: `Bearer ${jwt}` } : {},
      });

      if (!res.ok) {
        let msg = `Export failed (HTTP ${res.status})`;
        try {
          const j = await res.json();
          if (j?.message) msg = j.message;
        } catch {
          // Body wasn't JSON — use status-based message
        }
        throw new Error(msg);
      }

      // Read filename from Content-Disposition
      let filename = fallbackFilename;
      const cd = res.headers.get('content-disposition') || res.headers.get('Content-Disposition');
      if (cd) {
        const match = cd.match(/filename="?([^"]+)"?/i);
        if (match) filename = match[1];
      }

      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Free up memory after browser starts the download
      setTimeout(() => URL.revokeObjectURL(blobUrl), 5_000);
    } catch (e: any) {
      setError(e?.message || 'Export failed');
      console.error('[ExportButton]', e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', gap: 4 }}>
      <button
        type="button"
        onClick={handleClick}
        disabled={busy || disabled}
        style={busy || disabled ? buttonDisabledStyle : buttonStyle}
        title={busy ? 'Generating…' : 'Download Excel file'}
      >
        <span>{busy ? '⏳' : '⬇'}</span>
        <span>{busy ? 'Exporting…' : label}</span>
      </button>
      {error && (
        <span style={{ fontSize: '0.55rem', color: 'var(--danger, #d33)', maxWidth: 280 }}>
          {error}
        </span>
      )}
    </div>
  );
}
