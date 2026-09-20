// Figures here were read from SeedBudgetV5c 0x33ec0A97029adde1A7e0f78E3B8f414Ec56527ef,
// TreasuryManager 0x1ed5C848D1244a618Bd95Ff92d4f8C2356d3a42F, ListingReserve
// 0x9e4f9472E3526635d0001f6986D5daBca72b7D7D and ManagementPool
// 0x20C08cb2552E51AA3fA1450FD6811112f8c95cfb at block 123,004,731 on 2026-09-20. Only
// constants the contract cannot change are stated as numbers; live values are on the page.
import type { Guide } from './types'

export const daoManagement: Guide = {
  title: 'Funds Management',
  intro:
    'Governance spending is split across seven funds, each backed by its own contract with its ' +
    'own rules about who may take money out and how. This page brings them onto one screen, a ' +
    'tab per fund, with the balance read from the contract rather than from our records. What ' +
    'differs between them is not the voting — it is who or what actually enforces the decision.',
  howItWorks: [
    'Steward Salaries pays Council members. Each enrolled member has a share and a weekly maximum, both set by an administrator, and claims their own accrual from their own wallet. Anything above the weekly maximum is not lost — it stays claimable in later weeks. There is nothing to propose here.',
    'Management and Ops is one pool serving two purposes. Six leadership roles each claim a fixed share of everything the pool receives, and the contract will only accept that claim from the wallet registered for the role. Whatever is left over is a bonus budget: the Council proposes and votes on a bonus payment, but the contract accepts the payout call from its administrator alone, so an approved bonus still has to be signed there.',
    'Management Bonus and Contingency Reserve are the two funds that enforce their own vote. A member raises an order naming a recipient, an amount and a purpose; members approve it; and once the approving share is reached anyone may execute it. Below the bar the contract simply refuses to pay, and no role holder can override that.',
    'DAO Treasury is split into three sub-pools and is deliberately slow. A single transfer may take at most 5% of a sub-pool\'s balance, and each sub-pool allows at most 2 transfers in any 30-day period. Those three limits are fixed constants. A separate emergency withdrawal exists that bypasses both limits and is open to the administrator only.',
    'Reserved Listing holds the money for opening an external market. Taking money out is request, then wait, then execute: the delay is a fixed 24 hours and the contract holds only one pending request at a time, so a new request replaces the previous one. The administrator can cancel a request before it executes.',
    'Milestones and Incentives is held by the rewards contract and is credited to recipients by a wallet holding the crediting role. It is mostly referral commission that had no upline to pay.',
    'Three of the seven — Steward Salaries, Management Bonus and Contingency Reserve — are slots inside one shared vault rather than separate piles of money. A fund cannot pay out more than its own slot holds, even when the vault as a whole holds plenty.',
  ],
  tips: [
    'A release out of a vault slot is charged a fee, which is deducted on the way out and sent to a fee receiver. What the recipient actually gets is the approved amount minus that fee, so an approved figure is the gross, not the payment. The fee is a setting, and the contract caps it at 10% — it cannot be set higher.',
    'The balance on each tab is read from the contract. Where a contract keeps its own record of what it has released, the Spent figure is exact; where it does not, Spent is only accumulated minus balance and the page says so. Do not treat a derived figure as a ledger.',
    'An order can be approved and still fail to execute: the contract checks the slot balance at execution time, not at approval time. Approving a payment larger than the fund holds produces an order that reverts rather than a payment.',
    'Read the layer badge on each fund before relying on a vote. Where it says the contract enforces it, the vote is the gate. Where it does not, the contract only asks whether the signing wallet holds a role, and the decision is a promise rather than a lock.',
  ],
}
