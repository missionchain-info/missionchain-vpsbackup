'use client'

import { useHelp } from './HelpContext'

/** The ? in the Topbar. Renders nothing on a route with no guide — an inert button that
 *  opens an empty panel teaches people the feature is useless. */
export default function HelpButton() {
  const { guide, openHelp } = useHelp()
  if (!guide) return null
  return (
    <button className="topbar-btn" onClick={openHelp} aria-label="Help" title="Help">
      ?
    </button>
  )
}
