'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  listAdminFeeds, createFeed, updateFeed, deleteFeed, aiCheckFeed,
  type FeedItem, type AiCheckResult,
} from '@/lib/feeds';

const PILLARS = [
  { key: 'announcement', label: 'Announcement' },
  { key: 'ai', label: 'AI' },
  { key: 'tech', label: 'Technology' },
  { key: 'finance', label: 'Finance' },
  { key: 'faith', label: 'Faith' },
];
const HIGH_RISK = ['finance', 'faith'];

const STATUS_META: Record<string, { label: string; color: string }> = {
  draft: { label: 'DRAFT', color: '#8a8a8a' },
  pending_review: { label: 'PENDING', color: '#c084d4' },
  approved: { label: 'APPROVED', color: '#4a9eda' },
  published: { label: 'PUBLISHED', color: '#3fbf7f' },
  rejected: { label: 'REJECTED', color: '#c05a5a' },
};

type Form = {
  id?: string; pillar: string; title: string; body: string; lang: string;
  mediaText: string; sourceUrl: string; sourceAttribution: string;
  verseRef: string; verseText: string; pinned: boolean;
};

const EMPTY: Form = {
  pillar: 'announcement', title: '', body: '', lang: 'en',
  mediaText: '', sourceUrl: '', sourceAttribution: '', verseRef: '', verseText: '', pinned: false,
};

const inp: React.CSSProperties = {
  width: '100%', padding: '9px 12px', borderRadius: 8, background: 'var(--bg2, #17101c)',
  border: '1px solid var(--border, #34283f)', color: 'var(--white, #f3ecf7)', fontSize: 14, marginTop: 4,
};
const lbl: React.CSSProperties = { fontSize: 12, color: 'var(--muted, #9a8fa8)', fontWeight: 600 };

function toPayload(f: Form): Partial<FeedItem> {
  const media = f.mediaText.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
  return {
    pillar: f.pillar, title: f.title.trim(), body: f.body.trim(), lang: f.lang,
    media: media.length ? media : null,
    sourceUrl: f.sourceUrl.trim() || null,
    sourceAttribution: f.sourceAttribution.trim() || null,
    verseRef: f.verseRef.trim() || null,
    verseText: f.verseText.trim() || null,
    pinned: f.pinned,
  } as Partial<FeedItem>;
}

