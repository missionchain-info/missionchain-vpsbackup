/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Burn the 31,500,000 MIC held by LiquidityPoolV5 — PERMANENT, IRREVERSIBLE
 * ─────────────────────────────────────────────────────────────────────────────
 * LiquidityPoolV5 (0x3709…050a) has no withdrawal path of any kind: swapUsdtToMic
 * and swapMicToUsdt are `pure` reverts and there is no withdrawMIC. The only way
 * its 31.5M MIC can ever leave the contract is swapAndBurnMIC, which calls
 * mic.burn() on the pool's own balance.
 *
 * So this does not "lock" the tokens — it destroys them. MICToken.totalSupply
 * drops 1,050,000,000 → 1,018,500,000 and no one, including the Owner, can mint
 * them back: the only live mint path is mintFromMining, bounded by the cumulative
 * counter totalMiningMinted, which a burn does not reset.
 *
 *   Review:   npx hardhat run scripts/burn-lp5-mic.ts --network bsc
 *   Execute:  EXECUTE=1 npx hardhat run scripts/burn-lp5-mic.ts --network bsc
 *
 * Run from the VPS. Requires the signer to hold BURN_CALLER_ROLE (granted here)
 * and USDT_IN of USDT, which is consumed by the call and stays in the pool forever.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { ethers } from "hardhat"

const LP5  = "0x37091454eB49179D3aFF12402980F63cFC3e050a"
const MIC  = "0xf27ec0c311728b923b22828002c992c799326182"
const USDT = "0x55d398326f99059fF775485246999027B3197955"

/// BSC-USD is 18 decimals, not 6. swapAndBurnMIC divides by 1e6 regardless:
///   micAmount = usdtAmount × micPerUsdtRate / 1e6
/// $1 in and a rate of 3.15e13 lands exactly on the pool's 31.5M balance.
const USDT_IN = ethers.parseUnits("1", 18)
const RATE    = 31_500_000_000_000n
const TARGET  = ethers.parseUnits("31500000", 18)

const LP5_ABI = [
  "function setMicBurnRate(uint256)",
  "function swapAndBurnMIC(uint256)",
  "function grantRole(bytes32,address)",
  "function hasRole(bytes32,address) view returns (bool)",
  "function micPerUsdtRate() view returns (uint256)",
  "function totalMicBurned() view returns (uint256)",
  "function micBalance() view returns (uint256)",
  "function previewBurn(uint256) view returns (uint256)",
]

