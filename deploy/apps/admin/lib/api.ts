const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

function clearAdminSession() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('mc-admin-jwt');
}

interface FetchOptions extends RequestInit {
  timeout?: number;
}

async function apiFetch<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const { timeout = 10000, ...fetchOptions } = options;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  // Auto-attach JWT from localStorage
  const jwt = typeof window !== 'undefined' ? localStorage.getItem('mc-admin-jwt') : null;
  const headers: Record<string, string> = {
    ...(fetchOptions.headers as Record<string, string> || {}),
  };
  // Only set JSON content-type when there's actually a body — Fastify rejects
  // empty body with content-type: application/json otherwise.
  if (fetchOptions.body !== undefined && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  if (jwt) headers['Authorization'] = `Bearer ${jwt}`;

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...fetchOptions,
      signal: controller.signal,
      headers,
    });
    clearTimeout(id);
    if (res.status === 401) {
      clearAdminSession();
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
        window.location.assign('/login');
      }
    }
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.message || `API Error: ${res.status} ${res.statusText}`);
    }
    return res.json();
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

// ── Stats
export async function fetchStatsOverview() {
  return apiFetch<any>('/admin/stats');
}

// ── Sales Stats
export async function fetchSalesStats() {
  return apiFetch<any>('/admin/sales/stats');
}

// ── Revenue
export async function fetchRevenue() {
  return apiFetch<any>('/admin/revenue');
}

// ── Members (corrected route: /admin/users)
export async function fetchMembers(params?: { page?: number; limit?: number; search?: string; role?: string; kycStatus?: string }) {
  const query = new URLSearchParams();
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));
  if (params?.search) query.set('search', params.search);
  if (params?.role) query.set('role', params.role);
  if (params?.kycStatus) query.set('kycStatus', params.kycStatus);
  const qs = query.toString();
  return apiFetch<any>(`/admin/users${qs ? '?' + qs : ''}`);
}

export async function fetchMemberDetail(wallet: string) {
  return apiFetch<any>(`/admin/users/${wallet}`);
}

export async function updateMemberKyc(wallet: string, kycStatus: string) {
  return apiFetch<any>(`/admin/users/${wallet}/kyc`, {
    method: 'PUT',
    body: JSON.stringify({ kycStatus }),
  });
}

export async function updateMemberRole(wallet: string, role: string) {
  return apiFetch<any>(`/admin/users/${wallet}/role`, {
    method: 'PUT',
    body: JSON.stringify({ role }),
  });
}

// ── Rounds
export async function fetchRoundConfigs() {
  return apiFetch<any>('/admin/rounds');
}

export async function updateRoundConfig(roundType: string, data: any) {
  return apiFetch<any>(`/admin/rounds/${roundType}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

// ── Distributors
export async function fetchDistributors(params?: { page?: number; limit?: number; status?: string }) {
  const query = new URLSearchParams();
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));
  if (params?.status) query.set('status', params.status);
  const qs = query.toString();
  return apiFetch<any>(`/admin/distributors${qs ? '?' + qs : ''}`);
}

export async function fetchDistributorStats() {
  return apiFetch<any>('/admin/distributors/stats');
}

export async function grantDistributor(data: { wallet: string; commissionRate?: number; notes?: string }) {
  return apiFetch<any>('/admin/distributors', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateDistributor(wallet: string, data: { isActive?: boolean; commissionRate?: number; notes?: string }) {
  return apiFetch<any>(`/admin/distributors/${wallet}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteDistributor(wallet: string) {
  return apiFetch<any>(`/admin/distributors/${wallet}`, {
    method: 'DELETE',
  });
}

export async function fetchDistributorEarnings(wallet: string, params?: { page?: number; limit?: number }) {
  const query = new URLSearchParams();
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));
  const qs = query.toString();
  return apiFetch<any>(`/admin/distributors/${wallet}/earnings${qs ? '?' + qs : ''}`);
}

export async function fetchDistributorDetail(wallet: string) {
  return apiFetch<any>(`/admin/distributors/${wallet}/detail`);
}

export async function approvePayoutRequest(id: string, feeBps: number) {
  return apiFetch<any>(`/admin/distributors/payout-requests/${id}/approve`, {
    method: 'POST',
    body: JSON.stringify({ feeBps }),
  });
}

