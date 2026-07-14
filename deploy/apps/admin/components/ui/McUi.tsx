'use client';

import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
} from 'react';

/**
 * Mission Chain admin UI primitives — replaces native window.confirm / prompt / alert
 * with on-brand modals and toast. Wrap the dashboard layout with <McUiProvider>,
 * call useMcUi() in any descendant to get { confirm, prompt, toast }.
 */

type ConfirmOpts = {
  title?: string;
  message?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'danger';
};

type PromptOpts = {
  title?: string;
  message?: React.ReactNode;
  label?: string;
  placeholder?: string;
  defaultValue?: string;
  multiline?: boolean;
  validator?: (v: string) => string | null; // returns error message, or null if valid
  confirmLabel?: string;
  cancelLabel?: string;
};

type ToastOpts = {
  type?: 'success' | 'error' | 'info';
  message: string;
  durationMs?: number;
};

interface McUiAPI {
  confirm: (opts: ConfirmOpts) => Promise<boolean>;
  prompt: (opts: PromptOpts) => Promise<string | null>;
  toast: (opts: ToastOpts) => void;
}

const McUiCtx = createContext<McUiAPI | null>(null);

export function useMcUi(): McUiAPI {
  const ctx = useContext(McUiCtx);
  if (!ctx) throw new Error('useMcUi must be used within <McUiProvider>');
  return ctx;
}

// ── Internal types ───────────────────────────────────────────────────
type ConfirmState = ConfirmOpts & { resolve: (v: boolean) => void };
type PromptState = PromptOpts & { resolve: (v: string | null) => void };
type ToastState = ToastOpts & { id: number };

const SHARED_MODAL_BASE: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 9999,
  background: 'rgba(0,0,0,0.7)',
  backdropFilter: 'blur(6px)',
  WebkitBackdropFilter: 'blur(6px)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: 16,
};

const SHARED_CARD_BASE: React.CSSProperties = {
  width: 'min(480px, 100%)',
  background: 'linear-gradient(135deg, #1a0b2e 0%, #050210 100%)',
  border: '1px solid rgba(212,160,23,0.35)',
  borderRadius: 16,
  padding: 28,
  boxShadow: '0 20px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(212,160,23,0.1) inset',
  color: '#E8D8B8',
};

