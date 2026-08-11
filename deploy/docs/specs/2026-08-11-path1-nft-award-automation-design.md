# Path 1 Community NFT awards — automated minting

**Date:** 2026-08-11
**Status:** Approved by Owner, pending implementation
**Network:** BSC mainnet (chainid 56)
**Owner decisions:** full automation via keeper · admin-only alerting · backfill every rank passed · live immediately, capped

---

## 1. Problem

"Path 1" Community NFT awards — referral milestones (3/5/10 qualifying F1) and Community
Growth Award rank bonuses — were believed to mint automatically when a member meets the
KPI. They do not. Nothing in the platform calls `ClaimRewardsV2.mintMilestoneNFT` or
`mintRankBonus` except a manual button in the admin console.

The belief is written into the code itself. `apps/api/src/routes/community-grants.ts:6`
states:

> Path 1 — hit a KPI, the contract mints automatically. […] The NFT lands in the wallet
> the moment the condition is met.

That comment is the origin of the assumption and is false.

### 1.1 Corrections to the initial report

The investigation that opened this work contained one material error and missed three
things that matter more.

**`CREDITOR_ROLE` is NOT unassigned.** The original scan covered only the last 400,000
blocks. The grant sits at block **114760407** (2026-08-08 15:24 UTC); head at time of
verification was **115269232** — roughly **509,000 blocks back**, just outside the window.

A full-range `RoleGranted` scan on `ClaimRewardsV2`
(`0x1F38FD97a656d80bF873ca2B9262D9EB337E6866`) returns four grants:

| Role | Holder | Block |
|---|---|---|
| `DEFAULT_ADMIN_ROLE` | `0xD32e666381b56f979D60C57831838f05F33AD6c2` (Owner) | 114760354 |
| `DISTRIBUTOR_ROLE` | `0xDB4Cc75cdD3081557cB68d6dF456df3a1C31cab3` | 114760400 |
| *(unidentified `0xeb1049d6…`)* | `0x2a8C0c5c7414fD4f879ba34883652f306403f0f9` | 114760403 |
| **`CREDITOR_ROLE`** | **`0x2CE92C65650d7890fFBE0e1E853d6d3f53274753`** | **114760407** |

`RoleRevoked` events: **0**. Direct call `hasRole(CREDITOR_ROLE, 0x2CE9…4753)` → `true`.
The wallet holds 0.05 BNB and has **nonce 0** — provisioned on the Aug 8 rotation, never
used. The manual admin button therefore works today for whoever connects that wallet.

**The admin page already pre-checks the role.** `apps/admin/app/(dashboard)/nft-rewards/page.tsx:114-119`
calls `hasRole` before signing and throws a readable error. It does not name *which*
wallet holds the role, which is why the role looked unassigned.

**Rank bonuses have no owed-list at all.** Milestones get a computed proposals feed from
`GET /admin/nft-rewards/milestones`. `mintRankBonus` is driven by a free-text wallet box
and a dropdown. Nothing anywhere tells an operator that a rank was reached. This is the
larger hole and the automation must close it.

**Server-side signing is already the posture.** `rewardKeeper` runs hourly as
`0x2D5bd60Eefb96a8Fc4c67C4321502b3c347e8054` and signs `creditCommunity` / `creditMFP` on
mainnet. Production logs show it reaching the *business* check
(`"NFTRewardPool: insufficient mfp"`), so it passes authorisation. Granting that wallet
`CREDITOR_ROLE` does not breach a boundary that is still intact.

### 1.2 Current exposure

Nothing has been lost. On-chain: `MilestoneNFTMinted` **0 events**, `CommunityNFTMinted`
**0 events**, `CommunityNFTv2.totalSerials()` **0**. The database holds **one** confirmed
purchase — the $25 PreSale canary — against a `QUALIFYING_PURCHASE_USDT` threshold of
$100, so **zero** members currently qualify for anything.

This is a pre-launch gap, not an active incident. It can be built and proven against a
zero-pending baseline.

---

## 2. The blocking defect

Automation cannot be switched on before this is fixed.

**The contract has no dedupe.** `ClaimRewardsV2.mintMilestoneNFT` validates only
`user != address(0)` and `milestoneIndex < 3`. `mintRankBonus` validates only
`quantity > 0 && quantity <= MAX_RANK_BONUS_BATCH`. Neither records what it has already
minted. The contract states this deliberately:

> Rank eligibility is computed off-chain by the reward engine and approved before this is
> called; the contract does not track ranks.

Calling either function twice mints twice. **The entire double-mint guard is off-chain
code** — the exact code being automated.

**That guard is currently broken.** The event declares only one indexed parameter:

