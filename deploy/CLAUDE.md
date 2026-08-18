# MissionChain App — Web3 Monorepo

Smart contracts + DApp + backend API for MissionChain, a faith-based ecosystem on BSC.

## Tech Stack

Solidity 0.8.24 / Hardhat · Next.js 14 · Fastify · Prisma + PostgreSQL · Turborepo · npm 10

## Monorepo Layout

```
packages/contracts/   Solidity + Hardhat (tests, deploy scripts)
packages/sdk/         Shared ABIs, addresses, chain helpers
packages/db/          Prisma schema + migrations
apps/web/             DApp          → app.missionchain.io
apps/admin/           Admin console → admin.missionchain.io
apps/api/             Fastify API   → api.missionchain.io
```

The public landing site is a **separate** container (`missionchain.io`) outside this repo — never serve DApp content from it. See the `critical_deployment_rules` memory.

## Commands

```bash
npm run build
```

```bash
cd packages/contracts && npx hardhat test
```

```bash
cd packages/contracts && npx hardhat compile
```

Deploys use `--network bsc` / `bscTestnet`; hardhat reads the key from **`DEPLOYER_KEY`** (see `hardhat.config.ts`). Mainnet deploys run **from the VPS**, never locally, and only after a dry-run the Owner has approved.

## Contract Set — which version is current

Many contracts have V2/V5/V6/V7 successors living side by side in the tree. **Always check which one the deploy script uses before editing it or writing tests against it.**

**Phase-1 PreSale set — DEPLOYED to mainnet 2026-08-08, all 13 verified on BSCScan.**
`PreSale` `0xC4A6cd57DE0619daCDfD190E9A4D9682Ed78BE23` holds 315,000,000 MIC with
`active = false`; the menu entry is still `disabled`. Addresses live in
`packages/sdk/src/addresses.ts` — read them from there, never retype them.

Full runbook, blockers and the 21 role grants: `MISSIONCHAIN_PRESALE_DEPLOY_RUNBOOK.md` in the repo root. Read it before touching the deploy script.

**Live on mainnet, reused:** `MICToken` · `LockManager` · `TreasuryManager` · `MFPNFT` · `P2PEscrowMFP` · `SeedBudgetV5c`

**SEED is on its third contract. Read `SeedSaleV9` `0x5216c5C69FB899CC3De8Aa94165363153B5B589d`; never V7 or V8.**

| | Why it was replaced |
|---|---|
| `SeedSaleV7` `0xe4C1…0905` | 6-decimal prices against an 18-decimal token — package 3 sold 4,000,000 MIC for 0.00000001 USDT. Halted 2026-08-08, `totalSold` 0 |
| `SeedSaleV8` `0xD855…5B50` | Fixed the decimals but shipped with no whitelist. Never activated, now empty |
| **`SeedSaleV9`** | 18-decimal prices **and** a whitelist `buyPackage` actually reads. Holds 181,558,850 MIC, `active = false`, `whitelistRequired = true`, 0 wallets cleared |

The whitelist is load-bearing, not hygiene: SEED sells MIC at $0.0025 and the Pre-Sale at
$0.005, so an open SEED leaves nobody a reason to buy the Pre-Sale and the 315,000,000 MIC
sitting there would never move. Owner decision 2026-08-09.

**Superseded — do NOT build on these:**

