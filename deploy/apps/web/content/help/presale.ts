// Figures here were read from PreSale 0xC4A6cd57DE0619daCDfD190E9A4D9682Ed78BE23,
// RevenueRouter 0xf86b0cF9ce21250429b522Ed62a5B6b549539672 and ReferralRegistry
// 0x2a8C0c5c7414fD4f879ba34883652f306403f0f9 at block 122,999,289 on 2026-09-20. Only
// constants the contract cannot change are stated as numbers; live values belong on the
// page, not in this text.
import type { Guide } from './types'

export const presale: Guide = {
  title: 'Pre-Sale',
  intro:
    'The Pre-Sale sells MIC for USDT at a rate fixed in the contract. The rate does not move with ' +
    'demand, so the only things that change over the round are how much is left and who gets ' +
    'credited for introducing you.',
  howItWorks: [
    'You pay USDT and receive MIC at a fixed rate. Both tokens are 18-decimal, so the conversion is a plain multiply with no rounding surprises.',
    'The round has two ceilings: a MIC allocation and a USDT hard cap. Whichever is reached first stops the sale, and a purchase that would cross either one reverts rather than filling partially.',
    'There is a minimum purchase, plus three optional packages with higher minimums that also mint a Community NFT. Selecting a package and paying below its minimum reverts — the contract does not quietly downgrade you to the tier you paid for.',
    'Your payment is never held by the sale contract. The full gross amount is handed to the revenue router in the same transaction and split across six destinations: referral, marketing, management, treasury, staking and liquidity.',
    'Of those six, the referral slice is a hard constant in the router. The other five are DAO-adjustable, and even then each may move by at most 5 percentage points per change, no more than once every 30 days.',
    'Referral pays two levels out of that slice: your direct referrer (F1) and your referrer’s referrer (F2). Both rates are contract constants — F1 is 7% and F2 is 3% of the gross — and no vote can alter them.',
    'The MIC lands in your own wallet in the same transaction, with a lock schedule created against it. The tokens are yours immediately; when they become transferable is set by the schedule. See the Vesting guide.',
  ],
  tips: [
    'Your referrer is recorded once and is then permanent. Register the person who introduced you BEFORE your first purchase — it cannot be corrected afterwards.',
    'If you have no referrer, the unspent part of the referral slice goes to the Milestones and Incentives pool. It is not discounted from your price and it does not come back to you, so buying without a referrer costs you the same and credits nobody.',
    'Team volume is credited to every wallet above you in the chain, not only the two paid levels. The thresholds that move a wallet up a tier are contract constants; the rate that applies is read from the registry, not from a document.',
    'MIC that does not sell is under governance control, not the sale operator’s. It can only be withdrawn or burned once the round has been opened and then stopped, or once 180 days have passed since launch — never before.',
    'Approve only the amount you intend to spend. The price is fixed, so there is no reason to leave a standing allowance.',
  ],
}
