/**
 * ─────────────────────────────────────────────────────────────────────────────
 * MISSION CHAIN — PreSale Phase 1 Deploy (Revenue Model V2, revised 2026-07)
 * ─────────────────────────────────────────────────────────────────────────────
 * Deploys 12 contracts, applies 21 role grants plus one setter, and funds PreSale
 * with 315M MIC. The 105M liquidity transfer is behind CONFIG.FUND_LIQUIDITY_105M
 * and is OFF by default.
 * Does NOT activate the sale (PreSale.active stays false) and does NOT show it on
 * the frontend — those are deliberate manual final steps.
 *
 * SAFETY: dry-run by default. It only prints the plan unless EXECUTE=1 is set.
 *   Review:   npx hardhat run scripts/deploy-presale-phase1.ts --network bsc
 *   Execute:  EXECUTE=1 npx hardhat run scripts/deploy-presale-phase1.ts --network bsc
 *
 * All contracts get DEFAULT_ADMIN_ROLE = the deployer (Owner wallet, Phase 1 Minimal).
 * Move admin to DAOGovernor later for full DAO governance.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { ethers } from "hardhat"
import fs from "fs"
import path from "path"

// ── Existing mainnet dependencies (reused, already deployed) ──────────────────
const MAINNET = {
  USDT:            "0x55d398326f99059fF775485246999027B3197955",
  MIC:             "0xf27ec0c311728b923b22828002c992c799326182",
  LockManager:     "0x6bE58BCe62f526E7751e121CDBa1eb22873471A0",
  TreasuryManager: "0x1ed5C848D1244a618Bd95Ff92d4f8C2356d3a42F", // 12.5% DAO Treasury (live)
  DAOGovernor:     "0xDCD65DC97b0A147BeCf542E22a5C218C006231cC", // for later admin handover
}

// ── CONFIG — MUST review/fill before EXECUTE ─────────────────────────────────
const CONFIG = {
  // Deposits MIC into LiquidityPool (DEPOSITOR_ROLE). Owner wallet.
  OPERATOR: "0xD32e666381b56f979D60C57831838f05F33AD6c2",

  // Reward-engine hot wallet (CREDITOR_ROLE): credits GV / Weekly / Monthly, mints
  // milestone NFTs, and commits+reveals the Lucky Draw. Owner-provided 2026-08-08.
  //
  // Deliberately SEPARATE from OPERATOR: this key signs unattended from the backend, so
  // it is kept away from the Owner wallet. It holds no funds and cannot move money out —
  // it only allocates what is already in the pools — and DEFAULT_ADMIN can revoke it at
  // any time if it is ever compromised. Fund it with a little BNB for gas only.
  //
  // Replaces 0xa76c8433…35E4A9a4, which was an account of the same seed phrase as the
  // Owner wallet and became unreachable when that phrase was lost. It never transacted
  // (nonce 0) and held no role, so nothing moved with it. The replacement is from its
  // OWN seed on purpose: MetaMask derives accounts at m/44'/60'/0'/0/x, which is
  // non-hardened, so a hot key that lives on a server should never be a sibling of the
  // key holding the treasury.
  CREDITOR: "0x2CE92C65650d7890fFBE0e1E853d6d3f53274753",

  // ManagementPool: 6 leadership wallets (Founder, Architect, CTO, Social, Training, Tech).
  // Owner wallet placeholder for all 6 now; Owner reassigns each later via
  // ManagementPool.setRoleAddress(index, wallet) (DEFAULT_ADMIN_ROLE). Bonus 33% = DAO.
  MGMT_ROLE_WALLETS: [
    "0xD32e666381b56f979D60C57831838f05F33AD6c2", // Founder
    "0xD32e666381b56f979D60C57831838f05F33AD6c2", // Architect
    "0xD32e666381b56f979D60C57831838f05F33AD6c2", // CTO
    "0xD32e666381b56f979D60C57831838f05F33AD6c2", // Social Media
    "0xD32e666381b56f979D60C57831838f05F33AD6c2", // Global Training
    "0xD32e666381b56f979D60C57831838f05F33AD6c2", // Tech Team
  ] as string[],

  // PreSale funding: 315M MIC transferred from the deployer wallet (holds exactly 315M).
  PRESALE_MIC: ethers.parseUnits("315000000", 18),

  // NFTRewardPool community-share BPS (remainder = MFP slice)
  WEEKLY_COMMUNITY_BPS: 9091,  // Community NFT 5% / 5.5%
  MONTHLY_COMMUNITY_BPS: 9375, // Community NFT 7.5% / 8%

  // Liquidity 105M MIC listing allocation: leave OFF unless confirmed the 105M is in the
  // deployer wallet (it may already sit in LiquidityPoolV5). Verify before enabling.
  FUND_LIQUIDITY_105M: false,
  LIQUIDITY_MIC: ethers.parseUnits("105000000", 18),
}

const EXECUTE = process.env.EXECUTE === "1"
const out: Record<string, string> = {}

async function main() {
  const [deployer] = await ethers.getSigners()
  const net = await ethers.provider.getNetwork()
  const admin = deployer.address // Owner wallet (Phase 1 Minimal)

  console.log("══════════════════════════════════════════════════════════")
  console.log("  MISSION CHAIN — PreSale Phase 1 Deploy (V2)")
  console.log("══════════════════════════════════════════════════════════")
  console.log("Network :", net.chainId.toString())
  console.log("Deployer:", deployer.address)
  console.log("Admin   :", admin, "(all contracts, Phase 1 Minimal)")
  console.log("BNB bal :", ethers.formatEther(await ethers.provider.getBalance(deployer.address)))
  console.log("Mode    :", EXECUTE ? "🚀 EXECUTE (broadcasts txs)" : "🧪 DRY-RUN (plan only, no txs)")
  console.log("")

  // ── Pre-flight validation ──────────────────────────────────────────────────
  const problems: string[] = []
  if (net.chainId !== 56n) problems.push(`Not BSC mainnet (chainId ${net.chainId}). Use --network bsc.`)
  if (CONFIG.OPERATOR === ethers.ZeroAddress) problems.push("CONFIG.OPERATOR not set.")
  if (CONFIG.CREDITOR === ethers.ZeroAddress) problems.push("CONFIG.CREDITOR not set.")
  if (CONFIG.CREDITOR.toLowerCase() === CONFIG.OPERATOR.toLowerCase()) problems.push("CONFIG.CREDITOR must be a separate hot wallet, not the Owner wallet.")
  if (CONFIG.MGMT_ROLE_WALLETS.some(a => a === ethers.ZeroAddress)) problems.push("CONFIG.MGMT_ROLE_WALLETS has zero addresses.")

  // 35 transactions in all. Running out of gas mid-run leaves the set half-wired, which
  // is far more painful to unpick than refusing to start.
  const MIN_BNB = ethers.parseEther("0.1")
  const bnbBal = await ethers.provider.getBalance(deployer.address)
  if (bnbBal < MIN_BNB) {
    problems.push(`BNB ${ethers.formatEther(bnbBal)} is below the ${ethers.formatEther(MIN_BNB)} floor for a 35-transaction run — top up first.`)
  }

  // Every price in this batch is written in 18 decimals because BSC-USD is an 18-decimal
  // token. Deploying against anything else silently rewrites the whole price list — the
  // defect that had to be halted on live SeedSaleV7 on 2026-08-08. The contracts refuse
  // it in their constructors; this check reports it before spending gas to find out.
  try {
    const usdtMeta = await ethers.getContractAt("IERC20Metadata", MAINNET.USDT)
    const dec = await usdtMeta.decimals()
    console.log("USDT decimals        :", dec.toString(), Number(dec) === 18 ? "✓" : "✗ EXPECTED 18")
    if (Number(dec) !== 18) problems.push(`USDT at ${MAINNET.USDT} reports ${dec} decimals; every price constant assumes 18.`)
  } catch {
    problems.push("Could not read USDT decimals — refusing to guess.")
  }
  const micToken = await ethers.getContractAt("IERC20", MAINNET.MIC)
  const deployerMic = await micToken.balanceOf(deployer.address)
  if (deployerMic < CONFIG.PRESALE_MIC) problems.push(`Deployer holds ${ethers.formatUnits(deployerMic,18)} MIC < 315M needed for PreSale.`)

  // CRITICAL: Phase 2 grants roles on EXISTING TreasuryManager + LockManager.
  // The deployer must hold their DEFAULT_ADMIN_ROLE, else those grants revert.
  let treasuryAdminOK = false, lockAdminOK = false
  try {
    const t = await ethers.getContractAt("TreasuryManager", MAINNET.TreasuryManager)
    treasuryAdminOK = await t.hasRole(await t.DEFAULT_ADMIN_ROLE(), deployer.address)
  } catch { /* ignore on non-mainnet */ }
  try {
    const l = await ethers.getContractAt("LockManager", MAINNET.LockManager)
    lockAdminOK = await l.hasRole(await l.DEFAULT_ADMIN_ROLE(), deployer.address)
  } catch { /* ignore */ }
  if (net.chainId === 56n && !treasuryAdminOK) problems.push("Deployer is NOT admin of live TreasuryManager — cannot grant DISTRIBUTOR to router. (Grant via current admin / DAOGovernor.)")
  if (net.chainId === 56n && !lockAdminOK) problems.push("Deployer is NOT admin of live LockManager — cannot grant SCHEDULE_CREATOR to PreSale.")

  console.log("── Pre-flight ──")
  console.log("Deployer MIC balance :", ethers.formatUnits(deployerMic, 18))
  console.log("TreasuryManager admin:", treasuryAdminOK ? "✓ deployer" : "✗ NOT deployer")
  console.log("LockManager admin    :", lockAdminOK ? "✓ deployer" : "✗ NOT deployer")
  if (problems.length) {
    console.log("\n⚠️  BLOCKERS (fix before EXECUTE):")
    problems.forEach(p => console.log("   ✗", p))
  } else {
    console.log("✓ pre-flight OK")
  }
  console.log("")

  if (!EXECUTE) {
    console.log("── DEPLOY PLAN (dry-run) ──")
    printPlan(admin)
    console.log("\n🧪 DRY-RUN complete — no transactions sent. Set EXECUTE=1 to broadcast.")
    return
  }
  if (problems.length) { console.log("❌ Aborting: fix blockers above."); process.exit(1) }

  // ═══════════════ PHASE 1 — DEPLOY (dependency order) ═══════════════
  const deploy = async (name: string, args: any[]) => {
    const F = await ethers.getContractFactory(name)
    const c = await F.deploy(...args)
    await c.waitForDeployment()
    const addr = await c.getAddress()
    out[name] = addr
    console.log(`  ✓ ${name.padEnd(22)} ${addr}`)
    return c
  }
  console.log("── PHASE 1: deploy ──")
  const cnft     = await deploy("CommunityNFTv2", [admin])
  const registry = await deploy("ReferralRegistry", [MAINNET.USDT, admin])
  const claim    = await deploy("ClaimRewardsV2", [MAINNET.USDT, await cnft.getAddress(), admin])
  const weekly   = await deploy("NFTRewardPool", [MAINNET.USDT, admin, "Weekly Growth", CONFIG.WEEKLY_COMMUNITY_BPS])
  const monthly  = await deploy("NFTRewardPool", [MAINNET.USDT, admin, "Monthly Community", CONFIG.MONTHLY_COMMUNITY_BPS])
  const lucky    = await deploy("LuckyDraw", [MAINNET.USDT, admin])
  const distrib  = await deploy("RewardDistributorV2", [MAINNET.USDT, await claim.getAddress(), await weekly.getAddress(), await monthly.getAddress(), await lucky.getAddress(), admin])
  const staking  = await deploy("ListingReserve", [MAINNET.USDT, admin])
  const mgmt     = await deploy("ManagementPool", [MAINNET.USDT, CONFIG.MGMT_ROLE_WALLETS, admin])
  const liq      = await deploy("LiquidityPool", [MAINNET.USDT, MAINNET.MIC, admin])
  const router   = await deploy("RevenueRouter", [
    MAINNET.USDT, await registry.getAddress(), await distrib.getAddress(),
    await mgmt.getAddress(), MAINNET.TreasuryManager, await staking.getAddress(),
    await liq.getAddress(), admin,
  ])
  const presale  = await deploy("PreSale", [
    MAINNET.USDT, MAINNET.MIC, MAINNET.LockManager, await cnft.getAddress(),
    await registry.getAddress(), await router.getAddress(), admin,
  ])

  // ═══════════════ PHASE 2 — WIRE ROLES ═══════════════
  console.log("\n── PHASE 2: wire roles ──")
  const R = async (label: string, fn: Promise<any>) => { const tx = await fn; await tx.wait(); console.log("  ✓", label) }
  const role = async (c: any, name: string) => c[name]()

  // CommunityNFTv2 — PreSale + ClaimRewards can mint
  await R("CommunityNFTv2.MINTER → PreSale", cnft.grantRole(await role(cnft, "MINTER_ROLE"), await presale.getAddress()))
  await R("CommunityNFTv2.MINTER → ClaimRewardsV2", cnft.grantRole(await role(cnft, "MINTER_ROLE"), await claim.getAddress()))
  // ReferralRegistry — PreSale is caller; overflow pool = ClaimRewardsV2
  await R("ReferralRegistry.CALLER → PreSale", registry.grantRole(await role(registry, "CALLER_ROLE"), await presale.getAddress()))
  await R("ReferralRegistry.setIncentivePool(ClaimRewardsV2)", registry.setIncentivePool(await claim.getAddress()))
  // ClaimRewardsV2 — distributor + overflow + creditor
  await R("ClaimRewardsV2.DISTRIBUTOR → RewardDistributorV2", claim.grantRole(await role(claim, "DISTRIBUTOR_ROLE"), await distrib.getAddress()))
  await R("ClaimRewardsV2.OVERFLOW → ReferralRegistry", claim.grantRole(await role(claim, "OVERFLOW_ROLE"), await registry.getAddress()))
  await R("ClaimRewardsV2.CREDITOR → CREDITOR wallet", claim.grantRole(await role(claim, "CREDITOR_ROLE"), CONFIG.CREDITOR))
  // NFTRewardPools — distributor + creditor
  for (const [nm, pool] of [["Weekly", weekly], ["Monthly", monthly]] as const) {
    await R(`NFTRewardPool(${nm}).DISTRIBUTOR → RewardDistributorV2`, pool.grantRole(await role(pool, "DISTRIBUTOR_ROLE"), await distrib.getAddress()))
    await R(`NFTRewardPool(${nm}).CREDITOR → CREDITOR wallet`, pool.grantRole(await role(pool, "CREDITOR_ROLE"), CONFIG.CREDITOR))
  }
  // LuckyDraw — distributor + creditor
  await R("LuckyDraw.DISTRIBUTOR → RewardDistributorV2", lucky.grantRole(await role(lucky, "DISTRIBUTOR_ROLE"), await distrib.getAddress()))
  await R("LuckyDraw.CREDITOR → CREDITOR wallet", lucky.grantRole(await role(lucky, "CREDITOR_ROLE"), CONFIG.CREDITOR))
  // RewardDistributorV2 ← RevenueRouter
  await R("RewardDistributorV2.DISTRIBUTOR → RevenueRouter", distrib.grantRole(await role(distrib, "DISTRIBUTOR_ROLE"), await router.getAddress()))
  // Infra pools ← RevenueRouter
  await R("ListingReserve.DISTRIBUTOR → RevenueRouter", staking.grantRole(await role(staking, "DISTRIBUTOR_ROLE"), await router.getAddress()))
  await R("ManagementPool.DISTRIBUTOR → RevenueRouter", mgmt.grantRole(await role(mgmt, "DISTRIBUTOR_ROLE"), await router.getAddress()))
  await R("LiquidityPool.DISTRIBUTOR → RevenueRouter", liq.grantRole(await role(liq, "DISTRIBUTOR_ROLE"), await router.getAddress()))
  await R("LiquidityPool.DEPOSITOR → OPERATOR", liq.grantRole(await role(liq, "DEPOSITOR_ROLE"), CONFIG.OPERATOR))
  // RevenueRouter ← PreSale
  await R("RevenueRouter.DISTRIBUTOR → PreSale", router.grantRole(await role(router, "DISTRIBUTOR_ROLE"), await presale.getAddress()))

  // Existing contracts — grant to the new RevenueRouter / PreSale
  const treasury = await ethers.getContractAt("TreasuryManager", MAINNET.TreasuryManager)
  await R("TreasuryManager.DISTRIBUTOR → RevenueRouter", treasury.grantRole(await role(treasury, "DISTRIBUTOR_ROLE"), await router.getAddress()))
  const lockMgr = await ethers.getContractAt("LockManager", MAINNET.LockManager)
  await R("LockManager.SCHEDULE_CREATOR → PreSale", lockMgr.grantRole(await role(lockMgr, "SCHEDULE_CREATOR_ROLE"), await presale.getAddress()))

  // The Steward Council, not the deployer, decides what happens to a round that does
  // not sell out. DAOGovernor already carries the 3-of-5 quorum and the category
  // timelock, so PreSale.DAO_ROLE points at it rather than reimplementing a vote.
  // withdrawUnsoldMIC and burnUnsoldMIC stay locked for 180 days from deploy unless
  // the sale is stopped first.
  await R("PreSale.DAO_ROLE → DAOGovernor",
    presale.grantRole(await role(presale, "DAO_ROLE"), MAINNET.DAOGovernor))

  // ═══════════════ PHASE 3 — FUND ═══════════════
  console.log("\n── PHASE 3: fund ──")
  const mic = await ethers.getContractAt("IERC20", MAINNET.MIC)
  await R(`Transfer 315M MIC → PreSale`, mic.transfer(await presale.getAddress(), CONFIG.PRESALE_MIC))
  if (CONFIG.FUND_LIQUIDITY_105M) {
    await R(`Transfer 105M MIC → LiquidityPool (listing lock)`, mic.transfer(await liq.getAddress(), CONFIG.LIQUIDITY_MIC))
  } else {
    console.log("  ⏭  Liquidity 105M MIC NOT sent (FUND_LIQUIDITY_105M=false — confirm source first)")
  }

  // ── Save addresses ──
  const file = path.resolve(__dirname, `../deployments/presale-phase1-mainnet.json`)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ chainId: 56, admin, contracts: out }, null, 2))
  console.log("\n✓ addresses saved →", file)

  // The apps read addresses from packages/sdk/src/addresses.ts and nowhere else, so this
  // block is the whole hand-off. Printing it verbatim removes the transcription step that
  // left the DApp pointing at a halted SeedSaleV7 for a day.
  console.log("\n── paste into packages/sdk/src/addresses.ts (bsc) ──")
  const sdkKeys: Record<string, string> = {
    CommunityNFTv2:       out["CommunityNFTv2"],
    ReferralRegistry:     out["ReferralRegistry"],
    ClaimRewardsV2:       out["ClaimRewardsV2"],
    NFTRewardPoolWeekly:  await weekly.getAddress(),
    NFTRewardPoolMonthly: await monthly.getAddress(),
    LuckyDraw:            out["LuckyDraw"],
    RewardDistributorV2:  out["RewardDistributorV2"],
    ListingReserve:       out["ListingReserve"],
    ManagementPool:       out["ManagementPool"],
    LiquidityPool:        out["LiquidityPool"],
    RevenueRouter:        out["RevenueRouter"],
    PreSale:              out["PreSale"],
  }
  for (const [k, v] of Object.entries(sdkKeys)) {
    console.log(`    ${(k + ":").padEnd(22)} "${v}",`)
  }
  console.log("── end paste ──")

  console.log("\n══════════════════════════════════════════════════════════")
  console.log("  ✅ DEPLOY COMPLETE — but PreSale is NOT live yet.")
  console.log("  Manual final steps (deliberate, off this script):")
  console.log("   1. Verify all addresses + roles on BSCScan.")
  console.log("   2. PreSale.setActive(true)   ← turns the sale ON (irreversible-ish).")
  console.log("   3. Admin: flip menu-config presale → enabled (shows on frontend).")
  console.log("   4. (Later) hand admin roles to DAOGovernor for full DAO.")
  console.log("══════════════════════════════════════════════════════════")
}

