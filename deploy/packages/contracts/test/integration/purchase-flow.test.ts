import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import {
  PreSale,
  MICToken,
  LockManager,
  CommunityNFTv2,
  ReferralRegistry,
  RevenueRouter,
  MockUSDT,
  MockRewardReceiver,
} from "../../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

// ─── Constants ────────────────────────────────────────────────────────────────

const USDT_6  = 10n ** 18n;        // 1 USDT — BSC-USD is 18 decimals
const MIC_18  = 10n ** 18n;        // 1 MIC in 18-decimal

// Luminary package: $5,000 USDT → 1,000,000 MIC
const PKG3_USDT = 5_000n * USDT_6;          // $5,000
const PKG3_MIC  = 1_000_000n * MIC_18;      // 1_000_000e18 (18 dec)

const ALLOCATION = 315_000_000n * MIC_18;

// Time constants (matching LockManager: MONTH = 30 days)
const SIX_MONTHS   = 6 * 30 * 24 * 3600;    // 180 days in seconds
const ONE_MONTH    =     30 * 24 * 3600;     //  30 days in seconds
const FORTY_TWO_MO = 42 * ONE_MONTH;         // 42 months = full vest

// Revenue model V2 (2026-07) — every % is of GROSS; nothing is taken off the top.
// The router splits the full $5,000 six ways, then the registry pays F1/F2 out of its
// own 10% slice.
// F1 = 7%  → $350 USDT = 350_000_000 (6 dec)
// F2 = 3%  → $150 USDT = 150_000_000 (6 dec)
const F1_REWARD  = (PKG3_USDT * 700n)  / 10_000n;   // 350_000_000
const F2_REWARD  = (PKG3_USDT * 300n)  / 10_000n;   // 150_000_000

// Router gross BPS
const BPS_REFERRAL   = 1000n; // 10%
const BPS_MARKETING  = 2500n; // 25%
const BPS_MANAGEMENT = 750n;  // 7.5%
const BPS_TREASURY   = 1250n; // 12.5%
const BPS_STAKING    = 500n;  // 5%

// Vesting: 1M MIC, cliff 10% = 100K, monthly 2.5% = 25K
const CLIFF_UNLOCK   = PKG3_MIC / 10n;                  // 100,000 MIC
const MONTHLY_UNLOCK = (PKG3_MIC * 250n) / 10_000n;     //  25,000 MIC

// CommunityNFT tier IDs
const LUMINARY_TIER = 3n;

// ─── Fixture ──────────────────────────────────────────────────────────────────

interface Fixture {
  preSale:          PreSale;
  micToken:         MICToken;
  lockManager:      LockManager;
  communityNFT:     CommunityNFTv2;
  referralRegistry: ReferralRegistry;
  revenueRouter:    RevenueRouter;
  usdt:             MockUSDT;
  admin:            SignerWithAddress;
  buyer:            SignerWithAddress;   // user1
  referrer1:        SignerWithAddress;   // direct referrer (F1) for buyer
  referrer2:        SignerWithAddress;   // F1's referrer (F2 for buyer)
  // Router sinks — CONTRACTS: the router calls receiveAndDistribute()/receiveUSDT().
  marketing:        MockRewardReceiver;
  management:       MockRewardReceiver;
  treasury:         MockRewardReceiver;
  reservedStaking:  MockRewardReceiver;
  liquidity:        MockRewardReceiver;
  miPool:           MockRewardReceiver;  // Milestones & Incentives overflow sink
}

