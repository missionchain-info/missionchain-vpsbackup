/**
 * Check USDT/MIC distribution after SEED purchase
 * Run: npx hardhat run scripts/check-balances.ts --network bscTestnet
 */
import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  const addresses = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "deployments", "testnet.json"), "utf8")
  );
  const usdt = await ethers.getContractAt("MockUSDT", addresses.MockUSDT);
  const mic = await ethers.getContractAt("MICToken", addresses.MICToken);

  const contracts = [
    "SeedSale", "PreSale", "SeedBudget", "LiquidityPool", "RevenueRouter",
    "ManagementPool", "TreasuryManager", "RewardDistributor",
    "ClaimRewards", "PeriodicRewards", "LuckyDraw", "IncentivePool",
    "ReferralRegistry", "AirdropDistributor", "MICELicense",
  ];

  console.log("=== Contract Balances (BSC Testnet) ===\n");
  console.log("Contract".padEnd(24), "USDT".padStart(14), "MIC".padStart(20));
  console.log("-".repeat(60));

  for (const name of contracts) {
    const addr = addresses[name];
    if (!addr) continue;
    const uBal = await usdt.balanceOf(addr);
    const mBal = await mic.balanceOf(addr);
    if (uBal > 0n || mBal > 0n) {
      console.log(
        name.padEnd(24),
        ethers.formatUnits(uBal, 6).padStart(14),
        ethers.formatEther(mBal).padStart(20)
      );
    }
  }

  console.log("-".repeat(60));
  const dUsdt = await usdt.balanceOf(deployer.address);
  const dMic = await mic.balanceOf(deployer.address);
  console.log(
    "Deployer (Owner)".padEnd(24),
    ethers.formatUnits(dUsdt, 6).padStart(14),
    ethers.formatEther(dMic).padStart(20)
  );

  const bnb = await ethers.provider.getBalance(deployer.address);
  console.log("\nDeployer BNB:", ethers.formatEther(bnb));
}

main().catch(console.error);