export async function rejectPayoutRequest(id: string, reason: string) {
  return apiFetch<any>(`/admin/distributors/payout-requests/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export async function markPayoutPaid(id: string, txHash: string) {
  return apiFetch<any>(`/admin/distributors/payout-requests/${id}/mark-paid`, {
    method: 'POST',
    body: JSON.stringify({ txHash }),
  });
}

export async function approveAndPayPayout(id: string, feeBps: number, txHash: string) {
  return apiFetch<any>(`/admin/distributors/payout-requests/${id}/approve-and-pay`, {
    method: 'POST',
    body: JSON.stringify({ feeBps, txHash }),
  });
}

export async function fetchPayoutConfig() {
  return apiFetch<any>('/admin/distributors/payout-config');
}

export async function savePayoutConfig(feeBps: number, feeReceiver: string) {
  return apiFetch<any>('/admin/distributors/payout-config', {
    method: 'PUT',
    body: JSON.stringify({ feeBps, feeReceiver }),
  });
}

export async function fetchAllPayoutRequests(params?: { status?: string; page?: number; limit?: number }) {
  const query = new URLSearchParams();
  if (params?.status) query.set('status', params.status);
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));
  const qs = query.toString();
  return apiFetch<any>(`/admin/distributors/payout-requests${qs ? '?' + qs : ''}`);
}

// ── DAO Board
export async function fetchDAOBoard() {
  return apiFetch<any>('/admin/board');
}

export async function addDAOMember(data: any) {
  return apiFetch<any>('/admin/board', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateDAOMember(wallet: string, data: any) {
  return apiFetch<any>(`/admin/board/${wallet}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteDAOMember(wallet: string) {
  return apiFetch<any>(`/admin/board/${wallet}`, {
    method: 'DELETE',
  });
}

// ── Admin Access Management
export async function fetchAdminAccess() {
  return apiFetch<any>('/admin/access');
}

export async function grantAdminAccess(data: { wallet: string; adminLevel?: string }) {
  return apiFetch<any>('/admin/access', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateAdminLevel(wallet: string, data: { adminLevel: string }) {
  return apiFetch<any>(`/admin/access/${wallet}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function revokeAdminAccess(wallet: string) {
  return apiFetch<any>(`/admin/access/${wallet}`, {
    method: 'DELETE',
  });
}

// ── System Config
export async function fetchSystemConfig() {
  return apiFetch<any>('/admin/system-config');
}

export async function updateSystemConfig(data: any) {
  return apiFetch<any>('/admin/system-config', {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

// ── Menu Config (Frontend Interface)
export async function fetchMenuConfig() {
  return apiFetch<any>('/menu-config');
}

export async function saveMenuConfig(items: any[]) {
  return apiFetch<any>('/admin/system-config/frontend-menu-config', {
    method: 'PUT',
    body: JSON.stringify({ value: JSON.stringify(items) }),
  });
}

// ── SEED Summary
export async function fetchSeedSummary() {
  return apiFetch<any>('/admin/sales/seed/summary');
}

// ── Promotion Config
export async function updatePromotion(roundType: string, data: {
  promotionActive?: boolean;
  promotionPct?: number | null;
  promotionStart?: string | null;
  promotionEnd?: string | null;
}) {
  return apiFetch<any>(`/admin/rounds/${roundType}/promotion`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

// ── MFP Artwork
export async function fetchMfpArtworks() {
  return apiFetch<any>('/admin/mfp-artwork');
}

export async function uploadMfpArtwork(data: { name: string; imageData: string }) {
  return apiFetch<any>('/admin/mfp-artwork', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateMfpArtwork(id: string, data: { active?: boolean; name?: string }) {
  return apiFetch<any>(`/admin/mfp-artwork/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteMfpArtwork(id: string) {
  return apiFetch<any>(`/admin/mfp-artwork/${id}`, {
    method: 'DELETE',
  });
}

// ── NFT Pool Admin
export async function fetchPoolStats() {
  return apiFetch<any>('/nft/pool/stats');
}

export async function fetchPoolAdminEntries(params?: { status?: string; tier?: string; search?: string; page?: number }) {
  const query = new URLSearchParams();
  if (params?.status) query.set('status', params.status);
  if (params?.tier) query.set('tier', params.tier);
  if (params?.search) query.set('search', params.search);
  if (params?.page) query.set('page', String(params.page));
  const qs = query.toString();
  return apiFetch<any>(`/nft/pool/admin/entries${qs ? '?' + qs : ''}`);
}

export async function fetchPoolActivity() {
  return apiFetch<any>('/nft/pool/admin/activity');
}

// ── Health
export async function fetchHealth() {
  return apiFetch<{ status: string }>('/health');
}

// ── Dashboard Overview (on-chain data)
export async function fetchDashboardOverview() {
  return apiFetch<any>('/dashboard/overview');
}

// ── MFP-NFT Admin (Lazy mint allowance + Authors Pool royalty)
export async function fetchMfpStats() {
  return apiFetch<{
    maxSupply: number;
    granted: number;
    minted: number;
    availablePool: number;
    remainingMintable: number;
    uniqueRecipients: number;
  }>('/admin/mfp/stats');
}

export async function fetchMfpRecipients() {
  return apiFetch<{
    data: Array<{
      wallet: string;
      granted: number;
      minted: number;
      remaining: number;
      latestSource: number;
      latestGrantAt: string;
    }>;
  }>('/admin/mfp/recipients');
}

export async function fetchMfpGrants(params?: { page?: number; source?: number; wallet?: string }) {
  const q = new URLSearchParams();
  if (params?.page) q.set('page', String(params.page));
  if (params?.source !== undefined) q.set('source', String(params.source));
  if (params?.wallet) q.set('wallet', params.wallet);
  const qs = q.toString();
  return apiFetch<{ data: any[]; pagination: any }>(`/admin/mfp/grants${qs ? '?' + qs : ''}`);
}

export async function recordMfpGrant(data: {
  wallet: string;
  amount: number;
  note?: string;
  txHash: string;
  blockNumber: number;
  grantedBy: string;
}) {
  return apiFetch<any>('/admin/mfp/grants', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function fetchMfpRoyalty() {
  return apiFetch<{ royaltyReceiver: string | null; royaltyBps: number }>('/admin/mfp/royalty');
}

export async function setMfpRoyaltyReceiver(receiver: string, txHash?: string) {
  return apiFetch<{ royaltyReceiver: string; royaltyBps: number }>('/admin/mfp/royalty', {
    method: 'PUT',
    body: JSON.stringify({ receiver, txHash }),
  });
}

// ─── Old Investors 75M — pending-request workflow ──────────────────────
export interface OldInvestorStats {
  allocationMic: number;
  grantedMic: number;
  pendingMic: number;
  remainingMic: number;
  recipientsCount: number;
  grantsCount: number;
  pendingCount: number;
  cancelledCount: number;
  lastGrantAt: string | null;
  lastGrantedBy: string | null;
  cooldownHours: number;
}

export interface OldInvestorRequest {
  id: string;
  recipient: string;
  recipientUserId: string | null;
  micAmount: number;
  startTime: string;
  note: string | null;
  status: 'PENDING' | 'DONE' | 'CANCELLED';
  requestedBy: string;
  requestedByUserId: string | null;
  cooldownEnd: string;
  executedAt: string | null;
  executedBy: string | null;
  executedByUserId: string | null;
  txHash: string | null;
  blockNumber: number | null;
  executeError: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  createdAt: string;
}

export async function fetchOldInvestorStats() {
  return apiFetch<{ data: OldInvestorStats }>('/admin/seed/old-investors/stats');
}

export async function fetchOldInvestorRequests(params?: {
  limit?: number;
  offset?: number;
  status?: 'PENDING' | 'DONE' | 'CANCELLED';
}) {
  const qs = new URLSearchParams();
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.offset) qs.set('offset', String(params.offset));
  if (params?.status) qs.set('status', params.status);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return apiFetch<{
    data: OldInvestorRequest[];
    total: number;
    limit: number;
    offset: number;
  }>(`/admin/seed/old-investors/requests${suffix}`);
}

export async function createOldInvestorRequest(data: {
  recipient: string;
  micAmount: number;
  startTime: number | string; // Unix seconds OR ISO string
  note?: string;
}) {
  return apiFetch<{ data: OldInvestorRequest }>('/admin/seed/old-investors/request', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function cancelOldInvestorRequest(id: string, reason?: string) {
  return apiFetch<{ data: OldInvestorRequest }>(
    `/admin/seed/old-investors/request/${id}/cancel`,
    {
      method: 'POST',
      body: JSON.stringify({ reason }),
    },
  );
}

export async function executeOldInvestorRequestNow(id: string) {
  return apiFetch<{
    data: {
      id: string;
      status: string;
      txHash: string | null;
      blockNumber: number | null;
      executedAt: string | null;
      executedBy: string | null;
    };
  }>(`/admin/seed/old-investors/request/${id}/execute`, { method: 'POST' });
}

// ─── Founders & Management 280M — pending-request workflow (48h) ───────
export interface FounderStats {
  allocationMic: number;
  grantedMic: number;
  pendingMic: number;
  remainingMic: number;
  recipientsCount: number;
  grantsCount: number;
  pendingCount: number;
  cancelledCount: number;
  lastGrantAt: string | null;
  lastGrantedBy: string | null;
  cooldownHours: number;
}

export interface FounderRequest {
  id: string;
  memberId: string;
  recipient: string;
  micAmount: number;
  role: string;
  note: string | null;
  status: 'PENDING' | 'DONE' | 'CANCELLED';
  requestedBy: string;
  requestedByUserId: string | null;
  cooldownEnd: string;
  executedAt: string | null;
  executedBy: string | null;
  executedByUserId: string | null;
  txHash: string | null;
  blockNumber: number | null;
  executeError: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  createdAt: string;
}

export async function fetchFounderStats() {
  return apiFetch<{ data: FounderStats }>('/admin/founders/stats');
}

export async function fetchFounderRequests(params?: {
  limit?: number;
  offset?: number;
  status?: 'PENDING' | 'DONE' | 'CANCELLED';
}) {
  const qs = new URLSearchParams();
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.offset) qs.set('offset', String(params.offset));
  if (params?.status) qs.set('status', params.status);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return apiFetch<{
    data: FounderRequest[];
    total: number;
    limit: number;
    offset: number;
  }>(`/admin/founders/requests${suffix}`);
}

export async function lookupFounderMember(memberId: string) {
  return apiFetch<{
    data: { userId: string; wallet: string; kycStatus: string; role: string };
  }>(`/admin/founders/lookup-member?memberId=${encodeURIComponent(memberId)}`);
}

export async function createFounderRequest(data: {
  memberId: string;
  micAmount: number;
  role: string;
  note?: string;
}) {
  return apiFetch<{ data: FounderRequest }>('/admin/founders/request', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function cancelFounderRequest(id: string, reason?: string) {
  return apiFetch<{ data: FounderRequest }>(`/admin/founders/request/${id}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export async function executeFounderRequestNow(id: string) {
  return apiFetch<{
    data: {
      id: string;
      status: string;
      txHash: string | null;
      blockNumber: number | null;
      executedAt: string | null;
      executedBy: string | null;
    };
  }>(`/admin/founders/request/${id}/execute`, { method: 'POST' });
}

// ─── STEWARD COUNCIL (Phase 2a) ─────────────────────────────────────────

export interface StewardCouncilMember {
  id: string;
  memberId: string;
  wallet: string;
  role: string;
  rightLabel: string;
  note: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  operationalShare?: { sharePctBps: number; weeklyMaxoutUsdt: string } | null;
}

export async function fetchStewardCouncil() {
  return apiFetch<{ data: StewardCouncilMember[] }>('/admin/steward-council');
}

export async function searchUserForCouncil(q: string) {
  return apiFetch<{ data: Array<{ userId: string; wallet: string; kycStatus: string }> }>(
    `/admin/steward-council/search-user?q=${encodeURIComponent(q)}`,
  );
}

export async function addStewardCouncilMember(data: {
  memberId: string;
  wallet: string;
  role: string;
  rightLabel?: string;
  note?: string;
}) {
  return apiFetch<{ data: StewardCouncilMember }>('/admin/steward-council', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateStewardCouncilMember(
  wallet: string,
  data: { role?: string; rightLabel?: string; note?: string; active?: boolean },
) {
  return apiFetch<{ data: StewardCouncilMember }>(`/admin/steward-council/${wallet}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteStewardCouncilMember(wallet: string) {
  return apiFetch<{ success: boolean }>(`/admin/steward-council/${wallet}`, {
    method: 'DELETE',
  });
}

// ─── OPERATIONAL POOL (Phase 2a) ────────────────────────────────────────

export interface OperationalPoolMember {
  wallet: string;
  memberId: string;
  role: string;
  active: boolean;
  sharePctBps: number;
  weeklyMaxoutUsdt: number;
  claimableUsdt: number;
  totalClaimedUsdt: number;
  totalAllocatedUsdt: number;
  allocatedThisWeek: number;
}

export async function fetchOperationalPool() {
  return apiFetch<{
    data: {
      members: OperationalPoolMember[];
      totalShareBps: number;
      weekIdx: number;
      totalClaimable: number;
      totalAllocated: number;
      totalClaimed: number;
    };
  }>('/admin/seed-budget/operational');
}

export async function enrollOperationalPoolMember(data: {
  wallet: string;
  sharePctBps: number;
  weeklyMaxoutUsdt: number;
}) {
  return apiFetch<any>('/admin/seed-budget/operational/members', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateOperationalPoolMember(
  wallet: string,
  data: { sharePctBps?: number; weeklyMaxoutUsdt?: number },
) {
  return apiFetch<any>(`/admin/seed-budget/operational/members/${wallet}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function removeOperationalPoolMember(wallet: string) {
  return apiFetch<{ success: boolean }>(
    `/admin/seed-budget/operational/members/${wallet}`,
    { method: 'DELETE' },
  );
}

export async function claimOperationalPool() {
  return apiFetch<{
    data: { claimId: string; amountUsdt: number; offChain: boolean; message: string };
  }>('/admin/seed-budget/operational/claim', { method: 'POST' });
}
