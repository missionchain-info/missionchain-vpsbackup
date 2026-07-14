/**
 * Phase 2c+2d v5 Treasury Architecture Deploy
 *
 * Deploys 7 new contracts and migrates MIC from old LP v4:
 *   1. StewardCouncil (governance member registry)
 *   2. OperationalSalaryPool (20% SEED — Steward Council members claim)
 *   3. ManagementBonusPool (10% SEED — Council vote 75%)
 *   4. ReservedExpensesPool (10% SEED — DAO 7d cooldown)
 *   5. LiquidityPoolV5 (40% SEED + 31.5M MIC closed-loop)
 *   6. ListingReserveVault (73.5M MIC + 7d cooldown for CEX/DEX listing)
 *   7. SeedBudgetV5 (5-pool router; replaces v4 with 50/50 + Audit slot)
 *
 * Migration:
 *   - LP v4 has 105M MIC. Withdraw 73.5M → ListingReserveVault, 31.5M → LP v5.
 *   - LP v4 USDT balance migrated to LP v5 if any.
 *
 * Note: SeedSale v4 is IMMUTABLE-linked to SeedBudget v4. Cannot reroute SEED
 * purchases to new SeedBudget V5 without redeploying SeedSale. That step is
 * deferred — this script deploys the new pool architecture, anh tests the
 * pool wiring (admin can manually call receiveAndDistribute to simulate),
 * then a separate script will redeploy SeedSale v5 in a later phase.
 *
 * Run:
 *   cd packages/contracts
 *   npx hardhat run scripts/deploy-v5-treasury.ts --network bscTestnet
 */
import { ethers } from "hardhat"

// ── v4 live addresses (from reference_v4_contracts memory) ─────────────
const USDT             = "0x6d1A913665F26903C7d296d946B8D8527D6937B0"
const MIC              = "0x2Ab08b1DC87D1f0778D2190c25B42735348aD50D"
const LP_V4            = "0x62611ac2cD32a9B1DEabb5A659c8cd1052C24e77"
const SEED_SALE_V4     = "0xD11aeF00B3Eb18e3c8da0A7ba1a67a644f1C2a08"
const SEED_BUDGET_V4   = "0x618140893169ba589B67989fdbcb0550054fD044"

// Migration amounts
const LRV_INIT_MIC     = ethers.parseEther("73500000")  // 73.5M
const LP_V5_INIT_MIC   = ethers.parseEther("31500000")  // 31.5M

