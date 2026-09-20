// Sources read on 2026-09-20: MICToken 0xf27ec0c311728b923b22828002c992c799326182 at
// block 123,011,463, plus the handler that serves this screen
// (apps/api/src/routes/dashboard.ts, GET /dashboard/overview) and the on-chain reads the
// page makes in the browser. No figure is stated as a number here; this guide explains
// where each figure on the screen comes from, because several are computed rather than
// measured.
import type { Guide } from './types'

export const dashboard: Guide = {
  title: 'Dashboard',
  intro:
    'This screen is two things stacked: the protocol as a whole at the top, and your own wallet ' +
    'below it. They are not gathered the same way. Some figures are read straight from a ' +
    'contract, some are worked out by subtracting one thing from another, and one of them is ' +
    'simply a setting. Knowing which is which is most of what this page needs explaining.',
  howItWorks: [
    'The price at the top is a DISPLAY price. It is taken from the protocol pool when there is a market to read and from a figure an administrator has entered when there is not. It is not a sale price: Pre-Sale and SEED each sell at their own contract’s price, and neither one follows this number.',
    'Market cap is not measured anywhere. It is circulating supply multiplied by that display price, worked out in your browser as the page renders. If the price came from a setting rather than from the market, the market cap inherits that.',
    'Supply Now is what exists on chain today, read from the token itself. The figure beside it is the design cap once all mining has happened — supply that does not exist yet. The two are not a ratio and should never be read as one.',
    'Circulating is a subtraction, not a reading. It starts from everything issued and takes away what still sits inside protocol contracts, what the lock manager still holds restricted in member wallets, what is staked, and what has been burned. Every one of those has to be read correctly for the answer to be right.',
    'Burned is derived the same way: everything ever issued, less what the token still reports as existing. A burn anywhere in the system lands in that figure on its own, with nothing to record and nobody to remember.',
    'Reserves and Vesting are the locked total split in two. Reserves is MIC still inside protocol contracts and not yet distributed to anyone. Vesting is MIC already delivered into member wallets but still restricted by the lock manager.',
    'The mining bar shows how much of the mining allocation has been minted so far. The shares drawn beneath it come from a configured setting on the server, not from the emission contract, so read them as published policy rather than as a reading of what the contract did today. The Mining page is where a day’s mint and how it is divided are explained.',
    'Everything in My Wallet is read from chain by your browser when the page loads, not from the app’s database. MIC Balance is the token’s own balance for your address — the same figure your wallet shows. Vesting is what the lock manager reports as still restricted for you, and Available is the remainder.',
    'The NFT counts are read from the two collections directly. The Community tiers count only tokens that have not expired, so a count can fall without anything being sold or transferred.',
  ],
  tips: [
    'A zero is drawn as a dash on this screen. A dash means nothing, or nothing that could be read — it does not mean the page is still loading.',
    'The wallet block and the protocol figures above it are not from the same instant. Your balances are fetched fresh each time the page loads; the protocol figures come from the server and can be served briefly from a cache.',
    'Available is your balance minus what the lock manager reports locked. The token refuses to move staked MIC as well, so when a transfer or a swap is rejected, trust the error on that form over the figure here.',
    'For staking and for reward income, read the Staking and Network pages. Those screens read their own contracts, and this summary is not guaranteed to agree with them.',
    'Nothing on this page moves anything. It displays figures — every action lives on the page that owns it.',
  ],
}
