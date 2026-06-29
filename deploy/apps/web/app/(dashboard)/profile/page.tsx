'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { useAccount } from 'wagmi'
import SubNav, { PROFILE_TABS } from '@/components/layout/SubNav'
import { useApi } from '@/hooks/useApi'
import { api } from '@/lib/api'
import LoadingSpinner from '@/components/ui/LoadingSpinner'
import { QRCodeSVG } from 'qrcode.react'
import { auth, RecaptchaVerifier, signInWithPhoneNumber } from '@/lib/firebase'
import type { ConfirmationResult } from 'firebase/auth'

interface ProfileData {
  data?: {
    userId?: string
    wallet?: string
    referrer?: string
    avatarUrl?: string
    email?: string
    phone?: string
    emailVerified?: boolean
    phoneVerified?: boolean
    kycStatus?: string
    role?: string
    gvRank?: string
    mfpCount?: number
    totalGV?: string
    referralCount?: number
    createdAt?: string
    telegramHandle?: string
    telegramChatId?: string
    telegramVerified?: boolean
    telegramVerifiedAt?: string
    whatsappNumber?: string
    whatsappVerified?: boolean
    whatsappVerifiedAt?: string
  }
}

const RANK_MAP: Record<string, { icon: string; color: string }> = {
  Believer:         { icon: '\u{1F331}', color: 'var(--muted)' },
  Builder:          { icon: '\u{1F6E0}', color: '#29B6F6' },
  Connector:        { icon: '\u{2B50}',  color: '#AB47BC' },
  Champion:         { icon: '\u{1F48E}', color: '#C084D4' },
  Ambassador:       { icon: '\u{1F451}', color: 'var(--gold)' },
  Legend:            { icon: '\u{1F3C6}', color: '#FFD700' },
}

function shortenAddr(a: string) {
  return a.slice(0, 6) + '\u2026' + a.slice(-4)
}

function copyText(text: string, setCopied: (v: string) => void, key: string) {
  navigator.clipboard?.writeText(text)
  setCopied(key)
  setTimeout(() => setCopied(''), 2000)
}

