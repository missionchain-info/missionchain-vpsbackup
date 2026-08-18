/**
 * Exercises the per-type split in nftRewardHistory against a scripted chain.
 *
 * On mainnet every figure is currently zero, so the attribution code has never run. This
 * drives it with the case it exists for: credits of both types, a claim in the middle, and
 * the wallet sharing each batch with other people.
 */
import { Interface, id } from 'ethers'
import { readUsdtLedger } from '../src/services/nftRewardHistory.ts'

const ME = '0xD32e666381b56f979D60C57831838f05F33AD6c2'
const OTHER = '0x1111111111111111111111111111111111111111'
const POOL = '0x187b221C47b976b39E40F46470f0252f4194B676'
const E = 10n ** 18n

const iface = new Interface([
  'function creditCommunity(address[] recipients, uint256[] amounts)',
  'function creditMFP(address[] recipients, uint256[] amounts)',
])

const TOPIC = {
  community: id('CommunityCredited(uint256,uint256)'),
  mfp: id('MfpCredited(uint256,uint256)'),
  claimed: id('RewardClaimed(address,uint256)'),
}

// Community 10 + MFP 4, wallet claims (14 out), then Community 6 + MFP 1 still owed.
const txs = {
  '0xaa': iface.encodeFunctionData('creditCommunity', [[OTHER, ME], [99n * E, 10n * E]]),
  '0xbb': iface.encodeFunctionData('creditMFP', [[ME, OTHER], [4n * E, 7n * E]]),
  '0xcc': iface.encodeFunctionData('creditCommunity', [[ME], [6n * E]]),
  // The wallet appears twice in one batch — must be summed, not first-matched.
  '0xdd': iface.encodeFunctionData('creditMFP', [[ME, OTHER, ME], [1n * E, 3n * E, 0n]]),
}

const logs = [
  { topic: TOPIC.community, blockNumber: 100, transactionHash: '0xaa' },
  { topic: TOPIC.mfp, blockNumber: 101, transactionHash: '0xbb' },
  { topic: TOPIC.claimed, blockNumber: 150, transactionHash: '0xclaim', data: '0x' },
  { topic: TOPIC.community, blockNumber: 200, transactionHash: '0xcc' },
  { topic: TOPIC.mfp, blockNumber: 201, transactionHash: '0xdd' },
]

// 6 community + 1 MFP still owed — what claimable() must report for the split to reconcile.
const CLAIMABLE = 7n * E

const provider = {
  async getLogs({ topics }) {
    return logs.filter((l) => l.topic === topics[0])
  },
  async getTransaction(hash) {
    return txs[hash] ? { data: txs[hash] } : null
  },
  // readUsdtLedger builds a real ethers Contract, which reaches the chain through
  // runner.call(). Answering here exercises the real decode path rather than stubbing it.
  async call() {
    return '0x' + CLAIMABLE.toString(16).padStart(64, '0')
  },
  async resolveName(n) { return n },
}

const out = await readUsdtLedger(provider, POOL, ME)

const expect = (label, got, want) => {
  const ok = String(got) === String(want)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: got ${got}${ok ? '' : `, want ${want}`}`)
  if (!ok) process.exitCode = 1
}

if (out === null) {
  console.log('FAIL  split rejected by its own consistency check')
  process.exitCode = 1
} else {
  expect('community accumulated', out.community.accumulated, '16.0')
  expect('community claimed', out.community.claimed, '10.0')
  expect('community unclaimed', out.community.unclaimed, '6.0')
  expect('mfp accumulated', out.mfp.accumulated, '5.0')
  expect('mfp claimed', out.mfp.claimed, '4.0')
  expect('mfp unclaimed', out.mfp.unclaimed, '1.0')
}
