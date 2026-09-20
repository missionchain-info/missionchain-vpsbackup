// This page is static. Nothing on it is read from a contract, a database or an API at
// page load: the document links, the contract list and the community links are all
// written into the page and change only when the app is rebuilt. Checked against
// app/(dashboard)/info/page.tsx on 2026-09-20. No figures are quoted here on purpose.
import type { Guide } from './types'

export const info: Guide = {
  title: 'Infos',
  intro:
    'Infos is a directory, not a live screen. It collects the three things a member usually has ' +
    'to go hunting for: the published documents, the addresses of the contracts the system runs ' +
    'on, and the official community channels. Nothing here updates by itself.',
  howItWorks: [
    'The document sections link the White Paper and its appendices. Each one opens in a new tab and is a fixed published file, not a view of the running system.',
    'The contract list gives each contract a name, a one-line description, its address, a copy button and a link to the block explorer. This is the place to get an address from before you type one anywhere else.',
    'The addresses and their descriptions are written into the page by hand. They are not fetched, so they are as current as the last time somebody edited them, and a contract that has been replaced since can still be listed under its old address.',
    'The explorer link opens the address on BSCScan, where you can read the verified source, the balances and every transaction the contract has ever taken part in. That is the authority; this list is only the shortcut to it.',
    'The community section links the official channels. A channel that has no address yet is present as a placeholder rather than left out.',
  ],
  tips: [
    'Copy addresses from here rather than from a message, a screenshot or a search result. That single habit defeats most of the scams aimed at this kind of product.',
    'Being listed here does not prove a contract is the current one. A superseded contract stays live, stays verified and keeps answering — it just is not the one in use any more. When it matters, check which address the feature page itself is talking to.',
    'The descriptions beside each address are hand-written notes, not readings. Treat any quantity inside one as a note somebody left, and read the live figure from the explorer or from the page that owns it.',
    'Nothing on this page asks for a signature, and no document linked from it needs your wallet. Anything reached from here that asks you to connect and approve did not come from this list.',
  ],
}