```solidity
event MilestoneNFTMinted(address indexed user, uint256 tier, uint256 tokenId);
```

`tier` and `tokenId` are in `data`, not `topics`. `topics[2]` does not exist. But
`apps/api/src/routes/nft-rewards.ts:118-124` reads:

```ts
const tier = Number(BigInt(log.topics[2] ?? '0x0'))  // always 0
const index = tierToIndex.get(tier)                   // always undefined
if (index === undefined) continue                     // every prior mint skipped
```

`alreadyMinted` is therefore always empty and `proposeMilestones` re-proposes everything.
Read-only and with zero mints on chain, this is invisible today. Driven by a keeper it
re-mints every earned milestone on **every tick**, irreversibly and without bound.

The adjacent `CommunityNFTMinted` read is correct — that event indexes both `to` and
`tokenId`.

**Fix the guard, prove it with tests, then grant the role.** That order is not negotiable.

---

## 3. Design

### 3.1 New shared modules

**`apps/api/src/services/rewardEngine/mintedHistory.ts`** — chain-read, correct decoding.

- `readMintedMilestones(provider, claimAddress)` → `Map<wallet, Map<milestoneIndex, count>>`.
  Decodes `tier` and `tokenId` from `data` via the ABI coder, not from `topics`.
- `readMintedRankBonuses(provider, claimAddress)` → `Map<wallet, Set<RankName>>`.

Rank identity is recovered from the `(tier, quantity)` pair, which is unique across all
five ranks:

| Rank | tier | quantity |
|---|---|---|
| Builder | 1 | 3 |
| Connector | 2 | 3 |
| Champion | 3 | 3 |
| Ambassador | 3 | 5 |
| Legend | 3 | 10 |

The three tier-3 ranks are separated only by quantity. This is recorded as a known
fragility: if the White Paper ever gives two ranks the same `(tier, quantity)`, this
decoding breaks and rank idempotency must move to a dedicated on-chain event or a
contract change. A unit test asserts the five pairs remain distinct.

**`apps/api/src/services/rewardEngine/ranks.ts`** — pure, testable.

- `RANK_BONUS` — the canonical table above, relocated from the admin page so there is one
  source of truth. The admin page imports it rather than redeclaring it.
- `proposeRankBonuses(awards, alreadyMinted)` → one proposal per (wallet, unpaid rank).

Ranks come from the existing `buildGvTree` / `calculateGvAwards` in `rewardEngine/gv.ts`,
using each award's `.rank` only (the monetary fields are not used here). Thresholds are
cumulative group volume, from `GV_RANKS` in `rewardEngine/tiers.ts`.

**Backfill semantics (Owner decision):** a member receives the batch for **every rank they
have passed**, each once. A member who jumps straight to Champion receives Builder,
Connector and Champion batches. This keeps a fast climber and a slow climber at the same
rank holding the same NFTs. Because group volume is cumulative and never decreases, a rank
once reached is never un-reached, so "passed" is simply every rank at or below current.

### 3.2 The keeper

**`apps/api/src/services/nftAwardKeeper.ts`**, started alongside `rewardKeeper` in
`apps/api/src/index.ts` (~line 187), under the existing `KEEPER_PK` guard and reusing
`getKeeperSigner()` from `rewardKeeper.ts`.

Each tick:

1. **Preflight.** Verify the keeper holds `CREDITOR_ROLE`; verify `ClaimRewardsV2` holds
   `MINTER_ROLE` on `CommunityNFTv2`; verify keeper BNB is above a gas floor. Any failure
   → log, write an audit row, hold. Never proceed partially.
2. **Read history from chain.** Both maps, fresh, every tick. Never from the database.
3. **Compute owed.** Milestones via existing `qualifyingF1Counts` + `proposeMilestones`;
   ranks via the new `proposeRankBonuses`.
4. **Apply the cap.** At most `NFT_AWARD_MAX_PER_TICK` mints (default 25). The remainder
   waits for the next tick.
5. **Mint sequentially,** awaiting each receipt. If any transaction fails, abort the tick
   and re-read history next time rather than continuing against a stale map.
6. **Audit** every mint and every held tick.

### 3.3 Safety rails

Minting is irreversible, so the controls are deliberately heavier than the volume warrants
today.

- **Two-level enable.** `NFT_AWARD_KEEPER_ENABLED` (env, default `false`) decides whether
  the keeper starts at all; a `SystemConfig` row decides whether a started keeper mints or
  only observes. The env flag keeps it inert on first deploy; the SystemConfig row is the
  runtime kill switch, changeable without a redeploy.
- **Dry-run mode** — computes and logs the full owed-list, signs nothing. This is the state
  a started-but-not-armed keeper sits in.
