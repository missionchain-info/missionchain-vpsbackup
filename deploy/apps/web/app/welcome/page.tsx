'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAccount } from 'wagmi'
import { useTheme } from '@/hooks/useTheme'
import Link from 'next/link'

function shortenAddress(addr: string) {
  return addr.slice(0, 6) + '...' + addr.slice(-4)
}

// ── Confetti Effect ──
function launchConfetti(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')!
  canvas.width = window.innerWidth
  canvas.height = window.innerHeight

  const colors = ['#C9A84C', '#E8C96A', '#7B2D8B', '#C084D4', '#6B1428', '#9B2C42', '#00BCD4', '#F0E6D3', '#4CAF50', '#FF9800']

  interface Particle {
    x: number; y: number; vx: number; vy: number
    w: number; h: number; color: string
    rotation: number; rotSpeed: number
    opacity: number; gravity: number
  }

  const particles: Particle[] = []

  // Create particles in bursts from multiple origins
  for (let burst = 0; burst < 3; burst++) {
    const originX = canvas.width * (0.25 + burst * 0.25)
    const originY = canvas.height * 0.4
    for (let i = 0; i < 60; i++) {
      const angle = (Math.random() * Math.PI * 2)
      const speed = 4 + Math.random() * 10
      particles.push({
        x: originX + (Math.random() - 0.5) * 40,
        y: originY + (Math.random() - 0.5) * 20,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 6,
        w: 6 + Math.random() * 8,
        h: 4 + Math.random() * 6,
        color: colors[Math.floor(Math.random() * colors.length)],
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 0.3,
        opacity: 1,
        gravity: 0.12 + Math.random() * 0.08,
      })
    }
  }

  let frame = 0
  const maxFrames = 200

  function animate() {
    frame++
    if (frame > maxFrames) {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      return
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height)

    for (const p of particles) {
      p.x += p.vx
      p.vy += p.gravity
      p.y += p.vy
      p.vx *= 0.99
      p.rotation += p.rotSpeed

      if (frame > maxFrames * 0.6) {
        p.opacity = Math.max(0, p.opacity - 0.02)
      }

      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.rotate(p.rotation)
      ctx.globalAlpha = p.opacity
      ctx.fillStyle = p.color
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h)
      ctx.restore()
    }

    requestAnimationFrame(animate)
  }

  animate()
}

export default function WelcomePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { address } = useAccount()
  const { toggleTheme, isDark } = useTheme()
  const userName = searchParams.get('user') || 'User'
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [copied, setCopied] = useState(false)

  // Referral link: in-browser uses current origin (dev/preview); SSR falls back to production DApp domain
  const refLink = typeof window !== 'undefined'
    ? `${window.location.origin}/?ref=${userName}`
    : `https://app.missionchain.io/?ref=${userName}`

  // Auth gate — must have JWT to see welcome (prevents direct URL access)
  useEffect(() => {
    const jwt = typeof window !== 'undefined' ? localStorage.getItem('mc-jwt') : null
    if (!jwt) {
      router.replace('/')
    }
  }, [router])

  useEffect(() => {
    if (canvasRef.current) {
      setTimeout(() => launchConfetti(canvasRef.current!), 300)
    }
  }, [])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(refLink)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback
      const input = document.createElement('input')
      input.value = refLink
      document.body.appendChild(input)
      input.select()
      document.execCommand('copy')
      document.body.removeChild(input)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className="screen screen-welcome">
      <canvas ref={canvasRef} className="confetti-canvas" />

      <button className="theme-toggle" onClick={toggleTheme}>
        {isDark ? '🌙' : '☀'}
      </button>

      <div className="welcome-card">
        <div className="success-icon">&#10003;</div>
        <h1>Welcome to MISSION CHAIN!</h1>
        <div className="welcome-name">Hello, {userName}!</div>
        <p>Your account has been created successfully. You are now part of the MISSION CHAIN ecosystem.</p>
        <div className="welcome-wallet">
          {address || '0x0000...0000'}
        </div>

        {/* Referral Link */}
        <div className="welcome-ref">
          <div className="welcome-ref-label">Your Referral Link</div>
          <div className="welcome-ref-box">
            <span className="welcome-ref-url">{refLink}</span>
            <button className="welcome-ref-copy" onClick={handleCopy}>
              {copied ? '✓ Copied' : 'Copy'}
            </button>
          </div>
          <div className="welcome-ref-hint">Share the value, grow the community together, and receive the rewards you truly deserve.</div>
        </div>

        <Link href="/dashboard" className="btn btn-primary">
          ENTER DASHBOARD
        </Link>
      </div>
    </div>
  )
}