function printPlan(admin: string) {
  const rows = [
    ["CommunityNFTv2", "ERC-721 serial NFT (replaces old ERC-1155)"],
    ["ReferralRegistry", "F1/F2 + GV; overflow → M&I"],
    ["ClaimRewardsV2", "GV (claim) + M&I (DAO)"],
    ["NFTRewardPool ×2", "Weekly 5.5% + Monthly 8% (claim)"],
    ["LuckyDraw", "Weekly 1% (claim)"],
    ["RewardDistributorV2", "Marketing 25% splitter"],
    ["ListingReserve", "5% Listing & External Market fund (DAO, 24h timelock)"],
    ["ManagementPool", "7.5% leadership + DAO bonus"],
    ["LiquidityPool", "40% locked buffer"],
    ["RevenueRouter", "6-way gross splitter"],
    ["PreSale", "the sale (funded 315M MIC, active=false)"],
  ]
  // These counts are checked against the runbook before every deploy, and the checklist
  // says to STOP if they disagree. NFTRewardPool is deployed twice (Weekly + Monthly),
  // so 12 deploy transactions come from 11 distinct contract types.
  console.log("  Deploy (12 instances / 11 types), admin =", admin)
  rows.forEach(([a, b]) => console.log(`   • ${a.padEnd(20)} ${b}`))
  console.log("  Then: 21 role grants + setIncentivePool + transfer 315M MIC.")
  console.log("  Total: 35 transactions (12 deploy + 21 grant + 1 setter + 1 transfer).")
  console.log("  Reuse: USDT, MIC, LockManager, TreasuryManager (live).")
}

main().catch((e) => { console.error(e); process.exit(1) })
