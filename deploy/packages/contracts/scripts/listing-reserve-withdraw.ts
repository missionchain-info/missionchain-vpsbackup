/**
 * ─────────────────────────────────────────────────────────────────────────────
 * ListingReserveVault — 2-step withdrawal helper
 * ─────────────────────────────────────────────────────────────────────────────
 * Pulls MIC out of the vault to seed LiquidityPoolV6. Withdrawal is
 * requestWithdraw → 7-day cooldown → executeWithdraw, so this runs three times
 * across a week:
 *
 *   ACTION=request  npx hardhat run scripts/listing-reserve-withdraw.ts --network bsc
 *   ACTION=status   ...                                       (any time)
 *   ACTION=execute ID=1 ...                                   (after day 7)
 *
 * Dry-run by default. Add EXECUTE=1 to broadcast.
 *
 * The deployed vault uses AccessControl (DEFAULT_ADMIN_ROLE gates requestWithdraw),
 * NOT the `owner`/`onlyOwner` pattern in contracts/treasury/ListingReserveVault.sol.
 * The local file has drifted from mainnet, so the ABI below is written out
 * explicitly rather than taken from the artifact.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { ethers } from "hardhat"

const VAULT = "0x2EE1b6B7108851BB721cA1c9B8aCEf76e70C8f16"
const MIC = "0xf27ec0c311728b923b22828002c992c799326182"

/// Destination must be an address that can later call approve() + seedMic() on
/// LiquidityPoolV6. Sending straight to the pool strands the MIC: seedMic uses
/// transferFrom and credits reserveMic, and a raw transfer credits nothing.
const RECIPIENT = "0xD32e666381b56f979D60C57831838f05F33AD6c2"
const AMOUNT = ethers.parseUnits("50000000", 18)
const EXCHANGE = "LiquidityPoolV6"
const REASON = "Seed the protocol swap pool (M0 = 50,000,000 MIC at P0 $0.01)"

const VAULT_ABI = [
  "function requestWithdraw(address,uint256,string,string) returns (uint256)",
  "function executeWithdraw(uint256)",
  "function cancelWithdraw(uint256)",
  "function nextRequestId() view returns (uint256)",
  "function totalWithdrawn() view returns (uint256)",
  "function vaultBalance() view returns (uint256)",
  "function COOLDOWN() view returns (uint256)",
  "function hasRole(bytes32,address) view returns (bool)",
  "function getRequest(uint256) view returns (tuple(uint256 id,address recipient,uint256 amount,string exchange,string reason,address requester,uint64 createdAt,uint64 cooldownEnd,uint8 status,uint64 executedAt))",
]

const STATUS = ["PENDING", "EXECUTED", "CANCELLED"]

async function main() {
  const EXECUTE = process.env.EXECUTE === "1"
  const ACTION = (process.env.ACTION ?? "status").toLowerCase()
  const [signer] = await ethers.getSigners()

  const vault = new ethers.Contract(VAULT, VAULT_ABI, signer)
  const mic = new ethers.Contract(MIC, ["function balanceOf(address) view returns (uint256)"], signer)

  console.log("═".repeat(74))
  console.log(`ListingReserveVault — ${ACTION}` + (EXECUTE ? "  [EXECUTE]" : "  [DRY-RUN]"))
  console.log("═".repeat(74))
  console.log("Signer         :", signer.address)
  console.log("Vault MIC      :", ethers.formatUnits(await vault.vaultBalance(), 18))
  console.log("Signer MIC     :", ethers.formatUnits(await mic.balanceOf(signer.address), 18))
  console.log("Signer BNB     :", ethers.formatEther(await ethers.provider.getBalance(signer.address)))

  const isAdmin = await vault.hasRole(ethers.ZeroHash, signer.address)
  console.log("Signer is admin:", isAdmin)

  if (ACTION === "status") {
    const n = await vault.nextRequestId()
    console.log("\nRequests:", n.toString(), " total withdrawn:", ethers.formatUnits(await vault.totalWithdrawn(), 18))
    for (let i = 1n; i <= n; i++) {
      const r = await vault.getRequest(i)
      const left = Number(r.cooldownEnd) - Math.floor(Date.now() / 1000)
      console.log(
        `  #${r.id}  ${ethers.formatUnits(r.amount, 18)} MIC → ${r.recipient}  ${STATUS[Number(r.status)]}` +
          (Number(r.status) === 0
            ? left > 0
              ? `  (còn ${(left / 86400).toFixed(2)} ngày)`
              : "  (SẴN SÀNG execute)"
            : "")
      )
    }
    return
  }

  if (ACTION === "request") {
    if (!isAdmin) { console.log("\n❌ Signer không có DEFAULT_ADMIN_ROLE — không gọi được requestWithdraw."); return }
    const bal = await vault.vaultBalance()
    if (bal < AMOUNT) { console.log("\n❌ Vault không đủ MIC."); return }

    console.log("\n── plan ──")
    console.log("  requestWithdraw(")
    console.log("    recipient:", RECIPIENT)
    console.log("    amount   :", ethers.formatUnits(AMOUNT, 18), "MIC")
    console.log("    exchange :", EXCHANGE)
    console.log("    reason   :", REASON)
    console.log("  )")
    console.log("  → cooldown 7 ngày, sau đó bất kỳ ai gọi executeWithdraw(id) cũng được")
    console.log("  → vault còn lại sau khi execute:", ethers.formatUnits(bal - AMOUNT, 18), "MIC")

    if (!EXECUTE) { console.log("\n🧪 DRY-RUN — chưa gửi gì. Đặt EXECUTE=1 để phát lệnh."); return }

    const tx = await vault.requestWithdraw(RECIPIENT, AMOUNT, EXCHANGE, REASON)
    console.log("\n  tx:", tx.hash)
    const rc = await tx.wait()
    console.log("  ✓ mined in block", rc?.blockNumber, " — id =", (await vault.nextRequestId()).toString())
    return
  }

  if (ACTION === "execute") {
    const id = BigInt(process.env.ID ?? "0")
    if (id === 0n) { console.log("\n❌ Thiếu ID=<n>"); return }
    const r = await vault.getRequest(id)
    const left = Number(r.cooldownEnd) - Math.floor(Date.now() / 1000)
    console.log("\n── request #" + id + " ──")
    console.log("  recipient :", r.recipient)
    console.log("  amount    :", ethers.formatUnits(r.amount, 18), "MIC")
    console.log("  status    :", STATUS[Number(r.status)])
    console.log("  cooldown  :", left > 0 ? `còn ${(left / 86400).toFixed(2)} ngày` : "đã hết — execute được")
    if (Number(r.status) !== 0) { console.log("\n❌ Request không ở trạng thái PENDING."); return }
    if (left > 0) { console.log("\n❌ Cooldown chưa hết."); return }
    if (!EXECUTE) { console.log("\n🧪 DRY-RUN — chưa gửi gì. Đặt EXECUTE=1 để execute."); return }

    const tx = await vault.executeWithdraw(id)
    console.log("\n  tx:", tx.hash)
    const rc = await tx.wait()
    console.log("  ✓ mined in block", rc?.blockNumber)
    console.log("  recipient MIC giờ là:", ethers.formatUnits(await mic.balanceOf(r.recipient), 18))
    return
  }

  console.log("\nACTION phải là: status | request | execute")
}

main().catch(e => { console.error(e); process.exit(1) })
