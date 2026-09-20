// Figures here were read from the MIC staking contract
// 0x4eae6376501E975CbF207473E3277417495fd3fE and MICToken
// 0xf27ec0c311728b923b22828002c992c799326182 at block 122,999,185 on 2026-09-20. Only
// constants the contract cannot change are stated as numbers; live values belong on the
// page, not in this text.
import type { Guide } from './types'

export const staking: Guide = {
  title: 'Staking',
  intro:
    'Staking locks MIC for a chosen term in exchange for a share of the staking pool. What decides ' +
    'your share is not the amount you staked but your weight — the amount multiplied by the term ' +
    'you picked.',
  howItWorks: [
    'Staking is pure MIC. No NFT is involved, there are no tier caps and no minimum: any wallet may stake any amount. An MFP-NFT changes DAO voting eligibility, not staking rewards.',
    'Weight = amount × the multiplier of the term. Rewards are shared in proportion to weight, so the same MIC on a longer term draws a larger share of every distribution.',
    'There are four terms — 30, 90, 180 and 360 days — with multipliers of 1×, 1.6×, 2.6× and 5×. These were steepened in August 2026. Anything still showing 1 / 1.25 / 1.5 / 2 is out of date.',
    'Each stake is its own position with its own term, unlock time and weight. Staking again opens a second position; it does not extend or top up the first, and it does not re-price the first at the new term.',
    'Your weight is fixed at the moment you stake. To move to a longer term you unstake when the current one ends and stake again — there is no upgrade in place.',
    'The term is a real lock. Unstaking before the unlock time reverts. Rewards, however, can be claimed at any point without touching the position.',
    'Unstaking is capped across all users: at most one tenth of the total staked amount may leave in a single day. If the day’s allowance is used up before your transaction, it reverts and you retry later — the position is not harmed.',
    'Rewards arrive from the daily mining distribution, not from new deposits. There is no fixed rate: what you receive depends on how much was distributed and how much total weight it was shared across.',
  ],
  tips: [
    'The four terms, the four multipliers and the one-tenth daily unstake cap are hard constants in the contract.',
    'MIC still under a vesting lock can be staked, but only on the 360-day term — the contract refuses any shorter one. This also needs the token to recognise the staking contract as an approved destination; where that permission is not in place, the token itself refuses the transfer and the stake will not go through however the page looks. Try a small amount first.',
    'Plan around the daily unstake cap before you commit a large position. The cap is a share of the whole pool, so a position that is large relative to the pool may take more than one day to exit even after its term has ended.',
    'The staking pool is fed by the mining split, so its size moves with mining. During the early boost window the staking leg is larger than its published share; it returns to that share when the window closes.',
  ],
}
