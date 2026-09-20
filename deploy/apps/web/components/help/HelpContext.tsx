'use client'

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { guideForPath } from '@/content/help'
import type { Guide } from '@/content/help/types'

interface HelpState {
  open: boolean
  guide: Guide | null
  openHelp: () => void
  closeHelp: () => void
}

const Ctx = createContext<HelpState>({ open: false, guide: null, openHelp: () => {}, closeHelp: () => {} })

export function HelpProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const guide = guideForPath(pathname)

  const openHelp = useCallback(() => setOpen(true), [])
  const closeHelp = useCallback(() => setOpen(false), [])

  // Close on navigation. The provider is mounted by the (dashboard) layout and survives
  // route changes, so without this `open` outlives the page it was opened on: going back
  // to a page with no guide only hides the panel, and going forward shows it again with
  // nobody having asked for it.
  useEffect(() => { setOpen(false) }, [pathname])

  return <Ctx.Provider value={{ open, guide, openHelp, closeHelp }}>{children}</Ctx.Provider>
}

export const useHelp = () => useContext(Ctx)
