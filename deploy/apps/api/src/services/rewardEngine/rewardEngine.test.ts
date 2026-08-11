import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { gvRankFor } from './tiers'
import { buildGvTree, calculateGvAwards, countsTowardGv } from './gv'
import { planNftPool, distributeProRata, communityWeightBps } from './nftPools'
import { TIER } from './tiers'

// A scale factor for readable test figures. Deliberately NOT a decimals conversion:
// these functions split proportionally, so the unit cancels and any factor gives the
// same result. Real callers must pass 18-decimal BSC-USD wei read from chain.
const M = (n: number) => BigInt(Math.round(n * 1_000_000))

describe('GV ranks', () => {
  test('picks the highest reached threshold', () => {
    assert.equal(gvRankFor(0).name, 'Believer')
    assert.equal(gvRankFor(4_999).name, 'Believer')
    assert.equal(gvRankFor(5_000).name, 'Builder')
    assert.equal(gvRankFor(19_999).rate, 3)
    assert.equal(gvRankFor(20_000).name, 'Connector')
    assert.equal(gvRankFor(50_000).name, 'Champion')
    assert.equal(gvRankFor(150_000).name, 'Ambassador')
    assert.equal(gvRankFor(500_000).rate, 9)
    assert.equal(gvRankFor(10_000_000).rate, 9, 'rate is capped at Legend')
  })
})

describe('GV eligibility', () => {
  test('PRESALE and MICE count, SEED does not', () => {
    assert.equal(countsTowardGv('PRESALE'), true)
    assert.equal(countsTowardGv('MICE'), true, 'MICE USDT half counts toward GV')
    assert.equal(countsTowardGv('SEED'), false, 'SEED round has no referral programme')
  })
})

describe('GV differential award — White Paper §B.5.3 worked example', () => {
  // A (Hub Leader) group volume $60,000 → Champion 7%
  //   └── B  sub-group $25,000 → Connector 5%
  // Expected: A receives (7% − 5%) × $25,000 = $500 from B's sub-group.
  const tree = buildGvTree([
    { wallet: 'A', referrer: null, personalVolume: 35_000 },
    { wallet: 'B', referrer: 'A', personalVolume: 25_000 },
  ])
  const awards = calculateGvAwards(tree)
  const byWallet = Object.fromEntries(awards.map((a) => [a.wallet, a]))

  test('group volume rolls up the tree', () => {
    assert.equal(byWallet.A.groupVolume, 60_000)
    assert.equal(byWallet.B.groupVolume, 25_000)
  })

  test('ranks match the rolled-up volume', () => {
    assert.equal(byWallet.A.rank.name, 'Champion')
    assert.equal(byWallet.B.rank.name, 'Connector')
  })

  test('A receives exactly the $500 differential from B', () => {
    assert.equal(byWallet.A.fromSubGroups, 500)
  })

  test('B receives the full 5% on their own volume', () => {
    assert.equal(byWallet.B.total, 1_250) // 5% × 25,000
  })

  test('volume is never paid twice — A pays only the gap, not the full rate', () => {
    // A's own 35,000 at 7% = 2,450, plus 500 from B. If B's volume were double-counted
    // A would have received 7% × 60,000 = 4,200.
    assert.equal(byWallet.A.fromPersonal, 2_450)
    assert.equal(byWallet.A.total, 2_950)
  })
})

describe('GV edge cases', () => {
  test('a sub-group outranking its leader yields no negative award', () => {
    const awards = calculateGvAwards(
      buildGvTree([
        { wallet: 'L', referrer: null, personalVolume: 0 },
        { wallet: 'S', referrer: 'L', personalVolume: 600_000 }, // Legend under a leader
      ]),
    )
    const L = awards.find((a) => a.wallet === 'L')!
    assert.equal(L.rank.name, 'Legend', 'leader inherits the rolled-up volume')
    assert.equal(L.fromSubGroups, 0, 'equal rates ⇒ zero gap, never negative')
    assert.equal(L.total, 0)
  })

  test('Believer tier earns nothing', () => {
    const awards = calculateGvAwards(
      buildGvTree([{ wallet: 'X', referrer: null, personalVolume: 4_999 }]),
    )
    assert.equal(awards[0].total, 0)
  })

  test('an unknown referrer is re-rooted, not dropped', () => {
    const roots = buildGvTree([{ wallet: 'Z', referrer: '0xghost', personalVolume: 10_000 }])
    assert.equal(roots.length, 1)
    assert.equal(calculateGvAwards(roots)[0].groupVolume, 10_000)
  })

  test('a referral cycle terminates instead of recursing forever', () => {
    const roots = buildGvTree([
      { wallet: 'A', referrer: 'B', personalVolume: 1_000 },
      { wallet: 'B', referrer: 'A', personalVolume: 1_000 },
    ])
    const awards = calculateGvAwards(roots)
    assert.equal(awards.length, 2, 'every wallet still appears exactly once')
  })
})

