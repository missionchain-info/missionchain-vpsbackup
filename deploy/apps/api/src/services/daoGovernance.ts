import { JsonRpcProvider, Contract, id } from 'ethers'
import { getActiveAddresses } from '@missionchain/sdk'

/**
 * DAOGovernor reads for the member app.
 *
 * This is the real governance path — distinct from the "Bonus Orders" that
 * ManagementBonusPoolV3 handles. Both were being called "proposals", which is how the
 * council ended up with a Proposals tab that could not raise a proposal: the tab showed
 * bonus orders, while `DAOGovernor.propose()` had never been reachable because no wallet
 * held BTC_MEMBER_ROLE.
 *
 * Writes are NOT here. Council members sign `propose` / `approve` / `execute` with their
 * own wallet in the browser — a server relayer would mean one key casting everyone's vote,
 * which is the opposite of what a 3-of-5 quorum is for.
 */

const GOVERNOR_ABI = [
  'function proposalCount() view returns (uint256)',
  'function daoActive() view returns (bool)',
  'function hasRole(bytes32,address) view returns (bool)',
  'function hasApproved(uint256,address) view returns (bool)',
  'function isExecutable(uint256) view returns (bool)',
  'function getProposal(uint256) view returns (address proposer, address target, bytes callData, uint8 category, uint256 createdAt, uint256 approvalCount, uint8 state, uint256 timelockExpiry)',
]

const BTC_MEMBER_ROLE = id('BTC_MEMBER')

export const QUORUM = 3

export const CATEGORY = ['PARAMETER', 'BUDGET', 'STRUCTURAL', 'EMERGENCY'] as const
export const CATEGORY_DELAY_HOURS = [24, 24, 24 * 7, 0] as const
export const STATE = ['PENDING', 'APPROVED', 'EXECUTED', 'CANCELLED'] as const

export interface DaoProposal {
  id: number
  proposer: string
  target: string
  callData: string
  category: (typeof CATEGORY)[number]
  state: (typeof STATE)[number]
  createdAt: number
  approvalCount: number
  quorum: number
  timelockExpiry: number
  /** Seconds still to wait; 0 once the timelock has passed. */
  timelockRemaining: number
  executable: boolean
  iApproved: boolean
}

export interface DaoGovernanceView {
  address: string
  daoActive: boolean
  quorum: number
  /** Whether the caller may propose and approve at all. */
  callerCanVote: boolean
  proposals: DaoProposal[]
}

export async function readDaoGovernance(
  provider: JsonRpcProvider,
  callerWallet: string
): Promise<DaoGovernanceView> {
  const address = (getActiveAddresses() as any).DAOGovernor
  const gov = new Contract(address, GOVERNOR_ABI, provider)

  const [count, daoActive, callerCanVote] = await Promise.all([
    gov.proposalCount() as Promise<bigint>,
    gov.daoActive() as Promise<boolean>,
    gov.hasRole(BTC_MEMBER_ROLE, callerWallet) as Promise<boolean>,
  ])

  const total = Number(count)
  const now = Math.floor(Date.now() / 1000)
  const proposals: DaoProposal[] = []

  // Ids are 1-based (proposalCount is incremented before use). Newest first — a council
  // member opening this page is looking for what needs their signature, not for history.
  for (let pid = total; pid >= 1; pid--) {
    const [p, iApproved, executable] = await Promise.all([
      gov.getProposal(pid) as Promise<any>,
      gov.hasApproved(pid, callerWallet).catch(() => false) as Promise<boolean>,
      gov.isExecutable(pid).catch(() => false) as Promise<boolean>,
    ])
    const timelockExpiry = Number(p.timelockExpiry)
    proposals.push({
      id: pid,
      proposer: p.proposer,
      target: p.target,
      callData: p.callData,
      category: CATEGORY[Number(p.category)] ?? 'PARAMETER',
      state: STATE[Number(p.state)] ?? 'PENDING',
      createdAt: Number(p.createdAt),
      approvalCount: Number(p.approvalCount),
      quorum: QUORUM,
      timelockExpiry,
      timelockRemaining: Math.max(0, timelockExpiry - now),
      executable,
      iApproved,
    })
  }

  return { address, daoActive, quorum: QUORUM, callerCanVote, proposals }
}
