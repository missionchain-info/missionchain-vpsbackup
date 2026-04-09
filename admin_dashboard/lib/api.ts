const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:3847';

interface ApiOptions {
  method?: string;
  body?: any;
  token?: string;
}

export async function apiCall(endpoint: string, options: ApiOptions = {}) {
  const { method = 'GET', body, token } = options;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${endpoint}`, {
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
