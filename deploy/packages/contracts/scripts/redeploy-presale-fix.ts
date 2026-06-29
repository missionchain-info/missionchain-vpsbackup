/**
 * Phase 1 — Redeploy PreSale ONLY with correct constructor args.
 *
 * Why: v4 PreSale (0x068d52cF55ABBbE4E5a5A952FEe596502a696554) was deployed with
 * referralRegistry and communityNFT addresses SWAPPED, so buy() reverts on the
 * first internal call (referralRegistry.referrerOf — actually hits CommunityNFT).
 *
 * This script:
 *  1. Deploys new PreSale with correct args (per v4 contracts memory).
 *  2. Activates the sale.
 *  3. Grants SCHEDULE_CREATOR on LockManager → new PreSale.
 *  4. Grants CALLER_ROLE on ReferralRegistry → new PreSale.
 *  5. Grants DISTRIBUTOR_ROLE on RevenueRouter → new PreSale.
 *  6. Grants MINTER_ROLE on CommunityNFT → new PreSale.
 *  7. Withdraws all MIC from AirdropDistributor (17.5M) to new PreSale (testnet funding).
 *
 * v4 PreSale (0x068d…6554) keeps its 315M MIC stuck — orphaned, no rescue function.
 *
 * Run:
 *   cd packages/contracts
 *   npx hardhat run scripts/redeploy-presale-fix.ts --network bscTestnet
 */
import { ethers } from "hardhat"

// ── v4 live addresses (from reference_v4_contracts memory) ─────────
const USDT                = "0x6d1A913665F26903C7d296d946B8D8527D6937B0"
const MIC                 = "0x2Ab08b1DC87D1f0778D2190c25B42735348aD50D"
const LOCK_MANAGER        = "0xB23B802536735cCEB74BcE6B6dbe815CA0e7f4fa"
const COMMUNITY_NFT       = "0x6a1D509aE75f5E8794b79C823Fa3408535df07ee"
const REFERRAL_REGISTRY   = "0xa4a4d1f68760CEe7BE76500A682d60c4110705d9"
const REVENUE_ROUTER      = "0xe6Ac647a2FEeF86AE55A6732FFA8Dd9cEF21C7A2"
const AIRDROP_DISTRIBUTOR = "0xEAF7eC7f4c0cc96D196661a713920eF0DE2Fa178"

// Role hashes
const SCHEDULE_CREATOR_ROLE = ethers.id("SCHEDULE_CREATOR")     // LockManager (no _ROLE suffix!)
const CALLER_ROLE           = ethers.id("CALLER_ROLE")           // ReferralRegistry
const DISTRIBUTOR_ROLE      = ethers.id("DISTRIBUTOR_ROLE")      // RevenueRouter
const MINTER_ROLE           = ethers.id("MINTER_ROLE")           // CommunityNFT

async function main() {
  const [deployer] = await ethers.getSigners()
  const admin = deployer.address
  console.log("\n══════════════════════════════════════════════════════")
  console.log(" Phase 1 — Redeploy PreSale (fix swapped constructor args)")
  console.log("══════════════════════════════════════════════════════")
  console.log(" Deployer:", admin)
  console.log(" tBNB:    ", ethers.formatEther(await ethers.provider.getBalance(admin)), "\n")

  // 1. Deploy new PreSale
  console.log("[1/8] Deploying PreSale...")
  const PreSale = await ethers.getContractFactory("PreSale")
  // Constructor order: usdt, micToken, lockManager, communityNFT, referralRegistry, revenueRouter, admin
  const presale = await PreSale.deploy(
    USDT,
    MIC,
    LOCK_MANAGER,
    COMMUNITY_NFT,
    REFERRAL_REGISTRY,
    REVENUE_ROUTER,
    admin,
  )
  await presale.waitForDeployment()
  const presaleAddr = await presale.getAddress()
  console.log("    PreSale:", presaleAddr)

  // 2. Activate sale
  console.log("\n[2/8] Activating sale...")
  let tx = await (presale as any).setActive(true)
  await tx.wait()
  console.log("    active = true")

  // 3. Grant SCHEDULE_CREATOR on LockManager → PreSale
  console.log("\n[3/8] Granting SCHEDULE_CREATOR on LockManager → PreSale...")
  const lockManager = await ethers.getContractAt("LockManager", LOCK_MANAGER)
  tx = await (lockManager as any).grantRole(SCHEDULE_CREATOR_ROLE, presaleAddr)
  await tx.wait()
  console.log("    granted")

  // 4. Grant CALLER_ROLE on ReferralRegistry → PreSale
  console.log("\n[4/8] Granting CALLER_ROLE on ReferralRegistry → PreSale...")
  const referralRegistry = await ethers.getContractAt("ReferralRegistry", REFERRAL_REGISTRY)
  tx = await (referralRegistry as any).grantRole(CALLER_ROLE, presaleAddr)
  await tx.wait()
  console.log("    granted")

  // 5. Grant DISTRIBUTOR_ROLE on RevenueRouter → PreSale
  console.log("\n[5/8] Granting DISTRIBUTOR_ROLE on RevenueRouter → PreSale...")
  const revenueRouter = await ethers.getContractAt("RevenueRouter", REVENUE_ROUTER)
  tx = await (revenueRouter as any).grantRole(DISTRIBUTOR_ROLE, presaleAddr)
  await tx.wait()
  console.log("    granted")

  // 6. Grant MINTER_ROLE on CommunityNFT → PreSale
  console.log("\n[6/8] Granting MINTER_ROLE on CommunityNFT → PreSale...")
  const communityNFT = await ethers.getContractAt("CommunityNFT", COMMUNITY_NFT)
  tx = await (communityNFT as any).grantRole(MINTER_ROLE, presaleAddr)
  await tx.wait()
  console.log("    granted")

  // 7. Withdraw MIC from AirdropDistributor → PreSale (testnet funding, 17.5M)
  console.log("\n[7/8] Withdrawing MIC from AirdropDistributor → PreSale...")
  const airdrop = await ethers.getContractAt("AirdropDistributor", AIRDROP_DISTRIBUTOR)
  tx = await (airdrop as any).withdrawRemaining(presaleAddr)
  const r = await tx.wait()
  console.log("    tx:", r?.hash)

  // 8. Verify final state
  console.log("\n[8/8] Verifying final state...")
  const mic = await ethers.getContractAt("IERC20", MIC) as any
  const presaleMicBal = await mic.balanceOf(presaleAddr)
  console.log("    PreSale MIC balance:", ethers.formatEther(presaleMicBal), "MIC")
  console.log("    PreSale active:    ", await (presale as any).active())

  console.log("\n══════════════════════════════════════════════════════")
  console.log(" ✓ Done. Update FE constants:")
  console.log("   apps/web/lib/contracts.ts:")
  console.log(`     presale: '${presaleAddr}'`)
  console.log("══════════════════════════════════════════════════════\n")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
