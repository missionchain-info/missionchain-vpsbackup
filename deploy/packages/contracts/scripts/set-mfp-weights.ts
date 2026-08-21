/**
 * Register every MFP-NFT holder with the MFP reward pool.
 *
 * The pool is a FLAT-WEIGHT pool: `nft` is deliberately unset and `flatWeight` is 100000,
 * so holders do not enrol — an operator reports each wallet's pass count with `setWeight`,
 * and the contract refuses `setWeight` once an NFT contract is set. Nothing has ever called
 * it, so `totalWeight` is 0 and the MIC arriving each day has no one to go to.
 *
 * Dry-run unless EXECUTE=1.
 *
 *   npx hardhat run scripts/set-mfp-weights.ts --network bsc
 */
import { ethers } from "hardhat";

const POOL = "0xFb79deC4F0CDe13A667018e567dD636255D61d6d";
const MFP  = "0xAE6F32A6fdf80F5e54ba85441386dBA6a381f565";
const EXECUTE = process.env.EXECUTE === "1";

const f = (x: bigint) => Number(ethers.formatEther(x)).toLocaleString("vi-VN", { maximumFractionDigits: 4 });

async function main() {
  const net = await ethers.provider.getNetwork();
  if (net.chainId !== 56n) throw new Error(`Sai mạng: ${net.chainId}`);
  const [signer] = await ethers.getSigners();

  console.log(`\n═══ setWeight cho MFP pool · ${EXECUTE ? "THỰC THI" : "CHẠY KHÔ"} ═══`);
  console.log(`  ví ký  ${signer.address}\n`);

  const pool = await ethers.getContractAt([
    "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
    "function hasRole(bytes32,address) view returns (bool)",
    "function nft() view returns (address)",
    "function flatWeight() view returns (uint256)",
    "function totalWeight() view returns (uint256)",
    "function weightOf(address) view returns (uint256)",
    "function setWeight(address,uint256)",
  ], POOL, signer);

  const nft = await ethers.getContractAt([
    "function totalSupply() view returns (uint256)",
    "function ownerOf(uint256) view returns (address)",
  ], MFP);

  // Guard rails, in the order the contract itself checks them.
  const admin = await pool.DEFAULT_ADMIN_ROLE();
  if (!(await pool.hasRole(admin, signer.address))) throw new Error("Ví ký không có DEFAULT_ADMIN_ROLE");
  if ((await pool.nft()) !== ethers.ZeroAddress) throw new Error("Pool đã trỏ NFT — setWeight sẽ revert");
  const flat = await pool.flatWeight();
  if (flat === 0n) throw new Error("flatWeight = 0 — pool không ở chế độ phẳng");
  console.log(`  flatWeight ${flat}  ·  totalWeight hiện tại ${await pool.totalWeight()}\n`);

  // Count passes per wallet straight from the collection — the chain is the register.
  const supply = Number(await nft.totalSupply());
  const held = new Map<string, number>();
  for (let id = 1; id <= supply; id++) {
    try {
      const o: string = await nft.ownerOf(id);
      held.set(o, (held.get(o) ?? 0) + 1);
    } catch { /* burned or never minted */ }
  }

  const rows = [...held.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`── ${supply} pass · ${rows.length} ví ──`);

  let changes = 0;
  for (const [who, passes] of rows) {
    const now = await pool.weightOf(who);
    const want = BigInt(passes) * flat;
    const same = now === want;
    console.log(`  ${who}  ${String(passes).padStart(2)} pass  ${now} → ${want}  ${same ? "(không đổi)" : EXECUTE ? "▶" : "○ SẼ ĐẶT"}`);
    if (same) continue;
    changes += 1;
    if (EXECUTE) {
      // Explicit limit with headroom. The first calls run while totalWeight is 0, where
      // _sync() returns early and costs little; once weight exists it accrues on every
      // call and costs more than an estimate taken against the cheaper state. One tx
      // reverted at 85,647 gas that way.
      const tx = await pool.setWeight(who, passes, { gasLimit: 250_000 });
      const rc = await tx.wait();
      if (rc?.status !== 1) throw new Error(`setWeight reverted for ${who} — ${tx.hash}`);
    }
  }

  if (!EXECUTE) {
    console.log(`\n  ${changes} ví cần cập nhật. Đặt EXECUTE=1 để thực thi.\n`);
    return;
  }

  const total = await pool.totalWeight();
  const expect = BigInt(supply) * flat;
  console.log(`\n  totalWeight ${total}  ·  kỳ vọng ${expect}  ${total === expect ? "✅" : "❌ LỆCH"}`);
  console.log(`  ${changes} ví đã cập nhật.\n`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
