/**
 * Test PreSale Purchase Flow on BSC Testnet
 * Tests: minimum buy ($25), Builder package ($1K), Maker package ($2.5K), Luminary ($5K)
 * Run: npx hardhat run scripts/test-presale-purchase.ts --network bscTestnet
 */
import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const addresses = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "deployments", "testnet.json"), "utf8")
  );

  const usdt = await ethers.getContractAt("MockUSDT", addresses.MockUSDT);
  const mic = await ethers.getContractAt("MICToken", addresses.MICToken);
  const lm = await ethers.getContractAt("LockManager", addresses.LockManager);
  const preSale = await ethers.getContractAt("PreSale", addresses.PreSale);
  const communityNFT = await ethers.getContractAt("CommunityNFT", addresses.CommunityNFT);

  // ── Pre-state ──
  console.log("\n=== Pre-Purchase State ===");
  const micBefore = await mic.balanceOf(deployer.address);
  const usdtBefore = await usdt.balanceOf(deployer.address);
  console.log("MIC balance:", ethers.formatEther(micBefore));
  console.log("USDT balance:", ethers.formatUnits(usdtBefore, 6));
  console.log("PreSale active:", await preSale.active());
  console.log("PreSale totalSold:", ethers.formatEther(await preSale.totalSold()), "MIC");
  console.log("PreSale totalRaised:", ethers.formatUnits(await preSale.totalRaised(), 6), "USDT");

  // ── 1. Activate PreSale ──
  console.log("\n--- Step 1: Activate PreSale ---");
  let tx = await preSale.setActive(true);
  await tx.wait();
  console.log("  ✓ PreSale activated");

  // ── 2. Approve USDT for all tests ($8,525 = $25 + $1K + $2.5K + $5K) ──
  const totalUsdt = 8_525_000_000n; // $8,525 in 6-dec
  console.log("\n--- Step 2: Approve USDT ($8,525) ---");
  tx = await usdt.approve(addresses.PreSale, totalUsdt);
  await tx.wait();
  console.log("  ✓ USDT approved");

  // ── TEST A: Minimum buy ($25 = 5,000 MIC, no NFT, package 0) ──
  console.log("\n═══ TEST A: Minimum Buy ($25 / 5,000 MIC / no NFT) ═══");
  tx = await preSale.buy(25_000_000n, 0); // $25, packageIndex=0
  let receipt = await tx.wait();
  console.log("  ✓ TX:", receipt!.hash);

  let micNow = await mic.balanceOf(deployer.address);
  console.log("  MIC received:", ethers.formatEther(micNow - micBefore));

  // ── TEST B: Builder package ($1,000 = 200,000 MIC + Builder NFT) ──
  console.log("\n═══ TEST B: Builder Package ($1,000 / 200K MIC / Builder NFT) ═══");
  const micBeforeB = await mic.balanceOf(deployer.address);
  tx = await preSale.buy(1_000_000_000n, 1); // $1000, packageIndex=1
  receipt = await tx.wait();
  console.log("  ✓ TX:", receipt!.hash);

  micNow = await mic.balanceOf(deployer.address);
  console.log("  MIC received:", ethers.formatEther(micNow - micBeforeB));

  // Check CommunityNFT Builder (tier=1)
  const builderBal = await communityNFT.balanceOf(deployer.address, 1);
  console.log("  Builder NFT count:", builderBal.toString());

  // ── TEST C: Maker package ($2,500 = 500,000 MIC + Maker NFT) ──
  console.log("\n═══ TEST C: Maker Package ($2,500 / 500K MIC / Maker NFT) ═══");
  const micBeforeC = await mic.balanceOf(deployer.address);
  tx = await preSale.buy(2_500_000_000n, 2); // $2500, packageIndex=2
  receipt = await tx.wait();
  console.log("  ✓ TX:", receipt!.hash);

  micNow = await mic.balanceOf(deployer.address);
  console.log("  MIC received:", ethers.formatEther(micNow - micBeforeC));

  const makerBal = await communityNFT.balanceOf(deployer.address, 2);
  console.log("  Maker NFT count:", makerBal.toString());

  // ── TEST D: Luminary package ($5,000 = 1,000,000 MIC + Luminary NFT) ──
  console.log("\n═══ TEST D: Luminary Package ($5,000 / 1M MIC / Luminary NFT) ═══");
  const micBeforeD = await mic.balanceOf(deployer.address);
  tx = await preSale.buy(5_000_000_000n, 3); // $5000, packageIndex=3
  receipt = await tx.wait();
  console.log("  ✓ TX:", receipt!.hash);

  micNow = await mic.balanceOf(deployer.address);
  console.log("  MIC received:", ethers.formatEther(micNow - micBeforeD));

  const luminaryBal = await communityNFT.balanceOf(deployer.address, 3);
  console.log("  Luminary NFT count:", luminaryBal.toString());

  // ── Final State ──
  console.log("\n=== Final State After All PreSale Tests ===");

  const micFinal = await mic.balanceOf(deployer.address);
  const usdtFinal = await usdt.balanceOf(deployer.address);
  console.log("MIC balance:", ethers.formatEther(micFinal));
  console.log("MIC total received (PreSale):", ethers.formatEther(micFinal - micBefore));
  console.log("USDT remaining:", ethers.formatUnits(usdtFinal, 6));
  console.log("USDT spent:", ethers.formatUnits(usdtBefore - usdtFinal, 6));

  // PreSale stats
  console.log("\nPreSale totalSold:", ethers.formatEther(await preSale.totalSold()), "MIC");
  console.log("PreSale totalRaised:", ethers.formatUnits(await preSale.totalRaised(), 6), "USDT");

  // Vesting
  const schedules = await lm.getSchedules(deployer.address);
  console.log("\nTotal vesting schedules:", schedules.length);
  console.log("  Schedule 0: Founder 280M (cliff 720d)");
  console.log("  Schedule 1: Community 105M (cliff 720d)");
  console.log("  Schedule 2: SEED 400K (cliff 180d)");
  for (let i = 3; i < schedules.length; i++) {
    const s = schedules[i];
    console.log(`  Schedule ${i}: ${ethers.formatEther(s.totalAmount)} MIC (cliff ${Number(s.cliffDuration) / 86400}d)`);
  }
  const locked = await lm.lockedOf(deployer.address);
  console.log("Total locked:", ethers.formatEther(locked), "MIC");

  // NFT summary
  console.log("\nNFT Holdings:");
  const mfp = await ethers.getContractAt("MFPNFT", addresses.MFPNFT);
  console.log("  MFP-NFT:", (await mfp.balanceOf(deployer.address)).toString());
  console.log("  Builder (tier 1):", (await communityNFT.balanceOf(deployer.address, 1)).toString());
  console.log("  Maker (tier 2):", (await communityNFT.balanceOf(deployer.address, 2)).toString());
  console.log("  Luminary (tier 3):", (await communityNFT.balanceOf(deployer.address, 3)).toString());

  // Revenue distribution check
  console.log("\n=== Revenue Flow Check ===");
  const contracts = [
    "SeedBudget", "RevenueRouter", "RewardDistributor", "ManagementPool",
    "TreasuryManager", "LiquidityPool", "ClaimRewards", "PeriodicRewards",
    "LuckyDraw", "IncentivePool",
  ];
  for (const name of contracts) {
    const bal = await usdt.balanceOf(addresses[name]);
    if (bal > 0n) {
      console.log(`  ${name.padEnd(22)} ${ethers.formatUnits(bal, 6).padStart(12)} USDT`);
    }
  }

  const bnb = await ethers.provider.getBalance(deployer.address);
  console.log("\nDeployer BNB:", ethers.formatEther(bnb));

  console.log("\n✅ PreSale Test COMPLETE — All 4 purchase types succeeded");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
