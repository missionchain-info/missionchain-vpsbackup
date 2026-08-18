'use client';

/**
 * Chức danh (Admin Roles) — Owner-only.
 *
 * A role is a name the Owner chooses plus a set of capabilities they tick. The vocabulary
 * of capabilities comes from the API (it is fixed by the code, since each one corresponds
 * to a real gate); everything else on this page is the Owner's to define.
 *
 * Deliberately NOT a level picker: roles do not rank against each other. "Vận hành" and
 * "Quản trị" are different jobs, not a higher and a lower one — whoever approves a payout
 * must not also be the one granting the assets.
 */
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  fetchAdminRoles, createAdminRole, updateAdminRole, deleteAdminRole,
  type AdminRole, type CapabilityVocabulary,
} from '@/lib/api';
import { useAuth, isOwnerWallet } from '@/lib/auth';

const EMPTY = { name: '', description: '', capabilities: [] as string[] };

export default function RolesPage() {
  const { user } = useAuth();
  const router = useRouter();

  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [vocab, setVocab] = useState<CapabilityVocabulary>({});
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  const [editing, setEditing] = useState<AdminRole | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AdminRole | null>(null);

  // Menu hiding is not a gate — the API enforces `admin.manage` regardless. This only
  // keeps a non-owner from landing on a page whose every request would 403.
  useEffect(() => {
    if (user && !isOwnerWallet(user.wallet)) router.replace('/stats');
  }, [user, router]);

  const show = (m: string) => { setToast(m); setTimeout(() => setToast(null), 4000); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetchAdminRoles();
      setRoles(r.data);
      setVocab(r.vocabulary);
    } catch (e: any) {
      show(e?.message || 'Không tải được danh sách chức danh');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const openNew = () => { setForm(EMPTY); setEditing({ id: '' } as AdminRole); };
  const openEdit = (r: AdminRole) => {
    setForm({ name: r.name, description: r.description ?? '', capabilities: [...r.capabilities] });
    setEditing(r);
  };

  const toggleCap = (key: string) =>
    setForm((f) => ({
      ...f,
      capabilities: f.capabilities.includes(key)
        ? f.capabilities.filter((c) => c !== key)
        : [...f.capabilities, key],
    }));

  /** Tick or clear a whole group at once — role editing is otherwise 25 clicks. */
  const toggleGroup = (keys: string[]) =>
    setForm((f) => {
      const all = keys.every((k) => f.capabilities.includes(k));
      return {
        ...f,
        capabilities: all
          ? f.capabilities.filter((c) => !keys.includes(c))
          : [...new Set([...f.capabilities, ...keys])],
      };
    });

  const save = async () => {
    if (!form.name.trim()) return show('Chức danh phải có tên');
    setSaving(true);
    try {
      if (editing?.id) {
        await updateAdminRole(editing.id, form);
        show('Đã cập nhật chức danh');
      } else {
        await createAdminRole(form);
        show('Đã tạo chức danh');
      }
      setEditing(null);
      await load();
    } catch (e: any) {
      show(e?.message || 'Lưu thất bại');
    } finally {
      setSaving(false);
    }
  };

  const doDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteAdminRole(deleteTarget.id);
      show(`Đã xoá "${deleteTarget.name}"`);
      setDeleteTarget(null);
      await load();
    } catch (e: any) {
      show(e?.message || 'Xoá thất bại');
    }
  };

  const groups = Object.entries(vocab);

  return (
    <div>
      {toast && (
        <div className="alert" style={{ position: 'fixed', top: 20, right: 20, zIndex: 200, boxShadow: '0 4px 16px rgba(0,0,0,.3)' }}>
          {toast}
        </div>
      )}

      <div className="page-head">
        <div>
          <div className="eyebrow">SETTINGS</div>
          <div className="page-title">Chức danh</div>
          <div className="page-sub">
            Tự đặt tên chức danh và chọn quyền cho từng chức danh. Gắn cho admin ở trang Admin Access.
          </div>
        </div>
        <button className="btn btn-primary" onClick={openNew}>+ Tạo chức danh</button>
      </div>

      <div className="alert" style={{ marginBottom: 16, fontSize: '.7rem', lineHeight: 1.6 }}>
        <strong>Chức danh không xếp bậc cao thấp.</strong> "Vận hành" và "Quản trị" là hai công việc
        khác nhau, không phải một cái trên một cái dưới — người duyệt chi tiền không nên đồng thời là
        người cấp phát tài sản. Bỏ tick một quyền là quyền đó mất hiệu lực ngay ở request kế tiếp,
        không cần ai đăng xuất.
      </div>

      {/* ── Role list ─────────────────────────────────────────── */}
      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: 16, borderBottom: '1px solid var(--border)' }}>
          <div className="card-title" style={{ margin: 0 }}>Danh sách chức danh ({roles.length})</div>
        </div>
        {loading ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>Đang tải…</div>
        ) : roles.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)', fontSize: '.7rem' }}>
            Chưa có chức danh nào.
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Chức danh</th>
                <th style={{ textAlign: 'center' }}>Số quyền</th>
                <th style={{ textAlign: 'center' }}>Đang gắn</th>
                <th style={{ textAlign: 'right' }}>Hành động</th>
              </tr>
            </thead>
            <tbody>
              {roles.map((r) => (
                <tr key={r.id}>
                  <td>
                    <strong style={{ color: 'var(--fg)' }}>{r.name}</strong>
                    {r.isSystem && <span className="badge" style={{ marginLeft: 8, fontSize: '.5rem' }}>KHOÁ</span>}
                    {r.description && (
                      <div style={{ fontSize: '.6rem', color: 'var(--muted)', marginTop: 3, maxWidth: 460 }}>
                        {r.description}
                      </div>
                    )}
                  </td>
                  <td style={{ textAlign: 'center', fontFamily: 'var(--font-m)', fontSize: '.7rem' }}>
                    {r.capabilities.length}
                  </td>
                  <td style={{ textAlign: 'center', fontFamily: 'var(--font-m)', fontSize: '.7rem' }}>
                    {r.userCount > 0
                      ? <span className="badge purple" style={{ fontSize: '.55rem' }}>{r.userCount} admin</span>
                      : <span style={{ color: 'var(--muted)' }}>—</span>}
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button className="btn btn-outline btn-sm" onClick={() => openEdit(r)}>Sửa</button>
                    <button
                      className="btn btn-outline btn-sm"
                      style={{ marginLeft: 6, color: 'var(--danger)', borderColor: 'var(--danger)' }}
                      disabled={r.isSystem || r.userCount > 0}
                      title={
                        r.isSystem ? 'Chức danh được bảo vệ'
                        : r.userCount > 0 ? `Còn ${r.userCount} admin đang giữ — chuyển họ sang chức danh khác trước`
                        : 'Xoá chức danh'
                      }
                      onClick={() => setDeleteTarget(r)}
                    >
                      Xoá
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Editor ────────────────────────────────────────────── */}
      {editing && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 150, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={() => setEditing(null)}
        >
          <div className="card" style={{ width: 720, maxHeight: '88vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <div className="card-title">{editing.id ? `Sửa: ${editing.name}` : 'Tạo chức danh mới'}</div>

            <div className="input-group">
              <label className="input-label">Tên chức danh</label>
              <input
                className="input"
                placeholder="VD: Kế toán trưởng, Trưởng vận hành miền Nam…"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>

            <div className="input-group">
              <label className="input-label">Mô tả (tuỳ chọn)</label>
              <input
                className="input"
                placeholder="Chức danh này làm gì"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>

            <div style={{ margin: '18px 0 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <div className="input-label" style={{ margin: 0 }}>Quyền</div>
              <div style={{ fontSize: '.62rem', color: 'var(--muted)', fontFamily: 'var(--font-m)' }}>
                đã chọn {form.capabilities.length}
              </div>
            </div>

            {groups.map(([groupName, caps]) => {
              const keys = caps.map((c) => c[0]);
              const allOn = keys.every((k) => form.capabilities.includes(k));
              return (
                <div key={groupName} style={{ marginBottom: 14, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                  <div
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: 'var(--bg-2)', cursor: 'pointer' }}
                    onClick={() => toggleGroup(keys)}
                  >
                    <strong style={{ fontSize: '.68rem', letterSpacing: '.04em', textTransform: 'uppercase' }}>{groupName}</strong>
                    <span style={{ fontSize: '.58rem', color: 'var(--muted)' }}>{allOn ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}</span>
                  </div>
                  <div style={{ padding: '6px 12px 10px' }}>
                    {caps.map(([key, label]) => (
                      <label
                        key={key}
                        style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '6px 0', cursor: 'pointer' }}
                      >
                        <input
                          type="checkbox"
                          checked={form.capabilities.includes(key)}
                          onChange={() => toggleCap(key)}
                          style={{ marginTop: 3 }}
                        />
                        <span>
                          <span style={{ fontSize: '.68rem', color: 'var(--fg)' }}>{label}</span>
                          <code style={{ display: 'block', fontSize: '.55rem', color: 'var(--muted)', fontFamily: 'var(--font-m)' }}>{key}</code>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}

            <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
              <button className="btn btn-primary" onClick={save} disabled={saving}>
                {saving ? 'Đang lưu…' : editing.id ? 'Lưu thay đổi' : 'Tạo chức danh'}
              </button>
              <button className="btn btn-outline" onClick={() => setEditing(null)}>Huỷ</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete confirm ────────────────────────────────────── */}
      {deleteTarget && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 150, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setDeleteTarget(null)}
        >
          <div className="card" style={{ width: 420 }} onClick={(e) => e.stopPropagation()}>
            <div className="card-title" style={{ color: 'var(--danger)' }}>Xoá chức danh</div>
            <div style={{ fontSize: '.7rem', lineHeight: 1.6, marginBottom: 18 }}>
              Xoá <strong style={{ color: 'var(--fg)' }}>{deleteTarget.name}</strong>? Thao tác này không hoàn tác được.
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-outline" onClick={() => setDeleteTarget(null)}>Huỷ</button>
              <button className="btn" style={{ background: 'var(--danger)', color: '#fff' }} onClick={doDelete}>Xoá</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
