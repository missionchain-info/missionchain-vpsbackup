import { ethers } from "hardhat";
import * as fs from "fs";

async function main() {
  const addrs = JSON.parse(fs.readFileSync("deployments/testnet.json", "utf8"));
  
  // Check MIC total supply
  const mic = await ethers.getContractAt("MICToken", addrs.MICToken);
  const totalSupply = await mic.totalSupply();
  console.log("MIC totalSupply:", ethers.formatEther(totalSupply));
  
  // Check SeedSale MIC balance
  const seedBal = await mic.balanceOf(addrs.SeedSale);
  console.log("SeedSale MIC balance:", ethers.formatEther(seedBal));
  
  // Check MFPNFT total supply
  const mfp = await ethers.getContractAt("MFPNFT", addrs.MFPNFT);
  const mfpSupply = await mfp.totalSupply();
  console.log("MFP-NFT totalSupply:", mfpSupply.toString());
  
  // Check MockUSDT deployer balance
  const usdt = await ethers.getContractAt("MockUSDT", addrs.MockUSDT);
  const usdtBal = await usdt.balanceOf(addrs.deployer);
  console.log("Deployer USDT balance:", ethers.formatUnits(usdtBal, 6));
  
  // Check LockManager connected
  const lockMgr = await mic.lockManager();
  console.log("MIC lockManager set:", lockMgr === addrs.LockManager ? "✅" : "❌", lockMgr);
  
  // Check remaining tBNB
  const bal = await ethers.provider.getBalance(addrs.deployer);
  console.log("Deployer tBNB remaining:", ethers.formatEther(bal));
}
main();
