/**
 * Rescue 8M MIC from SeedSaleV5 (orphaned) to SeedSaleV6 (active).
 *
 * Strategy:
 *   1. Call SeedSaleV5.adminGrantOldInvestor(deployer, 8M, startTime=1)
 *      → transfers 8M MIC from V5 to deployer + creates vesting schedule on LockManager
 *      → startTime=1 (1970) means vesting curve fully unlocked by 2026
 *      → deployer can freely transfer the MIC
 *   2. deployer transfers 8M MIC to SeedSaleV6.
 *
 * Cost: consumes 8M of OLD_INVESTORS_ALLOCATION (75M pool) on V5. Acceptable
 * testnet trade-off since V5 is orphaned anyway.
 *
 * Run:
 *   npx hardhat run scripts/rescue-mic-v5-to-v6.ts --network bscTestnet
 */
import { ethers } from "hardhat"

const SEED_SALE_V5 = "0xf68e6AeEEA96a02e256F850C7a5e4dcf75d15235"
const SEED_SALE_V6 = "0xf3C3f88b434035484cEf6daF99Ed967489D2c7cC"
const MIC          = "0x2Ab08b1DC87D1f0778D2190c25B42735348aD50D"

const AMOUNT = ethers.parseEther("8000000") // 8M MIC
const ANCIENT_START = 1n // 1 sec after epoch — vesting fully unlocked by 2026

async function main() {
  const [deployer] = await ethers.getSigners()
  const me = deployer.address
  console.log("\n══════════════════════════════════════════════════════")
  console.log(" Rescue 8M MIC: SeedSaleV5 → deployer → SeedSaleV6")
  console.log("══════════════════════════════════════════════════════")
  console.log(" Deployer:", me, "\n")

  const mic = await ethers.getContractAt("IERC20", MIC) as any

  console.log("Pre-rescue balances:")
  console.log("  SeedSaleV5:", ethers.formatEther(await mic.balanceOf(SEED_SALE_V5)), "MIC")
  console.log("  Deployer: ", ethers.formatEther(await mic.balanceOf(me)), "MIC")
  console.log("  SeedSaleV6:", ethers.formatEther(await mic.balanceOf(SEED_SALE_V6)), "MIC")

  // Step 1: adminGrantOldInvestor(deployer, 8M, startTime=1)
  console.log("\n[1/2] Calling SeedSaleV5.adminGrantOldInvestor(deployer, 8M, startTime=1)...")
  const ssV5 = await ethers.getContractAt("SeedSaleV5", SEED_SALE_V5) as any
  const tx1 = await ssV5.adminGrantOldInvestor(me, AMOUNT, ANCIENT_START)
  await tx1.wait()
  console.log("    tx:", tx1.hash)

  console.log("\nPost-grant balances:")
  console.log("  SeedSaleV5:", ethers.formatEther(await mic.balanceOf(SEED_SALE_V5)), "MIC")
  console.log("  Deployer: ", ethers.formatEther(await mic.balanceOf(me)), "MIC (some may be locked)")

  // Step 2: Transfer 8M MIC from deployer to SeedSaleV6
  console.log("\n[2/2] Transferring 8M MIC: deployer → SeedSaleV6...")
  const tx2 = await mic.transfer(SEED_SALE_V6, AMOUNT)
  await tx2.wait()
  console.log("    tx:", tx2.hash)

  console.log("\nFinal balances:")
  console.log("  SeedSaleV5:", ethers.formatEther(await mic.balanceOf(SEED_SALE_V5)), "MIC")
  console.log("  Deployer: ", ethers.formatEther(await mic.balanceOf(me)), "MIC")
  console.log("  SeedSaleV6:", ethers.formatEther(await mic.balanceOf(SEED_SALE_V6)), "MIC")

  console.log("\n✓ Rescue complete. SeedSaleV6 funded.")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