- **Per-tick cap**, default 25, so a computation error cannot run away.
- **Chain-derived idempotency**, re-read every tick.
- **Preflight gating**, as above.
- **Sequential minting** with per-transaction receipts.

**Cutover (Owner decision):** the keeper goes **live immediately once the role is granted**,
bounded by the per-tick cap. This is low-risk today precisely because zero members qualify —
the first ticks will compute an empty list and mint nothing, which is itself the proof that
the idempotency fix works. Dry-run mode remains available as an operational tool.

### 3.4 Alerting — admin only

Members are told nothing until an NFT lands in their wallet. No pending-award notification
is sent, so no promise is made that a delayed mint could break.

Every mint, every skipped tick and every preflight failure writes to `adminAuditLog` via
the existing `auditLog()` helper in `apps/api/src/plugins/rbac.ts`, with
`adminWallet` set to the keeper address and a distinct `action` per event type.

### 3.5 API and admin console

`apps/api/src/routes/nft-rewards.ts`:
- Milestone endpoint switches to the shared `mintedHistory` module — fixing the decode bug
  at its source.
- **New** `GET /admin/nft-rewards/ranks` — the owed-list that does not exist today.
- **New** `GET /admin/nft-rewards/keeper` — mode, last run, last error, pending counts.

`apps/admin/app/(dashboard)/nft-rewards/page.tsx`:
- Keeper status card.
- Ranks-owed table, replacing blind free-text entry as the primary path.
- Manual buttons retained as fallback; the role error names `0x2CE9…4753` explicitly.
- Imports `RANK_BONUS` from the shared module instead of redeclaring it.

### 3.6 Documentation corrections

The false "mints automatically" comments in `community-grants.ts` and `nft-rewards.ts` are
rewritten to describe what actually happens. Leaving them is what caused this.

---

## 4. Owner on-chain action

To be signed by the Owner from `0xD32e666381b56f979D60C57831838f05F33AD6c2`
(holds `DEFAULT_ADMIN_ROLE`) **after** the fix is deployed and verified:

```
ClaimRewardsV2.grantRole(role, account)
  contract: 0x1F38FD97a656d80bF873ca2B9262D9EB337E6866
  role:     0xbe74a168a238bf2df7daa27dd5487ac84cb89ae44fd7e7d1e4b6397bfe51dcb8  (CREDITOR_ROLE)
  account:  0x2D5bd60Eefb96a8Fc4c67C4321502b3c347e8054                          (keeper)
```

`0x2CE92C65650d7890fFBE0e1E853d6d3f53274753` retains the role as break-glass. No contract
is deployed or upgraded. The grant is revocable by the Owner at any time and is the
outermost kill switch.

---

## 5. Testing

TDD, extending `apps/api/src/services/rewardEngine/rewardEngine.test.ts`:

1. **Event decoding** — `MilestoneNFTMinted` and `RankBonusNFTMinted` parsed from realistic
   log shapes; a regression test asserting a one-indexed-parameter event is never read from
   `topics[2]`.
2. **Rank pair uniqueness** — the five `(tier, quantity)` pairs are distinct.
3. **Rank proposals** — backfill across a multi-rank climb; the tier-3 Champion / Ambassador
   / Legend collisions resolve correctly.
4. **Idempotency** — given history reflecting a first tick, a second tick proposes
   **nothing**. This is the test that would have caught the blocking defect.
5. **Cap** — an owed-list larger than the cap yields exactly `cap` mints and leaves the rest.

---

## 6. Sequence

1. Write tests; fix `mintedHistory` decoding; build the shared modules.
2. Build the keeper and the API/admin surfaces.
3. Deploy to VPS with `NFT_AWARD_KEEPER_ENABLED=false`. Confirm the milestone and new rank
   endpoints both report **0 pending** against the known-zero baseline.
4. Set `NFT_AWARD_KEEPER_ENABLED=true` with the SystemConfig row unarmed. Confirm one
   dry-run tick logs an empty owed-list and a clean preflight — except `CREDITOR_ROLE`,
   which is expected to fail until step 5.
5. Owner grants `CREDITOR_ROLE` to the keeper.
6. Arm the SystemConfig row. Keeper is live and capped; confirm preflight now passes and it
   mints nothing while no member qualifies.
7. Re-verify at PreSale open, when real qualifying volume first appears.

---

## 7. Out of scope

**`rewardKeeper` weekly and monthly credit have been failing every hour** with
`execution reverted: "NFTRewardPool: insufficient mfp"`. Unrelated to Path 1 and not
addressed here, but it is a live production error and needs its own investigation.
