import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  const addresses = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "deployments", "testnet.json"), "utf8")
  );
  const usdt = await ethers.getContractAt("MockUSDT", addresses.MockUSDT);

  const balBefore = await usdt.balanceOf(deployer.address);
  console.log("USDT before:", ethers.formatUnits(balBefore, 6));

  const amount = 10_000_000n * 10n ** 6n; // 10M USDT
  console.log("Minting", ethers.formatUnits(amount, 6), "USDT...");
  const tx = await usdt.mint(deployer.address, amount);
  const receipt = await tx.wait();
  console.log("TX:", receipt!.hash);

  // Wait a bit then re-read
  const balAfter = await usdt.balanceOf(deployer.address);
  console.log("USDT after:", ethers.formatUnits(balAfter, 6));
  console.log("Difference:", ethers.formatUnits(balAfter - balBefore, 6));
}

main().catch(console.error);
