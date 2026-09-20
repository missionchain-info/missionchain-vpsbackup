'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { useHelp } from './HelpContext'

export default function HelpPanel() {
  const { open, guide, closeHelp } = useHelp()
  const panelRef = useRef<HTMLDivElement>(null)
  const restoreTo = useRef<HTMLElement | null>(null)

  // Remember what had focus, move focus into the panel, put it back on close. Without
  // this a keyboard user is dropped at the top of the document every time they close it.
  useEffect(() => {
    if (!open) return
    restoreTo.current = document.activeElement as HTMLElement | null
    panelRef.current?.focus()
    return () => restoreTo.current?.focus?.()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { closeHelp(); return }
      if (e.key !== 'Tab' || !panelRef.current) return
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === first || active === panelRef.current)) {
        e.preventDefault(); last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault(); first.focus()
      } else if (!panelRef.current.contains(active)) {
        // Focus got out by some route we did not anticipate — pull it back rather than
        // letting the user tab through a page that aria-modal has declared inert.
        e.preventDefault(); first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, closeHelp])

  if (!open || !guide) return null

  return (
    <>
      <div className="help-backdrop" onClick={closeHelp} aria-hidden="true" />
      <div
        className="help-panel"
        role="dialog"
        aria-modal="true"
        aria-label={`${guide.title} help`}
        tabIndex={-1}
        ref={panelRef}
      >
        <div className="help-head">
          <div>
            <div className="help-eyebrow">Guide</div>
            <h2 className="help-title">{guide.title}</h2>
          </div>
          <button className="help-close" onClick={closeHelp} aria-label="Close help">x</button>
        </div>

        <div className="help-body">
          <p className="help-intro">{guide.intro}</p>

          <div className="help-section-label">How it works</div>
          <ol className="help-steps">
            {guide.howItWorks.map((step, i) => (
              <li key={i}><span className="help-step-n">{i + 1}</span><span>{step}</span></li>
            ))}
          </ol>

          {guide.tips && guide.tips.length > 0 && (
            <>
              <div className="help-section-label">Tips</div>
              <ul className="help-tips">
                {guide.tips.map((tip, i) => <li key={i}>{tip}</li>)}
              </ul>
            </>
          )}
        </div>

        <div className="help-foot">
          <Link href="/nira" onClick={closeHelp}>Still stuck? Ask NIRA</Link>
        </div>
      </div>
    </>
  )
}
