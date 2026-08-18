/**
 * ─────────────────────────────────────────────────────────────────────────────
 * MISSION CHAIN — Seat the DAOGovernor BTC members (Phase 1)
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * `DAOGovernor.propose()` requires BTC_MEMBER_ROLE. On 2026-08-10 nobody held it —
 * all five seats were the zero address and `proposalCount` was 0. The app's Steward
 * Council page therefore had no way to raise a governance proposal, and neither did the
 * Owner. Meanwhile `StewardCouncil` 0x8772…1B19 already listed four active members, so
 * the council existed everywhere except the contract that counts votes.
 *
 * WHAT IT DOES
 *   1. Reads the active members from StewardCouncil (on-chain, not the database).
 *   2. Shows who currently holds BTC_MEMBER_ROLE on DAOGovernor.
 *   3. Calls `setTemporaryMembers` with the five seats.
 *
 * ⚠️ FIVE SEATS, NOT FOUR. `setTemporaryMembers(address[5])` rejects the zero address, so
 *    every seat must be filled. StewardCouncil has four active members — the fifth has to
 *    be supplied deliberately via FIFTH_SEAT. Quorum is 3 of 5 either way.
 *
 * ⚠️ IT REPLACES, IT DOES NOT ADD. The function revokes every existing BTC role before
 *    granting the new set. Whatever you pass becomes the complete council.
 *
 * SAFETY: dry-run by default. Prints the plan and the pre-flight checks; sends nothing
 * unless EXECUTE=1.
 *   Review:  npx hardhat run scripts/set-dao-btc-members.ts --network bsc
 *   Execute: EXECUTE=1 FIFTH_SEAT=0x… npx hardhat run scripts/set-dao-btc-members.ts --network bsc
 */
import { ethers } from "hardhat"
import { getActiveAddresses } from "@missionchain/sdk"

async function main() {
  const EXECUTE = process.env.EXECUTE === "1"
  const FIFTH_SEAT = process.env.FIFTH_SEAT?.trim()
  const [signer] = await ethers.getSigners()
  const A: any = getActiveAddresses()

  const problems: string[] = []
  const line = "═".repeat(78)

  console.log(line)
  console.log("DAOGovernor — seat the BTC members" + (EXECUTE ? "   [EXECUTE]" : "   [DRY-RUN]"))
  console.log(line)
  console.log("signer      :", signer.address)
  console.log("DAOGovernor :", A.DAOGovernor)
  console.log("Council     :", A.StewardCouncil)

  const gov = await ethers.getContractAt("DAOGovernor", A.DAOGovernor)
  const council = await ethers.getContractAt("StewardCouncil", A.StewardCouncil)

  // ── pre-flight ────────────────────────────────────────────────────────────
  console.log("\n── pre-flight ──")

  const daoActive = await (gov as any).daoActive()
  console.log("  daoActive          :", daoActive, daoActive ? "✗ Phase 2 reached — setTemporaryMembers is closed forever" : "✓")
  if (daoActive) problems.push("DAO is already active; the temporary-member path is permanently closed.")

  const ADMIN = await (gov as any).DEFAULT_ADMIN_ROLE()
  const isAdmin = await (gov as any).hasRole(ADMIN, signer.address)
  console.log("  signer is admin    :", isAdmin, isAdmin ? "✓" : "✗ needs DEFAULT_ADMIN_ROLE on DAOGovernor")
  if (!isAdmin) problems.push(`Signer ${signer.address} lacks DEFAULT_ADMIN_ROLE on DAOGovernor.`)

  const bnb = await ethers.provider.getBalance(signer.address)
  console.log("  signer BNB         :", ethers.formatEther(bnb))
  if (bnb < ethers.parseEther("0.005")) problems.push("BNB below ~0.005 — top up before executing.")

  // ── who is on the council today ───────────────────────────────────────────
  const active: string[] = [...(await (council as any).getActiveMembers())]
  const ROLE = await (gov as any).BTC_MEMBER_ROLE()

  console.log("\n── StewardCouncil active members ──")
  for (const w of active) {
    let label = ""
    try {
      const m = await (council as any).members(w)
      label = `${m[0]} · ${m[1]}`
    } catch { /* member struct shape differs — the address is what matters */ }
    const has = await (gov as any).hasRole(ROLE, w)
    console.log(`  ${w}  ${has ? "holds" : "MISSING"} BTC_MEMBER_ROLE   ${label}`)
  }

  console.log("\n── current DAOGovernor seats ──")
  for (let i = 0; i < 5; i++) {
    const s = await (gov as any).btcMembers(i)
    console.log(`  [${i}] ${s === ethers.ZeroAddress ? "(empty)" : s}`)
  }

  // ── build the seat list ───────────────────────────────────────────────────
  const seats = [...active]
  if (seats.length > 5) {
    problems.push(`StewardCouncil has ${seats.length} active members but there are only 5 seats. Deactivate ${seats.length - 5} first, or choose explicitly.`)
  }
  if (seats.length < 5) {
    if (!FIFTH_SEAT) {
      problems.push(
        `Only ${seats.length} active council members but all 5 seats must be filled (the contract rejects the zero address). ` +
        `Set FIFTH_SEAT=0x… with the wallet that should take the remaining seat — commonly the Owner wallet.`
      )
    } else if (!ethers.isAddress(FIFTH_SEAT)) {
      problems.push(`FIFTH_SEAT is not a valid address: ${FIFTH_SEAT}`)
    } else if (seats.some((s) => s.toLowerCase() === FIFTH_SEAT.toLowerCase())) {
      problems.push(`FIFTH_SEAT ${FIFTH_SEAT} is already an active council member — pick a different wallet.`)
    } else {
      while (seats.length < 5) seats.push(ethers.getAddress(FIFTH_SEAT))
    }
  }

  console.log("\n── plan ──")
  if (seats.length === 5) {
    seats.forEach((s, i) => {
      const fromCouncil = active.some((a) => a.toLowerCase() === s.toLowerCase())
      console.log(`  seat[${i}] ${s}  ${fromCouncil ? "(StewardCouncil)" : "(FIFTH_SEAT)"}`)
    })
    console.log("\n  Quorum is 3 of 5 — the proposer auto-approves, so two further signatures carry a vote.")
    console.log("  This REPLACES the whole set: any wallet not listed above loses BTC_MEMBER_ROLE.")
  }

  if (problems.length) {
    console.log("\n── BLOCKED ──")
    for (const p of problems) console.log("  ✗ " + p)
    console.log("\nNothing was sent.")
    process.exitCode = 1
    return
  }

  if (!EXECUTE) {
    console.log("\nDRY-RUN — nothing sent. Re-run with EXECUTE=1 to apply.")
    return
  }

  console.log("\n── executing ──")
  const tx = await (gov as any).setTemporaryMembers(seats as any)
  console.log("  tx:", tx.hash)
  const rc = await tx.wait()
  console.log("  mined in block", rc?.blockNumber)

  console.log("\n── verify ──")
  for (const s of seats) {
    console.log(`  ${s}  hasRole = ${await (gov as any).hasRole(ROLE, s)}`)
  }
  console.log("\nDone. Council members can now call propose() on DAOGovernor.")
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