async function deployFixture(): Promise<Fixture> {
  const [
    admin,
    buyer,
    referrer1,
    referrer2,
  ] = await ethers.getSigners();

  // ── Deploy MockUSDT ───────────────────────────────────────────────────────
  const USDT = await ethers.getContractFactory("MockUSDT");
  const usdt = await USDT.deploy() as unknown as MockUSDT;

  // ── Deploy MICToken ───────────────────────────────────────────────────────
  const MICFactory = await ethers.getContractFactory("MICToken");
  const micToken = await MICFactory.deploy(admin.address) as unknown as MICToken;

  // ── Deploy LockManager ────────────────────────────────────────────────────
  const LMFactory = await ethers.getContractFactory("LockManager");
  const lockManager = await LMFactory.deploy() as unknown as LockManager;

  // ── Deploy CommunityNFTv2 (what Phase-1 actually ships) ───────────────────
  const CNFTFactory = await ethers.getContractFactory("CommunityNFTv2");
  const communityNFT = await CNFTFactory.deploy(admin.address) as unknown as CommunityNFTv2;

  // ── Deploy ReferralRegistry ───────────────────────────────────────────────
  const RegFactory = await ethers.getContractFactory("ReferralRegistry");
  const referralRegistry = await RegFactory.deploy(
    await usdt.getAddress(),
    admin.address,
  ) as unknown as ReferralRegistry;

  // ── Deploy the router sinks (contracts — the router CALLS them) ───────────
  const MRFactory = await ethers.getContractFactory("MockRewardReceiver");
  const newSink = async () =>
    await MRFactory.deploy(await usdt.getAddress()) as unknown as MockRewardReceiver;
  const marketing       = await newSink();
  const management      = await newSink();
  const treasury        = await newSink();
  const reservedStaking = await newSink();
  const liquidity       = await newSink();
  const miPool          = await newSink();

  // ── Deploy RevenueRouter — 8 args, referral slice → ReferralRegistry ──────
  const RouterFactory = await ethers.getContractFactory("RevenueRouter");
  const revenueRouter = await RouterFactory.deploy(
    await usdt.getAddress(),
    await referralRegistry.getAddress(),
    await marketing.getAddress(),
    await management.getAddress(),
    await treasury.getAddress(),
    await reservedStaking.getAddress(),
    await liquidity.getAddress(),
    admin.address,
  ) as unknown as RevenueRouter;

  // ── Deploy PreSale ────────────────────────────────────────────────────────
  const PSFactory = await ethers.getContractFactory("PreSale");
  const preSale = await PSFactory.deploy(
    await usdt.getAddress(),
    await micToken.getAddress(),
    await lockManager.getAddress(),
    await communityNFT.getAddress(),
    await referralRegistry.getAddress(),
    await revenueRouter.getAddress(),
    admin.address,
  ) as unknown as PreSale;

  // ── Grant roles ───────────────────────────────────────────────────────────

  // LockManager: SCHEDULE_CREATOR_ROLE → preSale
  const SCHEDULE_CREATOR_ROLE = await lockManager.SCHEDULE_CREATOR_ROLE();
  await lockManager.connect(admin).grantRole(SCHEDULE_CREATOR_ROLE, await preSale.getAddress());

  // CommunityNFT: MINTER_ROLE → preSale
  const MINTER_ROLE = await communityNFT.MINTER_ROLE();
  await communityNFT.connect(admin).grantRole(MINTER_ROLE, await preSale.getAddress());

  // ReferralRegistry: CALLER_ROLE → preSale AND admin (for setReferrer setup)
  const CALLER_ROLE = await referralRegistry.CALLER_ROLE();
  await referralRegistry.connect(admin).grantRole(CALLER_ROLE, await preSale.getAddress());
  await referralRegistry.connect(admin).grantRole(CALLER_ROLE, admin.address);
  await referralRegistry.connect(admin).setIncentivePool(await miPool.getAddress());

  // RevenueRouter: DISTRIBUTOR_ROLE → preSale
  const DISTRIBUTOR_ROLE = await revenueRouter.DISTRIBUTOR_ROLE();
  await revenueRouter.connect(admin).grantRole(DISTRIBUTOR_ROLE, await preSale.getAddress());

  // ── Wire LockManager into MICToken (required for Hybrid Token-Level Lock) ─
  // Without this, MICToken._update() skips the lock check (lockManager == address(0))
  await micToken.connect(admin).setLockManager(await lockManager.getAddress());

  // ── Fund PreSale with 315M MIC ────────────────────────────────────────────
  await micToken.connect(admin).transfer(await preSale.getAddress(), ALLOCATION);

  // ── Activate sale ─────────────────────────────────────────────────────────
  await preSale.connect(admin).setActive(true);

  // ── Set up referral chain: buyer → referrer1 (F1) → referrer2 (F2) ────────
  await referralRegistry.connect(admin).setReferrer(referrer1.address, referrer2.address);
  await referralRegistry.connect(admin).setReferrer(buyer.address, referrer1.address);

  // ── Mint 10K MockUSDT to buyer, approve PreSale ───────────────────────────
  const BUYER_USDT = 10_000n * USDT_6;  // $10,000
  await usdt.mint(buyer.address, BUYER_USDT);
  await usdt.connect(buyer).approve(await preSale.getAddress(), ethers.MaxUint256);

  return {
    preSale, micToken, lockManager, communityNFT, referralRegistry, revenueRouter,
    usdt, admin, buyer, referrer1, referrer2,
    marketing, management, treasury, reservedStaking, liquidity, miPool,
  };
}

