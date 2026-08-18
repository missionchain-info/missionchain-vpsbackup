'use client'

export type Theme = 'dark' | 'light' | 'royal'

// Cycle order: dark → light → royal → dark
const ORDER: Theme[] = ['dark', 'light', 'royal']

export function getTheme(): Theme {
  if (typeof window === 'undefined') return 'dark'
  if (document.body.classList.contains('light')) return 'light'
  if (document.body.classList.contains('royal')) return 'royal'
  return 'dark'
}

export function setTheme(theme: Theme) {
  document.body.classList.remove('light', 'royal')
  if (theme === 'light') document.body.classList.add('light')
  else if (theme === 'royal') document.body.classList.add('royal')
  // dark = no class (base :root)
  try {
    window.localStorage.setItem('mc-theme-v2', theme)
  } catch {}
}

// Advances to the next theme in the cycle and returns it.
export function toggleTheme(): Theme {
  const current = getTheme()
  const idx = ORDER.indexOf(current)
  const next = ORDER[(idx + 1) % ORDER.length]
  setTheme(next)
  return next
}

export function initTheme() {
  try {
    const saved = window.localStorage.getItem('mc-theme-v2') as Theme | null
    // Mac dinh la 'light' (Owner chot 18/08/2026). <body> da mang class 'light'
    // san tu server nen khong bi chop mau khi tai trang.
    setTheme(saved && ORDER.includes(saved) ? saved : 'light')
  } catch {}
}