describe('NFT pool split', () => {
  test('community/MFP split mirrors NFTRewardPool.receiveUSDT', () => {
    // Weekly: 9091 bps to community, remainder to MFP.
    const plan = planNftPool(M(5_500), 9091, [
      { wallet: 'a', activeByTier: { [TIER.BUILDER]: 1 }, mfpCount: 1 },
    ])
    assert.equal(plan.communityPool, (M(5_500) * 9091n) / 10_000n)
    assert.equal(plan.mfpPool, M(5_500) - plan.communityPool)
    assert.equal(plan.communityPool + plan.mfpPool, M(5_500), 'nothing lost in the split')
  })

  test('weights follow the tier table', () => {
    assert.equal(communityWeightBps({ wallet: 'x', activeByTier: { [TIER.BUILDER]: 1 } }), 10_000n)
    assert.equal(communityWeightBps({ wallet: 'x', activeByTier: { [TIER.MAKER]: 1 } }), 25_000n)
    assert.equal(communityWeightBps({ wallet: 'x', activeByTier: { [TIER.LUMINARY]: 1 } }), 50_000n)
    assert.equal(
      communityWeightBps({ wallet: 'x', activeByTier: { [TIER.BUILDER]: 2, [TIER.LUMINARY]: 1 } }),
      70_000n,
      'multiple NFTs stack',
    )
  })

  test('a Luminary earns 5× a Builder from the same pool', () => {
    const plan = planNftPool(M(600), 10_000, [
      { wallet: 'builder', activeByTier: { [TIER.BUILDER]: 1 } },
      { wallet: 'luminary', activeByTier: { [TIER.LUMINARY]: 1 } },
    ])
    const b = plan.community.find((a) => a.wallet === 'builder')!.amount
    const l = plan.community.find((a) => a.wallet === 'luminary')!.amount
    assert.equal(l, b * 5n)
    assert.equal(b + l, M(600))
  })

  test('expired holders are simply absent from the snapshot and earn nothing', () => {
    // The snapshot only ever contains ACTIVE counts (activeCountOf), so an expired
    // credential shows up as weight 0 and receives 0 — benefits end at expiry.
    const plan = planNftPool(M(100), 10_000, [
      { wallet: 'active', activeByTier: { [TIER.MAKER]: 1 } },
      { wallet: 'expired', activeByTier: {} },
    ])
    assert.equal(plan.community.find((a) => a.wallet === 'expired'), undefined)
    assert.equal(plan.community.find((a) => a.wallet === 'active')!.amount, M(100))
  })
})

describe('pro-rata exactness — money must not leak', () => {
  test('indivisible pools are fully distributed via largest remainder', () => {
    // 10 base units across 3 equal holders: 3/3/4, not 3/3/3 with 1 stranded.
    const out = distributeProRata(10n, [
      { wallet: 'a', weight: 1n },
      { wallet: 'b', weight: 1n },
      { wallet: 'c', weight: 1n },
    ])
    assert.equal(out.reduce((s, a) => s + a.amount, 0n), 10n)
  })

  test('credited total equals the pool exactly whenever both sides have holders', () => {
    for (const pool of [1n, 7n, 999_999n, M(5_500), M(8_000) + 1n]) {
      for (const n of [1, 2, 3, 7, 13]) {
        // Every holder carries both a Community NFT and an MFP, so neither slice
        // can be left undistributable.
        const holders = Array.from({ length: n }, (_, i) => ({
          wallet: `w${i}`,
          activeByTier: { [TIER.BUILDER]: (i % 3) + 1 },
          mfpCount: 1,
        }))
        const plan = planNftPool(pool, 9091, holders)
        assert.equal(
          plan.creditedTotal,
          pool,
          `pool=${pool} holders=${n}: credited ${plan.creditedTotal} != ${pool}`,
        )
      }
    }
  })

  test('never over-credits — the contract would revert if we did', () => {
    for (const pool of [0n, 1n, 3n, M(1), M(8_000) + 7n]) {
      for (const mfp of [0, 1]) {
        for (const n of [0, 1, 5]) {
          const holders = Array.from({ length: n }, (_, i) => ({
            wallet: `w${i}`,
            activeByTier: i === 0 ? {} : { [TIER.MAKER]: 1 }, // first holder is expired
            mfpCount: mfp,
          }))
          const plan = planNftPool(pool, 9091, holders)
          assert.ok(
            plan.creditedTotal <= pool,
            `over-credited: ${plan.creditedTotal} > ${pool}`,
          )
        }
      }
    }
  })

  test('an undistributable slice stays in the contract for the next period', () => {
    // Nobody holds an MFP, so the 909-bps MFP slice cannot be credited to anyone.
    // It must remain in the pool rather than be forced onto Community holders.
    const pool = M(5_500)
    const plan = planNftPool(pool, 9091, [
      { wallet: 'a', activeByTier: { [TIER.MAKER]: 1 }, mfpCount: 0 },
    ])
    assert.equal(plan.mfp.length, 0, 'no eligible MFP recipients')
    assert.equal(plan.creditedTotal, plan.communityPool)
    assert.equal(pool - plan.creditedTotal, plan.mfpPool, 'the MFP slice is carried, not lost')
  })

  test('no holders means nothing is credited (pool stays in the contract)', () => {
    const plan = planNftPool(M(500), 9091, [])
    assert.equal(plan.creditedTotal, 0n)
  })

  test('a zero pool credits zero', () => {
    const plan = planNftPool(0n, 9091, [{ wallet: 'a', activeByTier: { [TIER.MAKER]: 1 } }])
    assert.equal(plan.creditedTotal, 0n)
  })
})