export default function FeedsAdminPage() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<Form>(EMPTY);
  const [ai, setAi] = useState<AiCheckResult | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [filter, setFilter] = useState('all');

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3200); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = filter === 'all' ? '' : `?status=${filter}`;
      const res = await listAdminFeeds(qs);
      setItems(res.items || []);
    } catch (e: any) { flash('Load error: ' + e.message); }
    finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const set = (patch: Partial<Form>) => setForm(prev => ({ ...prev, ...patch }));
  const reset = () => { setForm(EMPTY); setAi(null); };

  const runAi = async () => {
    if (!form.title.trim() && !form.body.trim()) { flash('Enter content first'); return; }
    setAiBusy(true); setAi(null);
    try {
      const r = await aiCheckFeed({ title: form.title, body: form.body, pillar: form.pillar });
      setAi(r);
      if (r.error === 'ai_disabled') flash('AI not enabled (missing OPENAI_API_KEY)');
      else if (r.error) flash('AI error: ' + r.error);
    } catch (e: any) { flash('AI error: ' + e.message); }
    finally { setAiBusy(false); }
  };

  const applyAi = () => {
    if (!ai) return;
    set({ title: ai.correctedTitle ?? form.title, body: ai.correctedBody ?? form.body });
    flash('Applied AI corrections');
  };

  const save = async (status: 'draft' | 'published') => {
    if (!form.title.trim() || !form.body.trim()) { flash('Title / body required'); return; }
    if (status === 'published' && HIGH_RISK.includes(form.pillar)) {
      const ok = window.confirm(
        `"${form.pillar}" content is SENSITIVE (faith / finance) — human review required.\n\n` +
        `Confirm you have reviewed it, it is compliant (no ROI / no investment advice; Scripture quoted correctly) and you want to PUBLISH?`
      );
      if (!ok) return;
    }
    setSaving(true);
    try {
      const payload = { ...toPayload(form), status };
      if (form.id) await updateFeed(form.id, payload);
      else await createFeed(payload);
      flash(status === 'published' ? 'Published ✓' : 'Draft saved ✓');
      reset(); load();
    } catch (e: any) { flash('Save error: ' + e.message); }
    finally { setSaving(false); }
  };

  const edit = (it: FeedItem) => {
    setForm({
      id: it.id, pillar: it.pillar, title: it.title, body: it.body, lang: it.lang,
      mediaText: Array.isArray(it.media) ? it.media.join('\n') : '',
      sourceUrl: it.sourceUrl || '', sourceAttribution: it.sourceAttribution || '',
      verseRef: it.verseRef || '', verseText: it.verseText || '', pinned: it.pinned,
    });
    setAi(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const togglePublish = async (it: FeedItem) => {
    const next = it.status === 'published' ? 'draft' : 'published';
    if (next === 'published' && HIGH_RISK.includes(it.pillar)) {
      if (!window.confirm(`"${it.pillar}" is sensitive — confirm reviewed and PUBLISH?`)) return;
    }
    try { await updateFeed(it.id, { status: next }); load(); } catch (e: any) { flash('Error: ' + e.message); }
  };

  const remove = async (it: FeedItem) => {
    if (!window.confirm(`Delete "${it.title}"? This cannot be undone.`)) return;
    try { await deleteFeed(it.id); load(); flash('Deleted'); } catch (e: any) { flash('Error: ' + e.message); }
  };

  const isFaith = form.pillar === 'faith';
  const highRisk = HIGH_RISK.includes(form.pillar);

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 6 }}>
        <h1 style={{ fontSize: 24, color: 'var(--gold, #c9a84c)', margin: 0 }}>📰 Feeds — Public Content</h1>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>Compose · AI-check · review · publish to app.missionchain.io/feeds</span>
      </div>

      <div style={{ background: 'rgba(201,168,76,.07)', border: '1px solid var(--border,#34283f)', borderRadius: 10, padding: '10px 14px', fontSize: 12.5, color: 'var(--muted)', marginBottom: 18 }}>
        ⛔ <b>Compliance gate (Phase 1 — manual review):</b> Finance: no ROI / no predictions / no investment advice (add &ldquo;Not financial advice&rdquo;). Faith: quote public-domain Scripture (WEB/KJV), respectful. External sources: rewrite + attribute. <b>Faith &amp; Finance always require human review before publishing.</b>
      </div>

      {/* ── FORM ── */}
      <div style={{ background: 'var(--bg2, #17101c)', border: '1px solid var(--border,#34283f)', borderRadius: 14, padding: 20, marginBottom: 26 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
          <b style={{ color: 'var(--white)' }}>{form.id ? 'Edit content' : 'Compose new content'}</b>
          {form.id && <button onClick={reset} style={btn('ghost')}>+ New instead</button>}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 120px 90px', gap: 12, marginBottom: 12 }}>
          <label><span style={lbl}>Pillar</span>
            <select value={form.pillar} onChange={e => set({ pillar: e.target.value })} style={inp}>
              {PILLARS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </label>
          <label><span style={lbl}>Language</span>
            <select value={form.lang} onChange={e => set({ lang: e.target.value })} style={inp}>
              {['en', 'vi', 'es', 'pt', 'ko'].map(l => <option key={l} value={l}>{l.toUpperCase()}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column' }}><span style={lbl}>Pin to top</span>
            <span style={{ marginTop: 10 }}>
              <input type="checkbox" checked={form.pinned} onChange={e => set({ pinned: e.target.checked })} /> Pinned
            </span>
          </label>
          {highRisk && <div style={{ alignSelf: 'end', fontSize: 11, color: '#e0b24a', fontWeight: 700 }}>⚠ SENSITIVE</div>}
        </div>

        <label><span style={lbl}>Title</span>
          <input value={form.title} onChange={e => set({ title: e.target.value })} style={inp} placeholder="Feed card title" />
        </label>
        <label style={{ display: 'block', marginTop: 12 }}><span style={lbl}>Body</span>
          <textarea value={form.body} onChange={e => set({ body: e.target.value })} style={{ ...inp, minHeight: 120, resize: 'vertical', fontFamily: 'inherit' }} placeholder="Short, concise content" />
        </label>

        {isFaith && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12, marginTop: 12 }}>
            <label><span style={lbl}>Scripture reference</span>
              <input value={form.verseRef} onChange={e => set({ verseRef: e.target.value })} style={inp} placeholder="e.g. Proverbs 9:10" />
            </label>
            <label><span style={lbl}>Verse text (WEB/KJV)</span>
              <input value={form.verseText} onChange={e => set({ verseText: e.target.value })} style={inp} placeholder="The verse text" />
            </label>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
          <label><span style={lbl}>Source — attribution</span>
            <input value={form.sourceAttribution} onChange={e => set({ sourceAttribution: e.target.value })} style={inp} placeholder="e.g. Reuters / Editorial" />
          </label>
          <label><span style={lbl}>Source — URL</span>
            <input value={form.sourceUrl} onChange={e => set({ sourceUrl: e.target.value })} style={inp} placeholder="https://…" />
          </label>
        </div>
        <label style={{ display: 'block', marginTop: 12 }}><span style={lbl}>Image/media (one URL per line — optional)</span>
          <textarea value={form.mediaText} onChange={e => set({ mediaText: e.target.value })} style={{ ...inp, minHeight: 52, resize: 'vertical', fontFamily: 'inherit' }} placeholder="https://…/image.jpg" />
        </label>

        {/* AI check */}
        <div style={{ marginTop: 16, display: 'flex', gap: 10, alignItems: 'center' }}>
          <button onClick={runAi} disabled={aiBusy} style={btn('ai')}>{aiBusy ? '⏳ Checking…' : '✨ AI grammar & compliance check'}</button>
          <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>gpt-4o-mini · keeps meaning, suggests fixes</span>
        </div>

        {ai && ai.enabled && !ai.error && (
          <div style={{ marginTop: 12, background: 'rgba(74,158,218,.06)', border: '1px solid #2f4a5e', borderRadius: 10, padding: 14 }}>
            <div style={{ fontSize: 12, color: '#7fc0ef', fontWeight: 700, marginBottom: 8 }}>AI RESULT</div>
            {(ai.complianceFlags?.length ?? 0) > 0 && (
              <div style={{ marginBottom: 10, padding: '8px 10px', background: 'rgba(192,90,90,.12)', border: '1px solid #7a3a3a', borderRadius: 8 }}>
                <b style={{ color: '#e88', fontSize: 12 }}>⚠ COMPLIANCE WARNINGS:</b>
                <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12.5, color: '#f0c0c0' }}>
                  {ai.complianceFlags!.map((f, i) => <li key={i}>{f}</li>)}
                </ul>
              </div>
            )}
            {(ai.notes?.length ?? 0) > 0 && (
              <ul style={{ margin: '0 0 10px', paddingLeft: 18, fontSize: 12.5, color: 'var(--muted)' }}>
                {ai.notes!.map((n, i) => <li key={i}>{n}</li>)}
              </ul>
            )}
            <div style={{ fontSize: 12, color: 'var(--gray,#cfc4d8)' }}>
              <b style={{ color: 'var(--gold)' }}>Corrected title:</b> {ai.correctedTitle}
              <div style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}><b style={{ color: 'var(--gold)' }}>Corrected body:</b> {ai.correctedBody}</div>
            </div>
            <button onClick={applyAi} style={{ ...btn('ghost'), marginTop: 10 }}>↩ Apply corrections</button>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
          <button onClick={() => save('draft')} disabled={saving} style={btn('ghost')}>💾 Save draft</button>
          <button onClick={() => save('published')} disabled={saving} style={btn('gold')}>🚀 {form.id ? 'Update & Publish' : 'Publish now'}</button>
        </div>
      </div>

      {/* ── LIST ── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {['all', 'draft', 'published'].map(s => (
          <button key={s} onClick={() => setFilter(s)} style={{ ...btn(filter === s ? 'gold' : 'ghost'), padding: '5px 12px', fontSize: 12 }}>
            {s === 'all' ? 'All' : STATUS_META[s]?.label || s}
          </button>
        ))}
        <button onClick={load} style={{ ...btn('ghost'), padding: '5px 12px', fontSize: 12 }}>⟳ Reload</button>
      </div>

      {loading ? <p style={{ color: 'var(--muted)' }}>Loading…</p> :
        items.length === 0 ? <p style={{ color: 'var(--muted)' }}>No content yet.</p> :
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {items.map(it => {
              const sm = STATUS_META[it.status] || { label: it.status, color: '#888' };
              return (
                <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'var(--bg2,#17101c)', border: '1px solid var(--border,#34283f)', borderRadius: 10, padding: '10px 14px' }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: sm.color, border: `1px solid ${sm.color}`, borderRadius: 5, padding: '2px 6px', whiteSpace: 'nowrap' }}>{sm.label}</span>
                  <span style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--gold)', width: 90 }}>{it.pillar}{HIGH_RISK.includes(it.pillar) ? ' ⚠' : ''}</span>
                  <span style={{ flex: 1, color: 'var(--white)', fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.pinned ? '📌 ' : ''}{it.title}</span>
                  <button onClick={() => edit(it)} style={btn('mini')}>Edit</button>
                  <button onClick={() => togglePublish(it)} style={btn('mini')}>{it.status === 'published' ? 'Hide' : 'Publish'}</button>
                  <button onClick={() => remove(it)} style={{ ...btn('mini'), color: '#e88', borderColor: '#7a3a3a' }}>Delete</button>
                </div>
              );
            })}
          </div>}

      {toast && <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: '#241426', color: 'var(--white)', border: '1px solid var(--gold)', borderRadius: 8, padding: '10px 20px', zIndex: 1000, fontSize: 13 }}>{toast}</div>}
    </div>
  );
}

function btn(kind: 'gold' | 'ghost' | 'ai' | 'mini'): React.CSSProperties {
  const base: React.CSSProperties = { cursor: 'pointer', borderRadius: 8, fontWeight: 600, fontSize: 13, padding: '9px 16px', border: '1px solid var(--border,#34283f)', background: 'transparent', color: 'var(--white,#f3ecf7)' };
  if (kind === 'gold') return { ...base, background: 'var(--gold,#c9a84c)', color: '#241426', border: 'none' };
  if (kind === 'ai') return { ...base, border: '1px solid #3f6fa0', color: '#8fc0ef' };
  if (kind === 'mini') return { ...base, padding: '5px 10px', fontSize: 12 };
  return base;
}
