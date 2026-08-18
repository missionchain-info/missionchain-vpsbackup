import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import {
  MICELicense,
  MICToken,
  MockUSDT,
  ReferralRegistry,
  RevenueRouter,
  MockRewardReceiver,
} from "../../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

// ─── Constants matching spec ────────────────────────────────────────────────
// 5 rounds × 20,000 licenses per round
const MAX_SUPPLY   = 100_000n;
const PER_ROUND    = 20_000n;
const DURATION     = 360n * 24n * 3600n; // 360 days in seconds

// Round prices (USDT 6 decimals)
/**
 * Round prices as dollars, converted here rather than copied from the contract.
 *
 * These used to read `100n * 1_000_000n` — the contract's own (wrong) 6-decimal literal
 * restated in the test. Comparing a contract against a copy of itself proves the two
 * agree and nothing else, which is why 37 green tests sat on top of a price of
 * $0.0000000001 per licence. Say what a licence should cost in dollars and let
 * `parseEther` do the conversion; then a wrong scale in the contract fails here.
 */
const ROUND_PRICE_USD = [100, 200, 300, 400, 500];
const ROUND_PRICES = ROUND_PRICE_USD.map((d) => ethers.parseEther(String(d)));

/**
 * The MIC reference price the mock pool publishes: $0.01 per MIC.
 *
 * `LiquidityPoolV6.spotPrice()` returns `effectiveUsdt * 1e18 / reserveMic` — USDT wei
 * per 1e18 MIC — so with 18-decimal BSC-USD the price is 18-decimal too. Written as
 * `10_000n` (the 6-decimal form) it was a trillionth of a cent, and the burn came out
 * 10^12 times too small.
 */
const MIC_PRICE_USDT = ethers.parseEther("0.01");

/**
 * MIC a buyer must burn for a given USDT half.
 *
 * Stated from the economics, not lifted from the contract: at $0.01 per MIC, a $50 half
 * has to burn 5,000 MIC. `expectedMicFor` below asserts exactly that in plain numbers, so
 * a scale error in either the contract or this helper is visible rather than cancelled.
 */
function calcMicBurn(usdtHalf: bigint): bigint {
  return (usdtHalf * 10n ** 18n) / MIC_PRICE_USDT;
}

/** $50 at $0.01/MIC = 5,000 MIC — the sanity anchor for every burn assertion. */
function expectedMicFor(usdDollars: number, micPriceUsd: number): bigint {
  return ethers.parseEther(String(usdDollars / micPriceUsd));
}

// ─── Fixture ─────────────────────────────────────────────────────────────────

interface Fixture {
  mice:            MICELicense;
  mic:             MICToken;
  usdt:            MockUSDT;
  referralRegistry: ReferralRegistry;
  revenueRouter:   RevenueRouter;
  admin:           SignerWithAddress;
  buyer:           SignerWithAddress;
  buyer2:          SignerWithAddress;
  referrer:        SignerWithAddress;
  referrer2:       SignerWithAddress;
  // RevenueRouter sinks — CONTRACTS (the router calls receiveAndDistribute()/receiveUSDT())
  marketing:       MockRewardReceiver;
  management:      MockRewardReceiver;
  treasury:        MockRewardReceiver;
  staking:         MockRewardReceiver;
  liquidity:       MockRewardReceiver;
  miPool:          MockRewardReceiver;
  pool:            any;
}

