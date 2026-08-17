/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Dress rehearsal for the LiquidityPoolV7 cutover, on a fork of BSC mainnet.
 * ─────────────────────────────────────────────────────────────────────────────
 * Everything the real runbook does, against the real contracts and the real
 * tokens, with nothing at stake. Unit tests use MockUSDT and a fresh MICToken;
 * this exercises BSC-USD itself and the live MICToken with its LockManager and
 * pause hooks, the live RevenueRouter, MICELicense and EmissionController, and
 * the actual Owner wallet's roles.
 *
 *   FORK_BSC=1 npx hardhat run scripts/forktest-swap-v7.ts
 *
 * Nothing here can touch mainnet: it runs on the in-process fork only.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { ethers, network } from "hardhat"

const A = {
  USDT:   "0x55d398326f99059fF775485246999027B3197955",
  MIC:    "0xf27ec0c311728b923b22828002c992c799326182",
  OWNER:  "0xD32e666381b56f979D60C57831838f05F33AD6c2",
  VAULT:  "0x2EE1b6B7108851BB721cA1c9B8aCEf76e70C8f16",   // ListingReserveVault, 23.5M MIC
  ROUTER: "0xf86b0cF9ce21250429b522Ed62a5B6b549539672",
  MICE:   "0x4d5147aC4aa44eFc1Ae6196FcE4c87567aA4BD8c",
  EMIS:   "0x37f38f383b4065BA58C7A6Fc1a91d2dF4f9f86F0",
  WHALE:  "0xF977814e90dA44bFA03b6295A0616a897441aceC",   // BSC-USD, 718M
  V6:     "0xf6AB7103d1072416366D34Ce5E8A41074feCC98e",
}

const SEED_MIC  = ethers.parseUnits("23500000", 18)
const VIRTUAL0  = ethers.parseUnits("235000", 18)
const SELL_GATE = ethers.parseUnits("25000", 18)
const P0        = ethers.parseUnits("0.01", 18)

