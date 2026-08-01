'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useAccount, useSignMessage } from 'wagmi'
import { api, authApi } from '@/lib/api'
import Sidebar from '@/components/layout/Sidebar'
import Topbar from '@/components/layout/Topbar'
import BottomNav from '@/components/layout/BottomNav'

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

  // Only clear session + redirect when wallet is fully disconnected (not reconnecting/connecting)
  useEffect(() => {
    if (status !== 'disconnected') return
    if (typeof window === 'undefined') return
    localStorage.removeItem('mc-jwt')
    localStorage.removeItem('mc-userId')
    localStorage.removeItem('mc-wallet')
    router.replace('/')
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
    </div>
  )
}
