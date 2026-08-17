/**
 * Does a real revenue distribution survive with V7 as the liquidity target?
 *
 * The pool accepting a direct `receiveUSDT` is not the same question. RevenueRouter calls
 * it through `_fundPool` — `forceApprove` then a typed `IUSDTReceiver(pool).receiveUSDT()`
 * — inside the same transaction as the sale. If that leg reverts, the sale reverts. This
 * exercises that exact path against the live router on a fork, before it is repointed for
 * real.
 *
 *   FORK_BSC=1 FORK_BLOCK=<recent> npx hardhat run scripts/forktest-router-v7.ts
 */
import { ethers, network } from "hardhat"

const ROUTER = "0xf86b0cF9ce21250429b522Ed62a5B6b549539672"
const V7     = "0x70E28Abcce584e2B3423737Dc3497e3A278641aF"
const V6     = "0xf6AB7103d1072416366D34Ce5E8A41074feCC98e"
const USDT   = "0x55d398326f99059fF775485246999027B3197955"
const OWNER  = "0xD32e666381b56f979D60C57831838f05F33AD6c2"
const PRESALE= "0xC4A6cd57DE0619daCDfD190E9A4D9682Ed78BE23"
const WHALE  = "0xF977814e90dA44bFA03b6295A0616a897441aceC"

let fail = 0
const check = (l: string, ok: boolean, d = "") => { console.log(`  ${ok ? "✓" : "✗"} ${l}${d ? "   " + d : ""}`); if (!ok) fail++ }

async function as(a: string) {
  await network.provider.request({ method: "hardhat_impersonateAccount", params: [a] })
  await network.provider.send("hardhat_setBalance", [a, "0x21E19E0C9BAB2400000"])
  return ethers.getSigner(a)
}

async function main() {
  // Mine one block first. A `view` call made AT the fork block is treated as historical,
  // and the in-process node has no hardfork history for chain 56 before that point.
  await network.provider.send("evm_mine")
  const blk = await ethers.provider.getBlockNumber()
  console.log("═".repeat(78)); console.log("ROUTER → V7 · real distribution path"); console.log("═".repeat(78))
  console.log("  forked block:", blk)
  if (blk < 100_000_000) throw new Error("run with FORK_BSC=1")

  const owner = await as(OWNER)
  const whale = await as(WHALE)
  const presale = await as(PRESALE)      // holds DISTRIBUTOR_ROLE on the router

  const usdt: any = new ethers.Contract(USDT, [
    "function balanceOf(address) view returns (uint256)",
    "function transfer(address,uint256) returns (bool)",
    "function approve(address,uint256) returns (bool)",
  ], whale)
  const router: any = new ethers.Contract(ROUTER, [
    "function receiveAndDistribute(uint256)",
    "function setLiquidity(address)",
    "function liquidity() view returns (address)",
    "function bpsLiquidity() view returns (uint256)",
    "function hasRole(bytes32,address) view returns (bool)",
    "function DISTRIBUTOR_ROLE() view returns (bytes32)",
  ], presale)
  const pool: any = new ethers.Contract(V7, [
    "function reserveUsdt() view returns (uint256)",
    "function effectiveUsdt() view returns (uint256)",
    "function virtualReserve() view returns (uint256)",
    "function totalUsdtReceived() view returns (uint256)",
    "function isSeeded() view returns (bool)",
    "function spotPrice() view returns (uint256)",
  ], owner)

  console.log("\n── before ──")
  console.log("  router.liquidity:", await router.liquidity())
  check("PreSale holds DISTRIBUTOR_ROLE on the router",
        await router.hasRole(await router.DISTRIBUTOR_ROLE(), PRESALE))
  check("V7 is dormant", (await pool.isSeeded()) === false)

  // Fund the caller exactly as a sale would, then repoint and distribute.
  const amt = ethers.parseUnits("1000", 18)
  await usdt.connect(whale).transfer(PRESALE, amt * 6n)   // baseline + 3 runs, with room
  await usdt.connect(presale).approve(ROUTER, ethers.MaxUint256)

  console.log("\n── baseline: distribution with the CURRENT target (V6) ──")
  await router.connect(presale).receiveAndDistribute(amt)
  check("a sale completes today", true)

  console.log("\n── repoint to V7 and distribute again ──")
  await router.connect(owner).setLiquidity(V7)
  check("router now points at V7", (await router.liquidity()).toLowerCase() === V7.toLowerCase())

  const before = await pool.reserveUsdt()
  const effBefore = await pool.effectiveUsdt()
  await router.connect(presale).receiveAndDistribute(amt)

  const got = (await pool.reserveUsdt()) - before
  check("THE SALE COMPLETED with a dormant V7 as the liquidity target", true)
  check("V7 received the liquidity slice", got > 0n,
        "$" + ethers.formatUnits(got, 18) + " of $" + ethers.formatUnits(amt, 18) +
        " (" + (Number(got) / Number(amt) * 100).toFixed(1) + "%)")
  check("effectiveUsdt unchanged — real displaced virtual one-for-one",
        (await pool.effectiveUsdt()) === effBefore,
        "$" + ethers.formatUnits(await pool.effectiveUsdt(), 18))
  check("still dormant, still quoting nothing",
        (await pool.isSeeded()) === false && (await pool.spotPrice()) === 0n)

  console.log("\n── a second and third sale, to be sure it is not a one-off ──")
  await router.connect(presale).receiveAndDistribute(amt)
  await router.connect(presale).receiveAndDistribute(amt)
  check("three consecutive sales all completed", true,
        "V7 now holds $" + ethers.formatUnits(await pool.reserveUsdt(), 18))
  check("effectiveUsdt STILL pinned", (await pool.effectiveUsdt()) === effBefore)

  console.log("\n" + "═".repeat(78))
  if (fail === 0) console.log("✅ SAFE TO REPOINT — sales complete with V7 as the liquidity target")
  else { console.log(`❌ ${fail} check(s) failed — DO NOT repoint`); process.exit(1) }
}
main().catch(e => { console.error(e); process.exit(1) })
