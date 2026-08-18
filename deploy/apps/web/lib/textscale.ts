'use client'

/** Co chu toan app. CSS cua app dung `rem` (970 cho) nen chi can doi co chu goc
 *  la moi thu theo. 'sm' = dung nhu cu, khong doi gi. */
export type TextSize = 'sm' | 'md' | 'lg'

export const TEXT_SIZES: { id: TextSize; label: string; hint: string }[] = [
  { id: 'sm', label: 'Small',  hint: 'Default' },
  { id: 'md', label: 'Medium', hint: '+12%' },
  { id: 'lg', label: 'Large',  hint: '+25%' },
]

const KEY = 'mc-textsize'
const ROOT: Record<TextSize, string> = { sm: '100%', md: '112.5%', lg: '125%' }

export function getTextSize(): TextSize {
  if (typeof window === 'undefined') return 'sm'
  try {
    const v = window.localStorage.getItem(KEY) as TextSize | null
    return v && v in ROOT ? v : 'sm'
  } catch { return 'sm' }
}

export function setTextSize(size: TextSize) {
  if (typeof document === 'undefined') return
  document.documentElement.style.fontSize = ROOT[size]
  document.documentElement.setAttribute('data-textsize', size)
  try { window.localStorage.setItem(KEY, size) } catch {}
}

export function initTextSize() {
  setTextSize(getTextSize())
}
