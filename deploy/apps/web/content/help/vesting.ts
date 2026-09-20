// Read from LockManager 0x6bE58BCe62f526E7751e121CDBa1eb22873471A0 and MICToken
// 0xf27ec0c311728b923b22828002c992c799326182 at block 123,000,918 on 2026-09-20. The
// lock manager held 0 MIC at that block and exposes no claim, release or withdraw
// function. Only constants the contract cannot change are stated as numbers; live values
// belong on the page, not in this text.
import type { Guide } from './types'

export const vesting: Guide = {
  title: 'Vesting',
  intro:
    'MIC bought in a locked round is in your own wallet from the moment you buy it. Nothing is held ' +
    'in escrow, there is no claim button and there is nothing you can miss. This page shows how much ' +
    'of your own balance is still restricted and when that restriction eases.',
  howItWorks: [
    'The tokens are transferred to you at purchase and are visible in your wallet and on the explorer straight away. This page is a view of a restriction, not a view of a balance held somewhere else.',
    'The lock manager holds no tokens at all. It stores a schedule per purchase and answers a single question: how much of this wallet’s MIC is still locked.',
    'The restriction is enforced by the MIC token itself, on every transfer. A transfer that would take your balance below your locked amount is rejected by the token — no app, front end or approval can route around it.',
    'Unlocking is purely time-based. There is no transaction to send, no claim step, no deadline and no cost. When the time passes, the locked figure falls on its own.',
    'Each purchase creates its own schedule, with its own start time, its own cliff and its own release rate. One wallet can hold several running side by side, and the page lists them separately because they do not share a clock.',
    'Before a schedule reaches its cliff, all of it is locked. At the cliff a set share is released, and a further set share is released at each step afterwards until the schedule is exhausted. The figures differ per schedule and are shown per row on this page.',
    'The lock applies to your balance as a whole, not to particular coins. Buying more MIC does not unlock anything, and it does not lock the new MIC either — it simply increases the free part of your balance.',
    'Staking is the one permitted exception: the token can be told to allow a transfer into an approved staking contract even while the balance is locked. Everything else — sending, selling on the swap, P2P, paying the MIC half of a MICE licence — is refused until the schedule releases.',
  ],
  tips: [
    'There is nothing to claim, ever. Anyone telling you to connect somewhere to "claim your vested MIC", or offering to unlock it for a fee, is not Mission Chain. Treat it as theft in progress.',
    'A transfer that fails with "transfer exceeds unlocked balance" is the lock doing its job, not a wallet fault or a gas problem. Check the unlocked figure here first.',
    'A grant can be created with a backdated start, so its clock may already be well advanced on the day it appears in your wallet. Read the start date on the row rather than assuming it began today.',
    'Do not plan a sale, a licence purchase or a transfer against your total balance. Plan against the unlocked figure — that is the only part the token will let you move.',
  ],
}
