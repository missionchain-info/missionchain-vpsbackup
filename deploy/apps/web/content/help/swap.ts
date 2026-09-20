// Figures here were read from LiquidityPoolV7 0x70E28Abcce584e2B3423737Dc3497e3A278641aF
// at block 123,018,534 on 2026-09-20. Only constants the contract cannot change are
// stated as numbers; live values belong on the page, not in this text. `sellGateUsdt` is
// declared `immutable` and set once in the constructor, so the 25,000 USDT gate is a
// constant of this deployment and is written as one.
import type { Guide } from './types'

export const swap: Guide = {
  title: 'Swap',
  intro:
    'Swap trades MIC against USDT directly with the protocol pool, not with another person. ' +
    'The pool quotes its own price from how much capital stands behind it, so the price you ' +
    'see is the price the contract will honour. Most of what is worth understanding here is ' +
    'the gap between the capital the pool quotes against and the capital it actually holds, ' +
    'because that gap is what decides when you may sell and what selling costs you.',
  howItWorks: [
    'The pool opens with a fixed amount of MIC and a virtual reserve that stands in for capital it does not hold yet. The virtual reserve is an accounting figure rather than money: it is there so the pool can quote a sensible price from its first trade instead of pricing an early buyer against an empty book.',
    'Every real dollar that arrives retires exactly one virtual dollar, so early buyers do not move the price against later ones. The pool does not get deeper as money comes in — it gets more REAL, one dollar at a time.',
    'Backing is the share of the capital behind the quote that is real USDT rather than virtual. It starts near nothing and reaches full when every dollar the pool quotes against is a dollar it actually holds. Backing is the number the rest of this page turns on.',
    'Buying MIC costs a flat 0.3% fee.',
    'Selling MIC back is closed until the pool has held 25,000 USDT of real capital. That threshold is fixed at deployment: no wallet and no vote can raise or lower it. It is a capital threshold, not a date — waiting for a calendar day will not open it.',
    'The gate is measured against the highest real balance the pool has ever held, not today’s, so once it is cleared it stays cleared and a later run of sells cannot close the sell side again. Flipping it is a permissionless transaction anyone may send once the condition is met, so nobody is waiting on an operator.',
    'Once selling opens, the fee is read off backing at the instant of the trade. Thin backing means the fee is near its maximum; when real capital has fully replaced the virtual reserve the fee is zero. Nothing is scheduled and nothing is decided — there is no admin path to this fee at all.',
    'The reason the fee falls is the reason it exists. Selling into virtual depth means selling against money the pool does not have, and the fee is the price of that gap. As real capital replaces the virtual reserve the gap closes, and the fee closes with it.',
  ],
  tips: [
    'The sell fee can never exceed 15%. It is a hard constant in the contract: no wallet and no vote can raise it.',
    'One trade can move at most 1% of the MIC in the pool, in either direction, so a single large order cannot swing the price.',
    'Sells are also capped per rolling 24 hours as a share of the real USDT held.',
    'If you have read that sells open on day 30, that is a legacy constant still sitting in the contract. It gates nothing, and it decides nothing. The capital threshold is the only thing that opens the sell side.',
  ],
}