// ─── Milestone NFT awards — White Paper §E.6.1.A (count-based, repeating) ─────
import {
  qualifyingF1Counts, proposeMilestones, milestonesEarned, MILESTONES, CIRCLE_SIZE,
  QUALIFYING_PURCHASE_USDT,
} from './milestones'
import { snapshotForWeekly, snapshotForMonthly, type NftRecord } from './nftPools'

describe('Milestone thresholds', () => {
  test('are COUNT-based (3/5/10 F1), not volume-based', () => {
    assert.deepEqual(
      MILESTONES.map((m) => [m.index, m.requiredF1, m.tier]),
      [[0, 3, TIER.BUILDER], [1, 5, TIER.MAKER], [2, 10, TIER.LUMINARY]],
    )
    assert.equal(CIRCLE_SIZE, 10)
    assert.equal(QUALIFYING_PURCHASE_USDT, 100)
  })

  test('progress within a circle unlocks tiers in order', () => {
    assert.equal(milestonesEarned(2).length, 0)
    assert.deepEqual(milestonesEarned(3).map((e) => e.milestone.index), [0])
    assert.deepEqual(milestonesEarned(5).map((e) => e.milestone.index), [0, 1])
    assert.deepEqual(milestonesEarned(9).map((e) => e.milestone.index), [0, 1])
  })

  test('the circle RESETS at 10 and can be earned again', () => {
    const at10 = milestonesEarned(10)
    assert.deepEqual(at10.map((e) => e.timesEarned), [1, 1, 1], 'one full set')

    // 13 = one complete circle + 3 into the next → a second Builder.
    const at13 = Object.fromEntries(milestonesEarned(13).map((e) => [e.milestone.index, e.timesEarned]))
    assert.deepEqual(at13, { 0: 2, 1: 1, 2: 1 })

    const at25 = Object.fromEntries(milestonesEarned(25).map((e) => [e.milestone.index, e.timesEarned]))
    assert.deepEqual(at25, { 0: 3, 1: 3, 2: 2 }, 'two circles + 5 into the third')
  })
})

describe('Qualifying F1 counting', () => {
  const referrerOf = new Map<string, string | null>([
    ['leader', null], ['a', 'leader'], ['b', 'leader'], ['c', 'leader'], ['deep', 'a'],
  ])

  test('counts F1 only — F2 does not count, unlike GV', () => {
    const c = qualifyingF1Counts(referrerOf, [
      { buyer: 'a', type: 'PRESALE', usdtAmount: 500 },
      { buyer: 'deep', type: 'PRESALE', usdtAmount: 5_000 },
    ])
    assert.equal(c.get('leader'), 1, 'only a — deep is F2 of leader')
    assert.equal(c.get('a'), 1, 'deep is F1 of a')
  })

  test('the $100 bar is cumulative per person, not per transaction', () => {
    const c = qualifyingF1Counts(referrerOf, [
      { buyer: 'a', type: 'PRESALE', usdtAmount: 60 },
      { buyer: 'a', type: 'PRESALE', usdtAmount: 60 }, // $120 total → qualifies
      { buyer: 'b', type: 'PRESALE', usdtAmount: 99 }, // below the bar
    ])
    assert.equal(c.get('leader'), 1)
  })

  test('one big buyer is still only ONE head — breadth, not depth', () => {
    const c = qualifyingF1Counts(referrerOf, [
      { buyer: 'a', type: 'PRESALE', usdtAmount: 1_000_000 },
    ])
    assert.equal(c.get('leader'), 1, 'this is what separates milestone from the GV rank bonus')
  })

  test('MICE counts, SEED does not', () => {
    const c = qualifyingF1Counts(referrerOf, [
      { buyer: 'a', type: 'MICE', usdtAmount: 500 },
      { buyer: 'b', type: 'SEED', usdtAmount: 9_000 },
    ])
    assert.equal(c.get('leader'), 1)
  })
})

