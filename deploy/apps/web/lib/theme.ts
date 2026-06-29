'use client'

export type Theme = 'dark' | 'light'

export function getTheme(): Theme {
  if (typeof window === 'undefined') return 'dark'
  return document.body.classList.contains('light') ? 'light' : 'dark'
}

export function setTheme(theme: Theme) {
  if (theme === 'light') {
    document.body.classList.add('light')
  } else {
    document.body.classList.remove('light')
  }
  try {
    window.localStorage.setItem('mc-theme', theme)
  } catch {}
}

export function toggleTheme(): Theme {
  const current = getTheme()
  const next = current === 'dark' ? 'light' : 'dark'
  setTheme(next)
  return next
}

export function initTheme() {
  try {
    const saved = window.localStorage.getItem('mc-theme') as Theme | null
    if (saved) {
      setTheme(saved)
    }
  } catch {}
}