async function main() {
  const EXECUTE = process.env.EXECUTE === "1"
  const [signer] = await ethers.getSigners()

  const lp5  = new ethers.Contract(LP5, LP5_ABI, signer)
  const mic  = new ethers.Contract(MIC, [
    "function balanceOf(address) view returns (uint256)",
    "function totalSupply() view returns (uint256)",
    "function paused() view returns (bool)",
    "function lockManager() view returns (address)",
  ], signer)
  const usdt = new ethers.Contract(USDT, [
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address,address) view returns (uint256)",
    "function approve(address,uint256) returns (bool)",
  ], signer)

  const BURN_CALLER = ethers.id("BURN_CALLER_ROLE")
  const RATE_SETTER = ethers.id("RATE_SETTER_ROLE")

  console.log("═".repeat(74))
  console.log("BURN LiquidityPoolV5 MIC" + (EXECUTE ? "   [EXECUTE — IRREVERSIBLE]" : "   [DRY-RUN]"))
  console.log("═".repeat(74))
  console.log("Signer:", signer.address)

  // ═══════════════ PRE-FLIGHT ═══════════════
  const problems: string[] = []
  const poolMic  = await mic.balanceOf(LP5)
  const supply0  = await mic.totalSupply()
  const usdtBal  = await usdt.balanceOf(signer.address)
  const bnb      = await ethers.provider.getBalance(signer.address)

  console.log("\n── pre-flight ──")
  console.log("  LP5 MIC balance   :", ethers.formatUnits(poolMic, 18))
  console.log("  MIC totalSupply   :", ethers.formatUnits(supply0, 18))
  console.log("  MIC paused        :", await mic.paused())
  console.log("  signer USDT       :", ethers.formatUnits(usdtBal, 18))
  console.log("  signer BNB        :", ethers.formatEther(bnb))
  console.log("  has RATE_SETTER   :", await lp5.hasRole(RATE_SETTER, signer.address))
  console.log("  has BURN_CALLER   :", await lp5.hasRole(BURN_CALLER, signer.address))
  console.log("  has ADMIN         :", await lp5.hasRole(ethers.ZeroHash, signer.address))
  console.log("  already burned    :", ethers.formatUnits(await lp5.totalMicBurned(), 18))

  const lm = await mic.lockManager()
  if (lm !== ethers.ZeroAddress) {
    const locked = await (new ethers.Contract(lm, ["function lockedOf(address) view returns (uint256)"], signer)).lockedOf(LP5)
    console.log("  lockedOf(LP5)     :", ethers.formatUnits(locked, 18), locked === 0n ? "✓" : "← phải = 0")
    if (locked !== 0n) problems.push("LP5's MIC is locked in LockManager — _update would revert on burn")
  }

  // The arithmetic must land exactly on the balance: short burns leave a remainder,
  // long ones revert on the contract's own balance check.
  const computed = (USDT_IN * RATE) / 1_000_000n
  console.log("\n── arithmetic ──")
  console.log("  usdtAmount        :", ethers.formatUnits(USDT_IN, 18), "USDT")
  console.log("  micPerUsdtRate    :", RATE.toString())
  console.log("  → micAmount       :", ethers.formatUnits(computed, 18), "MIC")
  console.log("  pool balance      :", ethers.formatUnits(poolMic, 18), "MIC")
  console.log("  khớp chính xác    :", computed === poolMic && computed === TARGET ? "✓" : "✗")

  if (computed !== poolMic) problems.push(`computed burn ${ethers.formatUnits(computed,18)} ≠ pool balance ${ethers.formatUnits(poolMic,18)}`)
  if (!await lp5.hasRole(ethers.ZeroHash, signer.address)) problems.push("signer lacks DEFAULT_ADMIN_ROLE — cannot grant BURN_CALLER_ROLE")
  if (!await lp5.hasRole(RATE_SETTER, signer.address)) problems.push("signer lacks RATE_SETTER_ROLE — cannot call setMicBurnRate")
  if (usdtBal < USDT_IN) problems.push(`signer holds ${ethers.formatUnits(usdtBal,18)} USDT, needs ${ethers.formatUnits(USDT_IN,18)} — fund the wallet first`)
  if (bnb < ethers.parseEther("0.005")) problems.push("BNB below 0.005 — top up for gas")

  console.log("\n── plan ──")
  console.log("  1. setMicBurnRate(" + RATE + ")")
  console.log("  2. grantRole(BURN_CALLER_ROLE, signer)")
  console.log("  3. USDT.approve(LP5, " + ethers.formatUnits(USDT_IN, 18) + ")")
  console.log("  4. swapAndBurnMIC(" + ethers.formatUnits(USDT_IN, 18) + ")  → burns " + ethers.formatUnits(computed, 18) + " MIC")
  console.log("\n  totalSupply sau khi đốt:", ethers.formatUnits(supply0 - computed, 18), "MIC")
  console.log("  (giảm", ((Number(computed) / Number(supply0)) * 100).toFixed(2) + "% nguồn cung đang lưu hành)")

  if (problems.length) {
    console.log("\n❌ BLOCKERS")
    problems.forEach(p => console.log("   •", p))
  }
  if (!EXECUTE) { console.log("\n🧪 DRY-RUN — chưa gửi gì. Đặt EXECUTE=1 để đốt thật."); return }
  if (problems.length) { console.log("\n❌ Dừng lại: xử lý blocker ở trên trước."); process.exit(1) }

  // ═══════════════ EXECUTE ═══════════════
  const R = async (label: string, p: Promise<any>) => { const tx = await p; console.log("   ", label, "→", tx.hash); await tx.wait(); console.log("    ✓") }

  console.log("\n── broadcasting ──")
  if ((await lp5.micPerUsdtRate()) !== RATE) await R("setMicBurnRate", lp5.setMicBurnRate(RATE))
  if (!(await lp5.hasRole(BURN_CALLER, signer.address))) await R("grantRole BURN_CALLER", lp5.grantRole(BURN_CALLER, signer.address))
  if ((await usdt.allowance(signer.address, LP5)) < USDT_IN) await R("USDT.approve", usdt.approve(LP5, USDT_IN))
  await R("swapAndBurnMIC", lp5.swapAndBurnMIC(USDT_IN))

  const supply1 = await mic.totalSupply()
  console.log("\n── kết quả ──")
  console.log("  LP5 MIC balance   :", ethers.formatUnits(await mic.balanceOf(LP5), 18), "(phải = 0)")
  console.log("  LP5 totalMicBurned:", ethers.formatUnits(await lp5.totalMicBurned(), 18))
  console.log("  MIC totalSupply   :", ethers.formatUnits(supply0, 18), "→", ethers.formatUnits(supply1, 18))
  console.log("  đã đốt            :", ethers.formatUnits(supply0 - supply1, 18), "MIC")

  console.log("\n── việc thủ công còn lại ──")
  console.log("  • lưu tx hash để công bố + đưa vào tài liệu")
  console.log("  • dashboard.ts: bỏ liquidityPoolV5Balance khỏi inContracts, đọc totalBurned on-chain")
  console.log("  • cập nhật total supply trong White Paper 5 ngôn ngữ + deck")
}

main().catch(e => { console.error(e); process.exit(1) })
