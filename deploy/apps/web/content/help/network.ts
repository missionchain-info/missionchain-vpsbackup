// Read from ReferralRegistry 0x2a8C0c5c7414fD4f879ba34883652f306403f0f9
// at block 123,011,260 on 2026-09-20: F1_BPS 700 and F2_BPS 300 are public
// constants with no setter, and PreSale 0xC4A6cd57DE0619daCDfD190E9A4D9682Ed78BE23 and
// MICELicense 0x4d5147aC4aa44eFc1Ae6196FcE4c87567aA4BD8c both hold CALLER_ROLE on it.
// Rank thresholds are constants there too; the rates are named in order, not in figures.
import type { Guide } from './types'

export const network: Guide = {
  title: 'Network',
  intro:
    'Network is the referral side of your account: who introduced you, who you introduced, what ' +
    'the people beneath you have bought, and what that pays. Some of what it shows is other ' +
    'people’s money, so it is worth being exact about which figure means what.',
  howItWorks: [
    'Your introducer is recorded once and is permanent. The registry refuses a second write for the same wallet and refuses a wallet that names itself, and there is no path anywhere in the app to correct one afterwards. That cuts both ways: nobody can move you into their line either.',
    'Referral commission is paid in USDT the moment your referral buys, inside the same transaction as their purchase. It lands in your wallet by itself — there is no claim step and nothing to miss.',
    'Two levels pay. Your direct referral, F1, pays 7% and the level below them, F2, pays 3%. Both are fixed constants in the registry: no wallet, no vote and no administrator can raise or lower them.',
    'Only Pre-Sale and MICE pay referral. SEED pays none at all, by design. On a MICE licence the commission is calculated on the USDT half of the price only, because the other half is paid by the buyer in their own MIC and burned.',
    'If a level is missing — you have no introducer, or they have none — that share is not held for you and is not passed to anyone else in your line. It is forwarded to the Milestones and Incentives pool.',
    'Team volume is credited up the WHOLE chain, not only two levels. Each purchase adds its USDT amount to the running total of every ancestor above the buyer, however deep you sit above them.',
    'Rank is derived from that running total. The ranks in ascending order are Believer, Builder, Connector, Champion, Ambassador and Legend, and each carries a Team Bonus rate that rises with the rank. Believer earns nothing; the rate at the top of the ladder is the largest any rank pays, not a rate everyone gets.',
    'Team Bonus is an override, not a flat cut. On volume beneath a direct downline who already holds a rank, you earn the difference between your rate and theirs — so a leg led by someone at your own rank adds volume without adding bonus.',
    'Referral is the only stream that arrives on its own. Team Bonus, the monthly pool and the lucky draw are credited to you on chain first and pulled by you afterwards.',
    'The My Community tree loads one generation at a time. Expanding a member shows their direct referrals only, and expanding again goes one level deeper — the tree is never fetched whole.',
  ],
  tips: [
    'More than one number on this screen is called a team figure and they are measured differently. The rank card’s volume, the F1 and F2 volumes in the Volume card, and Team Sales are three separate measurements — Team Sales includes your own purchases and the entire downline at any depth. Read the label, not the word.',
    'The per-member figures in the community tree count every purchase type, including SEED. The F1 and F2 volumes count only the two sales that pay referral. They are not supposed to add up, and a mismatch between them is not an error.',
    'The rank ladder and your accumulated volume live in the registry contract. The rank and rate printed on this screen are taken from your stored profile record. Where the two disagree, the contract is the authority.',
    'Your referral link carries your member ID, not your wallet address. Someone who registers without it is attached to a default upline instead, and that cannot be undone afterwards — so send the link, not an invitation to "sign up and mention me".',
    'Commission is a share of a sale that has already happened. There is no bonus for recruiting somebody who does not buy, and nothing on this page pays for activity of any other kind.',
  ],
}
