// Figures here were read from DAOGovernor 0xDCD65DC97b0A147BeCf542E22a5C218C006231cC at
// block 123,004,496 on 2026-09-20, and the proposal flow was rehearsed against that same
// deployed contract on a mainnet fork. Only constants the contract cannot change are
// stated as numbers; live values belong on the page, not in this text.
import type { Guide } from './types'

export const dao: Guide = {
  title: 'DAO Governance',
  intro:
    'Governance here is a small committee acting on chain, not a token vote. A proposal is a ' +
    'single call the committee wants the protocol to make — a contract to call and the exact ' +
    'instruction to send it — and it becomes executable only after enough seats approve it ' +
    'and a waiting period has passed.',
  howItWorks: [
    'A proposal names one target contract, one encoded instruction and one category. Only a seat holder may raise one.',
    'There are four categories, and the category is chosen when the proposal is raised. It decides the waiting period and nothing else: a parameter change and a budget action each wait 24 hours, a structural change waits 7 days, and an emergency action waits not at all.',
    'The committee has 5 seats and a proposal carries at 3 of them. Both numbers are fixed in the contract and no transaction can move them.',
    'The member who raises a proposal is counted as the first approval automatically. Three approvals therefore means the proposer plus two more, not the proposer plus three.',
    'The waiting period is counted from the moment the proposal was CREATED, not from the moment it reached its third approval. A budget proposal that takes two days to gather votes is executable the instant the third approval lands, because its 24 hours elapsed while the votes were being collected.',
    'Once a proposal is approved and its waiting period has passed, anyone at all may push the execute button — the gate is the vote, not the caller.',
    'An emergency pause is a separate path with no proposal and no delay. A seat holder calls it directly, naming at least 3 seat holders as authorising signers, and the contract checks each of them is a member and that none is named twice.',
  ],
  tips: [
    'If you have read that governance needs 4 of 5, or 5 of 5, or a share of staked MFP weight, that describes a design that was never built. The contract asks for 3 approvals out of 5 seats and reads no token, no stake and no NFT.',
    'Approval is one-way. There is no "against" vote to cast: not approving is how a member objects, and an approval cannot be withdrawn once given.',
    'Execution runs the instruction exactly as it was encoded when the proposal was raised. Nobody can edit a proposal after the fact, so a wrong recipient or a wrong amount has to be left to lapse and raised again.',
    'The money the Council moves week to week does NOT run through this contract. Each fund on the Steward Council page carries its own approval bar, read from that fund\'s own contract, and those bars are not this quorum. Check the bar shown on the fund you are acting on.',
  ],
}
