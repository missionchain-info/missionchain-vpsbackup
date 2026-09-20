// Figures here were read from EmissionControllerV2 0x3CEaeB22B262a61B1f974D90E247B8E3e8e7Ddd1
// and MiningPool 0x9178292E960cb17380dd329866e725e33200e04f at block 122,999,185 on
// 2026-09-20. Only constants the contract cannot change are stated as numbers; live
// values belong on the page, not in this text.
import type { Guide } from './types'

export const mining: Guide = {
  title: 'Mining',
  intro:
    'Mining is what an activated MICE licence does. Newly issued MIC is minted once a day and ' +
    'shared out; this page shows what your licences have earned and lets you take it. The rule the ' +
    'whole engine reduces to is that every active licence earns the same MIC per day.',
  howItWorks: [
    'Every active licence earns the same amount per day. The round it was bought in, the price it cost and the number of other licences running make no difference to your per-licence rate.',
    'There is no decay curve of any kind. Issuance is not a base rate that halves over the years — it is simply the number of active licences multiplied by the per-licence rate. When licences expire, total issuance falls with them.',
    'That miners’ amount is grossed up so the other four pools are funded out of the same mint, then multiplied by the damper. Nobody’s share is diluted when a new licence joins: more is issued instead.',
    'The mint splits five ways — miners, staking, DAO treasury, the Community NFT pool and the MFP-NFT pool. Governance may move any leg, but only within 10 percentage points of its published value, and the five must always total 100%.',
    'Early Staking Boost: for the first 90 days of the emission contract, up to 10 percentage points of the miners’ published share is lent to staking, tapering to nothing by day 90. Miners are not paid less — they still receive exactly the same MIC per licence, and more is issued to cover the larger staking slice.',
    'The damper is an emergency brake and the only discretionary input in the whole path. It ships fully disengaged and can never be set below one quarter of normal issuance.',
    'Each distribution is streamed to miners over 24 hours rather than paid as a lump, so a late run stretches the payout instead of spiking it. Anyone may trigger a distribution, and a missed run can be made up for at most 7 days.',
    'What a licence earns is banked to your wallet when the licence expires or changes hands, so you can still claim after a licence has ended or been sold on.',
  ],
  tips: [
    'The per-licence rate is NOT a constant. It can be set anywhere between 1 and 500 MIC per licence per day. Treat any lifetime total you calculate from today’s rate as an estimate, not a promise.',
    'The active count is read from the mining pool, which retires a licence the second its term ends — not when somebody gets around to noticing. An expired licence stops earning immediately.',
    'The 360-day licence term is the cap on what a licence can earn. There is no separate lifetime cap that could cut a term short.',
    'The mining allocation is finite and enforced at token level. Once it runs out, a distribution is clipped to whatever the allocation has left rather than minting beyond it.',
    'If you have seen a multi-factor emission formula with a decaying base rate and a half life, it describes an earlier contract, not this one. The controller paying rewards today has no decay term anywhere in it.',
  ],
}
