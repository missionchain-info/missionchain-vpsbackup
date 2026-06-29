'use client'

import { useState, useCallback, useEffect } from 'react'
import { getTheme, toggleTheme as toggle, type Theme } from '@/lib/theme'

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>('dark')

  useEffect(() => {
    setThemeState(getTheme())
  }, [])

  const toggleTheme = useCallback(() => {
    const next = toggle()
    setThemeState(next)
    return next
  }, [])

  return { theme, toggleTheme, isDark: theme === 'dark' }
}

export default useTheme
