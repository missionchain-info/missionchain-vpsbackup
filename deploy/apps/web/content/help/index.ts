import type { Guide } from './types'
import { swap } from './swap'

/**
 * Route path exactly as it appears in the URL, without a trailing slash.
 *
 * Naming convention for nested routes: a route like '/dao/council' lives in
 * `dao-council.ts` and exports `daoCouncil`.
 *
 * One guide per route, checked by scripts/check-help-content.mjs: aliasing two routes to
 * the same guide is disallowed on purpose, not an oversight — wanting to share a guide
 * means deciding to relax that check, not routing around it here.
 */
export const GUIDES: Record<string, Guide> = {
  '/swap': swap,
}

/**
 * The guide for a pathname, or null.
 *
 * Longest match wins so a child route uses its own guide rather than its parent's:
 * '/dao/council' resolves to the council guide, not to '/dao'.
 */
export function guideForPath(pathname: string | null): Guide | null {
  if (!pathname) return null
  const clean = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  const hit = Object.keys(GUIDES)
    .filter((route) => clean === route || clean.startsWith(route + '/'))
    .sort((a, b) => b.length - a.length)[0]
  return hit ? GUIDES[hit] : null
}
