import { ethers } from "hardhat";

const TREASURY_MANAGER = "0x4F373B5904402873Fb2000506Db2a4eE9366E411";
const P2P_ESCROW_MFP   = "0xD378AeffD194338E1F5E211D9E14287eC862d3b6";

async function main() {
  const [signer] = await ethers.getSigners();
  console.log("Signer:", signer.address);

  const tm = await ethers.getContractAt("TreasuryManager", TREASURY_MANAGER, signer);
  const distributorRole = await tm.DISTRIBUTOR_ROLE();
  const adminRole = await tm.DEFAULT_ADMIN_ROLE();

  // A5 fail-fast: ensure deployer holds admin role on TM before attempting grant
  const hasAdmin = await tm.hasRole(adminRole, signer.address);
  if (!hasAdmin) {
    console.error("\n✗ ABORT: deployer", signer.address, "does NOT hold DEFAULT_ADMIN_ROLE on TreasuryManager");
    console.error("  TreasuryManager admin may be DAOGovernor or migrated multi-sig.");
    console.error("  Cannot grant DISTRIBUTOR_ROLE without admin. Coordinate with governance.");
    process.exit(1);
  }
  console.log("✓ Deployer has DEFAULT_ADMIN_ROLE on TreasuryManager — proceeding");

  // Idempotent: skip if already granted
  if (await tm.hasRole(distributorRole, P2P_ESCROW_MFP)) {
    console.log("✓ Already granted, no-op");
    return;
  }

  console.log("Granting DISTRIBUTOR_ROLE to P2P:", P2P_ESCROW_MFP);
  const tx = await tm.grantRole(distributorRole, P2P_ESCROW_MFP);
  await tx.wait();
  console.log("Granted, tx:", tx.hash);
  console.log("Verify hasRole:", await tm.hasRole(distributorRole, P2P_ESCROW_MFP));
}

main().catch((e) => { console.error(e); process.exit(1); });