describe('Milestone proposals', () => {
  test('proposes one entry per NFT owed', () => {
    const p = proposeMilestones(new Map([['w', 13]]))[0]
    assert.equal(p.completedCircles, 1)
    assert.deepEqual(p.pending.map((m) => m.index), [0, 0, 1, 2], 'two Builders, one Maker, one Luminary')
  })

  test('never re-proposes what the ledger says was already minted', () => {
    const minted = new Map([['w', new Map([[0, 2], [1, 1], [2, 1]])]])
    assert.equal(proposeMilestones(new Map([['w', 13]]), minted).length, 0, 'safe to re-run')
  })

  test('proposes only the shortfall after a partial mint', () => {
    const minted = new Map([['w', new Map([[0, 1]])]])
    const p = proposeMilestones(new Map([['w', 13]]), minted)[0]
    assert.deepEqual(p.pending.map((m) => m.index), [0, 1, 2], 'one Builder still owed')
  })

  test('below 3 qualifying F1 there is no proposal', () => {
    assert.equal(proposeMilestones(new Map([['w', 2]])).length, 0)
  })
})

// ─── Weekly vs Monthly eligibility — White Paper §E.6.1 / §E.6.2 ─────────────
describe('Weekly and Monthly have DIFFERENT eligibility', () => {
  const DAY = 86_400
  const weekStart = 1_000 * DAY
  const weekEnd = weekStart + 7 * DAY

  const nfts: NftRecord[] = [
    // Issued long before this week, still valid → LOYAL holder
    { tokenId: 1, owner: 'old', tier: TIER.LUMINARY, mintTime: weekStart - 60 * DAY, expiryTime: weekEnd + 60 * DAY },
    // Issued during this week → NEW participant
    { tokenId: 2, owner: 'fresh', tier: TIER.BUILDER, mintTime: weekStart + 2 * DAY, expiryTime: weekEnd + 50 * DAY },
    // Issued during the week but already expired by close
    { tokenId: 3, owner: 'lapsed', tier: TIER.MAKER, mintTime: weekStart + 1 * DAY, expiryTime: weekStart + 3 * DAY },
  ]

  test('Weekly includes ONLY NFTs issued that week', () => {
    const snap = snapshotForWeekly(nfts, weekStart, weekEnd)
    assert.deepEqual(snap.map((s) => s.wallet), ['fresh'])
  })

  test('Monthly includes ALL still-active NFTs regardless of issue date', () => {
    const snap = snapshotForMonthly(nfts, weekEnd)
    assert.deepEqual(snap.map((s) => s.wallet).sort(), ['fresh', 'old'])
  })

  test('expired credentials are excluded from both', () => {
    assert.equal(snapshotForWeekly(nfts, weekStart, weekEnd).some((s) => s.wallet === 'lapsed'), false)
    assert.equal(snapshotForMonthly(nfts, weekEnd).some((s) => s.wallet === 'lapsed'), false)
  })

  test('a long-standing holder earns from Monthly but NOT from Weekly', () => {
    // The rule that is easiest to get wrong, and silent when you do.
    const weekly = planNftPool(M(5_500), 9091, snapshotForWeekly(nfts, weekStart, weekEnd))
    const monthly = planNftPool(M(8_000), 9375, snapshotForMonthly(nfts, weekEnd))
    assert.equal(weekly.community.find((a) => a.wallet === 'old'), undefined)
    assert.ok(monthly.community.find((a) => a.wallet === 'old')!.amount > 0n)
  })

  test('MFP holders qualify for the MFP slice even with no Community NFT', () => {
    const snap = snapshotForMonthly(nfts, weekEnd, new Map([['mfponly', 2]]))
    const mfpOnly = snap.find((s) => s.wallet === 'mfponly')!
    assert.deepEqual(mfpOnly.activeByTier, {})
    assert.equal(mfpOnly.mfpCount, 2)
  })
})
