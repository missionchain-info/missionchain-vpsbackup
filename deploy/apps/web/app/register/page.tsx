'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAccount, useBalance, useSignMessage, useReadContract } from 'wagmi'
import { useTheme } from '@/hooks/useTheme'
import { api, authApi } from '@/lib/api'
import { CONTRACTS, ERC20_ABI } from '@/lib/contracts'
import { fmtBalance } from '@missionchain/sdk'
import Modal from '@/components/ui/Modal'

function shortenAddress(addr: string) {
  return addr.slice(0, 6) + '...' + addr.slice(-4)
}

// Validation: 5-20 chars, letters and numbers only (no special chars)
const ACCOUNT_REGEX = /^[A-Za-z0-9_]+$/
const MIN_LEN = 5
const MAX_LEN = 12

// NO default introducer. If user lands on /register without ?ref=, the field stays empty
// and they MUST manually enter the introducer's account. Silent fallback to admin caused
// every wallet without a referral link to be re-parented to admin (Apr 28, 2026 incident).

type FieldStatus = 'idle' | 'checking' | 'valid' | 'invalid' | 'error'

export default function RegisterPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { address, isConnected } = useAccount()
  const { data: bnbBalance } = useBalance({ address })
  const { signMessageAsync } = useSignMessage()
  const { toggleTheme, isDark } = useTheme()

  // ── USDT + MIC balances ──
  const { data: usdtBalance } = useReadContract({
    address: CONTRACTS.usdt,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  })
  const { data: micBalance } = useReadContract({
    address: CONTRACTS.mic,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  })

  // ── Form State ──
  const [memberAccount, setMemberAccount] = useState('')
  const [accountStatus, setAccountStatus] = useState<FieldStatus>('idle')
  const [accountMsg, setAccountMsg] = useState('')

  const [introducer, setIntroducer] = useState('')
  const [introducerStatus, setIntroducerStatus] = useState<FieldStatus>('idle')
  const [introducerMsg, setIntroducerMsg] = useState('')
  const [introducerLocked, setIntroducerLocked] = useState(false)

  const [agreed, setAgreed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [registerError, setRegisterError] = useState('')

  const [showDisclaimer, setShowDisclaimer] = useState(false)
  const [showPrivacy, setShowPrivacy] = useState(false)

  // Debounce timers
  const accountTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const introducerTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Auto-fill introducer ONLY from ?ref= (no silent admin fallback) ──
  useEffect(() => {
    const ref = searchParams.get('ref')
    if (ref) {
      setIntroducer(ref)
      setIntroducerLocked(true)
    }
    // else: leave empty → user must enter introducer manually before submit can enable
  }, [searchParams])

  // ── If wallet already registered → auto-sign nonce → get JWT → /dashboard ──
  // If not registered → stay on this page (do NOT redirect to landing — wagmi hydration
  // can briefly flip isConnected to false right after navigation, which used to bounce
  // legitimate users back to '/' before they ever saw the register form).
  useEffect(() => {
    if (!isConnected || !address) return

    let cancelled = false
    ;(async () => {
      try {
        const { nonce } = await authApi.getNonce(address)
        if (cancelled) return
        const message = `Mission Chain Authentication\nNonce: ${nonce}`
        const signature = await signMessageAsync({ message })
        const verifyRes = await authApi.verify({ wallet: address, signature })
        if (cancelled) return
        localStorage.setItem('mc-jwt', verifyRes.jwt)
        localStorage.setItem('mc-userId', verifyRes.user.userId)
        localStorage.setItem('mc-wallet', verifyRes.user.wallet)
        router.push('/dashboard')
      } catch {
        // getNonce failed = not registered; or user rejected signature — stay on register page
      }
    })()

    return () => { cancelled = true }
  }, [isConnected, address, router, signMessageAsync])

  // ── Real-time Member Account check ──
  const checkMemberAccount = useCallback(async (value: string) => {
    const clean = value.trim()
    if (clean.length < MIN_LEN) {
      setAccountStatus('invalid')
      setAccountMsg(`At least ${MIN_LEN} characters required`)
      return
    }
    if (clean.length > MAX_LEN) {
      setAccountStatus('invalid')
      setAccountMsg(`Maximum ${MAX_LEN} characters`)
      return
    }
    if (!ACCOUNT_REGEX.test(clean)) {
      setAccountStatus('invalid')
      setAccountMsg('Letters, numbers and underscore only')
      return
    }

    setAccountStatus('checking')
    setAccountMsg('Checking availability...')
    try {
      const res = await api<{ available: boolean }>(`/auth/check-userid?userId=${encodeURIComponent(clean)}`)
      if (res.available) {
        setAccountStatus('valid')
        setAccountMsg('Available')
      } else {
        setAccountStatus('invalid')
        setAccountMsg('Already taken — choose another')
      }
    } catch {
      setAccountStatus('error')
      setAccountMsg('Could not verify — try again')
    }
  }, [])

  useEffect(() => {
    if (!memberAccount) {
      setAccountStatus('idle')
      setAccountMsg('')
      return
    }
    if (accountTimer.current) clearTimeout(accountTimer.current)
    accountTimer.current = setTimeout(() => checkMemberAccount(memberAccount), 400)
    return () => { if (accountTimer.current) clearTimeout(accountTimer.current) }
  }, [memberAccount, checkMemberAccount])

  // ── Real-time Introducer check ──
  const checkIntroducer = useCallback(async (value: string) => {
    const clean = value.trim()
    if (clean.length < MIN_LEN) {
      setIntroducerStatus('invalid')
      setIntroducerMsg(`At least ${MIN_LEN} characters required`)
      return
    }
    if (!ACCOUNT_REGEX.test(clean)) {
      setIntroducerStatus('invalid')
      setIntroducerMsg('Letters, numbers and underscore only')
      return
    }

    setIntroducerStatus('checking')
    setIntroducerMsg('Verifying introducer...')
    try {
      const res = await api<{ valid: boolean; name?: string }>(`/auth/check-referrer?ref=${encodeURIComponent(clean)}`)
      if (res.valid) {
        setIntroducerStatus('valid')
        setIntroducerMsg(res.name ? `Verified: ${res.name}` : 'Verified')
      } else {
        setIntroducerStatus('invalid')
        setIntroducerMsg('Introducer not found — check the account name')
      }
    } catch {
      setIntroducerStatus('error')
      setIntroducerMsg('Could not verify — try again')
    }
  }, [])

  useEffect(() => {
    if (!introducer) {
      setIntroducerStatus('idle')
      setIntroducerMsg('')
      return
    }
    if (introducerTimer.current) clearTimeout(introducerTimer.current)
    introducerTimer.current = setTimeout(() => checkIntroducer(introducer), 400)
    return () => { if (introducerTimer.current) clearTimeout(introducerTimer.current) }
  }, [introducer, checkIntroducer])

  // ── Validation ── (Introducer is REQUIRED — must be entered manually if no ?ref=)
  const isValid =
    accountStatus === 'valid' &&
    introducerStatus === 'valid' &&
    agreed

  // ── Submit ──
  // 1. POST /auth/register → { success, nonce }
  // 2. Sign the nonce message
  // 3. POST /auth/verify → { jwt, user } → save JWT
  // 4. Redirect to /welcome
  const handleRegister = async () => {
    if (!isValid || !address) return
    setLoading(true)
    setRegisterError('')
    try {
      const userId = memberAccount.trim()
      const regRes = await authApi.register({
        wallet: address,
        userId,
        referrer: introducer ? introducer.trim() : undefined,
        termsAccepted: agreed,
      })

      const message = `Mission Chain Authentication\nNonce: ${regRes.nonce}`
      const signature = await signMessageAsync({ message })
      const verifyRes = await authApi.verify({ wallet: address, signature })

      localStorage.setItem('mc-jwt', verifyRes.jwt)
      localStorage.setItem('mc-userId', verifyRes.user.userId)
      localStorage.setItem('mc-wallet', verifyRes.user.wallet)
      router.push(`/welcome?user=${encodeURIComponent(userId)}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('user rejected') || msg.includes('ACTION_REJECTED')) {
        setRegisterError('Signature cancelled — please sign to complete registration')
      } else {
        setRegisterError(msg || 'Registration failed — please try again')
      }
    } finally {
      setLoading(false)
    }
  }

  // ── Status indicator ──
  const statusIcon = (status: FieldStatus) => {
    switch (status) {
      case 'checking': return <span className="field-status checking">⟳</span>
      case 'valid': return <span className="field-status valid">✓</span>
      case 'invalid': return <span className="field-status invalid">✗</span>
      case 'error': return <span className="field-status error">!</span>
      default: return null
    }
  }

  return (
    <div className="screen screen-register">
      <button className="theme-toggle" onClick={toggleTheme}>
        {isDark ? '🌙' : '☀'}
      </button>

      <div className="register-container">
        {/* Wallet Info Card */}
        <div className="wallet-info-card">
          <div className="wallet-info-header">
            <div className="wallet-icon">🦊</div>
            <div>
              <div className="wallet-label">Connected Wallet</div>
              <div className="wallet-address">{address ? shortenAddress(address) : '--'}</div>
            </div>
          </div>
          <div className="wallet-balances">
            <div className="wallet-bal-item">
              <div className="bal-token">BNB</div>
              <div className="bal-value">{fmtBalance(bnbBalance?.value, 18, 4)}</div>
            </div>
            <div className="wallet-bal-item">
              <div className="bal-token">USDT</div>
              <div className="bal-value">{fmtBalance(usdtBalance as bigint | undefined, 6, 2)}</div>
            </div>
            <div className="wallet-bal-item">
              <div className="bal-token">MIC</div>
              <div className="bal-value">{fmtBalance(micBalance as bigint | undefined, 18, 4)}</div>
            </div>
          </div>
        </div>

        {/* Register Form */}
        <div className="register-box">
          <h2 className="register-title">
            <span>Create Your Account</span>
          </h2>
          <p className="register-subtitle">Join the Mission Chain ecosystem</p>

          {registerError && (
            <div className="form-error-banner">{registerError}</div>
          )}

          {/* Member Account */}
          <div className="form-group">
            <label>Member Account</label>
            <div className="input-with-status">
              <input
                type="text"
                placeholder="Choose your member account (min 5 characters)"
                value={memberAccount}
                onChange={(e) => setMemberAccount(e.target.value.replace(/[^A-Za-z0-9_]/g, ''))}
                maxLength={MAX_LEN}
                autoComplete="off"
              />
              {statusIcon(accountStatus)}
            </div>
            <div className={`form-hint ${accountStatus === 'valid' ? 'hint-valid' : accountStatus === 'invalid' ? 'hint-invalid' : ''}`}>
              {accountMsg || 'Letters, numbers and underscore only, 5-12 characters. This is your unique ID in Mission Chain.'}
            </div>
          </div>

          {/* Introducer / Referral */}
          <div className="form-group">
            <label>Introducer/Referral Code</label>
            <div className="input-with-status">
              <input
                type="text"
                placeholder="Enter your introducer's member account"
                value={introducer}
                onChange={(e) => {
                  if (introducerLocked) return
                  setIntroducer(e.target.value.replace(/[^A-Za-z0-9_]/g, ''))
                }}
                maxLength={MAX_LEN}
                autoComplete="off"
                readOnly={introducerLocked}
                className={introducerLocked ? 'input-locked' : ''}
              />
              {statusIcon(introducerStatus)}
            </div>
            <div className={`form-hint ${introducerStatus === 'valid' ? 'hint-valid' : introducerStatus === 'invalid' ? 'hint-invalid' : ''}`}>
              {introducerMsg || 'Required — enter the member account of the person who referred you.'}
            </div>
            {introducerLocked && (
              <div className="form-hint hint-info">Auto-filled from referral link</div>
            )}
          </div>

          {/* Terms & Conditions */}
          <div className="form-checkbox">
            <input
              type="checkbox"
              id="reg-agree"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
            />
            <label htmlFor="reg-agree">
              I have read and agree to the{' '}
              <a onClick={() => setShowDisclaimer(true)} className="link-accent">Disclaimers and Terms of Use</a>
              {' '}and{' '}
              <a onClick={() => setShowPrivacy(true)} className="link-accent">Privacy Policy</a>
            </label>
          </div>

          <button
            className="btn btn-primary"
            disabled={!isValid || loading}
            onClick={handleRegister}
            style={{ width: '100%', marginTop: 8 }}
          >
            {loading ? 'Processing...' : 'REGISTER'}
          </button>
        </div>
      </div>

      {/* ── Disclaimer & Terms Modal ── */}
      <Modal open={showDisclaimer} onClose={() => setShowDisclaimer(false)} title="Disclaimers & Terms of Use">
        <div className="modal-legal">
          <h4>1. Token Classification</h4>
          <p>
            MIC is a utility token issued on Binance Smart Chain (BSC). It is NOT a security,
            investment contract, share, bond, or any form of financial instrument. Holding MIC
            does not confer ownership, equity, or any claim to profits or revenues of Mission Chain
            or any affiliated entity.
          </p>

          <h4>2. Risk Acknowledgment</h4>
          <p>
            Participation in cryptocurrency and blockchain-based ecosystems involves significant risk.
            Token values may fluctuate substantially. You acknowledge that you may lose some or all
            of your contribution. You should only participate with funds you can afford to lose.
          </p>

          <h4>3. No Guarantees</h4>
          <p>
            Mission Chain makes no promises, representations, or warranties regarding token price,
            returns, future value, or project outcomes. Past performance does not indicate future
            results. All forward-looking statements are subject to change without notice.
          </p>

          <h4>4. Regulatory Compliance</h4>
          <p>
            Users are solely responsible for compliance with applicable laws, regulations, and tax
            obligations in their jurisdiction regarding cryptocurrency ownership, transactions, and
            reporting. Mission Chain does not provide legal, tax, or financial advice.
          </p>

          <h4>5. KYC / AML</h4>
          <p>
            Certain features may require Know Your Customer (KYC) verification processed by
            third-party provider Sumsub. By participating, you consent to identity verification
            procedures as required by applicable anti-money laundering regulations.
          </p>

          <h4>6. Smart Contract Risk</h4>
          <p>
            All smart contracts are subject to potential vulnerabilities despite security audits.
            Mission Chain is not liable for losses resulting from smart contract bugs, exploits,
            or blockchain network failures.
          </p>

          <h4>7. Vesting & Lock-up</h4>
          <p>
            Tokens purchased through SEED Round and Pre-Sale are subject to vesting schedules
            as described in the White Paper. Locked tokens cannot be transferred until the
            applicable unlock schedule releases them automatically.
          </p>

          <h4>8. Modification</h4>
          <p>
            Mission Chain reserves the right to modify these terms. Continued use of the
            platform after changes constitutes acceptance. Material changes will be communicated
            through official channels.
          </p>
        </div>
      </Modal>

      {/* ── Privacy Policy Modal ── */}
      <Modal open={showPrivacy} onClose={() => setShowPrivacy(false)} title="Privacy Policy">
        <div className="modal-legal">
          <h4>1. Data Collection</h4>
          <p>
            We collect wallet addresses and member account names for platform operation.
            No personal identifying information is required beyond what you voluntarily provide.
            We do not collect email addresses, phone numbers, or physical addresses unless
            required for KYC verification.
          </p>

          <h4>2. On-Chain Data</h4>
          <p>
            All transactions are recorded on the Binance Smart Chain blockchain and are
            publicly visible and immutable. We cannot modify or delete on-chain data.
            Your wallet address and transaction history are permanently recorded on the blockchain.
          </p>

          <h4>3. Off-Chain Data</h4>
          <p>
            Profile information, referral relationships, and account settings stored in our
            database are protected using industry-standard encryption. This data is not shared
            with third parties without your explicit consent, except as required by law.
          </p>

          <h4>4. KYC Data</h4>
          <p>
            Identity verification is handled exclusively by Sumsub, a certified third-party
            KYC provider. Your identity documents and verification data are processed and
            stored according to Sumsub&apos;s privacy policy. Mission Chain does not store
            copies of your identity documents.
          </p>

          <h4>5. Cookies & Analytics</h4>
          <p>
            We use minimal cookies necessary for platform functionality (session management,
            theme preferences). We do not use third-party tracking cookies or advertising pixels.
          </p>

          <h4>6. Data Retention</h4>
          <p>
            Off-chain data is retained for the duration of your account activity plus any
            period required by applicable regulations. You may request data export or deletion
            of off-chain data by contacting our support team.
          </p>

          <h4>7. Contact</h4>
          <p>
            For privacy-related inquiries, contact us through the official Mission Chain
            community channels or via Telegram: @MissionChainOwner.
          </p>
        </div>
      </Modal>
    </div>
  )
}
