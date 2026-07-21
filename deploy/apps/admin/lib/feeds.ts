// Admin Feeds API helpers (self-contained; reuses mc-admin-jwt from localStorage).
const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

function token(): string | null {
  return typeof window !== 'undefined' ? localStorage.getItem('mc-admin-jwt') : null;
}

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(opts.headers as Record<string, string> || {}) };
  if (opts.body) headers['Content-Type'] = 'application/json';
  const t = token();
  if (t) headers['Authorization'] = `Bearer ${t}`;
  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers });
  if (res.status === 401) {
    if (typeof window !== 'undefined') { localStorage.removeItem('mc-admin-jwt'); window.location.assign('/login'); }
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || e.message || `${res.status} ${res.statusText}`);
  }
  if (res.status === 204) return null as unknown as T;
  return res.json();
}

export interface FeedItem {
  id: string; type: string; pillar: string; title: string; body: string;
  media?: string[] | null; lang: string; sourceUrl?: string | null;
  sourceAttribution?: string | null; verseRef?: string | null; verseText?: string | null;
  status: string; createdBy: string; pinned: boolean; publishedAt?: string | null;
  createdAt: string; updatedAt: string;
}

export interface AiCheckResult {
  enabled: boolean; error?: string; detail?: string;
  correctedTitle?: string; correctedBody?: string; notes?: string[]; complianceFlags?: string[];
}

export const listAdminFeeds = (qs = '') => req<{ items: FeedItem[] }>(`/feeds/admin${qs}`);
export const createFeed = (data: Partial<FeedItem>) => req<FeedItem>('/feeds/admin', { method: 'POST', body: JSON.stringify(data) });
export const updateFeed = (id: string, data: Partial<FeedItem>) => req<FeedItem>(`/feeds/admin/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteFeed = (id: string) => req<null>(`/feeds/admin/${id}`, { method: 'DELETE' });
export const aiCheckFeed = (data: { title: string; body: string; pillar: string }) =>
  req<AiCheckResult>('/feeds/admin/ai-check', { method: 'POST', body: JSON.stringify(data) });
