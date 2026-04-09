// Orchestra API (mic-orchestra on port 3847) — used for AI Settings, pipeline, model-check
const ORCHESTRA_API_BASE = process.env.NEXT_PUBLIC_ORCHESTRA_URL || 'http://127.0.0.1:3847';
// Shared backend API — used for members, auth, etc.
const API_BASE = process.env.NEXT_PUBLIC_ORCHESTRA_URL || ORCHESTRA_API_BASE;

interface ApiOptions {
  method?: string;
  body?: any;
  token?: string;
}

export async function apiCall(endpoint: string, options: ApiOptions = {}) {
  const { method = 'GET', body, token } = options;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${ORCHESTRA_API_BASE}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `API Error ${res.status}`);
  }
  return res.json();
}

export async function login(chatId: string, passphrase: string) {
  return apiCall('/api/auth/login', { method: 'POST', body: { chatId, passphrase } });
}

export async function getMembers(token: string) {
  return apiCall('/api/members', { token });
}

export async function createMember(data: any, token: string) {
  return apiCall('/api/members', { method: 'POST', body: data, token });
}

export async function updateMember(id: string, data: any, token: string) {
  return apiCall(`/api/members/${id}`, { method: 'PUT', body: data, token });
}

export async function deleteMember(id: string, token: string) {
  return apiCall(`/api/members/${id}`, { method: 'DELETE', token });
}

export async function getRoles(token: string) {
  return apiCall('/api/members/roles', { token });
}

export async function getAIConfig(token: string) {
  return apiCall('/api/ai-config', { token });
}

// ═══════════════════════════════════════════════════════════
//  AI Settings v2.2 — Orchestra Pipeline & Model APIs
// ═══════════════════════════════════════════════════════════

// ─── Model Health Check (no auth required) ───
export async function checkModels() {
  return apiCall('/api/model-check');
}

// ─── Readiness Gates (G1-G9) ───
export async function getReadiness(token: string) {
  return apiCall('/api/readiness', { token });
}

// ─── Pipeline ───
export async function startPipeline(data: { directive: string; workflow_type: string; scope: string; constraints?: any }, token: string) {
  return apiCall('/api/pipeline/start', { method: 'POST', body: data, token });
}

export async function getPipelineStatus(token: string) {
  return apiCall('/api/pipeline/status', { token });
}

export async function getPipelineTasks(token: string, filters?: { status?: string; workflow_type?: string; limit?: number }) {
  const params = new URLSearchParams();
  if (filters?.status) params.set('status', filters.status);
  if (filters?.workflow_type) params.set('workflow_type', filters.workflow_type);
  if (filters?.limit) params.set('limit', String(filters.limit));
  const qs = params.toString();
  return apiCall(`/api/pipeline/tasks${qs ? '?' + qs : ''}`, { token });
}

export async function getTask(taskId: string, token: string) {
  return apiCall(`/api/pipeline/tasks/${taskId}`, { token });
}

export async function submitDecision(taskId: string, decision: string, token: string) {
  return apiCall(`/api/pipeline/tasks/${taskId}/decision`, { method: 'POST', body: { decision }, token });
}

export async function cancelTask(taskId: string, token: string) {
  return apiCall(`/api/pipeline/tasks/${taskId}/cancel`, { method: 'POST', token });
}

// ─── Artifacts ───
export async function getArtifacts(token: string, filters?: { status?: string; limit?: number }) {
  const params = new URLSearchParams();
  if (filters?.status) params.set('status', filters.status);
  if (filters?.limit) params.set('limit', String(filters.limit));
  const qs = params.toString();
  return apiCall(`/api/artifacts${qs ? '?' + qs : ''}`, { token });
}

export async function getArtifact(id: string, token: string) {
  return apiCall(`/api/artifacts/${id}`, { token });
}

export async function getDebateLog(artifactId: string, token: string) {
  return apiCall(`/api/artifacts/${artifactId}/debate`, { token });
}

export async function getArtifactFindings(artifactId: string, token: string) {
  return apiCall(`/api/artifacts/${artifactId}/findings`, { token });
}

export async function submitArtifactDecision(artifactId: string, decision: string, token: string) {
  return apiCall(`/api/artifacts/${artifactId}/decision`, { method: 'PUT', body: { decision }, token });
}

// ─── Config Updates ───
export async function updateAiConfig(data: any, token: string) {
  return apiCall('/api/ai-config', { method: 'PUT', body: data, token });
}

export async function updateProvider(provider: string, data: { apiKey?: string; primaryModel?: string; fallbackModel?: string }, token: string) {
  return apiCall(`/api/ai-config/provider/${provider}`, { method: 'PUT', body: data, token });
}

export async function updateBudget(data: { daily?: number; monthly?: number }, token: string) {
  return apiCall('/api/ai-config/budget', { method: 'PUT', body: data, token });
}

export async function updateTelegram(data: { botToken?: string; chatId?: string }, token: string) {
  return apiCall('/api/ai-config/telegram', { method: 'PUT', body: data, token });
}

export async function reloadConfig(token: string) {
  return apiCall('/api/reload', { method: 'POST', token });
}