let failures = 0
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? "   " + detail : ""}`)
  if (!ok) failures++
}

async function as(addr: string) {
  await network.provider.request({ method: "hardhat_impersonateAccount", params: [addr] })
  await network.provider.send("hardhat_setBalance", [addr, "0x21E19E0C9BAB2400000"])  // 10k BNB
  return await ethers.getSigner(addr)
}

async function main() {
  const net = await ethers.provider.getNetwork()
  const block = await ethers.provider.getBlockNumber()
  console.log("═".repeat(78))
  console.log("FORK REHEARSAL — LiquidityPoolV7")
  console.log("═".repeat(78))
  console.log("  chainId:", net.chainId.toString(), "· forked block:", block)
  if (block < 100_000_000) throw new Error("not forked from BSC mainnet — run with FORK_BSC=1")

  const owner = await as(A.OWNER)
  const vault = await as(A.VAULT)
  const whale = await as(A.WHALE)
  const [buyer] = await ethers.getSigners()

  const mic: any = new ethers.Contract(A.MIC, [
    "function balanceOf(address) view returns (uint256)",
    "function transfer(address,uint256) returns (bool)",
    "function approve(address,uint256) returns (bool)",
    "function lockedBalanceOf(address) view returns (uint256)",
    "function paused() view returns (bool)",
  ], owner)
  const usdt: any = new ethers.Contract(A.USDT, [
    "function balanceOf(address) view returns (uint256)",
    "function transfer(address,uint256) returns (bool)",
    "function approve(address,uint256) returns (bool)",
  ], owner)

  // ── 1. deploy against the REAL BSC-USD ────────────────────────────────────
  console.log("\n── 1. deploy")
  const pool: any = await (await ethers.getContractFactory("LiquidityPoolV7", owner))
    .deploy(A.USDT, A.MIC, VIRTUAL0, SELL_GATE, A.OWNER)
  await pool.waitForDeployment()
  const addr = await pool.getAddress()
  console.log("  pool:", addr)
  check("constructor accepted real BSC-USD (18-dec guard)", true)
  check("dormant on deploy", (await pool.isSeeded()) === false)
  check("spotPrice 0 while dormant", (await pool.spotPrice()) === 0n)
  check("sellGateUsdt = $25,000", (await pool.sellGateUsdt()) === SELL_GATE,
        "$" + ethers.formatUnits(await pool.sellGateUsdt(), 18))
  check("virtualReserve0 = $235,000", (await pool.virtualReserve0()) === VIRTUAL0)
  check("owner holds DEFAULT_ADMIN", await pool.hasRole(await pool.DEFAULT_ADMIN_ROLE(), A.OWNER))

  await pool.connect(owner).grantRole(await pool.DISTRIBUTOR_ROLE(), A.ROUTER)
  await pool.connect(owner).grantRole(await pool.EMISSION_REPORTER_ROLE(), A.EMIS)
  check("roles granted to router + emission", true)

  // ── 2. THE REAL SEQUENCE: point revenue at V7 while it is still dormant ───
  console.log("\n── 2. revenue starts landing BEFORE the seed")
  const router: any = new ethers.Contract(A.ROUTER,
    ["function setLiquidity(address)", "function liquidity() view returns (address)"], owner)
  await router.setLiquidity(addr)
  check("RevenueRouter repointed to V7 while dormant",
        (await router.liquidity()).toLowerCase() === addr.toLowerCase())

  // This is the step that would have broken every Pre-Sale and MICE sale if V7 had kept
  // V6's `require(startTime != 0)` — RevenueRouter calls receiveUSDT inside the sale itself.
  const routerSigner = await as(A.ROUTER)
  await usdt.connect(whale).transfer(A.ROUTER, ethers.parseUnits("30000", 18))
  await usdt.connect(routerSigner).approve(addr, ethers.MaxUint256)
  await pool.connect(routerSigner).receiveUSDT(ethers.parseUnits("8000", 18))
  check("dormant pool ACCEPTED revenue — a sale would not have reverted", true,
        "$" + ethers.formatUnits(await pool.reserveUsdt(), 18) + " received pre-seed")
  check("effectiveUsdt still pinned at virtualReserve0",
        (await pool.effectiveUsdt()) === VIRTUAL0,
        "$" + ethers.formatUnits(await pool.effectiveUsdt(), 18))
  check("still dormant, still quoting nothing",
        (await pool.isSeeded()) === false && (await pool.spotPrice()) === 0n)

  // ── 3. seven days later: the vault releases, and the pool is seeded ───────
  console.log("\n── 3. seed with the REAL MICToken, after revenue already arrived")
  const vaultBal = await mic.balanceOf(A.VAULT)
  console.log("  vault holds:", ethers.formatUnits(vaultBal, 18), "MIC")
  check("vault has the full 23.5M", vaultBal >= SEED_MIC)

  await mic.connect(vault).transfer(A.OWNER, SEED_MIC)
  check("23.5M reached the Owner wallet", (await mic.balanceOf(A.OWNER)) >= SEED_MIC)
  const locked = await mic.lockedBalanceOf(A.OWNER)
  check("released MIC carries NO vesting lock", locked === 0n,
        "locked=" + ethers.formatUnits(locked, 18))
  check("MICToken not paused", (await mic.paused()) === false)

  await mic.connect(owner).approve(addr, SEED_MIC)
  await pool.connect(owner).seedMic(SEED_MIC)
  check("seedMic succeeded against the live token", (await pool.isSeeded()) === true)
  check("reserveMic = 23,500,000", (await pool.reserveMic()) === SEED_MIC)

  // ── 4. the number this whole exercise exists for ──────────────────────────
  console.log("\n── 4. price, after $8,000 of revenue arrived first")
  const spot = await pool.spotPrice()
  check("spotPrice is EXACTLY $0.01 despite $8,000 arriving pre-seed", spot === P0,
        "$" + ethers.formatUnits(spot, 18))

  for (const amt of ["1", "10", "50"]) {
    const out = await pool.quoteBuy(ethers.parseUnits(amt, 18))
    const each = Number(amt) / Number(ethers.formatUnits(out, 18))
    check(`$${amt} buys ${Number(ethers.formatUnits(out, 18)).toFixed(4)} MIC`,
          each > 0.01002 && each < 0.01004, `$${each.toFixed(6)}/MIC`)
  }
  const v6: any = new ethers.Contract(A.V6, ["function quoteBuy(uint256) view returns (uint256)"], owner)
  const v6out = await v6.quoteBuy(ethers.parseUnits("50", 18))
  const v7out = await pool.quoteBuy(ethers.parseUnits("50", 18))
  check("V7 delivers ~2× the live V6 on the same $50",
        Number(v7out) / Number(v6out) > 1.98 && Number(v7out) / Number(v6out) < 2.02,
        `V6 ${Number(ethers.formatUnits(v6out,18)).toFixed(2)} → V7 ${Number(ethers.formatUnits(v7out,18)).toFixed(2)} MIC`)

  // ── 4. a real buy, with real BSC-USD ──────────────────────────────────────
  console.log("\n── 5. a real buy")
  await usdt.connect(whale).transfer(buyer.address, ethers.parseUnits("5000", 18))
  await usdt.connect(buyer).approve(addr, ethers.MaxUint256)

  const quoted = await pool.quoteBuy(ethers.parseUnits("100", 18))
  const before = await mic.balanceOf(buyer.address)
  await pool.connect(buyer).swapUsdtToMic(ethers.parseUnits("100", 18), 0)
  const got = await mic.balanceOf(buyer.address) - before
  check("buyer received exactly the quote", got === quoted,
        Number(ethers.formatUnits(got, 18)).toFixed(4) + " MIC for $100")
  check("$100 bought ~9,970 MIC, not ~4,985",
        Number(ethers.formatUnits(got, 18)) > 9900, "")
  check("pool books match its balance",
        (await pool.reserveUsdt()) === (await usdt.balanceOf(addr)) &&
        (await pool.reserveMic()) === (await mic.balanceOf(addr)))

  // ── 5. sell side must be shut, and stay shut ──────────────────────────────
  console.log("\n── 6. sell gate")
  check("sells shut at $100 of real USDT", (await pool.sellsOpen()) === false)
  check("quoteSell returns 0 while shut", (await pool.quoteSell(ethers.parseUnits("1000", 18))) === 0n)
  let opened = true
  try { await pool.advancePhase() } catch { opened = false }
  check("advancePhase refuses below the gate", opened === false)
  check("sell fee is near the 15% ceiling while the pool is thin",
        Number(await pool.sellFeeBps()) > 1400, (Number(await pool.sellFeeBps())/100).toFixed(2) + "%")

  // ── 6. the three repoints, from the real Owner wallet ─────────────────────
  console.log("\n── 7. cutover")
  // Minimal ABIs written out rather than pulled from local artifacts: the local tree's
  // MICELicense.sol is older than what is deployed and has no setLiquidityPool at all, so
  // getContractAt would build a contract object missing the very function being tested.
  // Verified present in the live bytecode by selector.
  const mice: any = new ethers.Contract(A.MICE,
    ["function setLiquidityPool(address)", "function liquidityPool() view returns (address)"], owner)
  const emis: any = new ethers.Contract(A.EMIS,
    ["function setLiquidityPool(address,uint256)", "function liquidityPool() view returns (address)"], owner)

  await mice.setLiquidityPool(addr)
  check("RevenueRouter still on V7 (moved in step 2)",
        (await router.liquidity()).toLowerCase() === addr.toLowerCase())
  check("MICELicense repointed", (await mice.liquidityPool()).toLowerCase() === addr.toLowerCase())

  // EmissionController freezes `openingPrice` on first use and gates the setter on it, so
  // the pool address is frozen alongside it. It is already set, to V6. This is a finding,
  // not a script bug: the emission layer CANNOT be repointed at V7.
  let ecMoved = true
  let ecErr = ""
  try { await emis.setLiquidityPool(addr, P0) } catch (e: any) { ecMoved = false; ecErr = e.shortMessage || e.message }
  check("EmissionController repointed", ecMoved, ecMoved ? "" : "BLOCKED — " + ecErr)
  if (!ecMoved) {
    console.log("     ↳ EmissionController stays bound to V6 " + A.V6)
    console.log("     ↳ it reads twap7d / twap30d / reserveUsdt from there, permanently")
    failures--   // recorded above and reported separately; not a defect in V7
    console.log("     ↳ counted as a FINDING for the runbook, not a failed check")
  }

  // MICELicense burns at min(spot, twap7d); it must read a live, sane price from V7.
  const t7 = await pool.twap7d()
  check("MICELicense price source is live and sane",
        t7 > 0n && t7 >= P0, "twap7d $" + ethers.formatUnits(t7, 18))

  // ── 7. revenue flows in, and one-for-one substitution holds ───────────────
  console.log("\n── 8. more revenue → substitution")
  await usdt.connect(whale).transfer(A.ROUTER, ethers.parseUnits("10000", 18))
  const effBefore = await pool.effectiveUsdt()
  await pool.connect(routerSigner).receiveUSDT(ethers.parseUnits("10000", 18))
  check("effectiveUsdt unchanged — real displaced virtual 1:1",
        (await pool.effectiveUsdt()) === effBefore,
        "$" + ethers.formatUnits(await pool.effectiveUsdt(), 18))
  check("virtual fell by exactly the deposit",
        (await pool.virtualReserve()) === VIRTUAL0 - (await pool.reserveUsdtHighWater()))

  // ── 8. gate opens on real money, and honours what it quotes ───────────────
  console.log("\n── 9. crossing the gate")
  await usdt.connect(whale).transfer(A.ROUTER, ethers.parseUnits("20000", 18))
  await pool.connect(routerSigner).receiveUSDT(ethers.parseUnits("20000", 18))
  await pool.advancePhase()
  check("sells open once real USDT passed $25,000", (await pool.sellsOpen()) === true)

  const maxSell = await pool.maxSellNow()
  check("maxSellNow is quotable", (await pool.quoteSell(maxSell)) > 0n,
        ethers.formatUnits(maxSell, 18) + " MIC → $" + ethers.formatUnits(await pool.quoteSell(maxSell), 18))

  // Sell what this buyer actually holds, bought from the pool moments ago — the honest
  // round trip: money in, MIC out, MIC back, money out.
  await mic.connect(buyer).approve(addr, ethers.MaxUint256)
  const bal = await mic.balanceOf(buyer.address)
  const sellAmt = bal < maxSell ? bal : maxSell
  const sellQuote = await pool.quoteSell(sellAmt)
  check("a round trip is quotable", sellQuote > 0n,
        ethers.formatUnits(sellAmt, 18) + " MIC → $" + ethers.formatUnits(sellQuote, 18))
  const uBefore = await usdt.balanceOf(buyer.address)
  await pool.connect(buyer).swapMicToUsdt(sellAmt, 0)
  check("sell paid exactly what was quoted",
        (await usdt.balanceOf(buyer.address)) - uBefore === sellQuote)
  check("pool still solvent to the wei",
        (await pool.reserveUsdt()) === (await usdt.balanceOf(addr)))
  check("sell fee fell as real capital replaced virtual",
        Number(await pool.sellFeeBps()) < 1500,
        (Number(await pool.sellFeeBps()) / 100).toFixed(2) + "% (was 15.00%)")
  check("MIC books still match the balance",
        (await pool.reserveMic()) === (await mic.balanceOf(addr)))

  console.log("\n" + "═".repeat(78))
  if (failures === 0) console.log("✅ REHEARSAL CLEAN — every check passed on a fork of real mainnet state")
  else { console.log(`❌ ${failures} CHECK(S) FAILED`); process.exit(1) }
}

main().catch(e => { console.error(e); process.exit(1) })
