/**
 * Per-wallet reward history: Total accumulated / Claimed / Unclaimed, split by NFT type.
 *
 * ## Why this is not a simple contract read
 *
 * The two USDT pools keep ONE bucket per wallet — `mapping(address => uint256) claimable` —
 * fed by two separate operator calls, `creditCommunity` and `creditMFP`. Once credited, a
 * Community dollar and an MFP dollar are indistinguishable on chain, and `claim()` takes
 * the whole bucket at once.
 *
 * Until now the page showed that one merged number in BOTH the MFP tab and the Community
 * tab, so a holder of both types saw the same money twice and could reasonably read it as
 * twice as much.
 *
 * The split is recoverable exactly, without estimating:
 *
 *   1. `CommunityCredited` / `MfpCredited` tell us which transactions credited which type.
 *      The recipient list is in the calldata of those transactions, so a wallet's share of
 *      each credit is an exact figure, not an apportionment.
 *   2. `claim()` always zeroes the bucket. So everything credited after a wallet's last
 *      `RewardClaimed` is unclaimed, and everything before it has been claimed. No
 *      guesswork — the contract cannot leave a partial balance behind.
 *
 * Step 2 is what makes the per-type claimed figure exact rather than a proportional guess.
 *
 * The invariant `unclaimedCommunity + unclaimedMfp === claimable(wallet)` must hold. It is
 * checked on every response; when it fails the caller is told the split is unreliable and
 * shows the merged figure instead of a confident wrong one.
 *
 * The MIC pools need none of this: Community and MFP are separate contracts with their own
 * `Claimed(address indexed account, uint256)`, so the split is just which contract you read.
 */
import { Contract, Interface, JsonRpcProvider, id, formatUnits, Provider } from 'ethers'

/** Both USDT pools were deployed well after this; scanning from 0 is what Alchemy prefers. */
const FROM_BLOCK = 0

const CREDIT_IFACE = new Interface([
  'function creditCommunity(address[] recipients, uint256[] amounts)',
  'function creditMFP(address[] recipients, uint256[] amounts)',
])

const TOPIC = {
  communityCredited: id('CommunityCredited(uint256,uint256)'),
  mfpCredited: id('MfpCredited(uint256,uint256)'),
  rewardClaimed: id('RewardClaimed(address,uint256)'),
  claimed: id('Claimed(address,uint256)'),
}

export type RewardLedger = {
  /** Everything this wallet has ever been credited, claimed or not. */
  accumulated: string
  claimed: string
  unclaimed: string
}

const ZERO_LEDGER: RewardLedger = { accumulated: '0', claimed: '0', unclaimed: '0' }

const fmt = (v: bigint) => formatUnits(v, 18)

/** A wallet address padded to a 32-byte log topic. */
const asTopic = (wallet: string) => '0x' + wallet.toLowerCase().replace(/^0x/, '').padStart(64, '0')

/**
 * USDT pool, split by NFT type.
 *
 * Returns null when the split cannot be trusted — the caller must then show the merged
 * balance rather than a confident wrong one.
 */
export async function readUsdtLedger(
  provider: Provider,
  poolAddress: string,
  wallet: string,
): Promise<{ community: RewardLedger; mfp: RewardLedger } | null> {
  const pool = new Contract(
    poolAddress,
    ['function claimable(address) view returns (uint256)'],
    provider,
  )

  const [claimableNow, communityLogs, mfpLogs, claimLogs] = await Promise.all([
    pool.claimable(wallet) as Promise<bigint>,
    provider.getLogs({ address: poolAddress, topics: [TOPIC.communityCredited], fromBlock: FROM_BLOCK, toBlock: 'latest' }),
    provider.getLogs({ address: poolAddress, topics: [TOPIC.mfpCredited], fromBlock: FROM_BLOCK, toBlock: 'latest' }),
    provider.getLogs({ address: poolAddress, topics: [TOPIC.rewardClaimed, asTopic(wallet)], fromBlock: FROM_BLOCK, toBlock: 'latest' }),
  ])

  // Nothing has ever been credited to anyone. Common right after launch, and worth
  // returning early so a quiet pool costs no transaction fetches at all.
  if (communityLogs.length === 0 && mfpLogs.length === 0) {
    return { community: ZERO_LEDGER, mfp: ZERO_LEDGER }
  }

  // The block of this wallet's most recent claim. Credits at or before it are spent;
  // credits after it are still owed. `claim()` zeroes the bucket, so there is no third case.
  const lastClaimBlock = claimLogs.reduce((hi, l) => (l.blockNumber > hi ? l.blockNumber : hi), -1)

  const want = wallet.toLowerCase()

  /** This wallet's share of one credit transaction, read from its calldata. */
  async function shareOf(txHash: string): Promise<bigint> {
    const tx = await provider.getTransaction(txHash)
    if (!tx) return 0n
    let decoded
    try {
      decoded = CREDIT_IFACE.parseTransaction({ data: tx.data })
    } catch {
      return 0n // credited by some other path — not attributable to a wallet
    }
    if (!decoded) return 0n
    const recipients = decoded.args[0] as string[]
    const amounts = decoded.args[1] as bigint[]
    let mine = 0n
    // A recipient may legitimately appear more than once in a batch; sum, don't find.
    for (let i = 0; i < recipients.length; i++) {
      if (recipients[i].toLowerCase() === want) mine += amounts[i]
    }
    return mine
  }

  // Kept in wei throughout. Formatting to a decimal string and parsing back would lose
  // precision on large balances, and this total is checked against the contract below.
  async function tally(logs: Awaited<ReturnType<JsonRpcProvider['getLogs']>>) {
    const shares = await Promise.all(logs.map((l) => shareOf(l.transactionHash)))
    let accumulated = 0n
    let unclaimed = 0n
    logs.forEach((log, i) => {
      accumulated += shares[i]
      if (log.blockNumber > lastClaimBlock) unclaimed += shares[i]
    })
    return { accumulated, unclaimed }
  }

  const [community, mfp] = await Promise.all([tally(communityLogs), tally(mfpLogs)])

  // The split must add up to exactly what the contract says is owed. If it does not,
  // something credited this wallet by a path this function does not model, and every
  // per-type figure above is suspect. Say so rather than publish it.
  if (community.unclaimed + mfp.unclaimed !== claimableNow) return null

  const ledger = (t: { accumulated: bigint; unclaimed: bigint }): RewardLedger => ({
    accumulated: fmt(t.accumulated),
    claimed: fmt(t.accumulated - t.unclaimed),
    unclaimed: fmt(t.unclaimed),
  })

  return { community: ledger(community), mfp: ledger(mfp) }
}

/**
 * MIC pool. One contract per NFT type, so no attribution problem — `Claimed` is already
 * per wallet and the live `claimable()` is the rest.
 */
export async function readMicLedger(
  provider: Provider,
  poolAddress: string,
  wallet: string,
): Promise<RewardLedger> {
  const pool = new Contract(
    poolAddress,
    ['function claimable(address) view returns (uint256)'],
    provider,
  )

  const [unclaimed, logs] = await Promise.all([
    pool.claimable(wallet) as Promise<bigint>,
    provider.getLogs({ address: poolAddress, topics: [TOPIC.claimed, asTopic(wallet)], fromBlock: FROM_BLOCK, toBlock: 'latest' }),
  ])

  // `Claimed(address indexed account, uint256 amount)` — the amount is the whole data word.
  const claimed = logs.reduce((sum, l) => sum + BigInt(l.data), 0n)

  return {
    accumulated: fmt(claimed + unclaimed),
    claimed: fmt(claimed),
    unclaimed: fmt(unclaimed),
  }
}
