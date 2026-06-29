/**
 * Phase 2d-4 — Redeploy SeedSale wired to SeedBudgetV5
 *
 * Why: v4 SeedSale has immutable seedBudget = v4 SeedBudget (BUGGY split).
 * Cannot retarget without redeploy. This script:
 *   1. Deploys SeedSaleV5 with seedBudget = SeedBudgetV5 address
 *   2. Carries over oldInvestorsGranted = 6M (v4 state)
 *   3. Grants CALLER_ROLE on SeedBudgetV5 → SeedSaleV5
 *   4. Grants SCHEDULE_CREATOR + ADMIN_GRANTER_ROLE on LockManager → SeedSaleV5
 *   5. Grants SEED_GRANTER_ROLE on MFPNFT → SeedSaleV5 (autoGrantFromSeed)
 *   6. Activates sale
 *   7. Funds with deployer's MIC balance (~4M MIC for testnet testing)
 *
 * v4 SeedSale (0xD11aeF00…) orphaned with ~212.7M MIC stuck (no rescue function).
 * Run:
 *   npx hardhat run scripts/redeploy-seedsale-v5.ts --network bscTestnet
 */
import { ethers } from "hardhat"

// v4 live addresses
const USDT          = "0x6d1A913665F26903C7d296d946B8D8527D6937B0"
const MIC           = "0x2Ab08b1DC87D1f0778D2190c25B42735348aD50D"
const LOCK_MANAGER  = "0xB23B802536735cCEB74BcE6B6dbe815CA0e7f4fa"
const MFP_NFT       = "0x011bF0cABB645F175Be4FF637Bf2D935545068c0"

// v5 deployed
const SEED_BUDGET_V5 = "0xCA9d612C790E7E7F0e1a1DF020Be03De81683d11"
const SEED_SALE_V4   = "0xD11aeF00B3Eb18e3c8da0A7ba1a67a644f1C2a08"

// Carry-over state from v4 (per memory: oldInvestorsGranted = 6M)
const INITIAL_OLD_INVESTORS = ethers.parseEther("6000000")

// Role hashes
const CALLER_ROLE           = ethers.id("CALLER_ROLE")
const SCHEDULE_CREATOR_ROLE = ethers.id("SCHEDULE_CREATOR")  // no _ROLE suffix per Solidity convention
const ADMIN_GRANTER_ROLE    = ethers.id("ADMIN_GRANTER_ROLE")
const SEED_GRANTER_ROLE     = ethers.id("SEED_GRANTER_ROLE")

async function main() {
  const [deployer] = await ethers.getSigners()
  const admin = deployer.address
  console.log("\n══════════════════════════════════════════════════════")
  console.log(" Phase 2d-4 — SeedSaleV5 redeploy")
  console.log("══════════════════════════════════════════════════════")
  console.log(" Deployer/Admin:", admin)
  console.log(" tBNB:          ", ethers.formatEther(await ethers.provider.getBalance(admin)), "\n")

  // ─── 1. Deploy SeedSaleV5 ─────────────────────────────────────────
  console.log("[1/8] Deploying SeedSaleV5...")
  const SS = await ethers.getContractFactory("SeedSaleV5")
  const ss = await SS.deploy(USDT, MIC, LOCK_MANAGER, MFP_NFT, SEED_BUDGET_V5, admin, INITIAL_OLD_INVESTORS)
  await ss.waitForDeployment()
  const ssAddr = await ss.getAddress()
  console.log("    SeedSaleV5:", ssAddr)

  // ─── 2. Grant CALLER_ROLE on SeedBudgetV5 → SeedSaleV5 ────────────
  console.log("\n[2/8] Granting CALLER_ROLE on SeedBudgetV5 → SeedSaleV5...")
  const sbV5 = await ethers.getContractAt("SeedBudgetV5", SEED_BUDGET_V5) as any
  await (await sbV5.grantRole(CALLER_ROLE, ssAddr)).wait()
  console.log("    granted")

  // ─── 3. Grant SCHEDULE_CREATOR on LockManager → SeedSaleV5 ────────
  console.log("\n[3/8] Granting SCHEDULE_CREATOR on LockManager → SeedSaleV5...")
  const lm = await ethers.getContractAt("LockManager", LOCK_MANAGER) as any
  await (await lm.grantRole(SCHEDULE_CREATOR_ROLE, ssAddr)).wait()
  console.log("    granted")

  // ─── 4. Grant ADMIN_GRANTER_ROLE on LockManager → SeedSaleV5 ──────
  // Needed for adminGrantOldInvestor → createScheduleWithStart
  console.log("\n[4/8] Granting ADMIN_GRANTER_ROLE on LockManager → SeedSaleV5...")
  await (await lm.grantRole(ADMIN_GRANTER_ROLE, ssAddr)).wait()
  console.log("    granted")

  // ─── 5. Grant SEED_GRANTER_ROLE on MFPNFT → SeedSaleV5 ────────────
  // Needed for autoGrantFromSeed during buyPackage
  console.log("\n[5/8] Granting SEED_GRANTER_ROLE on MFPNFT → SeedSaleV5...")
  const mfp = await ethers.getContractAt("MFPNFT", MFP_NFT) as any
  await (await mfp.grantRole(SEED_GRANTER_ROLE, ssAddr)).wait()
  console.log("    granted")

  // ─── 6. Activate sale ──────────────────────────────────────────────
  console.log("\n[6/8] Activating sale...")
  await (await (ss as any).setActive(true)).wait()
  console.log("    active = true")

  // ─── 7. Fund with deployer's MIC balance ───────────────────────────
  console.log("\n[7/8] Funding SeedSaleV5 with deployer's MIC...")
  const mic = await ethers.getContractAt("IERC20", MIC) as any
  const deployerBal = await mic.balanceOf(admin)
  console.log("    Deployer MIC balance:", ethers.formatEther(deployerBal))
  if (deployerBal > 0n) {
    await (await mic.transfer(ssAddr, deployerBal)).wait()
    console.log("    Transferred", ethers.formatEther(deployerBal), "MIC")
  } else {
    console.log("    (nothing to transfer)")
  }

  // ─── 8. Verify ─────────────────────────────────────────────────────
  console.log("\n[8/8] Verifying...")
  const ssMicBal = await mic.balanceOf(ssAddr)
  console.log("    SeedSaleV5 MIC balance:", ethers.formatEther(ssMicBal))
  console.log("    SeedSaleV5 active:    ", await (ss as any).active())
  console.log("    SeedSaleV5 totalSold: ", ethers.formatEther(await (ss as any).totalSold()))
  console.log("    SeedSaleV5 oldInvGran:", ethers.formatEther(await (ss as any).oldInvestorsGranted()))
  console.log("    SeedSaleV5 seedBudget:", await (ss as any).seedBudget())

  console.log("\n══════════════════════════════════════════════════════")
  console.log(" ✓ SeedSaleV5 deployed + wired")
  console.log("══════════════════════════════════════════════════════")
  console.log(JSON.stringify({
    SeedSaleV5: ssAddr,
    SeedSaleV4_orphaned: SEED_SALE_V4,
  }, null, 2))

  console.log("\n⚠ NEXT STEPS:")
  console.log("  1. Update SDK packages/sdk/src/addresses.ts: SeedSale = " + ssAddr)
  console.log("  2. Update apps/web/lib/contracts.ts: seed = " + ssAddr)
  console.log("  3. Update apps/admin (if has SeedSale ref)")
  console.log("  4. Anh test: buy SEED package → verify 5 splits in v5 pools")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
