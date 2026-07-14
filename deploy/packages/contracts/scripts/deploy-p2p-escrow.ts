import { ethers } from "hardhat";

// BSC Testnet addresses (v4 redeploy 2026-04-29)
const BSCTESTNET = {
  MockUSDT:        "0x6d1A913665F26903C7d296d946B8D8527D6937B0",
  MFPNFT:          "0x011bF0cABB645F175Be4FF637Bf2D935545068c0",
  TreasuryManager: "0x4F373B5904402873Fb2000506Db2a4eE9366E411",
};

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);
  console.log("tBNB balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)));

  const USDT = BSCTESTNET.MockUSDT;
  const MFP  = BSCTESTNET.MFPNFT;
  const TM   = BSCTESTNET.TreasuryManager;

  console.log("\nConstructor args:");
  console.log("  USDT:", USDT);
  console.log("  MFP:", MFP);
  console.log("  TM (feeRecipient):", TM);
  console.log("  admin:", deployer.address);

  const P2P = await ethers.getContractFactory("P2PEscrowMFP");
  const p2p = await P2P.deploy(USDT, MFP, TM, deployer.address);
  await p2p.waitForDeployment();
  const addr = await p2p.getAddress();
  console.log("\n✓ P2PEscrowMFP deployed:", addr);
  console.log("VERSION:", await p2p.VERSION());
  console.log("\nNext steps:");
  console.log("  1. Update SDK packages/sdk/src/addresses.ts");
  console.log("  2. Run grant-p2p-distributor-role.ts (Task 7)");
}

main().catch((e) => { console.error(e); process.exit(1); });