| Superseded | Replaced by |
|---|---|
| `RewardDistributor` | `RewardDistributorV2` |
| `ClaimRewards` | `ClaimRewardsV2` |
| `PeriodicRewards`, `IncentivePool` | `ClaimRewardsV2` + `NFTRewardPool` |
| `CommunityNFT` (ERC-1155) | `CommunityNFTv2` (ERC-721, unique serial, on-chain SVG) |
| `SeedSale`/`V5`/`V6`/`V7`/**`V8`**, `SeedBudget`/`V5`/`V5b` | **`SeedSaleV9`**, `SeedBudgetV5c` |

`mining/NFTStaking.sol` is a **misnomer**: since April 2026 it is pure MIC staking (the filename was kept for compatibility). No NFT tier multipliers, no per-tier caps — weight is `amount × time-lock multiplier` only. NFT multipliers now apply to USDT reward-pool distribution instead.

**Lock multipliers were steepened 2026-08-05** to `30d ×1.0 · 90d ×1.6 · 180d ×2.6 · 360d ×5.0` (was 1/1.25/1.5/2). The flat old curve gave almost no reason to pick a long term, so stake would sit at 30 days and barely reduce sell pressure. Vesting-locked MIC can still be staked at the full multiplier, 360-day term only.

## MICE · MINING · SWAP (Phase 1, design frozen 2026-08-05)

Full spec: `docs/superpowers/specs/2026-08-05-mice-mining-swap-design.md`
Operating policy (non-negotiable, lives outside the contracts): `…/2026-08-05-economic-guardrails-operating-policy.md`

**This is a flow-management model, not a price-support model.** Control issuance, not price · shape participant behaviour, not market destiny · reward long-term alignment, not short-term extraction. Never build or document anything that reads as price targeting.

Three layers, one contract each. The Liquidity layer sits in the middle; the other two read from it and never from each other.

| Layer | Contract | Owns |
|---|---|---|
| Sales | `MICELicense` | sale · 72h activation · renewal/seat reuse · MIC burn |
| Liquidity | `LiquidityPoolV6` **(new, not written yet)** | AMM · virtual-reserve unwind · 7-day TWAP · sell fee · daily caps |
| Emission | `EmissionController` | `H` · `G` · price brake · 5-way split |

**Frozen parameters:**

```
MICE     $100/200/300/400/500 × 20,000 · 360 days every round · activates after 72h
         buyer pays 50% USDT + 50% MIC (their own, burned)
         MIC priced at min(spot, TWAP7d) read from V6 — never admin-set
SWAP     P₀ $0.01 · M₀ 50,000,000 MIC · virtual reserve $500,000, retires at U/2
         sells open day 30 · 5%/day quota · 1% of reserve per trade
         buy fee 0.3% · sell fee 0.3%–10% (MAX_FEE_BPS = 1000, hard constant)
MINING   E₀ 750,000 MIC/day · half-life 8 years
         E = E_base × D(t) × L(H) × W(t) × A(N)
         H* = 110 days · L = clamp(H/110, 0.02, 2.0), ±10%/day
         G = clamp(TWAP7d/TWAP30d, 0.25, 1.0) — price brake, damps only, never boosts
         split 59 / 25 / 10 / 5 / 1 (miners / staking / DAO / Community NFT / MFP-NFT)
```

**`H` is a liquidity-coverage measure, not a price measure.** It is "how many days of new emission the pool's USDT could absorb". It moves the *wrong way* when price crashes (lower price → each day's emission is worth less → H rises), so `G` and the emergency brake at 50% of P₀ are mandatory from day one, not a later phase.

**Five bugs in `MICELicense` must be fixed before anything else** — see spec §5. Two are model-breaking: `activeLicenses()` doesn't exist (so `EmissionController.dailyEmission()` reverts every call), and `totalMinted` never decreases (so renewals are blocked once 100,000 are minted, turning MICE into one-time revenue).

**`LiquidityPoolV5` (`0x3709…050a`) is dead architecture.** No withdrawal path of any kind, swap functions are `pure` reverts, not a proxy. Its 31.5M MIC can only ever leave by being burned. Never route the router's liquidity slice to it, never grant `DEPOSITOR_ROLE`. Fund V6 from `ListingReserveVault` instead (7-day withdrawal cooldown — start it early).

## Revenue Model V2 (2026-07) — all % of GROSS

`PreSale.buy` sends the **full gross** USDT to `RevenueRouter`; `MICELicense` sends the **whole USDT half** (the other half is paid in MIC by the buyer and burned). Either way nothing is taken off the top — the router splits six ways and the sale contract then calls `ReferralRegistry.distributeReferral()` so F1/F2 are paid out of the router's referral slice. Both sales feed the **same** Group-Volume ledger, so MICE and Pre-Sale volume combine for rank and group rewards.

```
Referral 10%  → ReferralRegistry (F1 7% + F2 3%; unspent → Milestones & Incentives)
Marketing 25% → RewardDistributorV2 → GV 9% · M&I 1.5% · Weekly 5.5% · Monthly 8% · Lucky 1%
Management 7.5% · DAO Treasury 12.5% · Listing Reserve 5% · Liquidity 40% (absorbs dust)
```

Referral is **fixed** at 1000 BPS; the other five buckets are DAO-adjustable and must sum to 9000.

**The 5% slice is `ListingReserve` `0x9e4f9472E3526635d0001f6986D5daBca72b7D7D`, not staking.** Staking was
dropped and `StakingReserve.sol` deleted; the router still calls the slice `reservedStaking` / `bpsStaking` /
`setReservedStaking()` because it is deployed at `0xf86b0cF9ce21250429b522Ed62a5B6b549539672` and its ABI
cannot change. `ListingReserve` **holds** the USDT for opening an external MIC market — it does not buy MIC
and runs no market operation; withdrawal is request → 24h → execute. Do not confuse it with
`ListingReserveVault` `0x2EE1…8f16`, a different contract that holds the listing **MIC**.

**Payout model:** GV / Weekly / Monthly / Lucky are **credited on-chain, then pulled by the user** via `claim()` (credited by `CREDITOR_ROLE`). Milestones & Incentives is DAO-distributed. Referral F1/F2 pays instantly on purchase.

## Vesting — Hybrid Token-Level Lock

Tokens go **directly to the user's wallet** and are restricted by `LockManager`, not held in escrow. `MICToken._update()` enforces `amount <= balanceOf(from) - lockedOf(from) - stakedOf(from)`. Users see one balance in MetaMask; the DApp splits it into Available / Vesting / Staked. There is no claim step — unlock is purely time-based.

Never reintroduce the old VestingManager pattern (tokens held in contract, user claims).

## Decimals — the second invariant

**BSC-USD `0x55d398326f99059fF775485246999027B3197955` is 18 decimals.** It is not the
6-decimal USDT from Ethereum. MIC is 18 too, so USDT↔MIC needs no shim at all.

Until 2026-08-08 the codebase said 6 in three places at once, and each one was a
different severity of the same mistake:

| Where | What it did |
|---|---|
| `PreSale.HARD_CAP = 1_575_000e6` | first buyer takes all **315,000,000 MIC for $0.000001575**, in one call |
| live `SeedSaleV7` packages `1_000e6`… | same shape, **already on mainnet** with 181,558,850 MIC — halted, tx `0xc931ff25…72613a` |
| `ReferralRegistry.TIER*_THRESHOLD` | a $25 order clears Legend; the whole GV ladder pays 9% flat |
| `LuckyDraw.WEEKLY_CAP = 5_000 * 10**6` | every draw pays out 0.000000005 USDT and sweeps the rest |
| `sdk/constants.ts USDT_DECIMALS = 6` | 35 call sites across api/web/admin off by 10¹² in both directions |

A second sweep on **2026-08-10** found five more. The first two are live:

| Where | What it did |
|---|---|
| live `P2PEscrowMFP` `MAX_PRICE_USDT = 1_000_000e6` | caps a listing at **$0.000001** — every realistic price reverts. `constant`, so **only a redeploy fixes it**. `nextOrderId` is 0, so nothing was lost |
| live `OperationalSalaryPoolV3`, via `onChainAdminWrites.ts` `* 10n ** 6n` | the one enrolled member's $5,000 weekly cap was written as **$0.000000005**. The comment on that line already said "18 decimals". Pool balance is 0, so no claim has been short-paid — **but the enrolment must be re-sent with `updateMember` after the API ships** |
| `MICELicense.getPriceForRound` `100 * 1_000_000` | a $100 licence for **$0.0000000001**. Written as a product, so every `e6` search slid past it. Not deployed |
| `deploy-mice-mining.ts` `OPENING_PRICE` / `VIRTUAL_RESERVE` | SWAP would have opened at $0.00000000001 with a $0.0000005 virtual reserve. Not run |
| `packages/sdk/*.ts` (root, not `src/`) | a Jun-23 duplicate tree holding `USDT_DECIMALS = 6` and dead PreSale/SeedSale addresses. `exports` points at `src/`, but `contracts/` and `api/` use `moduleResolution: "node"`, which ignores `exports` — one subpath import would have picked up the 6. **Deleted** |

**The test suite cannot catch this class of bug.** `decimals()` is metadata and takes no
part in transfer arithmetic, so a suite that mints `1000e6` and asserts `1000e6` passes
against any token. All 1295 tests were green the whole time. The defect lives in the gap
between a contract's constants and what a real wallet sends for "$1,000".

**A test must not restate the constant it is checking.** `MICELicense.test.ts` asserted
`100n * 1_000_000n` against a contract returning `100 * 1_000_000` — perfect agreement,
both wrong. Price expectations belong in dollars: `parseUnits("100", USDT_DECIMALS)`.

**Grep for the shape, not the spelling.** `100e6`, `100 * 1_000_000`, `10n ** 6n` and
`parseUnits(x, 6)` are the same defect; a search for any one of them misses the rest.

What holds the line now, and must not be removed:

- Every contract pricing in USD does `require(IERC20Metadata(_usdt).decimals() == 18)` in
  its constructor — `PreSale`, `ReferralRegistry`, `LuckyDraw`, `MICELicense`, `P2PEscrowMFP`.
- `test/DecimalsGuard.test.ts` deploys each against `MockUSDT6` and asserts it reverts.
  **A contract that prices in dollars goes into that list the day it is written.**
- `deploy-mice-mining.ts` reads `decimals()` in pre-flight, same as the PreSale script.
- `MockUSDT` is 18 decimals. **Do not lower it to make a test pass** — a test that only
  passes against a 6-decimal token does not describe production.
- `deploy-presale-phase1.ts` reads `decimals()` off the live token in pre-flight and
  blocks the run if it is not 18.
- Off-chain, import `USDT_DECIMALS` from `@missionchain/sdk`. Never `formatUnits(x, 6)`.

## The invariant that costs the most when broken

**A contract that can hold a token must be able to send that token.**

Two live contracts broke this and the loss is permanent:

| Contract | Amount | What happened |
|---|---|---|
| `LiquidityPool v5` `0x3709…050a` | 31,500,000 MIC | No withdrawal path; swap entry points are `pure` reverts. Its only exit was `swapAndBurnMIC` — **burned 2026-08-05**, tx `0xb2f0d013…4924b`. `totalSupply` 1,050,000,000 → **1,018,500,000** |
| `TreasuryManager v1` `0x1ed5…a42F` | 105,000,000 MIC | Declares only USDT. No MIC reference, no code that can approve a spender, not a proxy. Cannot be moved **or** burned. Unrecoverable |

Every contract in the PreSale set now carries `rescueToken`, and `test/RescuePaths.test.ts` fails if a new one arrives without it. The rule is applied per contract, not uniformly:

- **Pass-through** (`ReferralRegistry`, `RewardDistributorV2`, `RevenueRouter`, `CommunityNFTv2`) — nothing rests there by design, so rescue reaches everything including USDT.
- **Holds user money** (`ListingReserve`, `ManagementPool`, `NFTRewardPool`) — rescue **refuses USDT**. An admin path to money owed to someone else is a worse defect than a stranded token.

`TreasuryManager v1` still receives the 12.5% DAO Treasury slice **in USDT**, which works fine. Only its MIC is stuck. `TreasuryManagerV2` + `ChurchesVault` ship with the MICE·MINING·SWAP batch, not with PreSale.

## Governance — what the contract actually enforces

`DAOGovernor` `0xDCD65DC97b0A147BeCf542E22a5C218C006231cC` is deployed and immutable.

- **`BTC_QUORUM = 3` for every proposal.** The proposer auto-approves, so two further signatures carry it. There is no per-class quorum.
- **Steward Council votes by head.** No token weight, no stake weight, anywhere in the contract. Owner decision 2026-08-07.
- Timelock by category: PARAMETER 24h · BUDGET 24h · STRUCTURAL 7d · EMERGENCY 0.
- **The timelock runs from `createdAt`, not from reaching quorum.**

The old published figures (≥4/5, 5/5, "dual approval with ≥75% staked MFP weight") were never implemented. Documents were aligned to the contract on 2026-08-06/07 — spec v1.2 and all five White Papers. Do not reintroduce them.

`PreSale.DAO_ROLE` is granted to DAOGovernor so the Council, not the deployer, decides what happens to an unsold round.

The unsold guard is `block.timestamp >= saleStart + UNSOLD_LOCK || (everActivated && !active)`. **`everActivated` is not optional** — `active` is also false at deploy, so gating on `!active` alone would let the Council empty a round that never opened.

## Critical Conventions

- **Never** commit `.env` or anything containing keys. Mainnet private keys live only on the VPS.
- **Never** grant `MINTER_ROLE` to anything but `EmissionController` — 85% of supply is minted progressively, never pre-minted.
- **Never** add referral logic to SEED (Pre-Sale and MICE only).
- **Never** change a tokenomics number in one place — the same figure appears across contracts, apps, docs and translations.
- Use `AccessControl` (not `Ownable`), OpenZeppelin `SafeERC20`, and `ReentrancyGuard` on anything making external calls.
- **USDT and MIC are BOTH 18 decimals.** Never write the digit — import `USDT_DECIMALS` from the SDK. See the decimals section below.
- Emit an event for every state change — the indexer depends on them.

## Gotchas

- **Router sinks must be contracts.** `RevenueRouter` *calls* `receiveUSDT()` / `receiveAndDistribute()` on its targets, so EOAs revert. Tests use `mock/MockRewardReceiver.sol`. Only the referral slice is a plain token push.
- **Locked MIC staking requires the 360-day lock period** — anything shorter reverts.
- **`NFTStaking` unstaking is capped at 10% of the pool per day**, so a lone staker can never withdraw; tests need a second "whale" stake to make the position withdrawable.
- **The test suite shares one chain clock.** Integration tests warp months or years forward, so never use an absolute calendar timestamp in a test — derive it from `await time.latest()`.
- **Paths containing `(dashboard)`** break older macOS rsync — `scp` to `/tmp`, then `cp` on the VPS.
- Local `missionchain/` has **diverged from the VPS** in places. Diff before pushing, and push individual files rather than bulk-syncing.
- **`apps/web` local is broken; the VPS copy is the good one.** Three files drift (`ConnectButton.tsx`, `MobileWalletSheet.tsx`, `network/page.tsx`) and local is missing `app/feeds/page.tsx` entirely.
- **Editing `/opt/missionchain/deploy` does not change what runs.** `mc-api`, `mc-app` and
  `mc-admin` all serve from baked images with **no bind mounts** — a `docker compose
  restart` reboots the old code and looks like a successful deploy. On 2026-08-09 a
  security fix appeared to ship and did not; the giveaway was `docker exec mc-api ls -l
  apps/api/src/routes/sales.ts` showing a June date. Always rebuild the image, then
  `docker compose up -d <svc>`, then check a file date or a known string **inside** the
  container.
- **`mc-admin` has no `build:` at all** — only `image: mc-admin:latest`, so
  `docker compose build` silently skips it. Run `npm run build` in `apps/admin`, then
  `docker build -t mc-admin:latest .` from that directory.
- **The local Prisma schema has been behind the VPS.** On 2026-08-09 it was missing the
  whole `FeedItem` model while production held rows — pushing it and running `db push`
  would have dropped the table. Diff `packages/db/prisma/schema.prisma` against the VPS
  before touching it, and treat the VPS as authoritative.
- **Free RPC endpoints refuse old receipts.** Both publicnode hosts answer
  `eth_getTransactionReceipt` with "Archive requests require a personal token", and the
  Alchemy key hit its monthly cap on 2026-08-09. Anything reading a receipt should try a
  list — the Binance dataseed hosts serve them without a key.
- **Local `contracts/treasury/ListingReserveVault.sol` differs from mainnet.** Local uses `owner`/`onlyOwner`; the deployed one uses AccessControl. Calling `owner()` reverts.
- **BSC-USD (`0x55d3…7955`) is 18 decimals, not 6.** This line sat here, correct, while
  the contracts and the SDK all said 6 — a true note in the docs stops nothing on its own.
  The guards described under "Decimals" are what actually enforce it.
- **Regenerate the SDK ABI after changing a contract.** `EmissionController` kept a stale `roiFactor` in `packages/sdk/src/abis/` long after the function was removed; the API called it and `.catch()` hid the failure behind a plausible 1.00.

## Where the details live

- System architecture — `docs/SYSTEM-ARCHITECTURE-FULL.md`
- Tokenomics numbers — the Whitepaper plus `docs/MissionChain_Tokenomics.xlsx` in the repo root (`Mission Chain Fullstack/`)
- PreSale deploy plan — `missionchain/deploy/PRESALE_PHASE1_DEPLOY_PLAN.md`
- Governance — `MissionChain_Governance_Spec_v1.2.html` in the repo root
- Live addresses, infra state and pending work — the handoff docs in the repo root, and the project memory files
