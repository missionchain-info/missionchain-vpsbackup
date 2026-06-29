const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

function clearWebSession() {
  if (typeof window === 'undefined') return
  localStorage.removeItem('mc-jwt')
  localStorage.removeItem('mc-userId')
  localStorage.removeItem('mc-wallet')
}

interface ApiOptions {
  method?: string
  body?: unknown
  token?: string
}

export async function api<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  const { method = 'GET', body, token } = opts
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  // Auto-attach JWT: explicit token > localStorage fallback
  const jwt = token || (typeof window !== 'undefined' ? localStorage.getItem('mc-jwt') : null)
  if (jwt) headers['Authorization'] = `Bearer ${jwt}`

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })

  if (res.status === 401) {
    clearWebSession()
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: 'Request failed' }))
    throw new Error(err.message || `API error ${res.status}`)
  }

  return res.json()
}

// Auth endpoints
export const authApi = {
  checkUserId: (userId: string) =>
    api<{ available: boolean }>(`/auth/check-userid?userId=${encodeURIComponent(userId)}`),

  checkReferrer: (ref: string) =>
    api<{ valid: boolean; name?: string }>(`/auth/check-referrer?ref=${encodeURIComponent(ref)}`),

  register: (data: { wallet: string; userId: string; referrer?: string; termsAccepted: boolean }) =>
    api<{ success: boolean; nonce: string }>('/auth/register', { method: 'POST', body: data }),

  getNonce: (wallet: string) =>
    api<{ nonce: string }>(`/auth/nonce?wallet=${encodeURIComponent(wallet)}`),

  verify: (data: { wallet: string; signature: string }) =>
    api<{ jwt: string; user: { id: string; userId: string; wallet: string } }>('/auth/verify', { method: 'POST', body: data }),
}
