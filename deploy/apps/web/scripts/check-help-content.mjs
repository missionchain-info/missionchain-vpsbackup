#!/usr/bin/env node
/**
 * Guard for content/help/.
 *
 * Product UI is English by default and the Owner restated it for this feature: 100%
 * English. A note in a document does not stop a translated sentence being merged; this
 * does. It also catches the ways a guide goes wrong quietly: a route wired to the wrong
 * guide, a route in the map that no longer has a page, and a figure quoted with no
 * record of where it was read. Field shape is left to `tsc` and the Guide interface.
 *
 * Zero dependencies on purpose: apps/web has no test runner, and adding one to enforce
 * one rule would be a bigger change than the feature.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const helpDir = join(webRoot, 'content', 'help')
const appDir = join(webRoot, 'app')

// Anything outside printable ASCII is flagged. An allowlist covers the typography we
// actually want — the previous range-based check had it backwards: it blocked "×5" and
// "café" while letting Korean, Chinese and emoji through, and a guard that rejects valid
// text is a guard someone eventually deletes.
//
// The allowlist deliberately contains no accented letters. Vietnamese and French share
// their accent set, so permitting `é` for "café" would also permit it in Vietnamese
// sentences — which is the leak this exists to close. English does not need accents:
// write "cafe". If you are here because a legitimate word was rejected, drop the accent
// rather than widening this list.
const ALLOWED_NON_ASCII = new Set(['×', '—', '–', '’', '‘', '“', '”', '…', '°', '€', '£'])

// A code point counts as "plain ASCII" if it is tab, LF, CR, or printable (0x20-0x7E).
// Anything else is a candidate offender, subject to the allowlist above.
function isPlainAscii(codePoint) {
  return codePoint === 9 || codePoint === 10 || codePoint === 13 || (codePoint >= 0x20 && codePoint <= 0x7e)
}

// Invisible or non-rendering code points — control characters, format characters like a
// zero-width space, space separators like a non-breaking space, line/paragraph
// separators — print only their U+ code point. Printing the character itself would
// print nothing, or a space indistinguishable from a real one; the characters hardest to
// spot by eye should give the clearest message. `JSON.stringify` does not escape these,
// which is what made them invisible in the old report.
const INVISIBLE_OR_CONTROL = /[\p{Cc}\p{Cf}\p{Zs}\p{Zl}\p{Zp}]/u
function describeChar(ch) {
  const hex = ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')
  return INVISIBLE_OR_CONTROL.test(ch) ? `U+${hex}` : `U+${hex} ${JSON.stringify(ch)}`
}

// The naming convention stated in the comment above GUIDES in index.ts: route
// '/dao/council' -> file 'dao-council.ts' -> identifier 'daoCouncil'. This derives the
// expected file base name from a route; it does not camelCase it, because the identifier
// itself is read from index.ts's own import line, not re-derived from the route string.
function routeToBase(route) {
  return route.replace(/^\//, '').replace(/\//g, '-')
}

// A route entry in GUIDES — key and the identifier assigned to it — either quote style,
// so a Prettier reformat (single -> double quotes) or an underscore in a route segment
// does not silently match zero entries.
const ROUTE_ENTRY = /^\s*['"](\/[\w/-]*)['"]\s*:\s*(\w+)\s*,?/gm

// A named import from a relative guide file, e.g. `import { swap } from './swap'`.
// Excludes `import type { Guide } from './types'` — the `type` keyword breaks the `\s*`
// gap right after `import`, which is deliberate: a type-only import isn't a guide value.
const IMPORT_LINE = /import\s*\{\s*(\w+)\s*\}\s*from\s*['"]\.\/([\w-]+)['"]/g

const failures = []

const files = readdirSync(helpDir).filter((f) => f.endsWith('.ts') && f !== 'types.ts' && f !== 'index.ts')
if (files.length === 0) failures.push('content/help/ has no guide files')

const fileTexts = new Map()
for (const file of files) fileTexts.set(file, readFileSync(join(helpDir, file), 'utf8'))

// Check 1: every character outside ASCII (minus the small typography allowlist) is a
// translated sentence, a stray symbol, or worse — report up to 5 per file with lines.
// Walked by Unicode code point (`for...of` over a string), not UTF-16 code unit, so an
// astral emoji reports once instead of as two meaningless surrogate halves.
for (const file of files) {
  const text = fileTexts.get(file)
  const offenders = []
  let line = 1
  for (const ch of text) {
    if (!isPlainAscii(ch.codePointAt(0)) && !ALLOWED_NON_ASCII.has(ch)) {
      offenders.push({ ch, line })
      if (offenders.length >= 5) break
    }
    if (ch === '\n') line++
  }
  for (const o of offenders) {
    failures.push(`${file}:${o.line} non-English character ${describeChar(o.ch)}`)
  }
}

// Check 2: a guide that quotes a figure (% or $) must give the contract address and the
// block number the figures were read at, in its first 5 lines. The word "block" alone is
// satisfied by "blockchain", or by "block rewards" — which the mining and staking guides
// will certainly mention — so this requires an actual block number, not just the word.
const BLOCK_NUMBER = /block\s*#?\s*[\d,]{4,}/i
for (const file of files) {
  const text = fileTexts.get(file)
  if (/[%$]/.test(text)) {
    const first5 = text.split('\n').slice(0, 5).join('\n')
    if (!BLOCK_NUMBER.test(first5)) {
      failures.push(
        `${file}: quotes a figure (% or $) but its first 5 lines do not give the contract address and the block number the figures were read at (need a block number, e.g. "block 122,967,819" — the word "block" alone is not enough)`,
      )
    }
  }
}

const indexText = readFileSync(join(helpDir, 'index.ts'), 'utf8')

// Check 3: every guide file must actually be imported by index.ts. Writing the file and
// forgetting the two lines in index.ts is the single most likely mistake once sixteen
// more of these are added at once — the only symptom is the help button not appearing.
const importedNameByFile = new Map()
for (const m of indexText.matchAll(IMPORT_LINE)) importedNameByFile.set(m[2], m[1])
for (const file of files) {
  const base = file.replace(/\.ts$/, '')
  if (!importedNameByFile.has(base)) {
    failures.push(`index.ts does not import from './${base}' — guide file '${file}' is not registered in GUIDES`)
  }
}

// Check 4: walk every page.tsx once, stripping (group) segments, so a route check works
// regardless of which route group a page lives under — not just '(dashboard)'.
function collectPageRoutes(dir) {
  const routes = new Set()
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (entry.name === 'page.tsx') {
        const rel = relative(dir, d)
        const segments = rel === '' ? [] : rel.split(sep)
        const kept = segments.filter((s) => !(s.startsWith('(') && s.endsWith(')')))
        routes.add('/' + kept.join('/'))
      }
    }
  }
  walk(dir)
  return routes
}
const pageRoutes = collectPageRoutes(appDir)

const routeEntries = [...indexText.matchAll(ROUTE_ENTRY)].map((m) => ({ route: m[1], identifier: m[2] }))

// Check 5: the route-entry regex itself must actually find something, and it must find
// exactly as many entries as there are guide files — otherwise a formatting change could
// make it match zero routes and the script would print "passed" having checked nothing.
//
// This also enforces one guide per route on purpose, not by accident: aliasing two
// routes to the same guide is disallowed here. If that is ever wanted, it means deciding
// to relax this specific check, not working around it.
if (routeEntries.length === 0 && files.length > 0) {
  failures.push("index.ts: the route-entry regex matched no routes in GUIDES — it may have stopped matching the map's formatting")
} else if (routeEntries.length !== files.length) {
  failures.push(`index.ts: GUIDES maps ${routeEntries.length} route(s) but there are ${files.length} guide file(s) — the counts must match`)
}

// Check 6: a route must be wired to the guide that corresponds to it by the naming
// convention, not merely to *some* imported guide. Without this, '/mice': dao passes
// every check above — the counts match, dao.ts is imported, /mice/page.tsx exists — and
// the /mice page would quietly show the DAO guide. Omission is caught elsewhere;
// mis-pairing is only caught here.
for (const { route, identifier } of routeEntries) {
  const base = routeToBase(route)
  const expected = importedNameByFile.get(base)
  if (expected === undefined) {
    failures.push(`index.ts maps '${route}' to identifier '${identifier}' but no guide file is imported as './${base}' (the route's naming convention expects '${base}.ts')`)
  } else if (identifier !== expected) {
    failures.push(
      `index.ts maps '${route}' to identifier '${identifier}', but '${base}.ts' (the file that corresponds to this route) is imported as '${expected}' — found '${identifier}', expected '${expected}'`,
    )
  }
  if (!pageRoutes.has(route)) failures.push(`index.ts maps '${route}' but ${route}/page.tsx does not exist`)
}

if (failures.length) {
  console.error('help content check FAILED:')
  for (const f of failures) console.error('  - ' + f)
  process.exit(1)
}
console.log(`help content check passed (${files.length} guide file(s))`)
