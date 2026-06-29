'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/auth';

interface Message {
  id: string;
  role: 'user' | 'nira';
  text: string;
}

const SZ = '0.62rem';

const NIRA_RESPONSES = [
  "Understood. Accessing the relevant system components now. This action will be logged in the session audit trail. Please confirm the specific parameters to apply.",
  "Task received. I've analyzed the current configuration and identified the optimal approach. Shall I proceed, or would you like a preview of the changes first?",
  "Acknowledged. Drafting the content update now \u2014 maintaining Mission Chain's voice and brand guidelines. Ready for your review before publication.",
  "Processing your instruction. Cross-referencing with whitepaper parameters and governance matrix. This change is within Owner authority \u2014 no DAO vote required. Shall I execute?",
  "Analyzing ecosystem data now. I've identified three key areas requiring attention. Would you like a full report, or shall I prioritize the most critical finding first?",
];

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
const CROP_SIZE = 240;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;

export default function NiraPage() {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'init',
      role: 'nira',
      text: "Hello, Owner. I'm connected with full system authority. I can update missionchain.io public content and structure, manage Telegram announcements, social media posts, or system configurations. What would you like to do?",
    },
  ]);
  const [input, setInput] = useState('');
  const [activeTab, setActiveTab] = useState(0);
  const chatRef = useRef<HTMLDivElement>(null);

  // ── NIRA Avatar State ──
  const [niraAvatar, setNiraAvatar] = useState<string | null>(null);
  const [avatarLoading, setAvatarLoading] = useState(false);
  const [avatarToast, setAvatarToast] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Crop modal state
  const [cropImage, setCropImage] = useState<string | null>(null);
  const [cropPos, setCropPos] = useState({ x: 0, y: 0 });
  const [cropZoom, setCropZoom] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const cropContainerRef = useRef<HTMLDivElement>(null);

  const tabs = [
    '\u{1F310} missionchain.io',
    '\u{1F4F1} Telegram Content',
    '\u{1F426} Social Media',
    '\u2699\uFE0F System Updates',
  ];

  // Load NIRA avatar from SystemConfig
  useEffect(() => {
    const jwt = localStorage.getItem('mc-admin-jwt');
    if (!jwt) return;
    fetch(`${API_BASE}/admin/system-config`, {
      headers: { Authorization: `Bearer ${jwt}` },
    })
      .then(r => r.json())
      .then(data => {
        const configs = data.data || [];
        const avatarConfig = configs.find((c: any) => c.key === 'nira-avatar');
        if (avatarConfig?.value) {
          setNiraAvatar(avatarConfig.value);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [messages]);

  const sendMessage = () => {
    const text = input.trim();
    if (!text) return;
    const userMsg: Message = { id: Date.now().toString(), role: 'user', text };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setTimeout(() => {
      const resp = NIRA_RESPONSES[Math.floor(Math.random() * NIRA_RESPONSES.length)];
      const niraMsg: Message = { id: (Date.now() + 1).toString(), role: 'nira', text: resp };
      setMessages(prev => [...prev, niraMsg]);
    }, 700);
  };

  const setQuickAction = (text: string) => setInput(text);

  // ── Avatar Upload Handlers ──
  const handleAvatarClick = () => fileInputRef.current?.click();

  const handleAvatarChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.max(CROP_SIZE / img.width, CROP_SIZE / img.height);
        const initialZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, scale));
        setCropZoom(initialZoom);
        setCropPos({
          x: (CROP_SIZE - img.width * initialZoom) / 2,
          y: (CROP_SIZE - img.height * initialZoom) / 2,
        });
        setCropImage(reader.result as string);
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }, []);

  const handleCropMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    setDragStart({ x: e.clientX - cropPos.x, y: e.clientY - cropPos.y });
  }, [cropPos]);

  const handleCropMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    setCropPos({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  }, [isDragging, dragStart]);

  const handleCropMouseUp = useCallback(() => setIsDragging(false), []);

  const handleCropWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setCropZoom(prev => {
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prev + delta));
      const cx = CROP_SIZE / 2;
      const cy = CROP_SIZE / 2;
      const ratio = newZoom / prev;
      setCropPos(p => ({
        x: cx - (cx - p.x) * ratio,
        y: cy - (cy - p.y) * ratio,
      }));
      return newZoom;
    });
  }, []);

  const handleCropCancel = useCallback(() => setCropImage(null), []);

  const handleCropSave = useCallback(async () => {
    if (!cropImage) return;
    const img = new Image();
    img.onload = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 200;
      canvas.height = 200;
      const ctx = canvas.getContext('2d')!;
      const srcX = -cropPos.x / cropZoom;
      const srcY = -cropPos.y / cropZoom;
      const srcSize = CROP_SIZE / cropZoom;
      ctx.drawImage(img, srcX, srcY, srcSize, srcSize, 0, 0, 200, 200);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);

      setCropImage(null);
      setAvatarLoading(true);
      try {
        const jwt = localStorage.getItem('mc-admin-jwt');
        await fetch(`${API_BASE}/admin/system-config/nira-avatar`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${jwt}`,
          },
          body: JSON.stringify({ value: dataUrl }),
        });
        setNiraAvatar(dataUrl);
        setAvatarToast('NIRA avatar updated successfully');
        setTimeout(() => setAvatarToast(null), 3000);
      } catch (err) {
        setAvatarToast('Failed to update avatar');
        setTimeout(() => setAvatarToast(null), 3000);
      }
      setAvatarLoading(false);
    };
    img.src = cropImage;
  }, [cropImage, cropPos, cropZoom]);

  const handleRemoveAvatar = async () => {
    setAvatarLoading(true);
    try {
      const jwt = localStorage.getItem('mc-admin-jwt');
      await fetch(`${API_BASE}/admin/system-config/nira-avatar`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify({ value: '' }),
      });
      setNiraAvatar(null);
      setAvatarToast('Avatar removed');
      setTimeout(() => setAvatarToast(null), 3000);
    } catch {
      setAvatarToast('Failed to remove avatar');
      setTimeout(() => setAvatarToast(null), 3000);
    }
    setAvatarLoading(false);
  };

  return (
    <>
      {/* Toast */}
      {avatarToast && (
        <div className="alert alert-info" style={{
          position: 'fixed', top: 20, right: 20, zIndex: 9999,
          marginBottom: 0, boxShadow: '0 4px 20px rgba(0,0,0,.4)',
        }}>
          {avatarToast}
        </div>
      )}

      <div className="page-hd">
        <div>
          <div className="page-eyebrow">Settings</div>
          <div className="page-title">NIRA-AI Assistant</div>
          <div className="page-sub">Direct API access &middot; Full authority mode &middot; Owner &amp; Super-Wallet only</div>
        </div>
        <span className="badge b-gold">{'\u2B21'} OWNER ACCESS</span>
      </div>

      <div className="alert alert-danger">{'\u{1F510}'} This console grants direct access to the most capable AI model with full system authority. All actions are immutably logged on-chain and by session. Use with care.</div>

      {/* ─── NIRA-CHAT — Support System (moved from System Config) ─── */}
      <div className="card card-c" style={{ marginBottom: 16 }}>
        <div className="card-title">NIRA-CHAT &mdash; Support System (Community)</div>
        <div style={{ fontSize: '0.7rem', color: 'var(--gray)', lineHeight: 1.5, marginBottom: 12 }}>
          Public-facing NIRA chatbot for community members (Telegram / WhatsApp / Web widget).
          Distinct from the Owner NIRA console above.
        </div>
        <div className="g2">
          <div>
            <div className="input-wrap">
              <div className="input-label">Bot Name</div>
              <input type="text" defaultValue="NIRA" />
            </div>
            <div className="input-wrap">
              <div className="input-label">Response Language</div>
              <select defaultValue="auto">
                <option value="auto">Auto-detect (Multilingual)</option>
                <option value="en">English</option>
                <option value="vi">Vietnamese</option>
                <option value="es">Spanish</option>
                <option value="pt">Portuguese</option>
                <option value="ko">Korean</option>
              </select>
            </div>
          </div>
          <div>
            <div className="toggle-row">
              <div className="toggle on" />
              <div><span className="toggle-label">Auto ticket creation from chat</span></div>
            </div>
            <div className="toggle-row">
              <div className="toggle on" />
              <div><span className="toggle-label">Escalate unresolved to Admin after 24h</span></div>
            </div>
            <div className="toggle-row">
              <div className="toggle" />
              <div><span className="toggle-label">Maintenance mode (disable public chat)</span></div>
            </div>
          </div>
        </div>
        <button className="btn btn-primary btn-sm" style={{ marginTop: 10 }}>Save Settings</button>
      </div>

      <div className="g2" style={{ marginBottom: 16 }}>
        <div className="card card-p">
          <div className="card-title">AI Engine</div>
          <div className="info-row"><span className="info-key">Model</span><span className="info-val">GPT-4o / Claude Opus (configurable)</span></div>
          <div className="info-row"><span className="info-key">API Endpoint</span><span className="info-val mono">api.anthropic.com</span></div>
          <div className="info-row"><span className="info-key">Context Loaded</span><span className="info-val">Full Mission Chain ecosystem knowledge</span></div>
          <div className="info-row"><span className="info-key">Permissions</span><span className="info-val"><span className="badge b-danger">Full Authority</span></span></div>
          <div className="info-row"><span className="info-key">Session Log</span><span className="info-val"><span className="badge b-active">On-chain &middot; Active</span></span></div>
        </div>

        {/* NIRA Avatar Card */}
        <div className="card card-g">
          <div className="card-title">NIRA Avatar</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 16 }}>
            <div
              onClick={handleAvatarClick}
              style={{
                width: 80, height: 80, borderRadius: '50%',
                background: niraAvatar ? 'none' : 'var(--grad-p)',
                border: '2px solid var(--border2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', overflow: 'hidden', position: 'relative',
                flexShrink: 0, transition: 'all .2s',
              }}
            >
              {niraAvatar ? (
                <img src={niraAvatar} alt="NIRA" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <span style={{ fontFamily: 'var(--font-d)', fontSize: 28, fontWeight: 900, color: '#fff' }}>N</span>
              )}
              <div style={{
                position: 'absolute', inset: 0, background: 'rgba(0,0,0,.4)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                opacity: 0, transition: 'opacity .2s', cursor: 'pointer',
                fontSize: SZ, fontWeight: 700, color: '#fff', fontFamily: 'var(--font-d)',
                letterSpacing: '.04em',
              }}
                onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                onMouseLeave={e => (e.currentTarget.style.opacity = '0')}
              >
                CHANGE
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: SZ, fontWeight: 700, color: 'var(--white)', fontFamily: 'var(--font-d)', marginBottom: 4 }}>
                NIRA AI Profile Image
              </div>
              <div style={{ fontSize: SZ, color: 'var(--gray)', lineHeight: 1.6, marginBottom: 10 }}>
                This avatar appears in the AI chat and across all NIRA interfaces. Upload a square image for best results.
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-primary btn-sm" onClick={handleAvatarClick} disabled={avatarLoading}>
                  {avatarLoading ? 'Processing...' : 'Upload Avatar'}
                </button>
                {niraAvatar && (
                  <button className="btn btn-outline btn-sm" onClick={handleRemoveAvatar} disabled={avatarLoading}
                    style={{ color: 'var(--crimson2)', borderColor: 'rgba(107,20,40,.3)' }}>
                    Remove
                  </button>
                )}
              </div>
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleAvatarChange}
            style={{ display: 'none' }}
          />
        </div>
      </div>

      <div className="g2" style={{ marginBottom: 16 }}>
        <div className="card card-c">
          <div className="card-title">Authorized Controllers</div>
          <div className="info-row"><span className="info-key">Primary Owner</span><span className="info-val mono">{user?.wallet ? `${user.wallet.slice(0,6)}...${user.wallet.slice(-4)}` : '\u2014'}</span></div>
          <div className="info-row"><span className="info-key">Super-Wallet 1</span><span className="info-val" style={{ color: 'var(--gray2)' }}>Not designated</span></div>
          <div className="info-row"><span className="info-key">Super-Wallet 2</span><span className="info-val" style={{ color: 'var(--gray2)' }}>Not designated</span></div>
          <div className="info-row"><span className="info-key">After DENOUNCE</span><span className="info-val" style={{ fontSize: SZ, color: 'var(--gray2)' }}>Authority passes to DAO governance</span></div>
          <button className="btn btn-outline btn-sm" style={{ marginTop: 12 }}>Designate Super-Wallet</button>
        </div>
        <div />
      </div>

      <div className="tabs">
        {tabs.map((t, i) => (
          <button key={t} className={`tab ${activeTab === i ? 'active' : ''}`} onClick={() => setActiveTab(i)}>{t}</button>
        ))}
      </div>

      <div className="card card-p">
        <div className="card-title">Direct AI Interaction &mdash; Full Authority Mode</div>
        <div className="nira-chat" ref={chatRef}>
          {messages.map((msg) => (
            <div key={msg.id} className={`msg ${msg.role === 'user' ? 'user' : ''}`}>
              <div className="msg-avatar" style={
                msg.role === 'user'
                  ? { background: 'var(--grad-g)', color: 'var(--bg)', fontWeight: 900 }
                  : niraAvatar
                    ? { background: 'none', padding: 0, overflow: 'hidden' }
                    : {}
              }>
                {msg.role === 'user'
                  ? (user?.wallet?.slice(2,4).toUpperCase() || 'U')
                  : niraAvatar
                    ? <img src={niraAvatar} alt="N" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
                    : 'N'
                }
              </div>
              <div className="msg-bubble">
                {msg.role === 'nira' && <><strong style={{ color: 'var(--gold2)', fontFamily: 'var(--font-d)' }}>NIRA{msg.id === 'init' ? ' \u00B7 Online' : ''}</strong><br /></>}
                {msg.text}
              </div>
            </div>
          ))}
        </div>
        <div className="nira-input-row">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Instruct NIRA... e.g. 'Update homepage hero section to...'"
            onKeyDown={e => { if (e.key === 'Enter') sendMessage(); }}
          />
          <button className="btn btn-primary" onClick={sendMessage}>Send {'\u21B5'}</button>
        </div>
        <div className="nira-quick">
          <button className="btn btn-outline btn-sm" onClick={() => setQuickAction('Update the missionchain.io homepage announcement')}>{'\u{1F4DD}'} Website Update</button>
          <button className="btn btn-outline btn-sm" onClick={() => setQuickAction('Draft Telegram announcement for the MIC staking launch')}>{'\u{1F4E2}'} Telegram Post</button>
          <button className="btn btn-outline btn-sm" onClick={() => setQuickAction('Analyze ecosystem health and provide recommendations')}>{'\u{1F4CA}'} Ecosystem Analysis</button>
          <button className="btn btn-outline btn-sm" onClick={() => setQuickAction('Review current MICE pricing strategy and suggest improvements')}>{'\u{1F4A1}'} MICE Strategy</button>
        </div>
      </div>

      {/* ── Avatar Crop Modal ── */}
      {cropImage && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 9999,
        }} onClick={handleCropCancel}>
          <div style={{
            background: 'var(--bg3)', border: '1px solid var(--border2)',
            borderRadius: 16, padding: 24, width: 320, textAlign: 'center',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ fontFamily: 'var(--font-d)', fontSize: SZ, fontWeight: 800, color: 'var(--white)', marginBottom: 4 }}>
              Adjust Photo
            </div>
            <div style={{ fontSize: SZ, color: 'var(--gray2)', marginBottom: 14 }}>
              Drag to reposition. Scroll to zoom.
            </div>

            <div
              ref={cropContainerRef}
              style={{
                width: CROP_SIZE, height: CROP_SIZE, margin: '0 auto',
                position: 'relative', overflow: 'hidden', borderRadius: '50%',
                border: '2px solid var(--border2)', cursor: isDragging ? 'grabbing' : 'grab',
                background: 'var(--bg)',
              }}
              onMouseDown={handleCropMouseDown}
              onMouseMove={handleCropMouseMove}
              onMouseUp={handleCropMouseUp}
              onMouseLeave={handleCropMouseUp}
              onWheel={handleCropWheel}
            >
              <img
                src={cropImage}
                alt="Crop"
                draggable={false}
                style={{
                  position: 'absolute',
                  left: cropPos.x, top: cropPos.y,
                  transform: `scale(${cropZoom})`,
                  transformOrigin: '0 0',
                  maxWidth: 'none',
                  pointerEvents: 'none',
                }}
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '14px 0', justifyContent: 'center' }}>
              <span style={{ fontSize: '0.58rem', color: 'var(--gray2)', fontFamily: 'var(--font-m)' }}>Zoom</span>
              <input
                type="range"
                min={MIN_ZOOM} max={MAX_ZOOM} step={0.05}
                value={cropZoom}
                onChange={e => {
                  const newZoom = parseFloat(e.target.value);
                  const cx = CROP_SIZE / 2;
                  const cy = CROP_SIZE / 2;
                  const ratio = newZoom / cropZoom;
                  setCropPos(p => ({
                    x: cx - (cx - p.x) * ratio,
                    y: cy - (cy - p.y) * ratio,
                  }));
                  setCropZoom(newZoom);
                }}
                style={{ flex: 1, accentColor: 'var(--purple)' }}
              />
              <span style={{ fontSize: '0.58rem', color: 'var(--gray2)', fontFamily: 'var(--font-m)', minWidth: 30 }}>{cropZoom.toFixed(1)}x</span>
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button className="btn btn-outline btn-sm" onClick={handleCropCancel}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={handleCropSave}>Save Avatar</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
