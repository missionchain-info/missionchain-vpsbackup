/**
 * The earliest block worth scanning for each contract's events.
 *
 * ## Why this exists
 *
 * Four log scans in the API ran `fromBlock: 0` — the whole chain, 115,600,000 blocks and
 * growing, on every call. Two of them fire on each load of the admin NFT Rewards page.
 * That is what exhausted the Alchemy monthly quota on 2026-08-12 and took the MIC order
 * book down with it, because the same key was the only endpoint several routes had.
 *
 * A floor is only ever a lower bound: a contract cannot have emitted an event before it
 * existed, so starting at its deploy block returns exactly the same logs.
 *
 * ## How these numbers were found
 *
 * Binary search on block TIMESTAMPS, taking the first block of the deploy date (UTC):
 *
 *   - the explorer's free tier no longer serves `getcontractcreation` for BSC
 *   - `eth_getCode` at a historical block is a state read, and the public dataseeds answer
 *     "missing trie node" — only an archive node has it, which is the dependency being
 *     reduced here
 *   - block headers are retained by every node, so searching them costs nothing
 *
 * Each value was verified to land on 00:00:00Z of its date. Start-of-day is deliberately
 * conservative: a floor that is slightly too low is merely slower, one that is too high
 * silently loses events.
 *
 * ## Adding a contract
 *
 * Record the block at deploy time — `deployedAtBlock` in the deployment JSON — rather than
 * re-deriving it later. None of the existing deployment files captured it, which is why
 * this had to be reconstructed from dates.
 */
export const DEPLOY_BLOCK: Record<string, number> = {
  // Phase-0 Genesis mainnet, 2026-05-06
  ClaimRewardsV2:         96_604_918,
  CommunityNFTv2:         96_604_918,
  MFPNFT:                 96_604_918,

  // Claim-based reward pools (NftRewardPoolV2), 2026-08-10
  CommunityNFTRewardPool: 115_021_055,
  MFPRewardPool:          115_021_055,

  // MIC ⇄ USDT marketplace, 2026-08-11
  P2PEscrowMIC:           115_213_006,

  // NFT marketplaces and member-claimed rank bonuses, 2026-08-12
  P2PEscrowNFT_MFP:       115_404_885,
  P2PEscrowNFT_Community: 115_404_885,
  RankBonusClaim:         115_404_885,
}

/**
 * Floor for a log scan. Unknown contract falls back to 0 — correct, just slow, and better
 * than silently starting after the events you were looking for.
 */
export function deployBlockOf(name: string): number {
  return DEPLOY_BLOCK[name] ?? 0
}
