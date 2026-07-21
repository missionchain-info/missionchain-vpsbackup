'use client'
import { useEffect, useState } from 'react'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

type FeedItem = {
  id: string; type: string; pillar: string; title: string; body: string
  media?: string[] | null; lang: string; sourceUrl?: string | null
  sourceAttribution?: string | null; verseRef?: string | null; verseText?: string | null
  publishedAt?: string | null; createdAt: string
}

const PILLARS = [
  { key: 'all', label: 'All' }, { key: 'ai', label: 'AI' }, { key: 'tech', label: 'Technology' },
  { key: 'finance', label: 'Finance' }, { key: 'faith', label: 'Faith' }, { key: 'announcement', label: 'Announcements' },
]

export default function FeedsPage() {
  const [items, setItems] = useState<FeedItem[]>([])
  const [pillar, setPillar] = useState('all')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`${API_BASE}/feeds?pillar=${pillar}&limit=30`)
      .then(r => r.json()).then(d => setItems(d.items || []))
      .catch(() => setItems([])).finally(() => setLoading(false))
  }, [pillar])

  return (
    <div style={{minHeight:'100vh', background:'var(--bg)', color:'var(--white)', padding:'0 16px 24px', overflowY:'auto'}}>
      <div style={{maxWidth:760, margin:'0 auto', display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 0', borderBottom:'1px solid var(--border)'}}>
        <a href="/" style={{display:'flex', alignItems:'center', gap:8, color:'var(--gold)', textDecoration:'none', fontFamily:'var(--font-d)', fontWeight:700, letterSpacing:1.5, fontSize:16}}>✝ MISSION CHAIN</a>
        <a href="/dashboard" style={{fontSize:13, color:'var(--white)', textDecoration:'none', border:'1px solid var(--gold)', borderRadius:999, padding:'7px 18px'}}>Open App →</a>
      </div>
      <div style={{maxWidth:760, margin:'0 auto', paddingTop:24}}>
        <header style={{textAlign:'center', marginBottom:20}}>
          <h1 style={{fontFamily:'var(--font-d)', color:'var(--gold)', fontSize:32, letterSpacing:1}}>Mission Chain Feeds</h1>
          <p style={{color:'var(--muted)', fontSize:14}}>AI · Technology · Finance · Faith — transparent, regular</p>
        </header>
        <nav style={{display:'flex', gap:8, flexWrap:'wrap', justifyContent:'center', marginBottom:20}}>
          {PILLARS.map(p => (
            <button key={p.key} onClick={()=>setPillar(p.key)} style={{padding:'6px 14px', borderRadius:999, cursor:'pointer', fontSize:13, border:'1px solid var(--border)', background: pillar===p.key ? 'var(--gold)' : 'transparent', color: pillar===p.key ? '#241426' : 'var(--white)'}}>{p.label}</button>
          ))}
        </nav>
        {loading ? <p style={{textAlign:'center', color:'var(--muted)'}}>Loading…</p> :
         items.length === 0 ? <p style={{textAlign:'center', color:'var(--muted)'}}>No content yet.</p> :
         <div style={{display:'flex', flexDirection:'column', gap:16}}>
           {items.map(it => (
             <article key={it.id} style={{background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:16, padding:20}}>
               <span style={{fontFamily:'var(--font-m)', fontSize:11, letterSpacing:1, textTransform:'uppercase', color:'var(--gold)'}}>{it.pillar}</span>
               <h2 style={{fontFamily:'var(--font-d)', fontSize:20, margin:'6px 0'}}>{it.title}</h2>
               {Array.isArray(it.media) && it.media[0] ? <img src={it.media[0]} alt="" style={{width:'100%', borderRadius:10, margin:'8px 0'}} /> : null}
               <p style={{color:'var(--gray)', lineHeight:1.6, whiteSpace:'pre-wrap'}}>{it.body}</p>
               {it.verseText ? <blockquote style={{borderLeft:'3px solid var(--gold)', paddingLeft:12, margin:'10px 0', fontStyle:'italic', color:'var(--muted)'}}>&ldquo;{it.verseText}&rdquo; <span style={{color:'var(--gold)'}}>— {it.verseRef}</span></blockquote> : null}
               {it.sourceAttribution ? <p style={{fontSize:12, color:'var(--muted)', marginTop:8}}>Source: {it.sourceUrl ? <a href={it.sourceUrl} target="_blank" rel="noopener noreferrer" style={{color:'var(--gold)'}}>{it.sourceAttribution}</a> : it.sourceAttribution}</p> : null}
             </article>
           ))}
         </div>}
        <p style={{textAlign:'center', color:'var(--muted)', fontSize:11, marginTop:24}}>Not financial advice.</p>
      </div>
    </div>
  )
}
