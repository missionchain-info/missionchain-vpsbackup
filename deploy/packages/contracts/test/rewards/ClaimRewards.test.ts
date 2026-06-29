import { expect } from "chai";
import { ethers } from "hardhat";
import { ClaimRewards, MockUSDT, CommunityNFT, ReferralRegistry } from "../../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("ClaimRewards", function () {
  let claimRewards: ClaimRewards;
  let usdt: MockUSDT;
  let communityNFT: CommunityNFT;
  let referralRegistry: ReferralRegistry;

  let admin: SignerWithAddress;
  let distributor: SignerWithAddress; // holds DISTRIBUTOR_ROLE (RewardDistributor)
  let stranger: SignerWithAddress;
  let recipient1: SignerWithAddress;
  let recipient2: SignerWithAddress;
  let recipient3: SignerWithAddress;
  let leader1: SignerWithAddress;
  let leader2: SignerWithAddress;

  const DISTRIBUTOR_ROLE  = ethers.keccak256(ethers.toUtf8Bytes("DISTRIBUTOR_ROLE"));
  const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;
  const MINTER_ROLE        = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
  const CALLER_ROLE        = ethers.keccak256(ethers.toUtf8Bytes("CALLER_ROLE"));

  // Internal BPS split of ClaimRewards (sum = 10000)
  // Referral Reserve: 10% of net → 10/21.5 * 10000 = 4651
  // Milestone:        2.5% of net → 2.5/21.5 * 10000 = 1163
  // GV Override:      9% of net   → 9/21.5 * 10000 = 4186
  const BPS_RESERVE   = 4651n;
  const BPS_MILESTONE = 1163n;
  const BPS_GV        = 4186n;
  const BPS_TOTAL     = 10_000n;

  // Helper: give distributor USDT and approval
  async function mintAndApprove(from: SignerWithAddress, amount: bigint) {
    await usdt.mint(from.address, amount);
    await usdt.connect(from).approve(await claimRewards.getAddress(), ethers.MaxUint256);
  }

  beforeEach(async () => {
    [admin, distributor, stranger, recipient1, recipient2, recipient3, leader1, leader2] =
      await ethers.getSigners();

    // Deploy MockUSDT
    const MockUSDTFactory = await ethers.getContractFactory("MockUSDT");
    usdt = await MockUSDTFactory.deploy();

    // Deploy CommunityNFT
    const CommunityNFTFactory = await ethers.getContractFactory("CommunityNFT");
    communityNFT = await CommunityNFTFactory.deploy("https://meta.example.com/", admin.address);

    // Deploy ReferralRegistry
    const ReferralRegistryFactory = await ethers.getContractFactory("ReferralRegistry");
    referralRegistry = await ReferralRegistryFactory.deploy(
      await usdt.getAddress(),
      admin.address,
    );

    // Deploy ClaimRewards
    const ClaimRewardsFactory = await ethers.getContractFactory("ClaimRewards");
    claimRewards = await ClaimRewardsFactory.deploy(
      await usdt.getAddress(),
      await communityNFT.getAddress(),
      await referralRegistry.getAddress(),
      admin.address,
    );

    // Grant DISTRIBUTOR_ROLE to authorized distributor
    await claimRewards.connect(admin).grantRole(DISTRIBUTOR_ROLE, distributor.address);

    // Grant MINTER_ROLE on CommunityNFT to ClaimRewards (so it can mint on milestone)
    await communityNFT.connect(admin).grantRole(MINTER_ROLE, await claimRewards.getAddress());

    // Fund distributor and approve
    await mintAndApprove(distributor, 1_000_000n * 10n ** 6n);
  });

  // ─────────────────────────────────────────────────────────
  // Constructor
  // ─────────────────────────────────────────────────────────
  describe("Constructor", () => {
    it("stores correct addresses", async () => {
      expect(await claimRewards.usdt()).to.equal(await usdt.getAddress());
      expect(await claimRewards.communityNFT()).to.equal(await communityNFT.getAddress());
      expect(await claimRewards.referralRegistry()).to.equal(await referralRegistry.getAddress());
    });

    it("grants DEFAULT_ADMIN_ROLE to admin", async () => {
      expect(await claimRewards.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.be.true;
    });

    it("all pool balances start at zero", async () => {
      expect(await claimRewards.reserveBalance()).to.equal(0n);
      expect(await claimRewards.milestoneBalance()).to.equal(0n);
      expect(await claimRewards.gvBalance()).to.equal(0n);
    });

    it("reverts on zero usdt address", async () => {
      const Factory = await ethers.getContractFactory("ClaimRewards");
      await expect(
        Factory.deploy(
          ethers.ZeroAddress,
          await communityNFT.getAddress(),
          await referralRegistry.getAddress(),
          admin.address,
        ),
      ).to.be.revertedWith("ClaimRewards: zero address");
    });

    it("reverts on zero communityNFT address", async () => {
      const Factory = await ethers.getContractFactory("ClaimRewards");
      await expect(
        Factory.deploy(
          await usdt.getAddress(),
          ethers.ZeroAddress,
          await referralRegistry.getAddress(),
          admin.address,
        ),
      ).to.be.revertedWith("ClaimRewards: zero address");
    });

    it("reverts on zero referralRegistry address", async () => {
      const Factory = await ethers.getContractFactory("ClaimRewards");
      await expect(
        Factory.deploy(
          await usdt.getAddress(),
          await communityNFT.getAddress(),
          ethers.ZeroAddress,
          admin.address,
        ),
      ).to.be.revertedWith("ClaimRewards: zero address");
    });

    it("reverts on zero admin address", async () => {
      const Factory = await ethers.getContractFactory("ClaimRewards");
      await expect(
        Factory.deploy(
          await usdt.getAddress(),
          await communityNFT.getAddress(),
          await referralRegistry.getAddress(),
          ethers.ZeroAddress,
        ),
      ).to.be.revertedWith("ClaimRewards: zero address");
    });
  });

  // ─────────────────────────────────────────────────────────
  // receiveUSDT — splits to 3 internal pools
  // ─────────────────────────────────────────────────────────
  describe("receiveUSDT", () => {
    it("splits 10,000 USDT into 3 pools correctly", async () => {
      const amount = 10_000n * 10n ** 6n;

      await claimRewards.connect(distributor).receiveUSDT(amount);

      const expectedReserve   = (amount * BPS_RESERVE)   / BPS_TOTAL; // ~4,651 USDT
      const expectedMilestone = (amount * BPS_MILESTONE) / BPS_TOTAL; // ~1,163 USDT
      // GV absorbs remainder
      const expectedGV        = amount - expectedReserve - expectedMilestone;

      expect(await claimRewards.reserveBalance()).to.equal(expectedReserve);
      expect(await claimRewards.milestoneBalance()).to.equal(expectedMilestone);
      expect(await claimRewards.gvBalance()).to.equal(expectedGV);
    });

    it("all USDT stays in contract — no dust lost", async () => {
      const amount = 10_000n * 10n ** 6n;
      await claimRewards.connect(distributor).receiveUSDT(amount);

      const contractBalance = await usdt.balanceOf(await claimRewards.getAddress());
      expect(contractBalance).to.equal(amount);

      const poolSum =
        (await claimRewards.reserveBalance()) +
        (await claimRewards.milestoneBalance()) +
        (await claimRewards.gvBalance());
      expect(poolSum).to.equal(amount);
    });

    it("handles non-divisible amounts — GV absorbs remainder", async () => {
      const amount = 1_000_007n; // deliberately not divisible
      await claimRewards.connect(distributor).receiveUSDT(amount);

      const poolSum =
        (await claimRewards.reserveBalance()) +
        (await claimRewards.milestoneBalance()) +
        (await claimRewards.gvBalance());
      expect(poolSum).to.equal(amount);
    });

    it("accumulates correctly across multiple calls", async () => {
      const amount = 5_000n * 10n ** 6n;
      await claimRewards.connect(distributor).receiveUSDT(amount);
      await claimRewards.connect(distributor).receiveUSDT(amount);

      const total = amount * 2n;
      const expectedReserve   = (total * BPS_RESERVE)   / BPS_TOTAL;
      const expectedMilestone = (total * BPS_MILESTONE) / BPS_TOTAL;
      const expectedGV        = total - expectedReserve - expectedMilestone;

      expect(await claimRewards.reserveBalance()).to.equal(expectedReserve);
      expect(await claimRewards.milestoneBalance()).to.equal(expectedMilestone);
      expect(await claimRewards.gvBalance()).to.equal(expectedGV);
    });

    it("emits USDTReceived event with split amounts", async () => {
      const amount = 10_000n * 10n ** 6n;
      const expectedReserve   = (amount * BPS_RESERVE)   / BPS_TOTAL;
      const expectedMilestone = (amount * BPS_MILESTONE) / BPS_TOTAL;
      const expectedGV        = amount - expectedReserve - expectedMilestone;

      await expect(claimRewards.connect(distributor).receiveUSDT(amount))
        .to.emit(claimRewards, "USDTReceived")
        .withArgs(amount, expectedReserve, expectedMilestone, expectedGV);
    });

    it("reverts if amount is zero", async () => {
      await expect(
        claimRewards.connect(distributor).receiveUSDT(0n),
      ).to.be.revertedWith("ClaimRewards: zero amount");
    });

    it("reverts if caller lacks DISTRIBUTOR_ROLE", async () => {
      const amount = 1_000n * 10n ** 6n;
      await mintAndApprove(stranger, amount);
      await expect(
        claimRewards.connect(stranger).receiveUSDT(amount),
      ).to.be.revertedWithCustomError(claimRewards, "AccessControlUnauthorizedAccount");
    });
  });

  // ─────────────────────────────────────────────────────────
  // distributeReserve — Layer 1
  // ─────────────────────────────────────────────────────────
  describe("distributeReserve", () => {
    const FUND = 10_000n * 10n ** 6n;

    beforeEach(async () => {
      await claimRewards.connect(distributor).receiveUSDT(FUND);
    });

    it("distributes reserve USDT to single recipient", async () => {
      const reserve = await claimRewards.reserveBalance();
      const before  = await usdt.balanceOf(recipient1.address);

      await claimRewards.connect(admin).distributeReserve([recipient1.address], [reserve]);

      expect(await usdt.balanceOf(recipient1.address)).to.equal(before + reserve);
    });

    it("distributes reserve USDT to multiple recipients", async () => {
      const reserve = await claimRewards.reserveBalance();
      const amt1 = reserve / 3n;
      const amt2 = reserve - amt1;

      const before1 = await usdt.balanceOf(recipient1.address);
      const before2 = await usdt.balanceOf(recipient2.address);

      await claimRewards.connect(admin).distributeReserve(
        [recipient1.address, recipient2.address],
        [amt1, amt2],
      );

      expect(await usdt.balanceOf(recipient1.address)).to.equal(before1 + amt1);
      expect(await usdt.balanceOf(recipient2.address)).to.equal(before2 + amt2);
    });

    it("decreases reserveBalance correctly", async () => {
      const reserve = await claimRewards.reserveBalance();
      const partial = reserve / 2n;

      await claimRewards.connect(admin).distributeReserve([recipient1.address], [partial]);

      expect(await claimRewards.reserveBalance()).to.equal(reserve - partial);
    });

    it("does not affect milestoneBalance or gvBalance", async () => {
      const milestoneBefore = await claimRewards.milestoneBalance();
      const gvBefore        = await claimRewards.gvBalance();
      const reserve         = await claimRewards.reserveBalance();

      await claimRewards.connect(admin).distributeReserve([recipient1.address], [reserve]);

      expect(await claimRewards.milestoneBalance()).to.equal(milestoneBefore);
      expect(await claimRewards.gvBalance()).to.equal(gvBefore);
    });

    it("emits ReserveDistributed event", async () => {
      const reserve = await claimRewards.reserveBalance();

      await expect(
        claimRewards.connect(admin).distributeReserve([recipient1.address], [reserve]),
      )
        .to.emit(claimRewards, "ReserveDistributed")
        .withArgs(reserve);
    });

    it("reverts if total exceeds reserveBalance", async () => {
      const reserve = await claimRewards.reserveBalance();
      await expect(
        claimRewards.connect(admin).distributeReserve([recipient1.address], [reserve + 1n]),
      ).to.be.revertedWith("ClaimRewards: insufficient reserve balance");
    });

    it("reverts on length mismatch", async () => {
      await expect(
        claimRewards.connect(admin).distributeReserve(
          [recipient1.address, recipient2.address],
          [1000n],
        ),
      ).to.be.revertedWith("ClaimRewards: length mismatch");
    });

    it("reverts on empty arrays", async () => {
      await expect(
        claimRewards.connect(admin).distributeReserve([], []),
      ).to.be.revertedWith("ClaimRewards: empty arrays");
    });

    it("reverts if caller lacks DEFAULT_ADMIN_ROLE", async () => {
      const reserve = await claimRewards.reserveBalance();
      await expect(
        claimRewards.connect(stranger).distributeReserve([recipient1.address], [reserve]),
      ).to.be.revertedWithCustomError(claimRewards, "AccessControlUnauthorizedAccount");
    });
  });

  // ─────────────────────────────────────────────────────────
  // triggerMilestone — Layer 2
  // ─────────────────────────────────────────────────────────
  describe("triggerMilestone", () => {
    const FUND = 100_000n * 10n ** 6n; // 100,000 USDT to have plenty in milestone pool

    beforeEach(async () => {
      await mintAndApprove(distributor, FUND * 2n); // extra approval
      await claimRewards.connect(distributor).receiveUSDT(FUND);
    });

    it("pays 5% cash bonus (USDT) from milestoneBalance on trigger", async () => {
      // Milestone index 0 = $2,500 cycle. Bonus = 5% of $2,500 = $125 USDT
      const milestoneAmount = 2_500n * 10n ** 6n; // $2,500 in USDT (6 decimals)
      const expectedBonus   = (milestoneAmount * 500n) / 10_000n; // 5% = $125

      const before = await usdt.balanceOf(recipient1.address);
      await claimRewards.connect(admin).triggerMilestone(recipient1.address, 0);

      expect(await usdt.balanceOf(recipient1.address)).to.equal(before + expectedBonus);
    });

    it("mints a CommunityNFT to user on milestone trigger", async () => {
      // For milestone index 0 ($2,500), expect Builder NFT (tier 1)
      const nftBalanceBefore = await communityNFT.balanceOf(recipient1.address, 1); // BUILDER

      await claimRewards.connect(admin).triggerMilestone(recipient1.address, 0);

      expect(await communityNFT.balanceOf(recipient1.address, 1)).to.equal(
        nftBalanceBefore + 1n,
      );
    });

    it("decreases milestoneBalance by the bonus amount", async () => {
      const milestoneBefore = await claimRewards.milestoneBalance();
      const milestoneAmount = 2_500n * 10n ** 6n;
      const expectedBonus   = (milestoneAmount * 500n) / 10_000n;

      await claimRewards.connect(admin).triggerMilestone(recipient1.address, 0);

      expect(await claimRewards.milestoneBalance()).to.equal(milestoneBefore - expectedBonus);
    });

    it("emits MilestoneTriggered event", async () => {
      const milestoneAmount = 2_500n * 10n ** 6n;
      const expectedBonus   = (milestoneAmount * 500n) / 10_000n;

      await expect(
        claimRewards.connect(admin).triggerMilestone(recipient1.address, 0),
      )
        .to.emit(claimRewards, "MilestoneTriggered")
        .withArgs(recipient1.address, 0, expectedBonus);
    });

    it("handles milestone index 1 ($5,000 cycle) correctly", async () => {
      const milestoneAmount = 5_000n * 10n ** 6n;
      const expectedBonus   = (milestoneAmount * 500n) / 10_000n; // 5% = $250

      const before = await usdt.balanceOf(recipient1.address);
      await claimRewards.connect(admin).triggerMilestone(recipient1.address, 1);

      expect(await usdt.balanceOf(recipient1.address)).to.equal(before + expectedBonus);
    });

    it("handles milestone index 2 ($10,000 cycle) correctly", async () => {
      const milestoneAmount = 10_000n * 10n ** 6n;
      const expectedBonus   = (milestoneAmount * 500n) / 10_000n; // 5% = $500

      const before = await usdt.balanceOf(recipient1.address);
      await claimRewards.connect(admin).triggerMilestone(recipient1.address, 2);

      expect(await usdt.balanceOf(recipient1.address)).to.equal(before + expectedBonus);
    });

    it("reverts on invalid milestone index (>= 3)", async () => {
      await expect(
        claimRewards.connect(admin).triggerMilestone(recipient1.address, 3),
      ).to.be.revertedWith("ClaimRewards: invalid milestone index");
    });

    it("reverts if milestoneBalance is insufficient", async () => {
      // Drain the milestone balance first
      const milestoneBalance = await claimRewards.milestoneBalance();
      // Manually drain by calling multiple triggers if large enough — but easier: deploy fresh
      // Actually, let's just use a very small fund to create insufficient balance
      const SmallFactory = await ethers.getContractFactory("ClaimRewards");
      const small = await SmallFactory.deploy(
        await usdt.getAddress(),
        await communityNFT.getAddress(),
        await referralRegistry.getAddress(),
        admin.address,
      );
      await small.connect(admin).grantRole(DISTRIBUTOR_ROLE, distributor.address);
      await communityNFT.connect(admin).grantRole(MINTER_ROLE, await small.getAddress());
      // Fund with tiny amount: 1 USDT
      await usdt.connect(distributor).approve(await small.getAddress(), ethers.MaxUint256);
      await small.connect(distributor).receiveUSDT(1_000_000n); // 1 USDT
      // milestoneBalance ≈ 1163 * 1_000_000 / 10000 = ~116,300 units (0.1163 USDT)
      // milestone[0] bonus = 2500 * 1e6 * 500 / 10000 = 125_000_000 units >> balance
      await expect(
        small.connect(admin).triggerMilestone(recipient1.address, 0),
      ).to.be.revertedWith("ClaimRewards: insufficient milestone balance");
    });

    it("reverts if caller lacks DEFAULT_ADMIN_ROLE", async () => {
      await expect(
        claimRewards.connect(stranger).triggerMilestone(recipient1.address, 0),
      ).to.be.revertedWithCustomError(claimRewards, "AccessControlUnauthorizedAccount");
    });

    it("reverts on zero user address", async () => {
      await expect(
        claimRewards.connect(admin).triggerMilestone(ethers.ZeroAddress, 0),
      ).to.be.revertedWith("ClaimRewards: zero address");
    });
  });

  // ─────────────────────────────────────────────────────────
  // distributeGVOverride — Layer 3
  // ─────────────────────────────────────────────────────────
  describe("distributeGVOverride", () => {
    const FUND = 10_000n * 10n ** 6n;

    beforeEach(async () => {
      await claimRewards.connect(distributor).receiveUSDT(FUND);
    });

    it("distributes GV override amounts to leaders", async () => {
      const gv = await claimRewards.gvBalance();
      const amt1 = gv / 3n;
      const amt2 = gv - amt1;

      const before1 = await usdt.balanceOf(leader1.address);
      const before2 = await usdt.balanceOf(leader2.address);

      await claimRewards.connect(admin).distributeGVOverride(
        [leader1.address, leader2.address],
        [amt1, amt2],
      );

      expect(await usdt.balanceOf(leader1.address)).to.equal(before1 + amt1);
      expect(await usdt.balanceOf(leader2.address)).to.equal(before2 + amt2);
    });

    it("decreases gvBalance after distribution", async () => {
      const gv      = await claimRewards.gvBalance();
      const partial = gv / 2n;

      await claimRewards.connect(admin).distributeGVOverride([leader1.address], [partial]);

      expect(await claimRewards.gvBalance()).to.equal(gv - partial);
    });

    it("does not affect reserveBalance or milestoneBalance", async () => {
      const reserveBefore   = await claimRewards.reserveBalance();
      const milestoneBefore = await claimRewards.milestoneBalance();
      const gv              = await claimRewards.gvBalance();

      await claimRewards.connect(admin).distributeGVOverride([leader1.address], [gv]);

      expect(await claimRewards.reserveBalance()).to.equal(reserveBefore);
      expect(await claimRewards.milestoneBalance()).to.equal(milestoneBefore);
    });

    it("emits GVDistributed event", async () => {
      const gv = await claimRewards.gvBalance();

      await expect(
        claimRewards.connect(admin).distributeGVOverride([leader1.address], [gv]),
      )
        .to.emit(claimRewards, "GVDistributed")
        .withArgs(gv);
    });

    it("reverts if total exceeds gvBalance", async () => {
      const gv = await claimRewards.gvBalance();
      await expect(
        claimRewards.connect(admin).distributeGVOverride([leader1.address], [gv + 1n]),
      ).to.be.revertedWith("ClaimRewards: insufficient GV balance");
    });

    it("reverts on length mismatch", async () => {
      await expect(
        claimRewards.connect(admin).distributeGVOverride(
          [leader1.address, leader2.address],
          [1000n],
        ),
      ).to.be.revertedWith("ClaimRewards: length mismatch");
    });

    it("reverts on empty arrays", async () => {
      await expect(
        claimRewards.connect(admin).distributeGVOverride([], []),
      ).to.be.revertedWith("ClaimRewards: empty arrays");
    });

    it("reverts if caller lacks DEFAULT_ADMIN_ROLE", async () => {
      const gv = await claimRewards.gvBalance();
      await expect(
        claimRewards.connect(stranger).distributeGVOverride([leader1.address], [gv]),
      ).to.be.revertedWithCustomError(claimRewards, "AccessControlUnauthorizedAccount");
    });
  });

  // ─────────────────────────────────────────────────────────
  // View Functions
  // ─────────────────────────────────────────────────────────
  describe("View Functions", () => {
    it("all balances start at zero before any receiveUSDT", async () => {
      expect(await claimRewards.reserveBalance()).to.equal(0n);
      expect(await claimRewards.milestoneBalance()).to.equal(0n);
      expect(await claimRewards.gvBalance()).to.equal(0n);
    });

    it("balances reflect state after multiple operations", async () => {
      const amount = 6_000n * 10n ** 6n;
      await claimRewards.connect(distributor).receiveUSDT(amount);

      const reserve   = await claimRewards.reserveBalance();
      const milestone = await claimRewards.milestoneBalance();
      const gv        = await claimRewards.gvBalance();

      // Total should equal funded amount
      expect(reserve + milestone + gv).to.equal(amount);

      // Distribute half reserve
      await claimRewards.connect(admin).distributeReserve([recipient1.address], [reserve / 2n]);
      expect(await claimRewards.reserveBalance()).to.equal(reserve - reserve / 2n);
      expect(await claimRewards.milestoneBalance()).to.equal(milestone);
      expect(await claimRewards.gvBalance()).to.equal(gv);
    });
  });

  // ─────────────────────────────────────────────────────────
  // Access Control
  // ─────────────────────────────────────────────────────────
  describe("Access Control", () => {
    it("admin can grant DISTRIBUTOR_ROLE", async () => {
      await claimRewards.connect(admin).grantRole(DISTRIBUTOR_ROLE, stranger.address);
      expect(await claimRewards.hasRole(DISTRIBUTOR_ROLE, stranger.address)).to.be.true;
    });

    it("stranger cannot grant DISTRIBUTOR_ROLE", async () => {
      await expect(
        claimRewards.connect(stranger).grantRole(DISTRIBUTOR_ROLE, stranger.address),
      ).to.be.revertedWithCustomError(claimRewards, "AccessControlUnauthorizedAccount");
    });

    it("admin can revoke DISTRIBUTOR_ROLE", async () => {
      await claimRewards.connect(admin).revokeRole(DISTRIBUTOR_ROLE, distributor.address);
      expect(await claimRewards.hasRole(DISTRIBUTOR_ROLE, distributor.address)).to.be.false;
    });

    it("revoked distributor cannot call receiveUSDT", async () => {
      await claimRewards.connect(admin).revokeRole(DISTRIBUTOR_ROLE, distributor.address);
      await expect(
        claimRewards.connect(distributor).receiveUSDT(1000n),
      ).to.be.revertedWithCustomError(claimRewards, "AccessControlUnauthorizedAccount");
    });
  });

  // ─────────────────────────────────────────────────────────
  // Balance tracking — pools are independent
  // ─────────────────────────────────────────────────────────
  describe("Balance tracking — pools are independent", () => {
    it("distributing from one pool does not affect others", async () => {
      const amount = 9_000n * 10n ** 6n;
      await claimRewards.connect(distributor).receiveUSDT(amount);

      const reserve0   = await claimRewards.reserveBalance();
      const milestone0 = await claimRewards.milestoneBalance();
      const gv0        = await claimRewards.gvBalance();

      // Drain reserve
      await claimRewards.connect(admin).distributeReserve([recipient1.address], [reserve0]);
      expect(await claimRewards.milestoneBalance()).to.equal(milestone0);
      expect(await claimRewards.gvBalance()).to.equal(gv0);

      // Drain GV
      await claimRewards.connect(admin).distributeGVOverride([leader1.address], [gv0]);
      expect(await claimRewards.milestoneBalance()).to.equal(milestone0);
      expect(await claimRewards.reserveBalance()).to.equal(0n);
    });
  });
});
