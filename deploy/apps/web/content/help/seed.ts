// Figures here were read from SeedSaleV9 0x5216c5C69FB899CC3De8Aa94165363153B5B589d
// at block 122,999,289 on 2026-09-20. Only constants the contract cannot change are
// stated as numbers; live values belong on the page, not in this text.
import type { Guide } from './types'

export const seed: Guide = {
  title: 'SEED',
  intro:
    'SEED is a strategic-partner grant round, arranged off this page and settled on it. It is not ' +
    'a public sale and not a general offering: the contract will only accept a wallet that has ' +
    'been cleared in advance. This page describes the mechanics and nothing else.',
  howItWorks: [
    'Access is by whitelist, and the whitelist is enforced inside the purchase function itself — not by the page. A wallet that is not on the list has its transaction reverted and is charged nothing beyond gas.',
    'Two switches must both be satisfied: the round must be active, and either the whitelist requirement must be lifted or your wallet must be on the list. The page asks the contract directly rather than assuming.',
    'Packages are fixed. Each one is a set USDT price, a set amount of MIC and a set number of MFP-NFTs. You cannot name your own amount, buy a fraction of a package, or combine two into one transaction.',
    'The USDT is forwarded to the SEED budget contract in the same transaction and split across the operating pools there. The sale contract does not sit on it.',
    'The MIC is transferred to your own wallet, and a lock schedule is created against that wallet in the same transaction. The tokens are yours from the first block; the schedule governs when they become transferable. See the Vesting guide.',
    'The MFP-NFTs in a package are granted as a mint allowance at the same moment, separately from the MIC.',
    'SEED has NO referral. No commission is paid to anybody on a SEED purchase. Referral belongs to Pre-Sale and MICE only, and a referral link pointed at this page pays nothing.',
  ],
  tips: [
    'Being cleared once does not mean you are cleared now. Clearance can be withdrawn, and the requirement itself can be switched on or off by governance, so the page re-checks every time.',
    'Grants to earlier partners run through a separate admin function with its own capped pool. They are not purchases, they do not pass through the whitelist, and they can be backdated — so a schedule may already be further along than its grant date suggests.',
    'Approve exactly the package price rather than an unlimited allowance. The page requests the exact amount for the package you chose.',
    'This is a partner grant with a delivery schedule. What the contract commits to is the MIC and the NFTs written into the package you buy — nothing beyond that is offered or implied.',
  ],
}
