/**
 * Move the MFP reward pool from flat-weight to NFT mode.
 *
 * WHY. NftRewardPoolV2 has two mutually exclusive modes. Flat-weight (`nft == 0`) lets only
 * an admin write weight, through `setWeight`; weight does not follow an ERC-721 transfer, so
 * a buyer has to ask an operator to be paid at all. NFT mode (`nft != 0`) makes `enroll` and
 * `resync` permissionless — the holder serves themselves and the operator leaves the loop.
 *
 * ORDER MATTERS. `enroll` ADDS to `weightOf`. Switching modes without zeroing the existing
 * weights first would leave every holder counted twice; the suite proves it.
 *
 * WHAT IS SAFE. While totalWeight is 0 the stream accrues to `carryOver` and is folded into
 * the next `notifyReward` — nothing is lost. And `enroll` credits `nft.ownerOf(tokenId)`,
 * not the caller, so this script enrols the whole collection on everyone's behalf and no
 * holder needs to be quick, or even present.
 *
 * Dry-run unless EXECUTE=1.
 */
import { ethers, network } from "hardhat";

const POOL = "0xFb79deC4F0CDe13A667018e567dD636255D61d6d";
const MFP  = "0xAE6F32A6fdf80F5e54ba85441386dBA6a381f565";
const EXECUTE = process.env.EXECUTE === "1";
const GAS = { gasLimit: 400_000 };

