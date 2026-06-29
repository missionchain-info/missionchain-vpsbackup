/**
 * Phase 2c-pivot — Deploy centralized treasury architecture
 *
 * Replaces the "split-and-forward" SeedBudgetV5 with a centralized vault model.
 * USDT for 4 slots (Distribution / Operational / MgmtBonus / Reserved) stays
 * inside SeedBudgetV5b. Liquidity slot (40%) still auto-forwards to LP v5.
 * Pool contracts become policy-only — they call SeedBudgetV5b.release() to
 * disburse USDT to recipients (with fee deduction).
 *
 * Deploys:
 *   1. SeedBudgetV5b (centralized vault)
 *   2. OperationalSalaryPoolV2
 *   3. ManagementBonusPoolV2
 *   4. ReservedExpensesPoolV2
 *   5. SeedSaleV6 (wire to SeedBudgetV5b, includes rescueToken)
 *
 * Wires:
 *   - SeedBudgetV5b.setSlotController(0/1/2/4) → respective pool
 *   - SeedBudgetV5b.setLiquidityPool(LiquidityPoolV5)
 *   - SeedBudgetV5b.grantRole(CALLER_ROLE, SeedSaleV6)
 *   - LockManager: SCHEDULE_CREATOR + ADMIN_GRANTER → SeedSaleV6
 *   - MFPNFT: SEED_GRANTER_ROLE → SeedSaleV6
 *   - SeedSaleV6.setActive(true)
 *   - SeedSaleV6 funded with deployer's MIC balance
 *
 * Old contracts orphaned (testnet trade-off accepted):
 *   - SeedBudgetV5 (split-forward) — has $30K stuck
 *   - OperationalSalaryPool (v1) — empty
 *   - ManagementBonusPool (v1) — empty
 *   - ReservedExpensesPool (v1) — empty
 *   - SeedSaleV5 — 8.1M MIC stuck (no rescue)
 *
 * Run:
 *   npx hardhat run scripts/deploy-v5b-pivot.ts --network bscTestnet
 */
import { ethers } from "hardhat"

// v4 live addresses
const USDT          = "0x6d1A913665F26903C7d296d946B8D8527D6937B0"
const MIC           = "0x2Ab08b1DC87D1f0778D2190c25B42735348aD50D"
const LOCK_MANAGER  = "0xB23B802536735cCEB74BcE6B6dbe815CA0e7f4fa"
const MFP_NFT       = "0x011bF0cABB645F175Be4FF637Bf2D935545068c0"

// Existing v5 (kept)
const STEWARD_COUNCIL = "0x2fbA13aF4F0674c9c8854e9cD525A207b470dC4B"
const LP_V5           = "0x5dE24d7c0c9D581CaDf5d058b086F158Ee88b86b"
const LRV             = "0xD6E88De8DE02b39faA27AE95eD5A18A1Ad203242"

// Old v5 contracts to orphan (will be replaced)
const OLD_OPERATIONAL_POOL = "0x5B13D1F18004592Cc4D72CA7E7fd20E12347DFAe"
const OLD_MGMT_BONUS_POOL  = "0xC359C451Be770FC41D2b1d6398c4cD9185CFbD81"
const OLD_RESERVED_POOL    = "0x00CA0934070ad81e777f290b72a8c6C73319Ca84"
const OLD_SEED_BUDGET      = "0xCA9d612C790E7E7F0e1a1DF020Be03De81683d11"
const OLD_SEED_SALE_V5     = "0xf68e6AeEEA96a02e256F850C7a5e4dcf75d15235"

// Carry-over state
const INITIAL_OLD_INVESTORS = ethers.parseEther("6000000")

// Role hashes
const CALLER_ROLE           = ethers.id("CALLER_ROLE")
const SCHEDULE_CREATOR_ROLE = ethers.id("SCHEDULE_CREATOR")  // typo preserved
const ADMIN_GRANTER_ROLE    = ethers.id("ADMIN_GRANTER_ROLE")
const SEED_GRANTER_ROLE     = ethers.id("SEED_GRANTER_ROLE")
const DISTRIBUTOR_ROLE      = ethers.id("DISTRIBUTOR_ROLE")