async function main() {
  const [deployer] = await ethers.getSigners()
  const owner = deployer.address
  console.log("\n══════════════════════════════════════════════════════")
  console.log(" Phase 2c+2d — Deploy v5 Treasury Architecture")
  console.log("══════════════════════════════════════════════════════")
  console.log(" Deployer/Owner:", owner)
  console.log(" tBNB balance:  ", ethers.formatEther(await ethers.provider.getBalance(owner)), "\n")

  // ─── 1. StewardCouncil ────────────────────────────────────────────
  console.log("[1/7] Deploying StewardCouncil...")
  const SC = await ethers.getContractFactory("StewardCouncil")
  const stewardCouncil = await SC.deploy(owner)
  await stewardCouncil.waitForDeployment()
  const stewardCouncilAddr = await stewardCouncil.getAddress()
  console.log("    StewardCouncil:", stewardCouncilAddr)

  // ─── 2. OperationalSalaryPool ─────────────────────────────────────
  console.log("\n[2/7] Deploying OperationalSalaryPool...")
  const OSP = await ethers.getContractFactory("OperationalSalaryPool")
  const operationalPool = await OSP.deploy(USDT, stewardCouncilAddr, owner)
  await operationalPool.waitForDeployment()
  const operationalPoolAddr = await operationalPool.getAddress()
  console.log("    OperationalSalaryPool:", operationalPoolAddr)

  // ─── 3. ManagementBonusPool ───────────────────────────────────────
  console.log("\n[3/7] Deploying ManagementBonusPool (75% threshold)...")
  const MBP = await ethers.getContractFactory("ManagementBonusPool")
  const mgmtBonusPool = await MBP.deploy(USDT, stewardCouncilAddr, owner)
  await mgmtBonusPool.waitForDeployment()
  const mgmtBonusPoolAddr = await mgmtBonusPool.getAddress()
  console.log("    ManagementBonusPool:", mgmtBonusPoolAddr)

  // ─── 4. ReservedExpensesPool ──────────────────────────────────────
  console.log("\n[4/7] Deploying ReservedExpensesPool...")
  const REP = await ethers.getContractFactory("ReservedExpensesPool")
  const reservedPool = await REP.deploy(USDT, owner)
  await reservedPool.waitForDeployment()
  const reservedPoolAddr = await reservedPool.getAddress()
  console.log("    ReservedExpensesPool:", reservedPoolAddr)

  // ─── 5. LiquidityPoolV5 ───────────────────────────────────────────
  console.log("\n[5/7] Deploying LiquidityPoolV5 (closed-loop)...")
  const LPV5 = await ethers.getContractFactory("LiquidityPoolV5")
  const lpV5 = await LPV5.deploy(USDT, MIC, owner)
  await lpV5.waitForDeployment()
  const lpV5Addr = await lpV5.getAddress()
  console.log("    LiquidityPoolV5:", lpV5Addr)

  // ─── 6. ListingReserveVault ───────────────────────────────────────
  console.log("\n[6/7] Deploying ListingReserveVault...")
  const LRV = await ethers.getContractFactory("ListingReserveVault")
  const lrv = await LRV.deploy(MIC, owner)
  await lrv.waitForDeployment()
  const lrvAddr = await lrv.getAddress()
  console.log("    ListingReserveVault:", lrvAddr)

  // ─── 7. SeedBudgetV5 ──────────────────────────────────────────────
  console.log("\n[7/7] Deploying SeedBudgetV5 (5-pool router)...")
  const SBV5 = await ethers.getContractFactory("SeedBudgetV5")
  const sbV5 = await SBV5.deploy(
    USDT,
    operationalPoolAddr,  // distributionProgramPool — placeholder, anh có thể đổi sau
    operationalPoolAddr,  // operationalSalaryPool
    mgmtBonusPoolAddr,    // managementBonusPool
    lpV5Addr,             // liquidityPool
    reservedPoolAddr,     // reservedExpensesPool
    owner,
  )
  await sbV5.waitForDeployment()
  const sbV5Addr = await sbV5.getAddress()
  console.log("    SeedBudgetV5:", sbV5Addr)

  // ─── Wire role grants + distributor pointers ──────────────────────
  console.log("\n══════════════════════════════════════════════════════")
  console.log(" Wiring roles + distributor pointers")
  console.log("══════════════════════════════════════════════════════")

  console.log("[wire] OperationalSalaryPool.setDistributor(SeedBudgetV5)...")
  await (await (operationalPool as any).setDistributor(sbV5Addr)).wait()
  console.log("[wire] ManagementBonusPool.setDistributor(SeedBudgetV5)...")
  await (await (mgmtBonusPool as any).setDistributor(sbV5Addr)).wait()
  console.log("[wire] ReservedExpensesPool.setDistributor(SeedBudgetV5)...")
  await (await (reservedPool as any).setDistributor(sbV5Addr)).wait()
  console.log("[wire] LiquidityPoolV5.grantRole(DISTRIBUTOR_ROLE, SeedBudgetV5)...")
  const DISTRIBUTOR_ROLE = ethers.id("DISTRIBUTOR_ROLE")
  await (await (lpV5 as any).grantRole(DISTRIBUTOR_ROLE, sbV5Addr)).wait()

  // ─── Migrate MIC from LP v4 → LP v5 + ListingReserveVault ─────────
  console.log("\n══════════════════════════════════════════════════════")
  console.log(" Migrate MIC from LP v4 (105M) → LP v5 (31.5M) + LRV (73.5M)")
  console.log("══════════════════════════════════════════════════════")

  const mic = await ethers.getContractAt("IERC20", MIC) as any
  const lpV4 = await ethers.getContractAt("LiquidityPool", LP_V4) as any
  const lpV4MicBalBefore = await mic.balanceOf(LP_V4)
  console.log(" LP v4 MIC balance before:", ethers.formatEther(lpV4MicBalBefore))

  console.log("[migrate] LP v4 → ListingReserveVault: 73.5M MIC...")
  await (await lpV4.withdrawMICForCEX(lrvAddr, LRV_INIT_MIC)).wait()
  console.log("[migrate] LP v4 → LP v5: 31.5M MIC...")
  await (await lpV4.withdrawMICForCEX(lpV5Addr, LP_V5_INIT_MIC)).wait()

  const lpV4MicBalAfter = await mic.balanceOf(LP_V4)
  const lrvMicBal = await mic.balanceOf(lrvAddr)
  const lpV5MicBal = await mic.balanceOf(lpV5Addr)
  console.log("\n LP v4 MIC balance after  :", ethers.formatEther(lpV4MicBalAfter))
  console.log(" LRV MIC balance          :", ethers.formatEther(lrvMicBal))
  console.log(" LP v5 MIC balance        :", ethers.formatEther(lpV5MicBal))

  // ─── Summary ──────────────────────────────────────────────────────
  console.log("\n══════════════════════════════════════════════════════")
  console.log(" ✓ Deploy + Migrate complete")
  console.log("══════════════════════════════════════════════════════")
  console.log(JSON.stringify({
    StewardCouncil:        stewardCouncilAddr,
    OperationalSalaryPool: operationalPoolAddr,
    ManagementBonusPool:   mgmtBonusPoolAddr,
    ReservedExpensesPool:  reservedPoolAddr,
    LiquidityPoolV5:       lpV5Addr,
    ListingReserveVault:   lrvAddr,
    SeedBudgetV5:          sbV5Addr,
  }, null, 2))

  console.log("\n⚠ NEXT STEPS (manual):")
  console.log("  1. Update SDK packages/sdk/src/addresses.ts with new addresses")
  console.log("  2. Update apps/web + apps/admin contracts.ts")
  console.log("  3. (Optional) Redeploy SeedSale v5 to use SeedBudgetV5 as recipient")
  console.log("     — current v4 SeedSale still routes USDT to v4 SeedBudget (immutable)")
  console.log("  4. Verify on BSCScan: testnet.bscscan.com")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
