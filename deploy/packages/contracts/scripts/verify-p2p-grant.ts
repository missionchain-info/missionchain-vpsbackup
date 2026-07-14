import { ethers } from "hardhat";

const TREASURY_MANAGER = "0x4F373B5904402873Fb2000506Db2a4eE9366E411";
const P2P_ESCROW_MFP   = "0xD378AeffD194338E1F5E211D9E14287eC862d3b6";
const TX_HASH = "0x7950b4d792b720e4bb875c9cf34deef038daa699c601f99743a2560386874833";

async function main() {
  const provider = ethers.provider;
  const receipt = await provider.getTransactionReceipt(TX_HASH);

  console.log("\n=== Transaction Status ===");
  console.log("TX Hash:", TX_HASH);
  console.log("Status:", receipt?.status === 1n ? "SUCCESS (1)" : receipt?.status === 0n ? "FAILED (0)" : "UNKNOWN");
  console.log("Block:", receipt?.blockNumber);
  console.log("From:", receipt?.from);
  console.log("To:", receipt?.to);
  console.log("Gas Used:", receipt?.gasUsed?.toString());

  const [signer] = await ethers.getSigners();
  const tm = await ethers.getContractAt("TreasuryManager", TREASURY_MANAGER, signer);

  // Try to get role from contract
  let distributorRole: string;
  try {
    distributorRole = await tm.DISTRIBUTOR_ROLE();
    console.log("\n=== Role Constants ===");
    console.log("DISTRIBUTOR_ROLE:", distributorRole);
  } catch (e) {
    console.error("Failed to read DISTRIBUTOR_ROLE:", e);
    return;
  }

  // Check hasRole
  const hasRole = await tm.hasRole(distributorRole, P2P_ESCROW_MFP);
  console.log("\n=== Role Check ===");
  console.log("P2P has DISTRIBUTOR_ROLE:", hasRole);

  // Try to call distributeToken to ensure the role is actually needed/used
  console.log("\n=== Contract Analysis ===");
  try {
    const adminRole = await tm.DEFAULT_ADMIN_ROLE();
    const isAdmin = await tm.hasRole(adminRole, signer.address);
    console.log("Deployer is admin:", isAdmin);
  } catch (e) {
    console.log("Could not verify admin role:", e.message);
  }

  // Check transaction logs for RoleGranted event
  if (receipt) {
    const iface = tm.interface;
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed?.name === "RoleGranted") {
          console.log("\n=== RoleGranted Event Found ===");
          console.log("Role:", parsed.args[0]);
          console.log("Account:", parsed.args[1]);
          console.log("Sender:", parsed.args[2]);
        }
      } catch {
        // ignore non-matching logs
      }
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
