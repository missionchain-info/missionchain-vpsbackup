'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useAccount, useSignMessage } from 'wagmi'
import { api, authApi } from '@/lib/api'
import Sidebar from '@/components/layout/Sidebar'
import Topbar from '@/components/layout/Topbar'
import BottomNav from '@/components/layout/BottomNav'
import DevicePreview from '@/components/DevicePreview'
import { HelpProvider } from '@/components/help/HelpContext'
import HelpPanel from '@/components/help/HelpPanel'

// Decode JWT payload (no verify — just read wallet field)
function getJwtWallet(): string | null {
  if (typeof window === 'undefined') return null
  const jwt = localStorage.getItem('mc-jwt')
  if (!jwt) return null
  try {
    const payload = JSON.parse(atob(jwt.split('.')[1] || ''))
    return (payload?.wallet as string)?.toLowerCase() ?? null
  } catch { return null }
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  // wagmi hydrates async on page load — `status` distinguishes 'connected' /
  // 'disconnected' / 'reconnecting' / 'connecting'. Old code used only
  // `isConnected`, which is briefly false during reconnection right after
  // navigating to /dashboard, causing a false-positive "logout → redirect /"
  // bounce. We must only redirect when the wallet is **truly** disconnected.
  const { address, status } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const [ready, setReady] = useState(false)
  const reauthing = useRef(false)

  useEffect(() => {
    const jwt = typeof window !== 'undefined' ? localStorage.getItem('mc-jwt') : null
    if (!jwt) {
      router.replace('/')
      return
    }
    setReady(true)
  }, [router])

  // Only clear session + redirect when wallet is fully disconnected (not reconnecting/connecting).
  // A network switch (chainChanged) or a brief reconnect can momentarily flash
  // 'disconnected'; clearing the session on that blip logs the user out on every
  // chain switch. So we DEBOUNCE: only clear if the wallet is STILL disconnected
  // ~1.5s later (checked via a ref holding the latest status).
  const statusRef = useRef(status)
  statusRef.current = status

  /*
   * "Not connected yet" is not "the user disconnected".
   *
   * Inside a mobile wallet's in-app browser the page is commonly rebuilt after the
   * signature — the wallet hands control back and the WebView reloads. wagmi then starts
   * from scratch and reports 'disconnected' until the injected connector reconnects,
   * which on a phone over 4G routinely takes longer than the 1.5s this used to allow.
   * The timer fired, the JWT was deleted, and the user was thrown back to Connect Wallet
   * with a working session destroyed. On 2026-09-02 one wallet signed in twelve times in
   * six hours for that reason.
   *
   * So two guards. First, only a session that was actually seen connected can be treated
   * as disconnected — a page that never connected has not lost anything. Second, give a
   * phone real time to reconnect, not a desktop's.
   */
  const hasBeenConnected = useRef(false)
  useEffect(() => {
    if (status === 'connected') hasBeenConnected.current = true
  }, [status])

  useEffect(() => {
    if (status !== 'disconnected') return
    if (typeof window === 'undefined') return
    if (!hasBeenConnected.current) return // never connected in this mount — nothing was lost
    const t = setTimeout(() => {
      if (statusRef.current !== 'disconnected') return // recovered (e.g. chain switch) — keep session
      localStorage.removeItem('mc-jwt')
      localStorage.removeItem('mc-userId')
      localStorage.removeItem('mc-wallet')
      router.replace('/')
    }, 8000)
    return () => clearTimeout(t)
  }, [status, router])

  // Layer C: Auto-reauth if connected wallet differs from JWT wallet
  // This handles the case where user switches MetaMask account mid-session.
  useEffect(() => {
    if (status !== 'connected' || !address || reauthing.current) return
    const jwtWallet = getJwtWallet()
    const current = address.toLowerCase()
    if (jwtWallet && jwtWallet === current) return // already authed for this wallet

    reauthing.current = true
    ;(async () => {
      try {
        const nonceRes = await api<{ nonce: string }>(`/auth/nonce?wallet=${current}`)
        if (!nonceRes.nonce) throw new Error('no nonce')
        const message = `Mission Chain Authentication\nNonce: ${nonceRes.nonce}`
        const signature = await signMessageAsync({ message })
        const verifyRes = await authApi.verify({ wallet: current, signature })
        localStorage.setItem('mc-jwt', verifyRes.jwt)
        localStorage.setItem('mc-userId', verifyRes.user.userId)
        localStorage.setItem('mc-wallet', verifyRes.user.wallet)
        // Force a soft refresh so useApi hooks pick up the new JWT
        window.dispatchEvent(new Event('mc-auth-changed'))
      } catch (err: any) {
        // Wallet not registered → send to /register
        const msg = err?.message || ''
        if (msg.includes('NOT_FOUND') || msg.includes('not found')) {
          router.replace('/register')
        } else {
          // Other errors: stay (user can manually retry from Topbar)
          console.warn('[Auto-reauth] failed:', msg)
        }
      } finally {
        reauthing.current = false
      }
    })()
  }, [address, status, signMessageAsync, router])

  if (!ready) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg)', color: 'var(--muted)' }}>
        Loading...
      </div>
    )
  }

  return (
    <HelpProvider>
      <div className="screen-dashboard" style={{ display: 'flex' }}>
        <Sidebar />
        <div className="dashboard-container">
          <Topbar />
          <div className="content-area">
            <div className="page-enter">
              {children}
            </div>
          </div>
        </div>
        <BottomNav />
        <DevicePreview />
        <HelpPanel />
      </div>
    </HelpProvider>
  )
}
