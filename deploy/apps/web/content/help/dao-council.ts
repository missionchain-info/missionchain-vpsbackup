// Figures here were read from StewardCouncil 0x87723621D50fcc6f6db25d73031E44Bee4081B19,
// ManagementBonusPoolV4 0x35f32C7C1967D55c9521d39f7F6e2B1437A9d65d and
// ReservedExpensesPoolV4 0xf8f549d290F2e25AAbC359b67765da6aFe0EB43D at block 123,004,731
// on 2026-09-20. Only constants the contract cannot change are stated as numbers; live
// values belong on the page, not in this text.
import type { Guide } from './types'

export const daoCouncil: Guide = {
  title: 'Steward Council',
  intro:
    'The Steward Council is the group of wallets that may raise and approve spending from the ' +
    'project funds. It is a registry on chain: a contract that holds one record per member and ' +
    'answers two questions for every other contract that asks — is this wallet a member, and how ' +
    'many members are active right now. This page is the members-only side of governance, and ' +
    'a wallet that is not on the registry sees a locked panel instead.',
  howItWorks: [
    'A seat is a record in the registry contract: a wallet, a member id, a role, a rights label and a note. Seats are added, edited, deactivated and removed by the wallet holding the registry\'s administrator role. The Council does not vote itself in — membership is granted, not elected.',
    'Deactivating a seat is not the same as removing it. A deactivated member keeps their record and their history but stops counting as active, and the active count is the number every approval bar is measured against.',
    'One member, one vote. The registry stores no weight of any kind: there is no function on it that reads a token balance, a staked amount or an NFT, and the fund contracts simply count approving wallets. Nothing you can buy or stake makes your approval worth more than anyone else\'s.',
    'Every approval bar is a SHARE of the currently active members, not a fixed number of votes, and it is rounded up. Add a member and the bar can rise; deactivate one and it can fall. Read the bar off the fund you are acting on rather than remembering a count.',
    'Raising an order and approving it are two separate actions on the fund contracts. Unlike a DAO proposal, the member who raises an order is NOT counted as an approval — you have to approve your own order as a second transaction if you want it to count.',
    'Two of the funds count approvals inside their own contract and refuse to release money below the bar. For those, bypassing this website changes nothing, and once the bar is met anyone at all may execute the order.',
    'The remaining funds sit on contracts with no voting code. The vote is real as a process and is recorded, but the contract only checks that the signing wallet holds the right role, so the payment rests on that role holder honouring the decision. Each fund on the page says which of the two it is.',
    'An order can be withdrawn while it is still pending by the member who raised it or by the administrator. Once it has executed it cannot be undone.',
  ],
  tips: [
    'The bar shown on your seat card and the bar enforced by an individual fund contract are not guaranteed to be the same number. The one that decides whether a payment goes through is the one on the fund, and the fund is where you should read it.',
    'A second approval from the same wallet is rejected, and an approval cannot be taken back. Approving is a one-way act — treat it as signing, not as an opinion.',
    'Salaries are not voted on. Each member claims their own accrual from their own wallet; nobody can claim on behalf of anyone else, and there is nothing to propose.',
    'The published governance documents described a council that votes with weighted MFP stake. No such mechanism exists in any deployed contract. If someone quotes weighted voting at you, the contract is the answer and it counts heads.',
  ],
}
