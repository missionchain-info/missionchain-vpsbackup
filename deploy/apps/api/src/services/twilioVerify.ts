/**
 * Twilio Verify — server-side phone OTP for KYC.
 *
 * Fallback for the Firebase phone-auth path that fails inside in-app browsers
 * (WebView reCAPTCHA blocked → auth/error-code:-39). Twilio Verify generates,
 * delivers and checks the OTP itself — we never store or handle the code.
 *
 * Config is admin-managed and stored in SystemConfig (key `twilio_kyc`), edited
 * from Admin → System → "Twilio Server KYC". Env vars are kept as a fallback:
 *   TWILIO_ACCOUNT_SID        = ACxxxxxxxx…      (Console dashboard)
 *   TWILIO_AUTH_TOKEN         = your auth token  (Console dashboard)
 *   TWILIO_VERIFY_SERVICE_SID = VAxxxxxxxx…      (Verify → Services)
 *
 * No npm dependency: uses the global fetch (Node 18+) against Twilio's REST API.
 */
const BASE = 'https://verify.twilio.com/v2'

export interface TwilioCfg {
  accountSid?: string
  authToken?: string
  verifyServiceSid?: string
}

/** Resolve effective config: explicit cfg wins, else fall back to env vars. */
function resolve(cfg?: TwilioCfg): Required<TwilioCfg> {
  return {
    accountSid: cfg?.accountSid || process.env.TWILIO_ACCOUNT_SID || '',
    authToken: cfg?.authToken || process.env.TWILIO_AUTH_TOKEN || '',
    verifyServiceSid: cfg?.verifyServiceSid || process.env.TWILIO_VERIFY_SERVICE_SID || '',
  }
}

export function twilioConfigured(cfg?: TwilioCfg): boolean {
  const c = resolve(cfg)
  return Boolean(c.accountSid && c.authToken && c.verifyServiceSid)
}

function authHeader(c: Required<TwilioCfg>): string {
  return 'Basic ' + Buffer.from(`${c.accountSid}:${c.authToken}`).toString('base64')
}

/** Start an SMS verification — Twilio sends the code to `phone` (E.164, e.g. +14155550123). */
export async function startPhoneVerification(
  phone: string,
  cfg?: TwilioCfg,
): Promise<{ ok: boolean; status?: string; error?: string }> {
  const c = resolve(cfg)
  if (!twilioConfigured(c)) {
    console.warn('[TWILIO] Verify not configured — SMS OTP not sent.')
    return { ok: false, error: 'TWILIO_NOT_CONFIGURED' }
  }
  try {
    const res = await fetch(`${BASE}/Services/${c.verifyServiceSid}/Verifications`, {
      method: 'POST',
      headers: { Authorization: authHeader(c), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: phone, Channel: 'sms' }),
    })
    const data: any = await res.json()
    if (!res.ok) {
      console.error('[TWILIO] start verification failed:', data?.message || res.status)
      return { ok: false, error: data?.message || `HTTP ${res.status}` }
    }
    return { ok: true, status: data.status } // 'pending'
  } catch (err: any) {
    console.error('[TWILIO] start verification error:', err?.message)
    return { ok: false, error: err?.message || 'NETWORK_ERROR' }
  }
}

/** Check the code the user entered. Returns approved=true only when Twilio confirms it. */
export async function checkPhoneVerification(
  phone: string,
  code: string,
  cfg?: TwilioCfg,
): Promise<{ approved: boolean; error?: string }> {
  const c = resolve(cfg)
  if (!twilioConfigured(c)) return { approved: false, error: 'TWILIO_NOT_CONFIGURED' }
  try {
    const res = await fetch(`${BASE}/Services/${c.verifyServiceSid}/VerificationCheck`, {
      method: 'POST',
      headers: { Authorization: authHeader(c), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: phone, Code: code }),
    })
    const data: any = await res.json()
    // Twilio returns 404 once a verification is consumed/expired — treat as not approved.
    if (!res.ok) return { approved: false, error: data?.message || `HTTP ${res.status}` }
    return { approved: data.status === 'approved' }
  } catch (err: any) {
    console.error('[TWILIO] check verification error:', err?.message)
    return { approved: false, error: err?.message || 'NETWORK_ERROR' }
  }
}
