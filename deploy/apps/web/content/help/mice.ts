// Figures here were read from MICELicense 0x4d5147aC4aa44eFc1Ae6196FcE4c87567aA4BD8c
// at block 122,999,185 on 2026-09-20. Only constants the contract cannot change are
// stated as numbers; live values belong on the page, not in this text.
import type { Guide } from './types'

export const mice: Guide = {
  title: 'MICE Licences',
  intro:
    'A MICE licence is a seat in the mining pool, not a token you hold for its price. Buying one ' +
    'buys the right to earn newly issued MIC for a fixed term, and the term starts when the licence ' +
    'is activated rather than when it is paid for.',
  howItWorks: [
    'Seats are limited to 100,000 and sold in 5 rounds of 20,000. The round is decided by how many seats are already taken, and each round costs a fixed multiple of the round-one price: round 2 costs twice it, round 5 costs five times it. Nothing about the ladder is adjustable.',
    'A whole batch is priced at the round of its first licence, so an order that straddles a round boundary does not pay the higher price for the tail.',
    'You pay half the price in USDT and half in MIC you already hold. The MIC half is burned on the spot: it leaves the supply permanently and is not held anywhere.',
    'The MIC half is quoted from a protocol pool’s own price feed, at the lower of its spot price and its seven-day average. That pool is not necessarily the one the Swap page trades against — they are separate contracts, so do not assume the quote here matches the price shown there. Pushing the pool price down makes you owe MORE MIC, not less, so there is nothing to gain by moving it before you buy. The page shows the quote before you sign.',
    'The USDT half goes straight into the revenue split in the same transaction. It is not a deposit and there is no refund path.',
    'A new licence is PENDING and earns nothing. It starts earning only when it is activated, which anyone can do on the owner’s behalf. The activation delay is zero, so it can be activated immediately.',
    'The term is 360 days measured from activation, not from purchase. When it ends, earning stops on that second, whether or not anyone has noticed.',
  ],
  tips: [
    'The 100,000 seat cap, the 20,000 licences per round, the 5 rounds and the 360-day term are hard constants in the contract. No wallet and no vote can change them.',
    'There is no 72-hour wait before a licence can be activated. The delay in the deployed contract is 0 — older diagrams that show 72 hours describe a version that was never deployed.',
    'Both balances are pulled in one transaction. If your wallet is short of either the USDT half or the MIC half, the whole purchase reverts and nothing moves.',
    'A referrer can be recorded on your first purchase and is then permanent. Set it before you buy; it cannot be changed afterwards. F1 pays 7% and F2 pays 3% of the USDT half, and both rates are contract constants.',
    'An expired licence keeps what it earned, but its seat can be recycled by anyone. Once every seat is taken, recycling an expired one is what frees a seat for the next buyer.',
  ],
}
