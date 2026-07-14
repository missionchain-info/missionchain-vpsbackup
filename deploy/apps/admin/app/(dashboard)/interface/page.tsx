'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { fetchMenuConfig, saveMenuConfig } from '@/lib/api';
import { useAuth, isOwnerWallet } from '@/lib/auth';

interface MenuItem {
  id: string;
  icon: string;
  label: string;
  href: string;
  group: string;
  status: 'enabled' | 'disabled' | 'cleared';
  mandatory: boolean;
  order: number;
  badge?: string;
  roundType?: string;
}

const SZ = '0.62rem';

const STATUS_STYLES: Record<string, { bg: string; color: string; border: string; label: string }> = {
  enabled:  { bg: 'rgba(201,168,76,.08)',  color: 'var(--gold2)',    border: 'var(--gold)',    label: 'ACTIVE' },
  disabled: { bg: 'rgba(192,132,212,.08)', color: 'var(--purple2)',  border: 'var(--purple)',  label: 'SOON' },
  cleared:  { bg: 'rgba(107,20,40,.08)',   color: 'var(--crimson2)', border: 'var(--crimson)', label: 'HIDDEN' },
};

export default function InterfacePage() {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // CLEAR button is owner-wallet only
  const { user } = useAuth();
  const isSuperAdmin = isOwnerWallet(user?.wallet);

  const loadConfig = useCallback(async () => {
    try {
      const res = await fetchMenuConfig();
      const data = res.data || [];
      data.sort((a: MenuItem, b: MenuItem) => a.order - b.order);
      setItems(data);
    } catch (err) {
      console.error('Failed to load menu config', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const updateStatus = (id: string, status: 'enabled' | 'disabled' | 'cleared') => {
    setItems(prev => prev.map(item =>
      item.id === id ? { ...item, status } : item
    ));
    setDirty(true);
  };

  const moveItem = (id: string, direction: 'up' | 'down') => {
    setItems(prev => {
      const idx = prev.findIndex(i => i.id === id);
      if (idx < 0) return prev;
      const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= prev.length) return prev;
      const copy = [...prev];
      [copy[idx], copy[swapIdx]] = [copy[swapIdx], copy[idx]];
      return copy.map((item, i) => ({ ...item, order: i }));
    });
    setDirty(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveMenuConfig(items);
      setDirty(false);
      showToast('Menu configuration saved');
    } catch (err: any) {
      showToast('Failed to save: ' + (err.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setLoading(true);
    loadConfig().then(() => {
      setDirty(false);
      showToast('Reset to last saved state');
    });
  };

  const visibleItems = items.filter(i => i.status !== 'cleared');
  const clearedItems = items.filter(i => i.status === 'cleared');

  const groups: string[] = [];
  visibleItems.forEach(i => {
    if (!groups.includes(i.group)) groups.push(i.group);
  });

  if (loading) {
    return <div style={{ padding: 32, color: 'var(--gray)' }}>Loading menu configuration...</div>;
  }

  return (
    <>
      {/* Toast */}
      {toast && (
        <div className="alert alert-info" style={{
          position: 'fixed', top: 20, right: 20, zIndex: 9999,
          marginBottom: 0, boxShadow: '0 4px 20px rgba(0,0,0,.4)',
        }}>
          {toast}
        </div>
      )}

      <div className="page-hd">
        <div>
          <div className="page-eyebrow">Settings</div>
          <div className="page-title">Frontend Menu Interface</div>
          <div className="page-sub">
            Manage which menu items are visible on the user-facing DApp sidebar.
            Enable, disable (show as &quot;SOON&quot;), or hide items completely.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {dirty && (
            <button className="btn btn-outline btn-sm" onClick={handleReset}>
              Reset
            </button>
          )}
          <button
            className={dirty ? 'btn btn-gold btn-sm' : 'btn btn-outline btn-sm'}
            onClick={handleSave}
            disabled={saving || !dirty}
            style={{ opacity: saving ? 0.6 : 1 }}
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 20, marginBottom: 20, flexWrap: 'wrap' }}>
        {Object.entries(STATUS_STYLES).map(([key, val]) => (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: SZ }}>
            <span style={{
              display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
              background: val.color,
            }} />
            <span style={{ color: 'var(--gray)', fontFamily: 'var(--font-m)', fontSize: '0.58rem', letterSpacing: '.04em' }}>
              {key === 'enabled' ? 'Active' :
               key === 'disabled' ? 'Disabled (SOON)' :
               'Hidden'}
            </span>
          </div>
        ))}
      </div>

      {/* Active Items by Group */}
      {groups.map(group => {
        const groupItems = visibleItems.filter(i => i.group === group);
        return (
          <div key={group} style={{ marginBottom: 22 }}>
            <div className="sep-lbl">{group}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {groupItems.map(item => {
                const st = STATUS_STYLES[item.status];
                return (
                  <div key={item.id} className="card" style={{
                    padding: '12px 16px',
                    display: 'flex', alignItems: 'center', gap: 12,
                    background: st.bg,
                    borderLeft: `3px solid ${st.border}`,
                  }}>
                    {/* Reorder arrows */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <button
                        onClick={() => moveItem(item.id, 'up')}
                        title="Move up"
                        className="btn-icon"
                        style={{ width: 22, height: 18, fontSize: SZ, borderRadius: 4 }}
                      >{'\u25B2'}</button>
                      <button
                        onClick={() => moveItem(item.id, 'down')}
                        title="Move down"
                        className="btn-icon"
                        style={{ width: 22, height: 18, fontSize: SZ, borderRadius: 4 }}
                      >{'\u25BC'}</button>
                    </div>

                    {/* Icon + Label */}
                    <span style={{ fontSize: '1.2rem', width: 26, textAlign: 'center' }}>{item.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: SZ, color: 'var(--white)', fontFamily: 'var(--font-d)' }}>
                        {item.label}
                        {item.mandatory && (
                          <span className="badge b-gold" style={{ marginLeft: 8, fontSize: '0.5rem', padding: '1px 6px' }}>REQUIRED</span>
                        )}
                        {item.badge && (
                          <span className="badge b-crimson" style={{ marginLeft: 6, fontSize: '0.5rem', padding: '1px 6px' }}>{item.badge}</span>
                        )}
                      </div>
                      <div style={{ fontSize: SZ, color: 'var(--gray2)', fontFamily: 'var(--font-m)' }}>{item.href}</div>
                    </div>

                    {/* Status badge */}
                    <span className={`badge ${item.status === 'enabled' ? 'b-gold' : item.status === 'disabled' ? 'b-purple' : 'b-crimson'}`}>
                      {st.label}
                    </span>

                    {/* Action buttons */}
                    <div style={{ display: 'flex', gap: 4 }}>
                      {item.status !== 'enabled' && (
                        <button
                          onClick={() => updateStatus(item.id, 'enabled')}
                          className="btn btn-gold btn-sm"
                          style={{ fontSize: SZ }}
                        >Enable</button>
                      )}
                      {item.status !== 'disabled' && (
                        <button
                          onClick={() => updateStatus(item.id, 'disabled')}
                          className="btn btn-primary btn-sm"
                          style={{ fontSize: SZ }}
                        >Disable</button>
                      )}
                      {!item.mandatory && (
                        <button
                          onClick={() => isSuperAdmin && updateStatus(item.id, 'cleared')}
                          disabled={!isSuperAdmin}
                          title={isSuperAdmin ? 'Clear menu item' : 'Only OWNER can use Clear'}
                          className="btn btn-outline btn-sm"
                          style={{
                            fontSize: SZ,
                            color: isSuperAdmin ? 'var(--crimson2)' : 'var(--gray2)',
                            borderColor: isSuperAdmin ? 'rgba(107,20,40,.3)' : 'rgba(120,120,120,.2)',
                            opacity: isSuperAdmin ? 1 : 0.4,
                            cursor: isSuperAdmin ? 'pointer' : 'not-allowed',
                          }}
                        >Clear</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Cleared/Hidden Items */}
      {clearedItems.length > 0 && (
        <div style={{ marginTop: 32 }}>
          <div className="sep-lbl" style={{ color: 'var(--crimson2)' }}>
            Hidden Items ({clearedItems.length})
          </div>
          <div style={{
            background: 'rgba(107,20,40,.05)', border: '1px dashed rgba(107,20,40,.2)',
            borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 6,
          }}>
            {clearedItems.map(item => (
              <div key={item.id} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 14px', background: 'var(--bg3)', borderRadius: 10,
                border: '1px solid var(--border)',
                opacity: 0.7,
              }}>
                <span style={{ fontSize: '1.1rem', width: 26, textAlign: 'center' }}>{item.icon}</span>
                <div style={{ flex: 1 }}>
                  <span style={{ fontWeight: 600, fontSize: SZ, color: 'var(--white)', fontFamily: 'var(--font-d)' }}>{item.label}</span>
                  <span style={{ marginLeft: 8, fontSize: SZ, color: 'var(--gray2)', fontFamily: 'var(--font-m)' }}>{item.href}</span>
                </div>
                <button
                  onClick={() => updateStatus(item.id, 'disabled')}
                  className="btn btn-primary btn-sm"
                  style={{ fontSize: SZ }}
                >
                  Restore
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
