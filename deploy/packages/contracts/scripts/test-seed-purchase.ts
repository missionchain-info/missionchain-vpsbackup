/**
 * Test SEED Purchase Flow on BSC Testnet
 * Run: npx hardhat run scripts/test-seed-purchase.ts --network bscTestnet
 */
import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  // Load addresses
  const addressesPath = path.join(__dirname, "..", "deployments", "testnet.json");
  const addresses = JSON.parse(fs.readFileSync(addressesPath, "utf8"));

  const usdt = await ethers.getContractAt("MockUSDT", addresses.MockUSDT);
  const seedSale = await ethers.getContractAt("SeedSale", addresses.SeedSale);
  const mic = await ethers.getContractAt("MICToken", addresses.MICToken);
  const lm = await ethers.getContractAt("LockManager", addresses.LockManager);
  const mfp = await ethers.getContractAt("MFPNFT", addresses.MFPNFT);

  // ── Pre-purchase state ──
  console.log("\n=== Pre-Purchase State ===");
  console.log("SeedSale active:", await seedSale.active());
  const micBefore = await mic.balanceOf(deployer.address);
  console.log("MIC balance:", ethers.formatEther(micBefore));
  const usdtBefore = await usdt.balanceOf(deployer.address);
  console.log("USDT balance:", ethers.formatUnits(usdtBefore, 6));

  // ── 1. Activate SEED sale ──
  console.log("\n--- Step 1: Activate SEED sale ---");
  let tx = await seedSale.setActive(true);
  await tx.wait();
  console.log("  ✓ SeedSale activated");

  // ── 2. Whitelist deployer ──
  console.log("\n--- Step 2: Whitelist deployer ---");
  tx = await seedSale.addToWhitelist([deployer.address]);
  await tx.wait();
  console.log("  ✓ Whitelisted:", await seedSale.whitelisted(deployer.address));

  // ── 3. Approve USDT ──
  console.log("\n--- Step 3: Approve USDT ($1,000) ---");
  tx = await usdt.approve(addresses.SeedSale, 1_000_000_000n); // $1000
  await tx.wait();
  console.log("  ✓ USDT approved");

  // ── 4. Buy Package 0 (EARLY BIRD) ──
  console.log("\n--- Step 4: Buy EARLY BIRD ($1,000 / 400K MIC / 20 MFP) ---");
  tx = await seedSale.buyPackage(0);
  const receipt = await tx.wait();
  console.log("  ✓ TX Hash:", receipt!.hash);

  // ── Post-purchase state ──
  console.log("\n=== Post-Purchase State ===");

  const micAfter = await mic.balanceOf(deployer.address);
  console.log("MIC balance:", ethers.formatEther(micAfter));
  console.log("MIC received:", ethers.formatEther(micAfter - micBefore));

  const usdtAfter = await usdt.balanceOf(deployer.address);
  console.log("USDT spent:", ethers.formatUnits(usdtBefore - usdtAfter, 6));
  console.log("USDT remaining:", ethers.formatUnits(usdtAfter, 6));

  // Vesting
  const schedules = await lm.getSchedules(deployer.address);
  console.log("\nVesting schedules:", schedules.length);
  for (let i = 0; i < schedules.length; i++) {
    const s = schedules[i];
    console.log(`  Schedule ${i}: ${ethers.formatEther(s.totalAmount)} MIC, cliff ${Number(s.cliffDuration) / 86400}d`);
  }

  const locked = await lm.lockedOf(deployer.address);
  console.log("Total locked:", ethers.formatEther(locked), "MIC");
  const available = await lm.availableOf(deployer.address);
  console.log("Available:", ethers.formatEther(available), "MIC");

  // MFP-NFT
  const nftBal = await mfp.balanceOf(deployer.address);
  console.log("\nMFP-NFT count:", nftBal.toString());

  // SeedSale stats
  const totalSold = await seedSale.totalSold();
  console.log("SeedSale totalSold:", ethers.formatEther(totalSold), "MIC");

  // SeedBudget USDT balance (should have received $1000)
  const sbBal = await usdt.balanceOf(addresses.SeedBudget);
  console.log("\nSeedBudget USDT:", ethers.formatUnits(sbBal, 6));

  // Check BNB remaining
  const bnb = await ethers.provider.getBalance(deployer.address);
  console.log("\nDeployer BNB remaining:", ethers.formatEther(bnb));

  console.log("\n✅ SEED Purchase Test COMPLETE");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