// ─── Integration Tests ────────────────────────────────────────────────────────

describe("Integration: Purchase Flow — PreSale $5K Luminary + Vesting", function () {

  // ─── 1. Purchase: MIC transferred to buyer ──────────────────────────────

  it("buyer has 1,000,000 MIC in wallet after purchase (balanceOf)", async () => {
    const f = await deployFixture();
    await f.preSale.connect(f.buyer).buy(PKG3_USDT, 3);

    const balance = await f.micToken.balanceOf(f.buyer.address);
    expect(balance).to.equal(PKG3_MIC);
  });

  // ─── 2. All MIC is locked immediately after purchase ────────────────────

  it("buyer has 1,000,000 MIC locked (lockedOf) immediately after purchase", async () => {
    const f = await deployFixture();
    await f.preSale.connect(f.buyer).buy(PKG3_USDT, 3);

    const locked = await f.lockManager.lockedOf(f.buyer.address);
    expect(locked).to.equal(PKG3_MIC);
  });

  // ─── 3. Buyer cannot transfer when fully locked ──────────────────────────

  it("buyer cannot transfer any MIC before cliff (all locked)", async () => {
    const f = await deployFixture();
    await f.preSale.connect(f.buyer).buy(PKG3_USDT, 3);

    // Attempt to transfer 1 MIC — should revert (transfer-locked check in MICToken._update)
    await expect(
      f.micToken.connect(f.buyer).transfer(f.admin.address, 1n)
    ).to.be.reverted;
  });

  // ─── 4. Luminary NFT minted to buyer ────────────────────────────────────

  it("Luminary NFT (tier 3) minted to buyer after Luminary package purchase", async () => {
    const f = await deployFixture();
    await f.preSale.connect(f.buyer).buy(PKG3_USDT, 3);

    // ERC-721 with per-tier accounting
    const nftBalance = await f.communityNFT.activeCountOf(f.buyer.address, LUMINARY_TIER);
    expect(nftBalance).to.equal(1n);
  });

  // ─── 5. Referrer1 (F1) receives 7% = $350 USDT ──────────────────────────

  it("referrer1 (F1) receives 7% of purchase = $350 USDT", async () => {
    const f = await deployFixture();
    const balBefore = await f.usdt.balanceOf(f.referrer1.address);
    await f.preSale.connect(f.buyer).buy(PKG3_USDT, 3);
    const balAfter = await f.usdt.balanceOf(f.referrer1.address);

    expect(balAfter - balBefore).to.equal(F1_REWARD);
  });

  // ─── 6. Referrer2 (F2) receives 3% = $150 USDT ──────────────────────────

  it("referrer2 (F2) receives 3% of purchase = $150 USDT", async () => {
    const f = await deployFixture();
    const balBefore = await f.usdt.balanceOf(f.referrer2.address);
    await f.preSale.connect(f.buyer).buy(PKG3_USDT, 3);
    const balAfter = await f.usdt.balanceOf(f.referrer2.address);

    expect(balAfter - balBefore).to.equal(F2_REWARD);
  });

  // ─── 7. Full GROSS is split 6 ways by the RevenueRouter ─────────────────

  it("RevenueRouter splits the full GROSS $5,000 six ways (10/25/7.5/12.5/5/40)", async () => {
    const f = await deployFixture();

    await f.preSale.connect(f.buyer).buy(PKG3_USDT, 3);

    const toReferral   = (PKG3_USDT * BPS_REFERRAL)   / 10_000n;
    const toMarketing  = (PKG3_USDT * BPS_MARKETING)  / 10_000n;
    const toManagement = (PKG3_USDT * BPS_MANAGEMENT) / 10_000n;
    const toTreasury   = (PKG3_USDT * BPS_TREASURY)   / 10_000n;
    const toStaking    = (PKG3_USDT * BPS_STAKING)    / 10_000n;
    // Liquidity gets the remainder, so it absorbs rounding dust.
    const toLiquidity  = PKG3_USDT - toReferral - toMarketing - toManagement - toTreasury - toStaking;

    expect(await f.marketing.received()).to.equal(toMarketing);
    expect(await f.management.received()).to.equal(toManagement);
    expect(await f.treasury.received()).to.equal(toTreasury);
    expect(await f.reservedStaking.received()).to.equal(toStaking);
    expect(await f.liquidity.received()).to.equal(toLiquidity);

    // The referral 10% left the router entirely — F1+F2 consumed it, nothing overflowed.
    expect(F1_REWARD + F2_REWARD).to.equal(toReferral);
    expect(await f.miPool.received()).to.equal(0n);
    expect(await f.usdt.balanceOf(await f.referralRegistry.getAddress())).to.equal(0n);
  });

  // ─── 8. Time warp 6 months → 10% unlocked ───────────────────────────────

  it("after 6-month cliff: 10% = 100,000 MIC unlocked, buyer can transfer up to 100K", async () => {
    const f = await deployFixture();
    await f.preSale.connect(f.buyer).buy(PKG3_USDT, 3);

    await time.increase(SIX_MONTHS);

    // lockedOf should now be 90% = 900,000 MIC
    const locked = await f.lockManager.lockedOf(f.buyer.address);
    expect(locked).to.equal(PKG3_MIC - CLIFF_UNLOCK); // 900,000 MIC

    // Can transfer exactly 100,000 MIC (cliff amount)
    await expect(
      f.micToken.connect(f.buyer).transfer(f.admin.address, CLIFF_UNLOCK)
    ).to.not.be.reverted;

    // Verify buyer's balance went down
    const balAfter = await f.micToken.balanceOf(f.buyer.address);
    expect(balAfter).to.equal(PKG3_MIC - CLIFF_UNLOCK); // 900,000 MIC
  });

  // ─── 9. Cannot transfer more than unlocked at cliff ─────────────────────

  it("after 6-month cliff: cannot transfer 100,001 MIC (exceeds unlocked amount)", async () => {
    const f = await deployFixture();
    await f.preSale.connect(f.buyer).buy(PKG3_USDT, 3);

    await time.increase(SIX_MONTHS);

    // Attempt to transfer 1 more than unlocked
    await expect(
      f.micToken.connect(f.buyer).transfer(f.admin.address, CLIFF_UNLOCK + 1n)
    ).to.be.reverted;
  });

  // ─── 10. Time warp 1 more month → 12.5% total unlocked ─────────────────

  it("after 7 months (cliff + 1): 12.5% = 125,000 MIC total unlocked", async () => {
    const f = await deployFixture();
    await f.preSale.connect(f.buyer).buy(PKG3_USDT, 3);

    await time.increase(SIX_MONTHS + ONE_MONTH);

    const totalUnlocked = CLIFF_UNLOCK + MONTHLY_UNLOCK; // 100K + 25K = 125K
    const expectedLocked = PKG3_MIC - totalUnlocked;      // 875,000 MIC

    const locked = await f.lockManager.lockedOf(f.buyer.address);
    expect(locked).to.equal(expectedLocked);

    // Can transfer exactly 125,000 MIC
    await expect(
      f.micToken.connect(f.buyer).transfer(f.admin.address, totalUnlocked)
    ).to.not.be.reverted;
  });

  // ─── 11. Full vesting at 42 months ──────────────────────────────────────

  it("after 42 months: 100% unlocked — all MIC freely transferable", async () => {
    const f = await deployFixture();
    await f.preSale.connect(f.buyer).buy(PKG3_USDT, 3);

    // Warp to full vest: 6-month cliff + 36 months × 2.5%/month = 100%
    await time.increase(FORTY_TWO_MO);

    // LockManager should show 0 locked
    const locked = await f.lockManager.lockedOf(f.buyer.address);
    expect(locked).to.equal(0n);

    // Full balance is now transferable
    const balance = await f.micToken.balanceOf(f.buyer.address);
    await expect(
      f.micToken.connect(f.buyer).transfer(f.admin.address, balance)
    ).to.not.be.reverted;

    // Buyer's balance should now be 0
    expect(await f.micToken.balanceOf(f.buyer.address)).to.equal(0n);
  });

  // ─── 12. End-to-end: full sequential flow in one test ───────────────────

  it("end-to-end: deploy → buy → lock → unlock at cliff → unlock monthly → fully vest", async () => {
    const f = await deployFixture();

    // ── Step 1: Buy Luminary package ($5,000 → 1,000,000 MIC) ───────────────
    await f.preSale.connect(f.buyer).buy(PKG3_USDT, 3);

    // Verify MIC in wallet, fully locked
    expect(await f.micToken.balanceOf(f.buyer.address)).to.equal(PKG3_MIC);
    expect(await f.lockManager.lockedOf(f.buyer.address)).to.equal(PKG3_MIC);

    // Cannot transfer at all before cliff
    await expect(
      f.micToken.connect(f.buyer).transfer(f.admin.address, 1n)
    ).to.be.reverted;

    // Luminary NFT received
    expect(await f.communityNFT.activeCountOf(f.buyer.address, LUMINARY_TIER)).to.equal(1n);

    // ── Step 2: Time warp to 6-month cliff ──────────────────────────────────
    await time.increase(SIX_MONTHS);

    expect(await f.lockManager.lockedOf(f.buyer.address)).to.equal(PKG3_MIC - CLIFF_UNLOCK);

    // Can transfer exactly cliff amount (100K)
    await f.micToken.connect(f.buyer).transfer(f.admin.address, CLIFF_UNLOCK);
    expect(await f.micToken.balanceOf(f.buyer.address)).to.equal(PKG3_MIC - CLIFF_UNLOCK);

    // ── Step 3: Time warp 1 more month (month 7) ────────────────────────────
    await time.increase(ONE_MONTH);

    // Unlocked: 100K (cliff) + 25K (month 1) = 125K; buyer already transferred 100K
    // Remaining balance: 900K. Additional unlocked: 25K → can transfer 25K more.
    const additionalUnlocked = MONTHLY_UNLOCK;
    await f.micToken.connect(f.buyer).transfer(f.admin.address, additionalUnlocked);
    expect(await f.micToken.balanceOf(f.buyer.address)).to.equal(PKG3_MIC - CLIFF_UNLOCK - additionalUnlocked);

    // ── Step 4: Warp to full vesting (42 months from start, already at 7 months) ─
    // Already advanced 7 months; need 35 more months
    await time.increase(35 * ONE_MONTH);

    expect(await f.lockManager.lockedOf(f.buyer.address)).to.equal(0n);

    // Transfer all remaining MIC
    const remaining = await f.micToken.balanceOf(f.buyer.address);
    expect(remaining).to.equal(PKG3_MIC - CLIFF_UNLOCK - additionalUnlocked);
    await f.micToken.connect(f.buyer).transfer(f.admin.address, remaining);
    expect(await f.micToken.balanceOf(f.buyer.address)).to.equal(0n);
  });
});
