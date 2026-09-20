'use client'

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
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

  return <Ctx.Provider value={{ open, guide, openHelp, closeHelp }}>{children}</Ctx.Provider>
}

export const useHelp = () => useContext(Ctx)
