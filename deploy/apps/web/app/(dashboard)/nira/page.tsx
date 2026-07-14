'use client'

import { useState, useEffect } from 'react'
import SubNav, { EXPLORE_TABS } from '@/components/layout/SubNav'

interface Message {
  role: 'bot' | 'user'
  text: string
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

export default function NiraPage() {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'bot', text: "Hi! I'm NIRA, your Mission Chain AI assistant. How can I help you today?" },
  ])
  const [input, setInput] = useState('')
  const [avatar, setAvatar] = useState<string | null>(null)

  // Fetch NIRA avatar from API (set by Admin)
  useEffect(() => {
    fetch(`${API_BASE}/nira-avatar`)
      .then(res => res.json())
      .then(data => {
        if (data.data) setAvatar(data.data)
      })
      .catch(() => {})
  }, [])

  const handleSend = () => {
    if (!input.trim()) return
    const userMsg: Message = { role: 'user', text: input.trim() }
    setMessages((prev) => [...prev, userMsg])
    setInput('')

    // Simulate bot response
    setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        { role: 'bot', text: 'I appreciate your question! NIRA AI is currently in development. Soon I will be able to help with mining calculations, staking strategies, and more.' },
      ])
    }, 1000)
  }

  return (
    <>
      <SubNav items={EXPLORE_TABS} />

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ width: 60, height: 60, borderRadius: '50%', background: 'linear-gradient(135deg, #7B2D8B, #C9A84C)', overflow: 'hidden', flexShrink: 0 }}>
            <img
              src={avatar || '/images/nira-avatar.png'}
              alt="NIRA"
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
              }}
            />
          </div>
          <div>
            <h3 style={{ fontSize: '0.82rem', fontFamily: 'var(--font-d)', fontWeight: 800, color: 'var(--gold)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>NIRA AI</h3>
            <p style={{ color: 'var(--muted)', fontSize: '0.6rem', fontFamily: 'var(--font-b)', fontWeight: 400, letterSpacing: '0.02em', marginTop: 2 }}>Your Mission Chain assistant</p>
          </div>
        </div>
      </div>

      <div className="nira-chat-area">
        {messages.map((msg, i) => (
          <div key={i} className={msg.role === 'bot' ? 'nira-msg-bot' : 'nira-msg-user'}>
            {msg.role === 'bot' && avatar && (
              <img
                src={avatar}
                alt="NIRA"
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  objectFit: 'cover',
                  flexShrink: 0,
                  border: '1.5px solid var(--purple)',
                }}
              />
            )}
            <div className="nira-bubble">
              <p style={{ fontSize: msg.role === 'bot' ? '0.72rem' : '0.76rem' }}>{msg.text}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="nira-input-row">
        <input
          type="text"
          placeholder="Ask NIRA anything..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
        />
        <button className="btn btn-primary" style={{ fontSize: '0.72rem', padding: '8px 18px' }} onClick={handleSend}>Send</button>
      </div>
      <p style={{ color: 'var(--gray2)', fontSize: '0.64rem', textAlign: 'center', marginTop: 14 }}>Powered by Mission AI Labs</p>
    </>
  )
}
