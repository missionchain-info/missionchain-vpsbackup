import { expect } from "chai";
import { ethers } from "hardhat";
import { ReferralRegistry, MockUSDT } from "../../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("ReferralRegistry", function () {
  let registry: ReferralRegistry;
  let usdt: MockUSDT;
  let admin: SignerWithAddress;
  let caller: SignerWithAddress;   // authorized sale contract (PreSale / MICELicense)
  let stranger: SignerWithAddress;
  let alice: SignerWithAddress;    // buyer
  let bob: SignerWithAddress;      // F1 referrer for alice
  let carol: SignerWithAddress;    // F2 referrer (bob's referrer)
  let dave: SignerWithAddress;     // another buyer

  const CALLER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("CALLER_ROLE"));
  const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;

  // USDT amounts (6 decimals)
  const USDT_100   = 100n   * 10n ** 6n;
  const USDT_1000  = 1_000n * 10n ** 6n;
  const USDT_5000  = 5_000n * 10n ** 6n;
  const USDT_10000 = 10_000n * 10n ** 6n;
  const USDT_20000 = 20_000n * 10n ** 6n;
  const USDT_50000 = 50_000n * 10n ** 6n;
  const USDT_150000 = 150_000n * 10n ** 6n;
  const USDT_500000 = 500_000n * 10n ** 6n;

  // GV tier thresholds in USDT (6-decimal format from CLAUDE.md)
  // Tier 0 (Believer):       $0 – $4,999       → 0 BPS
  // Tier 1 (Builder):        $5,000 – $19,999   → 300 BPS (3%)
  // Tier 2 (Connector):      $20,000 – $49,999  → 500 BPS (5%)
  // Tier 3 (Champion):       $50,000 – $149,999 → 700 BPS (7%)
  // Tier 4 (Ambassador):     $150,000 – $499,999→ 800 BPS (8%)
  // Tier 5 (Legend):         $500,000+          → 900 BPS (9%)

  beforeEach(async () => {
    [admin, caller, stranger, alice, bob, carol, dave] = await ethers.getSigners();

    // Deploy MockUSDT
    const MockUSDTFactory = await ethers.getContractFactory("MockUSDT");
    usdt = await MockUSDTFactory.deploy();

    // Deploy ReferralRegistry
    const RegistryFactory = await ethers.getContractFactory("ReferralRegistry");
    registry = await RegistryFactory.deploy(
      await usdt.getAddress(),
      admin.address,
    );

    // Grant CALLER_ROLE to authorized sale contract
    await registry.connect(admin).grantRole(CALLER_ROLE, caller.address);

    // Mint USDT to caller (simulates PreSale/MICELicense holding USDT to distribute)
    await usdt.mint(caller.address, 10_000_000n * 10n ** 6n); // 10M USDT

    // Approve registry to pull from caller
    await usdt.connect(caller).approve(await registry.getAddress(), ethers.MaxUint256);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Constructor
  // ─────────────────────────────────────────────────────────────────────────
  describe("Constructor", () => {
    it("sets USDT address", async () => {
      expect(await registry.usdt()).to.equal(await usdt.getAddress());
    });

    it("grants DEFAULT_ADMIN_ROLE to admin", async () => {
      expect(await registry.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.be.true;
    });

    it("reverts on zero USDT address", async () => {
      const Factory = await ethers.getContractFactory("ReferralRegistry");
      await expect(
        Factory.deploy(ethers.ZeroAddress, admin.address)
      ).to.be.revertedWith("Ref: zero address");
    });

    it("reverts on zero admin address", async () => {
      const Factory = await ethers.getContractFactory("ReferralRegistry");
      await expect(
        Factory.deploy(await usdt.getAddress(), ethers.ZeroAddress)
      ).to.be.revertedWith("Ref: zero address");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // setReferrer
  // ─────────────────────────────────────────────────────────────────────────
  describe("setReferrer", () => {
    it("sets F1 referrer correctly", async () => {
      await registry.connect(caller).setReferrer(alice.address, bob.address);
      expect(await registry.referrerOf(alice.address)).to.equal(bob.address);
    });

    it("emits ReferrerSet event", async () => {
      await expect(registry.connect(caller).setReferrer(alice.address, bob.address))
        .to.emit(registry, "ReferrerSet")
        .withArgs(alice.address, bob.address);
    });

    it("referrer is immutable — cannot be changed after set", async () => {
      await registry.connect(caller).setReferrer(alice.address, bob.address);
      await expect(
        registry.connect(caller).setReferrer(alice.address, carol.address)
      ).to.be.revertedWith("Ref: already registered");
    });

    it("reverts on self-referral", async () => {
      await expect(
        registry.connect(caller).setReferrer(alice.address, alice.address)
      ).to.be.revertedWith("Ref: self-referral");
    });

    it("reverts on zero user address", async () => {
      await expect(
        registry.connect(caller).setReferrer(ethers.ZeroAddress, bob.address)
      ).to.be.revertedWith("Ref: zero address");
    });

    it("reverts on zero referrer address", async () => {
      await expect(
        registry.connect(caller).setReferrer(alice.address, ethers.ZeroAddress)
      ).to.be.revertedWith("Ref: zero address");
    });

    it("only CALLER_ROLE can setReferrer", async () => {
      await expect(
        registry.connect(stranger).setReferrer(alice.address, bob.address)
      ).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // distributeReferral — reward payments
  // ─────────────────────────────────────────────────────────────────────────
  describe("distributeReferral — reward payments", () => {
    it("pays F1 7% and F2 3% when both exist", async () => {
      // Chain: alice → bob → carol
      await registry.connect(caller).setReferrer(alice.address, bob.address);
      await registry.connect(caller).setReferrer(bob.address, carol.address);

      const bobBefore   = await usdt.balanceOf(bob.address);
      const carolBefore = await usdt.balanceOf(carol.address);

      await registry.connect(caller).distributeReferral(alice.address, USDT_1000);

      const expectedF1 = (USDT_1000 * 700n) / 10000n; // 7% = 70 USDT
      const expectedF2 = (USDT_1000 * 300n) / 10000n; // 3% = 30 USDT

      expect(await usdt.balanceOf(bob.address)).to.equal(bobBefore + expectedF1);
      expect(await usdt.balanceOf(carol.address)).to.equal(carolBefore + expectedF2);
    });

    it("emits RewardDistributed event", async () => {
      await registry.connect(caller).setReferrer(alice.address, bob.address);
      await registry.connect(caller).setReferrer(bob.address, carol.address);

      const expectedF1 = (USDT_1000 * 700n) / 10000n;
      const expectedF2 = (USDT_1000 * 300n) / 10000n;

      await expect(registry.connect(caller).distributeReferral(alice.address, USDT_1000))
        .to.emit(registry, "RewardDistributed")
        .withArgs(alice.address, bob.address, expectedF1, carol.address, expectedF2);
    });

    it("when no F1: 7% stays in contract (for admin recovery)", async () => {
      // alice has no referrer
      const contractBefore = await usdt.balanceOf(await registry.getAddress());
      await registry.connect(caller).distributeReferral(alice.address, USDT_1000);
      const contractAfter = await usdt.balanceOf(await registry.getAddress());

      // 7% of 1000 USDT stays in contract (no F1, no F2)
      const expectedStayed = (USDT_1000 * 700n) / 10000n;
      expect(contractAfter - contractBefore).to.equal(expectedStayed);
    });

    it("when F1 exists but no F2: F1 gets 7%, F2 3% stays in contract", async () => {
      await registry.connect(caller).setReferrer(alice.address, bob.address);
      // bob has no referrer

      const bobBefore      = await usdt.balanceOf(bob.address);
      const contractBefore = await usdt.balanceOf(await registry.getAddress());

      await registry.connect(caller).distributeReferral(alice.address, USDT_1000);

      const expectedF1      = (USDT_1000 * 700n) / 10000n; // 70 USDT to bob
      const expectedStayed  = (USDT_1000 * 300n) / 10000n; // 30 USDT stays in contract

      expect(await usdt.balanceOf(bob.address)).to.equal(bobBefore + expectedF1);
      expect(await usdt.balanceOf(await registry.getAddress())).to.equal(contractBefore + expectedStayed);
    });

    it("only CALLER_ROLE can call distributeReferral", async () => {
      await expect(
        registry.connect(stranger).distributeReferral(alice.address, USDT_1000)
      ).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    });

    it("reverts if amount is zero", async () => {
      await expect(
        registry.connect(caller).distributeReferral(alice.address, 0n)
      ).to.be.revertedWith("Ref: zero amount");
    });

    it("multiple purchases accumulate earnings for referrers", async () => {
      await registry.connect(caller).setReferrer(alice.address, bob.address);

      const bobBefore = await usdt.balanceOf(bob.address);
      await registry.connect(caller).distributeReferral(alice.address, USDT_1000);
      await registry.connect(caller).distributeReferral(alice.address, USDT_1000);

      const expectedF1 = (USDT_1000 * 700n) / 10000n * 2n;
      expect(await usdt.balanceOf(bob.address)).to.equal(bobBefore + expectedF1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // GV Tracking
  // ─────────────────────────────────────────────────────────────────────────
  describe("GV Tracking", () => {
    it("purchase adds usdtAmount to direct referrer GV (F1)", async () => {
      await registry.connect(caller).setReferrer(alice.address, bob.address);

      await registry.connect(caller).distributeReferral(alice.address, USDT_1000);

      expect(await registry.groupVolume(bob.address)).to.equal(USDT_1000);
    });

    it("purchase adds usdtAmount to F2 (referrer's referrer) GV too", async () => {
      await registry.connect(caller).setReferrer(alice.address, bob.address);
      await registry.connect(caller).setReferrer(bob.address, carol.address);

      await registry.connect(caller).distributeReferral(alice.address, USDT_1000);

      expect(await registry.groupVolume(bob.address)).to.equal(USDT_1000);
      expect(await registry.groupVolume(carol.address)).to.equal(USDT_1000);
    });

    it("GV propagates through entire upline chain (3+ levels)", async () => {
      // Chain: alice → bob → carol → dave
      await registry.connect(caller).setReferrer(alice.address, bob.address);
      await registry.connect(caller).setReferrer(bob.address, carol.address);
      await registry.connect(caller).setReferrer(carol.address, dave.address);

      await registry.connect(caller).distributeReferral(alice.address, USDT_1000);

      expect(await registry.groupVolume(bob.address)).to.equal(USDT_1000);
      expect(await registry.groupVolume(carol.address)).to.equal(USDT_1000);
      expect(await registry.groupVolume(dave.address)).to.equal(USDT_1000);
    });

    it("GV accumulates over multiple purchases", async () => {
      await registry.connect(caller).setReferrer(alice.address, bob.address);

      await registry.connect(caller).distributeReferral(alice.address, USDT_1000);
      await registry.connect(caller).distributeReferral(alice.address, USDT_1000);

      expect(await registry.groupVolume(bob.address)).to.equal(USDT_1000 * 2n);
    });

    it("GV from multiple different downlines accumulates for upline", async () => {
      // alice and dave both refer to bob; bob refers carol
      await registry.connect(caller).setReferrer(alice.address, bob.address);
      await registry.connect(caller).setReferrer(dave.address, bob.address);
      await registry.connect(caller).setReferrer(bob.address, carol.address);

      await registry.connect(caller).distributeReferral(alice.address, USDT_1000);
      await registry.connect(caller).distributeReferral(dave.address, USDT_1000);

      // bob gets GV from both alice and dave
      expect(await registry.groupVolume(bob.address)).to.equal(USDT_1000 * 2n);
      // carol also accumulates both
      expect(await registry.groupVolume(carol.address)).to.equal(USDT_1000 * 2n);
    });

    it("buyer with no referrer has zero GV (GV only tracks upline)", async () => {
      await registry.connect(caller).distributeReferral(alice.address, USDT_1000);
      expect(await registry.groupVolume(alice.address)).to.equal(0n);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getTier
  // ─────────────────────────────────────────────────────────────────────────
  describe("getTier", () => {
    it("tier 0 (Believer): GV < $5,000", async () => {
      await registry.connect(caller).setReferrer(alice.address, bob.address);
      await registry.connect(caller).distributeReferral(alice.address, USDT_1000); // bob GV = $1000
      expect(await registry.getTier(bob.address)).to.equal(0);
    });

    it("tier 1 (Builder): GV = $5,000", async () => {
      await registry.connect(caller).setReferrer(alice.address, bob.address);
      await registry.connect(caller).distributeReferral(alice.address, USDT_5000);
      expect(await registry.getTier(bob.address)).to.equal(1);
    });

    it("tier 1 (Builder): GV < $20,000", async () => {
      await registry.connect(caller).setReferrer(alice.address, bob.address);
      await registry.connect(caller).distributeReferral(alice.address, USDT_10000);
      expect(await registry.getTier(bob.address)).to.equal(1);
    });

    it("tier 2 (Connector): GV = $20,000", async () => {
      await registry.connect(caller).setReferrer(alice.address, bob.address);
      await registry.connect(caller).distributeReferral(alice.address, USDT_20000);
      expect(await registry.getTier(bob.address)).to.equal(2);
    });

    it("tier 3 (Champion): GV = $50,000", async () => {
      await registry.connect(caller).setReferrer(alice.address, bob.address);
      await registry.connect(caller).distributeReferral(alice.address, USDT_50000);
      expect(await registry.getTier(bob.address)).to.equal(3);
    });

    it("tier 4 (Ambassador): GV = $150,000", async () => {
      await registry.connect(caller).setReferrer(alice.address, bob.address);
      await registry.connect(caller).distributeReferral(alice.address, USDT_150000);
      expect(await registry.getTier(bob.address)).to.equal(4);
    });

    it("tier 5 (Legend): GV = $500,000", async () => {
      await registry.connect(caller).setReferrer(alice.address, bob.address);
      await registry.connect(caller).distributeReferral(alice.address, USDT_500000);
      expect(await registry.getTier(bob.address)).to.equal(5);
    });

    it("tier 0 for address with no GV", async () => {
      expect(await registry.getTier(bob.address)).to.equal(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getGVRate
  // ─────────────────────────────────────────────────────────────────────────
  describe("getGVRate", () => {
    it("tier 0 → 0 BPS", async () => {
      expect(await registry.getGVRate(bob.address)).to.equal(0);
    });

    it("tier 1 → 300 BPS (3%)", async () => {
      await registry.connect(caller).setReferrer(alice.address, bob.address);
      await registry.connect(caller).distributeReferral(alice.address, USDT_5000);
      expect(await registry.getGVRate(bob.address)).to.equal(300);
    });

    it("tier 2 → 500 BPS (5%)", async () => {
      await registry.connect(caller).setReferrer(alice.address, bob.address);
      await registry.connect(caller).distributeReferral(alice.address, USDT_20000);
      expect(await registry.getGVRate(bob.address)).to.equal(500);
    });

    it("tier 3 → 700 BPS (7%)", async () => {
      await registry.connect(caller).setReferrer(alice.address, bob.address);
      await registry.connect(caller).distributeReferral(alice.address, USDT_50000);
      expect(await registry.getGVRate(bob.address)).to.equal(700);
    });

    it("tier 4 → 800 BPS (8%)", async () => {
      await registry.connect(caller).setReferrer(alice.address, bob.address);
      await registry.connect(caller).distributeReferral(alice.address, USDT_150000);
      expect(await registry.getGVRate(bob.address)).to.equal(800);
    });

    it("tier 5 → 900 BPS (9%)", async () => {
      await registry.connect(caller).setReferrer(alice.address, bob.address);
      await registry.connect(caller).distributeReferral(alice.address, USDT_500000);
      expect(await registry.getGVRate(bob.address)).to.equal(900);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Monthly GV tracking
  // ─────────────────────────────────────────────────────────────────────────
  describe("Monthly GV tracking", () => {
    it("monthlyGV increments for current month index on purchase", async () => {
      await registry.connect(caller).setReferrer(alice.address, bob.address);
      await registry.connect(caller).distributeReferral(alice.address, USDT_1000);

      const monthIndex = await registry.currentMonthIndex();
      expect(await registry.monthlyGV(bob.address, monthIndex)).to.equal(USDT_1000);
    });

    it("monthlyGV accumulates within same month", async () => {
      await registry.connect(caller).setReferrer(alice.address, bob.address);
      await registry.connect(caller).distributeReferral(alice.address, USDT_1000);
      await registry.connect(caller).distributeReferral(alice.address, USDT_1000);

      const monthIndex = await registry.currentMonthIndex();
      expect(await registry.monthlyGV(bob.address, monthIndex)).to.equal(USDT_1000 * 2n);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // View helpers
  // ─────────────────────────────────────────────────────────────────────────
  describe("View helpers", () => {
    it("referrerOf returns zero address for unregistered user", async () => {
      expect(await registry.referrerOf(alice.address)).to.equal(ethers.ZeroAddress);
    });

    it("referrerOf returns F1 after registration", async () => {
      await registry.connect(caller).setReferrer(alice.address, bob.address);
      expect(await registry.referrerOf(alice.address)).to.equal(bob.address);
    });

    it("groupVolume starts at 0", async () => {
      expect(await registry.groupVolume(bob.address)).to.equal(0n);
    });
  });
});
