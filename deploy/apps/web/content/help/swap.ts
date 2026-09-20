// Figures here were read from LiquidityPoolV7 0x70E28Abcce584e2B3423737Dc3497e3A278641aF
// at block 122,967,819 on 2026-09-20. Only constants the contract cannot change are
// stated as numbers; live values belong on the page, not in this text.
import type { Guide } from './types'

export const swap: Guide = {
  title: 'Swap',
  intro:
    'Swap trades MIC against USDT directly with the protocol pool, not with another person. ' +
    'The pool quotes its own price from how much capital stands behind it, so the price you ' +
    'see is the price the contract will honour.',
  howItWorks: [
    'The pool opens with a fixed amount of MIC and a virtual reserve that stands in for capital it does not hold yet.',
    'Every real dollar that arrives retires exactly one virtual dollar, so early buyers do not move the price against later ones.',
    'Buying MIC costs a flat 0.3% fee.',
    'Selling MIC back is closed until the pool holds enough real USDT. This is a capital threshold, not a date — waiting for a calendar day will not open it.',
    'Once selling opens, the fee starts high and falls to zero as real capital replaces the virtual reserve.',
  ],
  tips: [
    'The sell fee can never exceed 15%. It is a hard constant in the contract: no wallet and no vote can raise it.',
    'One trade can move at most 1% of the MIC in the pool, in either direction, so a single large order cannot swing the price.',
    'Sells are also capped per rolling 24 hours as a share of the real USDT held.',
  ],
}