// ── Confirm Modal ────────────────────────────────────────────────────
function ConfirmModal({ state, close }: { state: ConfirmState; close: () => void }) {
  const onCancel = () => { state.resolve(false); close(); };
  const onOk = () => { state.resolve(true); close(); };
  const isDanger = state.variant === 'danger';
  return (
    <div onClick={onCancel} style={SHARED_MODAL_BASE}>
      <div onClick={(e) => e.stopPropagation()} style={SHARED_CARD_BASE}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <div style={{
            width: 40, height: 40, borderRadius: '50%',
            background: isDanger
              ? 'linear-gradient(135deg, rgba(229,57,53,0.2), rgba(229,57,53,0.05))'
              : 'linear-gradient(135deg, rgba(212,160,23,0.2), rgba(212,160,23,0.05))',
            border: `1px solid ${isDanger ? 'rgba(229,57,53,0.3)' : 'rgba(212,160,23,0.3)'}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 20,
          }}>{isDanger ? '⚠' : '✦'}</div>
          <h2 style={{
            margin: 0, fontSize: '1rem', fontWeight: 700,
            color: isDanger ? '#FCB5B3' : 'var(--gold)',
            fontFamily: 'var(--font-d)', letterSpacing: '0.02em',
          }}>{state.title || 'Please confirm'}</h2>
        </div>
        {state.message != null && (
          <div style={{ fontSize: '0.78rem', color: '#D4C098', lineHeight: 1.6, marginBottom: 22 }}>
            {state.message}
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{
            padding: '10px 22px',
            background: 'transparent',
            border: '1px solid rgba(255,255,255,0.15)',
            color: '#D4C098',
            borderRadius: 8, fontWeight: 600, fontSize: '0.78rem',
            cursor: 'pointer', fontFamily: 'var(--font-d)',
          }}>{state.cancelLabel || 'Cancel'}</button>
          <button onClick={onOk} style={{
            padding: '10px 26px',
            background: isDanger
              ? 'linear-gradient(135deg, #E53935, #b71c1c)'
              : 'linear-gradient(135deg, var(--gold), #b8942f)',
            border: 'none',
            color: isDanger ? '#fff' : '#000',
            borderRadius: 8, fontWeight: 700, fontSize: '0.78rem',
            cursor: 'pointer', fontFamily: 'var(--font-d)', letterSpacing: '0.04em',
            boxShadow: isDanger
              ? '0 4px 14px rgba(229,57,53,0.3)'
              : '0 4px 14px rgba(212,160,23,0.3)',
          }}>{state.confirmLabel || 'Confirm'}</button>
        </div>
      </div>
    </div>
  );
}

// ── Prompt Modal ─────────────────────────────────────────────────────
function PromptModal({ state, close }: { state: PromptState; close: () => void }) {
  const [value, setValue] = useState(state.defaultValue ?? '');
  const [error, setError] = useState<string | null>(null);
  const onCancel = () => { state.resolve(null); close(); };
  const onSubmit = () => {
    if (state.validator) {
      const err = state.validator(value);
      if (err) { setError(err); return; }
    }
    state.resolve(value); close();
  };
  return (
    <div onClick={onCancel} style={SHARED_MODAL_BASE}>
      <div onClick={(e) => e.stopPropagation()} style={SHARED_CARD_BASE}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <div style={{
            width: 40, height: 40, borderRadius: '50%',
            background: 'linear-gradient(135deg, rgba(91,45,158,0.2), rgba(91,45,158,0.05))',
            border: '1px solid rgba(155,114,207,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 20, color: '#C8B4E8',
          }}>✎</div>
          <h2 style={{
            margin: 0, fontSize: '1rem', fontWeight: 700,
            color: 'var(--gold)', fontFamily: 'var(--font-d)', letterSpacing: '0.02em',
          }}>{state.title || 'Input'}</h2>
        </div>
        {state.message != null && (
          <div style={{ fontSize: '0.75rem', color: '#A89878', lineHeight: 1.5, marginBottom: 12 }}>
            {state.message}
          </div>
        )}
        {state.label && (
          <div style={{
            fontSize: '0.6rem', color: 'var(--muted)', textTransform: 'uppercase',
            letterSpacing: '0.08em', marginBottom: 6, fontWeight: 600,
          }}>{state.label}</div>
        )}
        {state.multiline ? (
          <textarea
            value={value}
            onChange={(e) => { setValue(e.target.value); setError(null); }}
            placeholder={state.placeholder}
            rows={4}
            style={{
              width: '100%', padding: '10px 12px', fontSize: '0.78rem',
              fontFamily: 'var(--font-m)', resize: 'vertical',
              background: 'rgba(255,255,255,0.05)',
              border: `1px solid ${error ? 'rgba(229,57,53,0.5)' : 'rgba(255,255,255,0.12)'}`,
              borderRadius: 8, color: '#E8D8B8', outline: 'none',
            }}
            autoFocus
          />
        ) : (
          <input
            type="text"
            value={value}
            onChange={(e) => { setValue(e.target.value); setError(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') onSubmit(); }}
            placeholder={state.placeholder}
            style={{
              width: '100%', padding: '10px 12px', fontSize: '0.82rem',
              fontFamily: 'var(--font-m)',
              background: 'rgba(255,255,255,0.05)',
              border: `1px solid ${error ? 'rgba(229,57,53,0.5)' : 'rgba(255,255,255,0.12)'}`,
              borderRadius: 8, color: '#E8D8B8', outline: 'none',
            }}
            autoFocus
          />
        )}
        {error && (
          <div style={{ marginTop: 6, fontSize: '0.7rem', color: '#FCB5B3' }}>
            {error}
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 22 }}>
          <button onClick={onCancel} style={{
            padding: '10px 22px',
            background: 'transparent',
            border: '1px solid rgba(255,255,255,0.15)',
            color: '#D4C098',
            borderRadius: 8, fontWeight: 600, fontSize: '0.78rem',
            cursor: 'pointer', fontFamily: 'var(--font-d)',
          }}>{state.cancelLabel || 'Cancel'}</button>
          <button onClick={onSubmit} style={{
            padding: '10px 26px',
            background: 'linear-gradient(135deg, var(--gold), #b8942f)',
            border: 'none', color: '#000',
            borderRadius: 8, fontWeight: 700, fontSize: '0.78rem',
            cursor: 'pointer', fontFamily: 'var(--font-d)', letterSpacing: '0.04em',
            boxShadow: '0 4px 14px rgba(212,160,23,0.3)',
          }}>{state.confirmLabel || 'Submit'}</button>
        </div>
      </div>
    </div>
  );
}

// ── Toast Stack ──────────────────────────────────────────────────────
function ToastStack({ items, dismiss }: { items: ToastState[]; dismiss: (id: number) => void }) {
  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24, zIndex: 10000,
      display: 'flex', flexDirection: 'column', gap: 10,
      maxWidth: 'min(420px, calc(100vw - 48px))',
    }}>
      {items.map((t) => {
        const colors = t.type === 'success'
          ? { bg: 'rgba(102,187,106,0.18)', bgEnd: 'rgba(102,187,106,0.06)', border: 'rgba(102,187,106,0.4)', fg: '#A8E6AB', icon: '✓' }
          : t.type === 'error'
          ? { bg: 'rgba(229,57,53,0.18)', bgEnd: 'rgba(229,57,53,0.06)', border: 'rgba(229,57,53,0.4)', fg: '#FCB5B3', icon: '⚠' }
          : { bg: 'rgba(212,160,23,0.18)', bgEnd: 'rgba(212,160,23,0.06)', border: 'rgba(212,160,23,0.4)', fg: '#F5D56E', icon: 'ℹ' };
        return (
          <div key={t.id} style={{
            padding: '14px 18px',
            background: `linear-gradient(135deg, ${colors.bg}, ${colors.bgEnd})`,
            border: `1px solid ${colors.border}`,
            backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
            borderRadius: 10, color: colors.fg, fontSize: '0.78rem', lineHeight: 1.5,
            fontFamily: 'var(--font-m)',
            boxShadow: '0 10px 30px rgba(0,0,0,0.4)',
            display: 'flex', alignItems: 'flex-start', gap: 10,
          }}>
            <span style={{ fontSize: 16, lineHeight: 1, marginTop: 1 }}>{colors.icon}</span>
            <span style={{ flex: 1 }}>{t.message}</span>
            <button onClick={() => dismiss(t.id)} style={{
              background: 'transparent', border: 'none', color: 'inherit',
              fontSize: 18, lineHeight: 1, cursor: 'pointer', opacity: 0.6,
              padding: 0, marginLeft: 4,
            }}>×</button>
          </div>
        );
      })}
    </div>
  );
}

// ── Provider ─────────────────────────────────────────────────────────
export function McUiProvider({ children }: { children: React.ReactNode }) {
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [promptState, setPromptState] = useState<PromptState | null>(null);
  const [toasts, setToasts] = useState<ToastState[]>([]);

  const confirm = useCallback((opts: ConfirmOpts) => {
    return new Promise<boolean>((resolve) => {
      setConfirmState({ ...opts, resolve });
    });
  }, []);

  const prompt = useCallback((opts: PromptOpts) => {
    return new Promise<string | null>((resolve) => {
      setPromptState({ ...opts, resolve });
    });
  }, []);

  const toast = useCallback(({ type = 'info', message, durationMs = 6000 }: ToastOpts) => {
    const id = Date.now() + Math.random();
    setToasts((cur) => [...cur, { id, type, message, durationMs }]);
    if (durationMs > 0) {
      setTimeout(() => setToasts((cur) => cur.filter((t) => t.id !== id)), durationMs);
    }
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((cur) => cur.filter((t) => t.id !== id));
  }, []);

  const api = useMemo<McUiAPI>(() => ({ confirm, prompt, toast }), [confirm, prompt, toast]);

  return (
    <McUiCtx.Provider value={api}>
      {children}
      {confirmState && (
        <ConfirmModal state={confirmState} close={() => setConfirmState(null)} />
      )}
      {promptState && (
        <PromptModal state={promptState} close={() => setPromptState(null)} />
      )}
      <ToastStack items={toasts} dismiss={dismissToast} />
    </McUiCtx.Provider>
  );
}