async function main() {
  // The rehearsal runs the SAME sequence against a mainnet fork, which reports 31337.
  // Anything else is refused: this script writes to a pool holding other people's rewards.
  const FORK = process.env.FORK_BSC === "1";
  const net = await ethers.provider.getNetwork();
  if (net.chainId !== 56n && !(FORK && net.chainId === 31337n))
    throw new Error(`Sai mạng: ${net.chainId}`);

  const OWNER = "0xD32e666381b56f979D60C57831838f05F33AD6c2";
  let signer;
  if (FORK) {
    await network.provider.send("evm_mine");
    await network.provider.send("hardhat_impersonateAccount", [OWNER]);
    await network.provider.send("hardhat_setBalance", [OWNER, "0x56BC75E2D63100000"]);
    signer = await ethers.getSigner(OWNER);
    console.log("  (diễn tập trên fork — không chạm mainnet)");
  } else {
    [signer] = await ethers.getSigners();
  }

  console.log(`\n═══ MFP pool: flat-weight → NFT mode · ${EXECUTE ? "THỰC THI" : "CHẠY KHÔ"} ═══`);
  console.log(`  ví ký  ${signer.address}\n`);

  const pool = await ethers.getContractAt([
    "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
    "function hasRole(bytes32,address) view returns (bool)",
    "function nft() view returns (address)",
    "function flatWeight() view returns (uint256)",
    "function totalWeight() view returns (uint256)",
    "function weightOf(address) view returns (uint256)",
    "function carryOver() view returns (uint256)",
    "function setWeight(address,uint256)",
    "function setNft(address)",
    "function enrollBatch(uint256[])",
  ], POOL, signer);

  const col = await ethers.getContractAt([
    "function totalSupply() view returns (uint256)",
    "function ownerOf(uint256) view returns (address)",
  ], MFP);

  if (!(await pool.hasRole(await pool.DEFAULT_ADMIN_ROLE(), signer.address)))
    throw new Error("Ví ký không có DEFAULT_ADMIN_ROLE");
  if ((await pool.nft()) !== ethers.ZeroAddress)
    throw new Error("Pool đã ở NFT mode — không cần chạy lại");

  const flat: bigint = await pool.flatWeight();
  const supply = Number(await col.totalSupply());

  // Current ownership is the register; the mint table is not.
  const owners = new Map<string, number[]>();
  const ids: number[] = [];
  for (let id = 1; id <= supply; id++) {
    try {
      const o = ethers.getAddress(await col.ownerOf(id));
      (owners.get(o) ?? owners.set(o, []).get(o)!).push(id);
      ids.push(id);
    } catch { /* burned or never minted */ }
  }
  const wallets = [...owners.keys()];

  console.log(`── hiện trạng ──`);
  console.log(`  totalWeight   ${await pool.totalWeight()}  ·  flatWeight ${flat}`);
  console.log(`  carryOver     ${ethers.formatEther(await pool.carryOver())} MIC`);
  console.log(`  ${ids.length} pass  ·  ${wallets.length} ví\n`);

  console.log(`── ① đưa mọi ví về 0 (nếu không, enroll sẽ cộng chồng) ──`);
  const toZero: string[] = [];
  for (const w of wallets) {
    const cur: bigint = await pool.weightOf(w);
    if (cur === 0n) continue;
    toZero.push(w);
    console.log(`  ${w}  ${cur} → 0`);
  }
  if (toZero.length === 0) console.log(`  (không ví nào đang mang weight)`);

  console.log(`\n── ② setNft(adapter) — mở enroll/resync cho mọi người ──`);
  console.log(`  ${EXECUTE ? "▶" : "○ SẼ"} deploy MFPNftAdapter(${MFP}) rồi setNft`);

  console.log(`\n── ③ enrollBatch cho toàn bộ ${ids.length} pass ──`);
  console.log(`  enroll ghi cho nft.ownerOf(tokenId), nên không ai phải tự bấm để được ghi danh`);

  if (!EXECUTE) {
    console.log(`\n  Đặt EXECUTE=1 để thực thi. ${toZero.length} lệnh zero + 1 deploy + 1 setNft + 1 enrollBatch.\n`);
    return;
  }

  for (const w of toZero) {
    const tx = await pool.setWeight(w, 0, GAS);
    const rc = await tx.wait();
    if (rc?.status !== 1) throw new Error(`setWeight(${w}, 0) reverted — ${tx.hash}`);
    console.log(`  ✅ ${w} → 0`);
  }
  if ((await pool.totalWeight()) !== 0n) throw new Error("totalWeight chưa về 0 — dừng trước khi đổi chế độ");

  const adapter = await (await ethers.getContractFactory("MFPNftAdapter")).deploy(MFP);
  await adapter.waitForDeployment();
  const addr = await adapter.getAddress();
  console.log(`\n  ✅ adapter ${addr}`);

  const tx2 = await pool.setNft(addr, GAS);
  if ((await tx2.wait())?.status !== 1) throw new Error("setNft reverted");
  console.log(`  ✅ setNft`);

  // One transaction for the whole collection. 23 enrols fits comfortably; if the collection
  // grows this must be chunked, so the bound is asserted rather than assumed.
  if (ids.length > 60) throw new Error(`${ids.length} pass — chia lô trước khi enroll`);
  const tx3 = await pool.enrollBatch(ids, { gasLimit: 200_000 + ids.length * 180_000 });
  if ((await tx3.wait())?.status !== 1) throw new Error("enrollBatch reverted");
  console.log(`  ✅ enrollBatch ${ids.length} pass`);

  console.log(`\n── đối chiếu ──`);
  const total: bigint = await pool.totalWeight();
  const expect = BigInt(ids.length) * 10_000n;   // adapter WEIGHT
  console.log(`  totalWeight ${total} · kỳ vọng ${expect} ${total === expect ? "✅" : "❌ LỆCH"}`);
  let bad = 0;
  for (const [w, list] of owners) {
    const got: bigint = await pool.weightOf(w);
    const want = BigInt(list.length) * 10_000n;
    if (got !== want) { bad++; console.log(`  ❌ ${w}  ${got} ≠ ${want}`); }
  }
  console.log(bad === 0 ? `  mọi ví khớp số pass đang giữ ✅\n` : `  ${bad} ví lệch ❌\n`);
  console.log(`  Verify: npx hardhat verify --network bsc ${addr} ${MFP}\n`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