function formatDate(d?: string) {
  if (!d) return '-'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/* ── Inline SVG Icons ── */
const IconUser = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
const IconMail = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
const IconLink = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
const IconWallet = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M16 14h.01"/><path d="M2 10h20"/></svg>
const IconCopy = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
const IconCheck = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
const IconShield = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/></svg>
const IconShare = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
const IconCamera = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
const IconPhone = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
const IconLock = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>

export default function ProfilePage() {
  const { address } = useAccount()
  const { data: resp, loading, refetch } = useApi<ProfileData>('/user/profile', { enabled: !!address })
  const [copied, setCopied] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  // KYC states
  const [kycEmail, setKycEmail] = useState('')
  const [kycPhone, setKycPhone] = useState('')
  const [emailOtp, setEmailOtp] = useState('')
  const [phoneOtp, setPhoneOtp] = useState('')
  const [emailOtpSent, setEmailOtpSent] = useState(false)
  const [phoneOtpSent, setPhoneOtpSent] = useState(false)
  const [kycLoading, setKycLoading] = useState('')
  const [kycMsg, setKycMsg] = useState('')

  // Social connect — Telegram + WhatsApp
  const [telegramHandle, setTelegramHandle] = useState('')
  const [telegramChatId, setTelegramChatId] = useState('')
  const [telegramOtp, setTelegramOtp] = useState('')
  const [telegramOtpSent, setTelegramOtpSent] = useState(false)
  const [whatsappNumber, setWhatsappNumber] = useState('')
  const [socialLoading, setSocialLoading] = useState('')
  const [socialMsg, setSocialMsg] = useState('')
  // Firebase Phone Auth
  const [firebaseConfirmation, setFirebaseConfirmation] = useState<ConfirmationResult | null>(null)
  const recaptchaContainerRef = useRef<HTMLDivElement>(null)
  const recaptchaVerifierRef = useRef<RecaptchaVerifier | null>(null)

  const storedUserId = typeof window !== 'undefined' ? localStorage.getItem('mc-userId') : null

  // ── Avatar Crop Modal State ──
  const [cropImage, setCropImage] = useState<string | null>(null)
  const [cropPos, setCropPos] = useState({ x: 0, y: 0 })
  const [cropZoom, setCropZoom] = useState(1)
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const cropContainerRef = useRef<HTMLDivElement>(null)

  const CROP_SIZE = 240
  const MIN_ZOOM = 0.5
  const MAX_ZOOM = 3

  // ── Avatar Upload (hooks must be before early return) ──
  const handleAvatarClick = () => fileInputRef.current?.click()

  const handleAvatarChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        // Center the image so the crop circle is in the middle
        const scale = Math.max(CROP_SIZE / img.width, CROP_SIZE / img.height)
        const initialZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, scale))
        setCropZoom(initialZoom)
        setCropPos({
          x: (CROP_SIZE - img.width * initialZoom) / 2,
          y: (CROP_SIZE - img.height * initialZoom) / 2,
        })
        setCropImage(reader.result as string)
      }
      img.src = reader.result as string
    }
    reader.readAsDataURL(file)
    // Reset file input so same file can be re-selected
    e.target.value = ''
  }, [])

  const handleCropMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
    setDragStart({ x: e.clientX - cropPos.x, y: e.clientY - cropPos.y })
  }, [cropPos])

  const handleCropMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return
    setCropPos({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y })
  }, [isDragging, dragStart])

  const handleCropMouseUp = useCallback(() => {
    setIsDragging(false)
  }, [])

  const handleCropWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    setCropZoom(prev => {
      const delta = e.deltaY > 0 ? -0.1 : 0.1
      const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prev + delta))
      // Adjust position to zoom toward center
      const cx = CROP_SIZE / 2
      const cy = CROP_SIZE / 2
      const ratio = newZoom / prev
      setCropPos(p => ({
        x: cx - (cx - p.x) * ratio,
        y: cy - (cy - p.y) * ratio,
      }))
      return newZoom
    })
  }, [])

  // Touch support for mobile pinch/drag
  const lastTouchRef = useRef<{ x: number; y: number; dist?: number } | null>(null)

  const handleCropTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      const t = e.touches[0]
      lastTouchRef.current = { x: t.clientX - cropPos.x, y: t.clientY - cropPos.y }
      setIsDragging(true)
    } else if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      lastTouchRef.current = { x: 0, y: 0, dist: Math.hypot(dx, dy) }
    }
  }, [cropPos])

  const handleCropTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault()
    if (e.touches.length === 1 && isDragging && lastTouchRef.current) {
      const t = e.touches[0]
      setCropPos({ x: t.clientX - lastTouchRef.current.x, y: t.clientY - lastTouchRef.current.y })
    } else if (e.touches.length === 2 && lastTouchRef.current?.dist) {
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      const newDist = Math.hypot(dx, dy)
      const scale = newDist / lastTouchRef.current.dist
      setCropZoom(prev => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prev * scale)))
      lastTouchRef.current.dist = newDist
    }
  }, [isDragging])

  const handleCropTouchEnd = useCallback(() => {
    setIsDragging(false)
    lastTouchRef.current = null
  }, [])

  const handleCropCancel = useCallback(() => {
    setCropImage(null)
  }, [])

  const handleCropSave = useCallback(async () => {
    if (!cropImage) return

    const img = new Image()
    img.onload = async () => {
      const canvas = document.createElement('canvas')
      canvas.width = 200
      canvas.height = 200
      const ctx = canvas.getContext('2d')!

      // Calculate what portion of the source image is visible in the crop circle
      const srcX = -cropPos.x / cropZoom
      const srcY = -cropPos.y / cropZoom
      const srcSize = CROP_SIZE / cropZoom

      ctx.drawImage(img, srcX, srcY, srcSize, srcSize, 0, 0, 200, 200)
      const dataUrl = canvas.toDataURL('image/jpeg', 0.8)

      setCropImage(null)
      setUploading(true)
      try {
        await api('/user/avatar', { method: 'POST', body: { avatar: dataUrl } })
        refetch()
      } catch (err) {
        console.error('Avatar upload failed:', err)
      }
      setUploading(false)
    }
    img.src = cropImage
  }, [cropImage, cropPos, cropZoom, refetch])

  // ── Loading guard (AFTER all hooks) ──
  if (loading) return <LoadingSpinner />

  const p = resp?.data || ({} as NonNullable<ProfileData['data']>)
  const username = p.userId || storedUserId || ''
  const rank = p.gvRank || 'Believer'
  const rankInfo = RANK_MAP[rank] || RANK_MAP.Believer
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://missionchain.io'
  const refUrl = `${origin}?ref=${username}`
  const initials = (username || 'U').slice(0, 2).toUpperCase()
  const emailVerified = p.emailVerified ?? false
  const phoneVerified = p.phoneVerified ?? false
  const kycLevel = phoneVerified ? 2 : emailVerified ? 1 : 0
  const kycLabel = kycLevel === 2 ? 'Verified' : kycLevel === 1 ? 'Email Verified' : 'Not Verified'

  // ── KYC OTP Handlers ──
  const sendEmailOtp = async () => {
    if (!kycEmail) return
    setKycLoading('send-email')
    setKycMsg('')
    try {
      const res = await api<{ data: { devCode?: string } }>('/user/kyc/send-email-otp', {
        method: 'POST', body: { email: kycEmail },
      })
      setEmailOtpSent(true)
      if (res.data?.devCode) setKycMsg(`[DEV] OTP: ${res.data.devCode}`)
    } catch (err: any) {
      setKycMsg(err.message || 'Failed to send OTP')
    }
    setKycLoading('')
  }

  const verifyEmail = async () => {
    if (!emailOtp) return
    setKycLoading('verify-email')
    setKycMsg('')
    try {
      await api('/user/kyc/verify-email', {
        method: 'POST', body: { email: kycEmail, code: emailOtp },
      })
      setKycMsg('Email verified!')
      refetch()
    } catch (err: any) {
      setKycMsg(err.message || 'Invalid OTP')
    }
    setKycLoading('')
  }

  const sendPhoneOtp = async () => {
    if (!kycPhone) return
    setKycLoading('send-phone')
    setKycMsg('')
    try {
      // Clean up previous reCAPTCHA if exists
      if (recaptchaVerifierRef.current) {
        try { recaptchaVerifierRef.current.clear() } catch {}
        recaptchaVerifierRef.current = null
      }

      // Remove any leftover reCAPTCHA iframes/widgets
      const container = document.getElementById('recaptcha-container')
      if (container) container.innerHTML = ''

      // Initialize invisible reCAPTCHA
      const verifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
        size: 'invisible',
        callback: () => { console.log('[reCAPTCHA] solved') },
        'expired-callback': () => {
          setKycMsg('reCAPTCHA expired. Please try again.')
        },
      })

      // IMPORTANT: render the reCAPTCHA widget before calling signInWithPhoneNumber
      await verifier.render()
      recaptchaVerifierRef.current = verifier

      // Format phone number — ensure it starts with +
      const phone = kycPhone.trim().startsWith('+') ? kycPhone.trim() : `+${kycPhone.trim()}`

      const confirmation = await signInWithPhoneNumber(auth, phone, verifier)
      setFirebaseConfirmation(confirmation)
      setPhoneOtpSent(true)
      setKycMsg('SMS code sent to your phone!')
    } catch (err: any) {
      console.error('[Firebase Phone Auth] code:', err.code, 'msg:', err.message, 'full:', err)
      const msg = err.code === 'auth/invalid-phone-number'
        ? 'Invalid phone number. Use format: +84912345678'
        : err.code === 'auth/too-many-requests'
        ? 'Too many attempts. Try again later.'
        : err.code === 'auth/captcha-check-failed'
        ? `reCAPTCHA failed [${err.code}]. Ensure Phone Auth is enabled & Firebase is on Blaze plan.`
        : err.code === 'auth/network-request-failed'
        ? 'Network error. Check your connection and try again.'
        : err.code === 'auth/operation-not-allowed'
        ? 'Phone Auth is not enabled. Enable it in Firebase Console > Authentication > Sign-in method.'
        : `Error: ${err.code || ''} — ${err.message || 'Unknown error'}`
      setKycMsg(msg)
      // Clean up reCAPTCHA on error
      if (recaptchaVerifierRef.current) {
        try { recaptchaVerifierRef.current.clear() } catch {}
        recaptchaVerifierRef.current = null
      }
      const cont = document.getElementById('recaptcha-container')
      if (cont) cont.innerHTML = ''
    }
    setKycLoading('')
  }

  const verifyPhone = async () => {
    if (!phoneOtp || !firebaseConfirmation) return
    setKycLoading('verify-phone')
    setKycMsg('')
    try {
      // Verify OTP with Firebase
      const credential = await firebaseConfirmation.confirm(phoneOtp)
      const idToken = await credential.user.getIdToken()

      // Send Firebase ID token to our API for server-side verification
      await api('/user/kyc/verify-phone-firebase', {
        method: 'POST', body: { phone: kycPhone, firebaseIdToken: idToken },
      })
      setKycMsg('Phone verified!')
      refetch()
    } catch (err: any) {
      console.error('[Firebase Verify]', err)
      const msg = err.code === 'auth/invalid-verification-code'
        ? 'Invalid code. Please check and try again.'
        : err.code === 'auth/code-expired'
        ? 'Code expired. Please request a new one.'
        : err.message || 'Verification failed'
      setKycMsg(msg)
    }
    setKycLoading('')
  }

  // ── Social Connect handlers ───────────────────────────────────────
  const sendTelegramOtp = async () => {
    setSocialMsg('')
    if (!telegramHandle.trim() || !telegramChatId.trim()) {
      setSocialMsg('Enter both Telegram handle and chat ID')
      return
    }
    setSocialLoading('send-telegram')
    try {
      const res = await api<{ data: { message?: string; devCode?: string } }>('/user/connect/telegram/start', {
        method: 'POST',
        body: { handle: telegramHandle.trim(), chatId: telegramChatId.trim() },
      })
      setTelegramOtpSent(true)
      setSocialMsg(res.data.message || 'Code sent. Check your Telegram.')
    } catch (err: any) {
      setSocialMsg(err?.message || 'Failed to send code')
    }
    setSocialLoading('')
  }

  const verifyTelegramOtp = async () => {
    setSocialMsg('')
    if (telegramOtp.length !== 6) return
    setSocialLoading('verify-telegram')
    try {
      await api('/user/connect/telegram/verify', {
        method: 'POST',
        body: { code: telegramOtp.trim() },
      })
      setSocialMsg('Telegram connected successfully!')
      setTelegramHandle('')
      setTelegramChatId('')
      setTelegramOtp('')
      setTelegramOtpSent(false)
      refetch()
    } catch (err: any) {
      setSocialMsg(err?.message || 'Invalid or expired code')
    }
    setSocialLoading('')
  }

  const disconnectTelegram = async () => {
    if (!confirm('Disconnect Telegram?')) return
    setSocialLoading('disconnect-telegram')
    try {
      await api('/user/connect/telegram', { method: 'DELETE' })
      setSocialMsg('Telegram disconnected')
      refetch()
    } catch (err: any) {
      setSocialMsg(err?.message || 'Failed to disconnect')
    }
    setSocialLoading('')
  }

  const saveWhatsapp = async () => {
    setSocialMsg('')
    if (!whatsappNumber.trim()) {
      setSocialMsg('Enter your WhatsApp number')
      return
    }
    setSocialLoading('save-whatsapp')
    try {
      await api('/user/connect/whatsapp', {
        method: 'POST',
        body: { number: whatsappNumber.trim() },
      })
      setSocialMsg('WhatsApp number linked.')
      setWhatsappNumber('')
      refetch()
    } catch (err: any) {
      setSocialMsg(err?.message || 'Failed to save')
    }
    setSocialLoading('')
  }

  const disconnectWhatsapp = async () => {
    if (!confirm('Remove WhatsApp number?')) return
    setSocialLoading('disconnect-whatsapp')
    try {
      await api('/user/connect/whatsapp', { method: 'DELETE' })
      setSocialMsg('WhatsApp removed')
      refetch()
    } catch (err: any) {
      setSocialMsg(err?.message || 'Failed to remove')
    }
    setSocialLoading('')
  }

  return (
    <>
    <SubNav items={PROFILE_TABS} />
    <div className="prof-page">

      {/* ── 1. Member Hero Card ── */}
      <div className="prof-hero">
        <div className="prof-hero-bg" />
        <div className="prof-hero-shine" />
        <div className="prof-hero-content">
          {/* Avatar with upload */}
          <div className="prof-avatar-wrap" onClick={handleAvatarClick}>
            <div className="prof-avatar-ring">
              <div className="prof-avatar">
                {p.avatarUrl ? (
                  <img src={p.avatarUrl} alt="Avatar" />
                ) : (
                  initials
                )}
              </div>
              <div className="prof-avatar-overlay">
                <IconCamera />
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleAvatarChange}
              style={{ display: 'none' }}
            />
            {uploading && <div className="prof-avatar-loading">Uploading...</div>}
          </div>

          <h1 className="prof-name">{username || '-'}</h1>
          <p className="prof-handle">@{username || '-'}</p>

          <div className="prof-member-id">
            <IconWallet />
            <span>{address ? shortenAddr(address) : 'Not Connected'}</span>
            {address && (
              <button className="prof-copy-btn-inline" onClick={(e) => { e.stopPropagation(); copyText(address, setCopied, 'hero') }} title="Copy address">
                {copied === 'hero' ? <IconCheck /> : <IconCopy />}
              </button>
            )}
          </div>

          <div className="prof-hero-meta">
            <span className="prof-rank-badge" style={{ borderColor: rankInfo.color }}>
              <span className="prof-rank-icon">{rankInfo.icon}</span>
              <span style={{ color: rankInfo.color }}>{rank}</span>
            </span>
            {p.createdAt && <span className="prof-joined-tag">Joined {formatDate(p.createdAt)}</span>}
            <span className={`prof-kyc-dot ${kycLevel >= 2 ? 'verified' : kycLevel === 1 ? 'partial' : 'pending'}`}>
              {kycLevel >= 2 ? '✓ Verified' : kycLevel === 1 ? '◐ Email Only' : '○ Not Verified'}
            </span>
          </div>
        </div>
      </div>

      {/* ── 2. Quick Info Chips ── */}
      <div className="prof-chips-row">
        <div className={`prof-chip ${kycLevel >= 2 ? 'prof-chip-success' : kycLevel === 1 ? 'prof-chip-warn' : ''}`}>
          <span className="prof-chip-label">KYC</span>
          <span className="prof-chip-value">{kycLabel}</span>
        </div>
        <div className="prof-chip">
          <span className="prof-chip-label">Since</span>
          <span className="prof-chip-value">{formatDate(p.createdAt)}</span>
        </div>
        <div className="prof-chip prof-chip-highlight">
          <span className="prof-chip-label">Rank</span>
          <span className="prof-chip-value prof-chip-gold">{rank}</span>
        </div>
        <div className="prof-chip">
          <span className="prof-chip-label">Referrals</span>
          <span className="prof-chip-value">{p.referralCount || '-'}</span>
        </div>
      </div>

      {/* ── Two column layout ── */}
      <div className="prof-duo">

        {/* ── 3. Account Details Card ── */}
        <div className="prof-card">
          <div className="prof-card-header">
            <IconUser />
            <span className="prof-card-title">Account Details</span>
          </div>
          <div className="prof-detail-rows">
            <div className="prof-detail-row">
              <div className="prof-detail-icon"><IconUser /></div>
              <div className="prof-detail-label">Username</div>
              <div className="prof-detail-value">{username || '-'}</div>
            </div>
            <div className="prof-detail-row">
              <div className="prof-detail-icon"><IconMail /></div>
              <div className="prof-detail-label">Email</div>
              <div className="prof-detail-value">
                {p.email || '-'}
                {emailVerified && <span className="prof-verified-tag">✓</span>}
              </div>
            </div>
            <div className="prof-detail-row">
              <div className="prof-detail-icon"><IconPhone /></div>
              <div className="prof-detail-label">Phone</div>
              <div className="prof-detail-value">
                {p.phone || '-'}
                {phoneVerified && <span className="prof-verified-tag">✓</span>}
              </div>
            </div>
            <div className="prof-detail-row">
              <div className="prof-detail-icon"><IconLink /></div>
              <div className="prof-detail-label">Introducer</div>
              <div className="prof-detail-value">{p.referrer ? shortenAddr(p.referrer) : '-'}</div>
            </div>
            <div className="prof-detail-row">
              <div className="prof-detail-icon"><IconWallet /></div>
              <div className="prof-detail-label">Wallet</div>
              <div className="prof-detail-value prof-mono">
                {address ? shortenAddr(address) : '-'}
                {address && (
                  <button className="prof-copy-btn-inline" onClick={() => copyText(address, setCopied, 'acct')} title="Copy">
                    {copied === 'acct' ? <IconCheck /> : <IconCopy />}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── 4. Referral Card ── */}
        <div className="prof-card prof-referral-card">
          <div className="prof-referral-shine" />
          <div className="prof-card-header" style={{ position: 'relative', zIndex: 1 }}>
            <IconShare />
            <span className="prof-card-title">Referral Program</span>
          </div>
          <div className="prof-referral-body">
            <p className="prof-referral-hint">Share your link to earn USDT rewards</p>
            <div className="prof-ref-link-box">
              <span className="prof-ref-url">{refUrl}</span>
              <button className="prof-copy-btn" onClick={() => copyText(refUrl, setCopied, 'ref')}>
                {copied === 'ref' ? <IconCheck /> : <IconCopy />}
                <span>{copied === 'ref' ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
            {/* Real QR Code */}
            <div className="prof-qr-area">
              <QRCodeSVG
                value={refUrl}
                size={110}
                bgColor="#FFFFFF"
                fgColor="#1E1230"
                level="M"
                includeMargin={false}
              />
              <span className="prof-qr-label">Scan to join</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── 5. KYC Verification Card ── */}
      <div className="prof-card prof-kyc-card">
        <div className="prof-card-header">
          <IconShield />
          <span className="prof-card-title">Identity Verification</span>
          <span className={`prof-kyc-level-badge level-${kycLevel}`}>
            Level {kycLevel}/2
          </span>
        </div>

        {/* Progress bar */}
        <div className="prof-kyc-progress">
          <div className={`prof-kyc-step-dot ${kycLevel >= 0 ? 'active' : ''}`} />
          <div className={`prof-kyc-progress-line ${kycLevel >= 1 ? 'filled' : ''}`} />
          <div className={`prof-kyc-step-dot ${kycLevel >= 1 ? 'active' : ''}`} />
          <div className={`prof-kyc-progress-line ${kycLevel >= 2 ? 'filled' : ''}`} />
          <div className={`prof-kyc-step-dot ${kycLevel >= 2 ? 'active' : ''}`} />
        </div>

        <div className="prof-kyc-steps">
          {/* Step 1: Email */}
          <div className={`prof-kyc-step ${emailVerified ? 'completed' : 'active'}`}>
            <div className="prof-kyc-step-header">
              <div className="prof-kyc-step-icon">
                {emailVerified ? <IconCheck /> : <IconMail />}
              </div>
              <div className="prof-kyc-step-info">
                <span className="prof-kyc-step-title">Email Verification</span>
                <span className="prof-kyc-step-desc">
                  {emailVerified ? p.email : 'Verify your email address'}
                </span>
              </div>
              {emailVerified && <span className="prof-kyc-badge-done">Done</span>}
            </div>
            {!emailVerified && (
              <div className="prof-kyc-step-form">
                <div className="prof-kyc-input-row">
                  <input
                    type="email"
                    placeholder="your@email.com"
                    value={kycEmail}
                    onChange={(e) => setKycEmail(e.target.value)}
                    className="prof-kyc-input"
                    disabled={emailOtpSent}
                  />
                  <button
                    className="prof-kyc-btn"
                    onClick={sendEmailOtp}
                    disabled={!kycEmail || kycLoading === 'send-email' || emailOtpSent}
                  >
                    {kycLoading === 'send-email' ? '...' : emailOtpSent ? 'Sent' : 'Send OTP'}
                  </button>
                </div>
                {emailOtpSent && (
                  <div className="prof-kyc-input-row">
                    <input
                      type="text"
                      placeholder="Enter 6-digit code"
                      value={emailOtp}
                      onChange={(e) => setEmailOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      className="prof-kyc-input prof-kyc-otp-input"
                      maxLength={6}
                    />
                    <button
                      className="prof-kyc-btn prof-kyc-btn-verify"
                      onClick={verifyEmail}
                      disabled={emailOtp.length !== 6 || kycLoading === 'verify-email'}
                    >
                      {kycLoading === 'verify-email' ? '...' : 'Verify'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Step 2: Phone */}
          <div className={`prof-kyc-step ${phoneVerified ? 'completed' : emailVerified ? 'active' : 'locked'}`}>
            <div className="prof-kyc-step-header">
              <div className="prof-kyc-step-icon">
                {phoneVerified ? <IconCheck /> : !emailVerified ? <IconLock /> : <IconPhone />}
              </div>
              <div className="prof-kyc-step-info">
                <span className="prof-kyc-step-title">Phone Verification</span>
                <span className="prof-kyc-step-desc">
                  {phoneVerified ? p.phone : !emailVerified ? 'Verify email first' : 'Verify your phone number'}
                </span>
              </div>
              {phoneVerified && <span className="prof-kyc-badge-done">Done</span>}
            </div>
            {emailVerified && !phoneVerified && (
              <div className="prof-kyc-step-form">
                {/* Phone number input + Send SMS */}
                <div className="prof-kyc-input-row">
                  <input
                    type="tel"
                    placeholder="+(Country Code) xxx xxx xxx"
                    value={kycPhone}
                    onChange={(e) => setKycPhone(e.target.value)}
                    className="prof-kyc-input"
                    disabled={phoneOtpSent}
                  />
                  <button
                    className="prof-kyc-btn"
                    onClick={sendPhoneOtp}
                    disabled={!kycPhone || kycLoading === 'send-phone' || phoneOtpSent}
                  >
                    {kycLoading === 'send-phone' ? '...' : phoneOtpSent ? 'Sent' : 'Send SMS'}
                  </button>
                </div>
                <div style={{ fontSize: '0.62rem', color: 'var(--muted)', margin: '4px 0 6px', lineHeight: 1.5 }}>
                  Enter with country code (e.g. +1, +44, +82...). SMS will be sent to this number.
                </div>

                {/* reCAPTCHA container (invisible) */}
                <div id="recaptcha-container" ref={recaptchaContainerRef} />

                {/* OTP code input */}
                {phoneOtpSent && (
                  <div className="prof-kyc-input-row">
                    <input
                      type="text"
                      placeholder="Enter 6-digit code"
                      value={phoneOtp}
                      onChange={(e) => setPhoneOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      className="prof-kyc-input prof-kyc-otp-input"
                      maxLength={6}
                    />
                    <button
                      className="prof-kyc-btn prof-kyc-btn-verify"
                      onClick={verifyPhone}
                      disabled={phoneOtp.length !== 6 || kycLoading === 'verify-phone'}
                    >
                      {kycLoading === 'verify-phone' ? '...' : 'Verify'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {kycMsg && <div className="prof-kyc-msg">{kycMsg}</div>}
      </div>

      {/* ── 6. Social Connect Card (Telegram + WhatsApp) ── */}
      <div className="prof-card prof-social-card">
        <div className="prof-card-header">
          <span className="prof-social-icon">{'\u{1F517}'}</span>
          <span className="prof-card-title">Social Connect</span>
          <span className="prof-social-hint">For NIRA AI · Group invites · Notifications</span>
        </div>

        <div className="prof-social-grid">
          {/* ─── Telegram ─── */}
          <div className={`prof-social-step ${p.telegramVerified ? 'completed' : 'active'}`}>
            <div className="prof-social-step-header">
              <div className="prof-social-step-icon">{'\u{1F4AC}'}</div>
              <div className="prof-social-step-info">
                <span className="prof-social-step-title">Telegram</span>
                <span className="prof-social-step-desc">
                  {p.telegramVerified
                    ? `Connected: @${p.telegramHandle}`
                    : 'Receive secure notifications via @nira_missionchain_bot'}
                </span>
              </div>
              {p.telegramVerified && <IconCheck />}
            </div>

            {!p.telegramVerified && (
              <>
                {!telegramOtpSent ? (
                  <div className="prof-social-step-body">
                    <div className="prof-social-howto">
                      <strong>How to get your Chat ID:</strong>
                      <ol style={{ margin: '6px 0 0 18px', padding: 0, fontSize: '0.7rem', lineHeight: 1.6 }}>
                        <li>Open Telegram → search <strong>@nira_missionchain_bot</strong></li>
                        <li>Click <strong>Start</strong> (or send <code>/start</code>)</li>
                        <li>Bot will reply with your numeric Chat ID</li>
                        <li>Copy that ID and paste below</li>
                      </ol>
                    </div>
                    <div className="prof-social-input-row">
                      <input
                        type="text"
                        className="prof-social-input"
                        placeholder="@yourhandle"
                        value={telegramHandle}
                        onChange={(e) => setTelegramHandle(e.target.value)}
                      />
                    </div>
                    <div className="prof-social-input-row">
                      <input
                        type="text"
                        className="prof-social-input"
                        placeholder="Chat ID (numeric)"
                        value={telegramChatId}
                        onChange={(e) => setTelegramChatId(e.target.value.replace(/[^\d-]/g, ''))}
                      />
                      <button
                        className="prof-kyc-btn prof-kyc-btn-send"
                        onClick={sendTelegramOtp}
                        disabled={!telegramHandle || !telegramChatId || socialLoading === 'send-telegram'}
                      >
                        {socialLoading === 'send-telegram' ? '...' : 'Send Code'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="prof-social-step-body">
                    <div className="prof-social-input-row">
                      <input
                        type="text"
                        className="prof-social-input"
                        placeholder="6-digit code"
                        value={telegramOtp}
                        maxLength={6}
                        onChange={(e) => setTelegramOtp(e.target.value.replace(/\D/g, ''))}
                      />
                      <button
                        className="prof-kyc-btn prof-kyc-btn-verify"
                        onClick={verifyTelegramOtp}
                        disabled={telegramOtp.length !== 6 || socialLoading === 'verify-telegram'}
                      >
                        {socialLoading === 'verify-telegram' ? '...' : 'Verify'}
                      </button>
                    </div>
                    <button
                      className="prof-social-link"
                      onClick={() => { setTelegramOtpSent(false); setTelegramOtp('') }}
                    >
                      ← Resend / change Chat ID
                    </button>
                  </div>
                )}
              </>
            )}

            {p.telegramVerified && (
              <button
                className="prof-social-disconnect"
                onClick={disconnectTelegram}
                disabled={socialLoading === 'disconnect-telegram'}
              >
                {socialLoading === 'disconnect-telegram' ? '...' : 'Disconnect'}
              </button>
            )}
          </div>

          {/* ─── WhatsApp ─── */}
          <div className={`prof-social-step ${p.whatsappNumber ? 'completed' : 'active'}`}>
            <div className="prof-social-step-header">
              <div className="prof-social-step-icon">{'\u{1F4F1}'}</div>
              <div className="prof-social-step-info">
                <span className="prof-social-step-title">WhatsApp</span>
                <span className="prof-social-step-desc">
                  {p.whatsappNumber
                    ? `Linked: ${p.whatsappNumber}`
                    : 'Save your WhatsApp for community group invitations'}
                </span>
              </div>
              {p.whatsappNumber && (
                <span className="prof-social-badge prof-social-badge-linked">Linked</span>
              )}
            </div>

            {!p.whatsappNumber && (
              <div className="prof-social-step-body">
                <div className="prof-social-howto" style={{ fontSize: '0.7rem', color: 'var(--gray2)', marginBottom: 8 }}>
                  Use international format with country code, e.g. <code>+14155550123</code>
                </div>
                <div className="prof-social-input-row">
                  <input
                    type="tel"
                    className="prof-social-input"
                    placeholder="+14155550123"
                    value={whatsappNumber}
                    onChange={(e) => setWhatsappNumber(e.target.value)}
                  />
                  <button
                    className="prof-kyc-btn prof-kyc-btn-send"
                    onClick={saveWhatsapp}
                    disabled={!whatsappNumber || socialLoading === 'save-whatsapp'}
                  >
                    {socialLoading === 'save-whatsapp' ? '...' : 'Save'}
                  </button>
                </div>
              </div>
            )}

            {p.whatsappNumber && (
              <button
                className="prof-social-disconnect"
                onClick={disconnectWhatsapp}
                disabled={socialLoading === 'disconnect-whatsapp'}
              >
                {socialLoading === 'disconnect-whatsapp' ? '...' : 'Remove'}
              </button>
            )}
          </div>
        </div>

        {socialMsg && <div className="prof-kyc-msg">{socialMsg}</div>}
      </div>

    </div>

    {/* ── Avatar Crop Modal ── */}
    {cropImage && (
      <div className="avatar-crop-overlay" onClick={handleCropCancel}>
        <div className="avatar-crop-modal" onClick={(e) => e.stopPropagation()}>
          <div className="avatar-crop-title">Adjust Photo</div>
          <div className="avatar-crop-hint">Drag to reposition. Scroll to zoom.</div>
          <div
            ref={cropContainerRef}
            className="avatar-crop-container"
            onMouseDown={handleCropMouseDown}
            onMouseMove={handleCropMouseMove}
            onMouseUp={handleCropMouseUp}
            onMouseLeave={handleCropMouseUp}
            onWheel={handleCropWheel}
            onTouchStart={handleCropTouchStart}
            onTouchMove={handleCropTouchMove}
            onTouchEnd={handleCropTouchEnd}
            style={{ width: CROP_SIZE, height: CROP_SIZE }}
          >
            <img
              src={cropImage}
              alt="Crop preview"
              className="avatar-crop-img"
              draggable={false}
              style={{
                transform: `translate(${cropPos.x}px, ${cropPos.y}px) scale(${cropZoom})`,
                transformOrigin: '0 0',
              }}
            />
            <div className="avatar-crop-circle" />
            <svg className="avatar-crop-mask" width={CROP_SIZE} height={CROP_SIZE}>
              <defs>
                <mask id="crop-hole">
                  <rect width={CROP_SIZE} height={CROP_SIZE} fill="white" />
                  <circle cx={CROP_SIZE / 2} cy={CROP_SIZE / 2} r={CROP_SIZE / 2 - 8} fill="black" />
                </mask>
              </defs>
              <rect width={CROP_SIZE} height={CROP_SIZE} fill="rgba(0,0,0,0.6)" mask="url(#crop-hole)" />
            </svg>
          </div>
          <div className="avatar-crop-zoom-row">
            <span className="avatar-crop-zoom-label">Zoom</span>
            <input
              type="range"
              min={MIN_ZOOM * 100}
              max={MAX_ZOOM * 100}
              value={cropZoom * 100}
              onChange={(e) => {
                const newZoom = Number(e.target.value) / 100
                const ratio = newZoom / cropZoom
                const cx = CROP_SIZE / 2
                const cy = CROP_SIZE / 2
                setCropPos(p => ({
                  x: cx - (cx - p.x) * ratio,
                  y: cy - (cy - p.y) * ratio,
                }))
                setCropZoom(newZoom)
              }}
              className="avatar-crop-slider"
            />
            <span className="avatar-crop-zoom-val">{cropZoom.toFixed(1)}x</span>
          </div>
          <div className="avatar-crop-actions">
            <button className="avatar-crop-btn avatar-crop-btn-cancel" onClick={handleCropCancel}>
              Cancel
            </button>
            <button className="avatar-crop-btn avatar-crop-btn-save" onClick={handleCropSave}>
              Save
            </button>
          </div>
        </div>
      </div>
    )}

    </>
  )
}