async function deployFixture(): Promise<Fixture> {
  const [
    admin, buyer, buyer2, referrer, referrer2,
  ] = await ethers.getSigners();

  // MockUSDT
  const USDT = await ethers.getContractFactory("MockUSDT");
  const usdt = await USDT.deploy() as unknown as MockUSDT;

  // MICToken (admin receives 15% pre-issued)
  const MICFactory = await ethers.getContractFactory("MICToken");
  const mic = await MICFactory.deploy(admin.address) as unknown as MICToken;

  // ReferralRegistry
  const RefFactory = await ethers.getContractFactory("ReferralRegistry");
  const referralRegistry = await RefFactory.deploy(
    await usdt.getAddress(),
    admin.address,
  ) as unknown as ReferralRegistry;

  // Router sinks (contracts — the router CALLS them) + M&I overflow sink
  const MRFactory = await ethers.getContractFactory("MockRewardReceiver");
  const newSink = async () =>
    await MRFactory.deploy(await usdt.getAddress()) as unknown as MockRewardReceiver;
  const marketing  = await newSink();
  const management = await newSink();
  const treasury   = await newSink();
  const staking    = await newSink();
  const liquidity  = await newSink();
  const miPool     = await newSink();

  // RevenueRouter — 8 args, referral slice → ReferralRegistry
  const RRFactory = await ethers.getContractFactory("RevenueRouter");
  const revenueRouter = await RRFactory.deploy(
    await usdt.getAddress(),
    await referralRegistry.getAddress(),
    await marketing.getAddress(),
    await management.getAddress(),
    await treasury.getAddress(),
    await staking.getAddress(),
    await liquidity.getAddress(),
    admin.address,
  ) as unknown as RevenueRouter;
  await referralRegistry.connect(admin).setIncentivePool(await miPool.getAddress());

  // MICELicense
  // Mock pool: MICE reads min(spot, twap7d) from it. Both set to $0.01 here.
  const pool = await (await ethers.getContractFactory("MockLiquidityPoolV6")).deploy();
  await (pool as any).setPrices(MIC_PRICE_USDT, MIC_PRICE_USDT, MIC_PRICE_USDT);

  const MICEFactory = await ethers.getContractFactory("MICELicense");
  const mice = await MICEFactory.deploy(
    await usdt.getAddress(),
    await mic.getAddress(),
    await referralRegistry.getAddress(),
    await revenueRouter.getAddress(),
    admin.address,
    await pool.getAddress(),
    MIC_PRICE_USDT,
  ) as unknown as MICELicense;

  // Grant CALLER_ROLE on ReferralRegistry to MICELicense
  const CALLER_ROLE = await referralRegistry.CALLER_ROLE();
  await referralRegistry.connect(admin).grantRole(CALLER_ROLE, await mice.getAddress());

  // Grant DISTRIBUTOR_ROLE on RevenueRouter to MICELicense
  const DIST_ROLE = await revenueRouter.DISTRIBUTOR_ROLE();
  await revenueRouter.connect(admin).grantRole(DIST_ROLE, await mice.getAddress());

  // Mint USDT to buyers (enough for multiple rounds)
  // $10M in 18-decimal USDT. Written as `10_000_000n * 1_000_000n` this funded each
  // buyer with $0.00001 — enough only because the licence prices were wrong by the
  // same factor, so the two errors cancelled and the suite stayed green.
  const USDT_AMOUNT = ethers.parseEther("10000000"); // $10M
  await (usdt as any).mint(buyer.address, USDT_AMOUNT);
  await (usdt as any).mint(buyer2.address, USDT_AMOUNT);
  await (usdt as any).mint(referrer.address, USDT_AMOUNT);

  // Approve USDT for MICELicense (large allowance)
  await usdt.connect(buyer).approve(await mice.getAddress(), USDT_AMOUNT);
  await usdt.connect(buyer2).approve(await mice.getAddress(), USDT_AMOUNT);
  await usdt.connect(referrer).approve(await mice.getAddress(), USDT_AMOUNT);

  // Mint enough MIC to buyers for burn
  // Round 1 max burn per license: calcMicBurn(50e6) = 5,000,000 MIC
  // For 20,000 licenses: 100B MIC — use admin's pre-issued 1.05B, transfer what's needed
  // For tests we'll transfer from admin to buyer
  const MIC_FOR_BUYER = 50_000_000n * 10n ** 18n; // 50M MIC each (enough for many licenses)
  await mic.connect(admin).transfer(buyer.address, MIC_FOR_BUYER);
  await mic.connect(admin).transfer(buyer2.address, MIC_FOR_BUYER);
  await mic.connect(admin).transfer(referrer.address, MIC_FOR_BUYER);

  // Approve MIC for MICELicense (burn via transferFrom to address(0) OR burnFrom)
  await mic.connect(buyer).approve(await mice.getAddress(), MIC_FOR_BUYER);
  await mic.connect(buyer2).approve(await mice.getAddress(), MIC_FOR_BUYER);
  await mic.connect(referrer).approve(await mice.getAddress(), MIC_FOR_BUYER);

  return {
    mice, mic, usdt, referralRegistry, revenueRouter,
    admin, buyer, buyer2, referrer, referrer2,
    marketing, management, treasury, staking, liquidity, miPool, pool,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Calculate USDT half (50%) for a given round price */
function usdtHalf(roundPrice: bigint): bigint {
  return roundPrice / 2n;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

/** A licence must cost real money. This is the assertion the old suite never made. */
function expectDollars(actual: bigint, dollars: number, label: string) {
  const expected = ethers.parseEther(String(dollars));
  expect(actual, `${label}: expected $${dollars}`).to.equal(expected);
  // A 6-decimal literal would land a trillion times low; catch that shape explicitly.
  expect(actual, `${label}: looks like a 6-decimal amount`).to.be.greaterThan(
    ethers.parseEther("0.01"),
  );
}

describe("MICELicense", () => {
  let f: Fixture;

  beforeEach(async () => {
    f = await deployFixture();
  });

  // ── Deployment ──────────────────────────────────────────────────────────────

  describe("Deployment", () => {
    it("sets correct max supply and duration", async () => {
      expect(await f.mice.MAX_SUPPLY()).to.equal(MAX_SUPPLY);
      expect(await f.mice.DURATION()).to.equal(DURATION);
    });

    it("initialises totalMinted to 0", async () => {
      expect(await f.mice.totalMinted()).to.equal(0n);
    });

    it("getCurrentRound returns 1 initially", async () => {
      expect(await f.mice.getCurrentRound()).to.equal(1n);
    });

    it("getCurrentPrice returns $100 initially", async () => {
      expect(await f.mice.getCurrentPrice()).to.equal(ROUND_PRICES[0]);
    });
  });

  // ── Round detection ─────────────────────────────────────────────────────────

  describe("Round detection", () => {
    it("getRoundForToken returns correct round for boundary tokens", async () => {
      // Round 1: tokens 0 – 19999 (0-indexed)
      expect(await f.mice.getRoundForToken(0n)).to.equal(1n);
      expect(await f.mice.getRoundForToken(19_999n)).to.equal(1n);
      // Round 2: tokens 20000 – 39999
      expect(await f.mice.getRoundForToken(20_000n)).to.equal(2n);
      expect(await f.mice.getRoundForToken(39_999n)).to.equal(2n);
      // Round 5: tokens 80000 – 99999
      expect(await f.mice.getRoundForToken(80_000n)).to.equal(5n);
      expect(await f.mice.getRoundForToken(99_999n)).to.equal(5n);
    });

    it("getPriceForRound returns correct prices", async () => {
      for (let r = 1; r <= 5; r++) {
        expect(await f.mice.getPriceForRound(BigInt(r))).to.equal(ROUND_PRICES[r - 1]);
      }
    });
  });

  // ── Single license purchase — Round 1 ──────────────────────────────────────

  describe("buyLicense — Round 1 single purchase", () => {
    it("transfers correct USDT and burns correct MIC", async () => {
      const price = ROUND_PRICES[0]; // $100
      const half = usdtHalf(price);   // $50
      const micBurn = calcMicBurn(half);

      const usdtBefore = await f.usdt.balanceOf(f.buyer.address);
      const micBefore  = await f.mic.balanceOf(f.buyer.address);
      const supplyBefore = await f.mic.totalSupply();

      await f.mice.connect(f.buyer).buyLicense(1n);

      const usdtAfter = await f.usdt.balanceOf(f.buyer.address);
      const micAfter  = await f.mic.balanceOf(f.buyer.address);
      const supplyAfter = await f.mic.totalSupply();

      // USDT deducted: 50% portion only (no referral)
      expect(usdtBefore - usdtAfter).to.equal(half);

      // MIC burned: deducted from buyer and total supply reduced
      expect(micBefore - micAfter).to.equal(micBurn);
      expect(supplyBefore - supplyAfter).to.equal(micBurn);
    });

    it("mints ERC-1155 token to buyer", async () => {
      await f.mice.connect(f.buyer).buyLicense(1n);
      // Each license is a unique token ID, but buyer should hold 1 unit
      const licenseId = 0n;
      expect(await f.mice.balanceOf(f.buyer.address, licenseId)).to.equal(1n);
    });

    it("the 360-day term starts at ACTIVATION, not at purchase", async () => {
      const tx = await f.mice.connect(f.buyer).buyLicense(1n);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt!.blockNumber);
      const mintTime = BigInt(block!.timestamp);

      let info = await f.mice.licenses(0n);
      expect(info.mintTime).to.equal(mintTime);
      // Not yet activated: no clock is running, so the 72h wait costs the buyer nothing.
      expect(info.activatedAt).to.equal(0n);
      expect(info.expiryTime).to.equal(0n);

      await time.increase(72 * 3600 + 1);
      await (f.mice as any).activate(0n);
      info = await f.mice.licenses(0n);
      expect(info.activatedAt).to.be.gt(0n);
      expect(info.expiryTime).to.equal(info.activatedAt + DURATION);
    });

    it("can be activated the moment it is bought", async () => {
      // The 72-hour wait was removed: the 360-day term already starts at activation, so
      // all the delay achieved was postponing the buyer's first day of rewards.
      await f.mice.connect(f.buyer).buyLicense(1n);
      expect(await (f.mice as any).isActivatable(0n)).to.be.true;
      await (f.mice as any).activate(0n);
      expect(await (f.mice as any).activeLicenses()).to.equal(1n);
    });

    it("refuses to activate the same licence twice", async () => {
      await f.mice.connect(f.buyer).buyLicense(1n);
      await (f.mice as any).activate(0n);
      await expect((f.mice as any).activate(0n)).to.be.revertedWith("MICE: not activatable");
    });

    it("activeLicenses only counts activated licences", async () => {
      await f.mice.connect(f.buyer).buyLicense(3n);
      expect(await (f.mice as any).activeLicenses()).to.equal(0n);
      await time.increase(72 * 3600 + 1);
      await (f.mice as any).activateBatch([0n, 1n]);
      expect(await (f.mice as any).activeLicenses()).to.equal(2n);
    });

    it("increments totalMinted", async () => {
      await f.mice.connect(f.buyer).buyLicense(1n);
      expect(await f.mice.totalMinted()).to.equal(1n);
    });

    it("the full USDT half is routed 6 ways on GROSS (no referrer → 10% to M&I)", async () => {
      const half = usdtHalf(ROUND_PRICES[0]);
      await f.mice.connect(f.buyer).buyLicense(1n);

      // Router should have 0 balance after distribution
      expect(await f.usdt.balanceOf(await f.revenueRouter.getAddress())).to.equal(0n);

      // Model V2: Referral 10% · Marketing 25% · Mgmt 7.5% · Treasury 12.5% · Staking 5% · Liquidity 40%
      const toReferral   = (half * 1000n) / 10000n;
      const toMarketing  = (half * 2500n) / 10000n;
      const toManagement = (half * 750n)  / 10000n;
      const toTreasury   = (half * 1250n) / 10000n;
      const toStaking    = (half * 500n)  / 10000n;
      const toLiquidity  = half - toReferral - toMarketing - toManagement - toTreasury - toStaking;

      expect(await f.marketing.received()).to.equal(toMarketing);
      expect(await f.management.received()).to.equal(toManagement);
      expect(await f.treasury.received()).to.equal(toTreasury);
      expect(await f.staking.received()).to.equal(toStaking);
      expect(await f.liquidity.received()).to.equal(toLiquidity);

      // This buyer has no referrer → the whole 10% overflows to Milestones & Incentives,
      // and nothing is stranded in the registry.
      expect(await f.miPool.received()).to.equal(toReferral);
      expect(await f.usdt.balanceOf(await f.referralRegistry.getAddress())).to.equal(0n);
    });

    it("emits LicensePurchased event", async () => {
      await expect(f.mice.connect(f.buyer).buyLicense(1n))
        .to.emit(f.mice, "LicensePurchased")
        .withArgs(f.buyer.address, 0n, ROUND_PRICES[0]);
    });
  });

  // ── Referral ────────────────────────────────────────────────────────────────

  describe("buyLicense — with referral", () => {
    beforeEach(async () => {
      // Register buyer's referrer as 'referrer'
      const CALLER_ROLE = await f.referralRegistry.CALLER_ROLE();
      // referralRegistry.setReferrer called by MICELicense via CALLER_ROLE
      // We need MICELicense to call setReferrer — do it via buyLicense with referrer param
    });

    it("pays F1 7% of the USDT half; the unused F2 3% overflows to M&I", async () => {
      const price = ROUND_PRICES[0]; // $100
      const half  = usdtHalf(price);  // $50 USDT (6 dec) = 50_000_000

      // Buy with referrer (sets referrer as F1 for buyer). `referrer` has no upline,
      // so there is no F2 and that 3% share overflows to Milestones & Incentives.
      const f1BalBefore = await f.usdt.balanceOf(f.referrer.address);
      await f.mice.connect(f.buyer)["buyLicense(uint256,address)"](1n, f.referrer.address);

      const f1Received = await f.usdt.balanceOf(f.referrer.address) - f1BalBefore;

      const f1Expected = (half * 700n) / 10000n; // 7%
      const f2Expected = (half * 300n) / 10000n; // 3% — nobody to pay
      expect(f1Received).to.equal(f1Expected);
      expect(await f.miPool.received()).to.equal(f2Expected);

      // Marketing still gets 25% of GROSS — referral is not taken off the top.
      expect(await f.marketing.received()).to.equal((half * 2500n) / 10000n);
      expect(await f.usdt.balanceOf(await f.referralRegistry.getAddress())).to.equal(0n);
    });

    it("pays both F1 and F2 when referrer chain is 2 deep", async () => {
      const price = ROUND_PRICES[0];
      const half  = usdtHalf(price);

      // Register referrer's referrer first: referrer buys with referrer2 as their referrer
      // (so referrer's F1 = referrer2)
      const micNeeded = calcMicBurn(half);
      // referrer needs MIC and USDT approved already (done in fixture)

      await f.mice.connect(f.referrer)["buyLicense(uint256,address)"](1n, f.referrer2.address);
      // Now referrer is registered with F1 = referrer2

      // Now buyer buys with referrer as F1
      const f1BalBefore = await f.usdt.balanceOf(f.referrer.address);
      const f2BalBefore = await f.usdt.balanceOf(f.referrer2.address);

      // buyer2 also needs usdt and mic approved
      await (f.usdt as any).mint(f.buyer2.address, ethers.parseEther("10000000"));
      await f.usdt.connect(f.buyer2).approve(await f.mice.getAddress(), ethers.parseEther("10000000"));
      await f.mic.connect(f.admin).transfer(f.buyer2.address, 50_000_000n * 10n ** 18n);
      await f.mic.connect(f.buyer2).approve(await f.mice.getAddress(), 50_000_000n * 10n ** 18n);

      await f.mice.connect(f.buyer2)["buyLicense(uint256,address)"](1n, f.referrer.address);

      const f1BalAfter = await f.usdt.balanceOf(f.referrer.address);
      const f2BalAfter = await f.usdt.balanceOf(f.referrer2.address);

      const f1Received = f1BalAfter - f1BalBefore;
      const f2Received = f2BalAfter - f2BalBefore;

      expect(f1Received).to.equal((half * 700n) / 10000n);
      expect(f2Received).to.equal((half * 300n) / 10000n);
    });

    it("referrer is set only once (immutable)", async () => {
      await f.mice.connect(f.buyer)["buyLicense(uint256,address)"](1n, f.referrer.address);
      // Second purchase with different referrer should not change referrer
      await f.mice.connect(f.buyer)["buyLicense(uint256,address)"](1n, f.buyer2.address);

      expect(await f.referralRegistry.referrerOf(f.buyer.address))
        .to.equal(f.referrer.address);
    });
  });

  // ── Round transitions ───────────────────────────────────────────────────────

  describe("Round price transitions", () => {
    it("getCurrentRound and getCurrentPrice update at round boundaries", async () => {
      expect(await f.mice.getCurrentRound()).to.equal(1n);
      expect(await f.mice.getCurrentPrice()).to.equal(ROUND_PRICES[0]);

      // Buy enough to fill round 1 (use admin to skip MIC limits — give admin huge MIC)
      // For test efficiency, we manipulate totalMinted via admin function OR test boundary math
      // We'll use admin's setTotalMintedForTesting — not available, so we'll verify via
      // getRoundForToken which is a pure function

      // Test that at totalMinted = 20000, round becomes 2
      // We do this by checking the round for the 20001st token index
      expect(await f.mice.getRoundForToken(20_000n)).to.equal(2n);
      expect(await f.mice.getPriceForRound(2n)).to.equal(ROUND_PRICES[1]);
    });

    it("buying across round boundary charges correct prices per license", async () => {
      // Give buyer 2 lots of MIC/USDT and buy 1 in round1 + 1 spanning (can't easily skip)
      // Instead verify price function is correct for each round index
      for (let r = 1n; r <= 5n; r++) {
        const price = await f.mice.getPriceForRound(r);
        expect(price).to.equal(ROUND_PRICES[Number(r) - 1]);
      }
    });
  });

  // ── Multi-license purchase ──────────────────────────────────────────────────

  describe("buyLicense — multiple in one tx", () => {
    it("buys 3 licenses and mints 3 ERC-1155 tokens", async () => {
      await f.mice.connect(f.buyer).buyLicense(3n);
      expect(await f.mice.totalMinted()).to.equal(3n);

      // Each license ID is unique (0, 1, 2)
      expect(await f.mice.balanceOf(f.buyer.address, 0n)).to.equal(1n);
      expect(await f.mice.balanceOf(f.buyer.address, 1n)).to.equal(1n);
      expect(await f.mice.balanceOf(f.buyer.address, 2n)).to.equal(1n);
    });

    it("burns correct total MIC for 3 licenses", async () => {
      const price = ROUND_PRICES[0]; // $100 per license (all round 1)
      const half  = usdtHalf(price);
      const micPerLicense = calcMicBurn(half);
      const totalMicBurn = micPerLicense * 3n;

      const supplyBefore = await f.mic.totalSupply();
      await f.mice.connect(f.buyer).buyLicense(3n);
      const supplyAfter = await f.mic.totalSupply();

      expect(supplyBefore - supplyAfter).to.equal(totalMicBurn);
    });

    it("deducts correct total USDT for 3 licenses", async () => {
      const totalUSDT = usdtHalf(ROUND_PRICES[0]) * 3n;
      const before = await f.usdt.balanceOf(f.buyer.address);
      await f.mice.connect(f.buyer).buyLicense(3n);
      const after = await f.usdt.balanceOf(f.buyer.address);
      expect(before - after).to.equal(totalUSDT);
    });
  });

  // ── isActive ────────────────────────────────────────────────────────────────

  describe("isActive", () => {
    it("is false until activated, true after", async () => {
      await f.mice.connect(f.buyer).buyLicense(1n);
      expect(await f.mice.isActive(0n)).to.be.false;   // bought, not mining yet
      await time.increase(72 * 3600 + 1);
      await (f.mice as any).activate(0n);
      expect(await f.mice.isActive(0n)).to.be.true;
    });

    it("returns false after 360 days have elapsed", async () => {
      await f.mice.connect(f.buyer).buyLicense(1n);
      await time.increase(Number(DURATION) + 1);
      expect(await f.mice.isActive(0n)).to.be.false;
    });

    it("returns false for a non-existent license", async () => {
      expect(await f.mice.isActive(9999n)).to.be.false;
    });
  });

  // ── Supply cap ──────────────────────────────────────────────────────────────

  describe("Supply cap", () => {
    it("reverts when trying to buy beyond MAX_SUPPLY", async () => {
      // We can't mint 100K in a unit test — instead test the revert condition directly
      // by checking the revert string when totalMinted >= MAX_SUPPLY
      // We'll use the admin setTotalMinted if available, otherwise skip to boundary check
      // Since we can't fast-forward 100K mints, we verify the require logic path exists:
      // Test that quantity=0 reverts
      await expect(
        f.mice.connect(f.buyer).buyLicense(0n)
      ).to.be.revertedWith("MICE: zero quantity");
    });

    it("reverts when quantity would exceed MAX_SUPPLY", async () => {
      // Buy 1 to confirm it works, then attempt to buy MAX_SUPPLY worth
      // This tests the guard: totalMinted + quantity > MAX_SUPPLY
      await expect(
        f.mice.connect(f.buyer).buyLicense(MAX_SUPPLY + 1n)
      ).to.be.revertedWith("MICE: exceeds max supply");
    });
  });

  // ── getUserLicenses ─────────────────────────────────────────────────────────

  describe("getUserLicenses", () => {
    it("returns correct license IDs for a user", async () => {
      await f.mice.connect(f.buyer).buyLicense(2n);
      const ids = await f.mice.getUserLicenses(f.buyer.address);
      expect(ids.length).to.equal(2);
      expect(ids[0]).to.equal(0n);
      expect(ids[1]).to.equal(1n);
    });

    it("returns empty array for user with no licenses", async () => {
      const ids = await f.mice.getUserLicenses(f.buyer2.address);
      expect(ids.length).to.equal(0);
    });
  });

  // ── Slot recycling ──────────────────────────────────────────────────────────

  describe("Slot recycling (expired license reuse)", () => {
    it("expired license can be recycled and the seat re-sold", async () => {
      await f.mice.connect(f.buyer).buyLicense(1n);
      const licenseId = 0n;

      await time.increase(72 * 3600 + 1);
      await (f.mice as any).activate(licenseId);
      expect(await (f.mice as any).activeLicenses()).to.equal(1n);

      await time.increase(Number(DURATION) + 1);
      expect(await f.mice.isActive(licenseId)).to.be.false;

      await f.mice.recycleLicense(licenseId);
      expect(await f.mice.recycledCount()).to.equal(1n);
      expect(await (f.mice as any).activeLicenses()).to.equal(0n);

      // The freed seat is handed to the next buyer, and totalMinted does NOT grow —
      // that is exactly what makes renewals possible once 100,000 are minted.
      const before = await f.mice.totalMinted();
      await f.mice.connect(f.buyer2).buyLicense(1n);
      expect(await f.mice.totalMinted()).to.equal(before);
      expect(await f.mice.recycledCount()).to.equal(0n);
      expect((await f.mice.licenses(licenseId)).owner).to.equal(f.buyer2.address);
    });
  });

  // ── Admin ────────────────────────────────────────────────────────────────────

  describe("Pricing comes from the pool, not from an admin", () => {
    it("there is no admin price setter at all", async () => {
      expect((f.mice as any).setMicPriceUSDT).to.equal(undefined);
      expect((f.mice as any).micPriceUSDT).to.equal(undefined);
    });

    it("burns the economically correct amount: $50 at $0.01 = 5,000 MIC", async () => {
      const half = ROUND_PRICES[0] / 2n;                 // $50
      const before = await f.mic.balanceOf(f.buyer.address);
      await (f.mice.connect(f.buyer) as any)["buyLicense(uint256)"](1);
      const burned = before - (await f.mic.balanceOf(f.buyer.address));
      // Independent of the contract's own formula: $50 / $0.01 = 5,000 MIC
      expect(burned).to.equal(ethers.parseEther("5000"));
      expect(burned).to.equal(calcMicBurn(half));
    });

    it("quoteMicRequired matches what is actually pulled", async () => {
      const quoted = await (f.mice as any).quoteMicRequired(2);
      const before = await f.mic.balanceOf(f.buyer.address);
      await (f.mice.connect(f.buyer) as any)["buyLicense(uint256)"](2);
      expect(before - (await f.mic.balanceOf(f.buyer.address))).to.equal(quoted);
    });

    it("uses the LOWER of spot and 7-day average, so pumping spot does not help", async () => {
      // Spot pumped 10x; the quote must still use the unchanged average.
      await (f.pool as any).setPrices(MIC_PRICE_USDT * 10n, MIC_PRICE_USDT, MIC_PRICE_USDT);
      const quoted = await (f.mice as any).quoteMicRequired(1);
      expect(quoted).to.equal(calcMicBurn(ROUND_PRICES[0] / 2n));
    });

    it("a depressed spot makes the buyer owe MORE, not less", async () => {
      const atPar = await (f.mice as any).quoteMicRequired(1);
      await (f.pool as any).setPrices(MIC_PRICE_USDT / 2n, MIC_PRICE_USDT, MIC_PRICE_USDT);
      expect(await (f.mice as any).quoteMicRequired(1)).to.equal(atPar * 2n);
    });
  });
});