async function main() {
  const [deployer] = await ethers.getSigners()
  const admin = deployer.address
  console.log("\n══════════════════════════════════════════════════════")
  console.log(" Phase 2c-pivot — Centralized Treasury Architecture")
  console.log("══════════════════════════════════════════════════════")
  console.log(" Deployer:", admin)
  console.log(" tBNB:    ", ethers.formatEther(await ethers.provider.getBalance(admin)), "\n")

  // ─── 1. Deploy SeedBudgetV5b ──────────────────────────────────────
  console.log("[1/5] Deploying SeedBudgetV5b...")
  const SBV5b = await ethers.getContractFactory("SeedBudgetV5b")
  const sb = await SBV5b.deploy(USDT, admin)
  await sb.waitForDeployment()
  const sbAddr = await sb.getAddress()
  console.log("    SeedBudgetV5b:", sbAddr)

  // ─── 2. Deploy OperationalSalaryPoolV2 ────────────────────────────
  console.log("\n[2/5] Deploying OperationalSalaryPoolV2...")
  const OSPV2 = await ethers.getContractFactory("OperationalSalaryPoolV2")
  const osp = await OSPV2.deploy(STEWARD_COUNCIL, sbAddr, admin)
  await osp.waitForDeployment()
  const ospAddr = await osp.getAddress()
  console.log("    OperationalSalaryPoolV2:", ospAddr)

  // ─── 3. Deploy ManagementBonusPoolV2 ──────────────────────────────
  console.log("\n[3/5] Deploying ManagementBonusPoolV2...")
  const MBPV2 = await ethers.getContractFactory("ManagementBonusPoolV2")
  const mbp = await MBPV2.deploy(STEWARD_COUNCIL, sbAddr, admin)
  await mbp.waitForDeployment()
  const mbpAddr = await mbp.getAddress()
  console.log("    ManagementBonusPoolV2:", mbpAddr)

  // ─── 4. Deploy ReservedExpensesPoolV2 ─────────────────────────────
  console.log("\n[4/5] Deploying ReservedExpensesPoolV2...")
  const REPV2 = await ethers.getContractFactory("ReservedExpensesPoolV2")
  const rep = await REPV2.deploy(sbAddr, admin)
  await rep.waitForDeployment()
  const repAddr = await rep.getAddress()
  console.log("    ReservedExpensesPoolV2:", repAddr)

  // ─── 5. Deploy SeedSaleV6 ─────────────────────────────────────────
  console.log("\n[5/5] Deploying SeedSaleV6...")
  const SSV6 = await ethers.getContractFactory("SeedSaleV6")
  const ss = await SSV6.deploy(USDT, MIC, LOCK_MANAGER, MFP_NFT, sbAddr, admin, INITIAL_OLD_INVESTORS)
  await ss.waitForDeployment()
  const ssAddr = await ss.getAddress()
  console.log("    SeedSaleV6:", ssAddr)

  // ─── Wire SeedBudgetV5b ───────────────────────────────────────────
  console.log("\n══════════════════════════════════════════════════════")
  console.log(" Wiring SeedBudgetV5b")
  console.log("══════════════════════════════════════════════════════")

  console.log("[wire] setSlotController(OPERATIONAL=1, OperationalPoolV2)...")
  await (await (sb as any).setSlotController(1, ospAddr)).wait()

  console.log("[wire] setSlotController(MGMT_BONUS=2, MgmtBonusPoolV2)...")
  await (await (sb as any).setSlotController(2, mbpAddr)).wait()

  console.log("[wire] setSlotController(RESERVED=4, ReservedPoolV2)...")
  await (await (sb as any).setSlotController(4, repAddr)).wait()

  // SLOT_DISTRIBUTION (0) intentionally unset — anh decide DistributionProgramPool later

  console.log("[wire] setLiquidityPool(LiquidityPoolV5)...")
  await (await (sb as any).setLiquidityPool(LP_V5)).wait()

  console.log("[wire] grantRole(CALLER_ROLE, SeedSaleV6)...")
  await (await (sb as any).grantRole(CALLER_ROLE, ssAddr)).wait()

  // ─── Wire LockManager ─────────────────────────────────────────────
  console.log("\n══════════════════════════════════════════════════════")
  console.log(" Wiring LockManager + MFPNFT for SeedSaleV6")
  console.log("══════════════════════════════════════════════════════")

  const lm = await ethers.getContractAt("LockManager", LOCK_MANAGER) as any
  console.log("[wire] LockManager.grantRole(SCHEDULE_CREATOR, SeedSaleV6)...")
  await (await lm.grantRole(SCHEDULE_CREATOR_ROLE, ssAddr)).wait()
  console.log("[wire] LockManager.grantRole(ADMIN_GRANTER_ROLE, SeedSaleV6)...")
  await (await lm.grantRole(ADMIN_GRANTER_ROLE, ssAddr)).wait()

  const mfp = await ethers.getContractAt("MFPNFT", MFP_NFT) as any
  console.log("[wire] MFPNFT.grantRole(SEED_GRANTER_ROLE, SeedSaleV6)...")
  await (await mfp.grantRole(SEED_GRANTER_ROLE, ssAddr)).wait()

  // LP v5 needs DISTRIBUTOR_ROLE for SeedBudgetV5b (Liquidity auto-forward calls receiveAndDistribute on LP)
  console.log("[wire] LiquidityPoolV5.grantRole(DISTRIBUTOR_ROLE, SeedBudgetV5b)...")
  const lpV5 = await ethers.getContractAt("LiquidityPoolV5", LP_V5) as any
  // First check if SeedBudgetV5 (old) still has the role; revoke for clarity
  await (await lpV5.grantRole(DISTRIBUTOR_ROLE, sbAddr)).wait()

  // ─── Activate sale ───────────────────────────────────────────────
  console.log("\n[activate] SeedSaleV6.setActive(true)...")
  await (await (ss as any).setActive(true)).wait()

  // ─── Fund SeedSaleV6 with deployer's MIC ─────────────────────────
  console.log("\n[fund] Funding SeedSaleV6 with deployer MIC...")
  const mic = await ethers.getContractAt("IERC20", MIC) as any
  const deployerBal = await mic.balanceOf(admin)
  console.log("    Deployer MIC balance:", ethers.formatEther(deployerBal))
  if (deployerBal > 0n) {
    await (await mic.transfer(ssAddr, deployerBal)).wait()
    console.log("    Transferred", ethers.formatEther(deployerBal), "MIC to SeedSaleV6")
  } else {
    console.log("    (deployer has 0 MIC — SeedSaleV6 starts unfunded)")
    console.log("    Anh có thể fund sau qua transfer trực tiếp")
  }

  // ─── Verify ──────────────────────────────────────────────────────
  console.log("\n[verify] Final state...")
  console.log("    SeedSaleV6 MIC balance:", ethers.formatEther(await mic.balanceOf(ssAddr)))
  console.log("    SeedSaleV6 active:    ", await (ss as any).active())
  console.log("    SeedSaleV6 seedBudget:", await (ss as any).seedBudget())
  console.log("    SeedBudgetV5b liquidityPool:", await (sb as any).liquidityPool())
  console.log("    SeedBudgetV5b feeBps:", await (sb as any).feeBps())
  console.log("    SeedBudgetV5b feeReceiver:", await (sb as any).feeReceiver())

  console.log("\n══════════════════════════════════════════════════════")
  console.log(" ✓ Pivot complete — centralized treasury architecture")
  console.log("══════════════════════════════════════════════════════")
  const out = {
    SeedBudgetV5b:           sbAddr,
    OperationalSalaryPoolV2: ospAddr,
    ManagementBonusPoolV2:   mbpAddr,
    ReservedExpensesPoolV2:  repAddr,
    SeedSaleV6:              ssAddr,
    // Existing kept
    StewardCouncil:          STEWARD_COUNCIL,
    LiquidityPoolV5:         LP_V5,
    ListingReserveVault:     LRV,
  }
  console.log(JSON.stringify(out, null, 2))

  console.log("\n⚠ ORPHANED (testnet trade-offs accepted):")
  console.log(`  Old SeedSaleV5:       ${OLD_SEED_SALE_V5} (8.1M MIC stuck)`)
  console.log(`  Old SeedBudgetV5:     ${OLD_SEED_BUDGET} ($30K USDT stuck)`)
  console.log(`  Old OperationalPool:  ${OLD_OPERATIONAL_POOL} (empty)`)
  console.log(`  Old MgmtBonusPool:    ${OLD_MGMT_BONUS_POOL} (empty)`)
  console.log(`  Old ReservedPool:     ${OLD_RESERVED_POOL} (empty)`)

  console.log("\n📋 NEXT STEPS:")
  console.log("  1. Update SDK packages/sdk/src/addresses.ts with new addresses above")
  console.log("  2. Update apps/web/lib/contracts.ts (seed=" + ssAddr + ", seedBudget=" + sbAddr + ")")
  console.log("  3. Update API service references")
  console.log("  4. Anh test buy SEED → verify slot balances accumulate + claim works")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
