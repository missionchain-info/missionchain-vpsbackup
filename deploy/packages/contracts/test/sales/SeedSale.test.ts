import { expect } from "chai";
import { ethers } from "hardhat";
import { SeedSale, MICToken, LockManager, MFPNFT, MockUSDT, SeedBudget } from "../../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

// ─── Package spec ──────────────────────────────────────────────────────────────
// Package 0: EARLY BIRD       — $1,000 USDT /   400,000 MIC /  20 MFP-NFTs
// Package 1: FOUNDING PARTNER I  — $2,500 USDT / 1,000,000 MIC /  60 MFP-NFTs
// Package 2: FOUNDING PARTNER II — $5,000 USDT / 2,000,000 MIC / 150 MFP-NFTs
// Package 3: FOUNDING PARTNER III — $10,000 USDT / 4,000,000 MIC / 350 MFP-NFTs
//
// NOTE ON GAS:
// Hardhat EDR has a per-transaction gas cap of 16,777,216. ERC-721 _safeMint costs
// ~115K gas/NFT. 150 NFTs ≈ 17.3M gas (exceeds cap). On BSC mainnet (140M block gas)
// this works fine. Tests for packages 2 and 3 use MockMFPNFT to bypass this constraint
// while still verifying all SeedSale logic (USDT routing, MIC transfer, vesting).

const PACKAGES = [
  { priceUsdt: 1_000n * 1_000_000n,  micAmount: 400_000n * 10n**18n,   nftCount: 20n  },
  { priceUsdt: 2_500n * 1_000_000n,  micAmount: 1_000_000n * 10n**18n, nftCount: 60n  },
  { priceUsdt: 5_000n * 1_000_000n,  micAmount: 2_000_000n * 10n**18n, nftCount: 150n },
  { priceUsdt: 10_000n * 1_000_000n, micAmount: 4_000_000n * 10n**18n, nftCount: 350n },
];

const ALLOCATION = 227_500_000n * 10n**18n;

// ─── Shared deployment helper ─────────────────────────────────────────────────

interface Fixture {
  seedSale: SeedSale;
  micToken: MICToken;
  lockManager: LockManager;
  mfpNFT: MFPNFT | any; // real or mock
  usdt: MockUSDT;
  seedBudget: SeedBudget;
  admin: SignerWithAddress;
  buyer: SignerWithAddress;
  buyer2: SignerWithAddress;
  nonWhitelisted: SignerWithAddress;
  liquidityPool: SignerWithAddress;
  auditWallet: SignerWithAddress;
  daoReserve: SignerWithAddress;
  founder: SignerWithAddress;
}

async function deployFixture(useMockNFT: boolean = false): Promise<Fixture> {
  const [
    admin, buyer, buyer2, nonWhitelisted,
    liquidityPool, auditWallet, daoReserve,
    founder, architect, cto, socialMedia, techManager,
    agentKpiWallet, bonusWallet,
  ] = await ethers.getSigners();

  // MockUSDT
  const USDT = await ethers.getContractFactory("MockUSDT");
  const usdt = await USDT.deploy() as unknown as MockUSDT;

  // MICToken
  const MICFactory = await ethers.getContractFactory("MICToken");
  const micToken = await MICFactory.deploy(admin.address) as unknown as MICToken;

  // LockManager
  const LMFactory = await ethers.getContractFactory("LockManager");
  const lockManager = await LMFactory.deploy() as unknown as LockManager;

  // NFT: real MFPNFT or MockMFPNFT
  let mfpNFT: any;
  if (useMockNFT) {
    const MockNFT = await ethers.getContractFactory("MockMFPNFT");
    mfpNFT = await MockNFT.deploy();
  } else {
    const NFTFactory = await ethers.getContractFactory("MFPNFT");
    mfpNFT = await NFTFactory.deploy("https://meta.missionchain.io/mfp/", admin.address) as unknown as MFPNFT;
  }

  // SeedBudget
  const SBFactory = await ethers.getContractFactory("SeedBudget");
  const seedBudget = await SBFactory.deploy(
    await usdt.getAddress(),
    liquidityPool.address,
    auditWallet.address,
    daoReserve.address,
    admin.address,
    [
      founder.address,
      architect.address,
      cto.address,
      socialMedia.address,
      techManager.address,
      agentKpiWallet.address,
      bonusWallet.address,
    ]
  ) as unknown as SeedBudget;

  // SeedSale
  const SeedFactory = await ethers.getContractFactory("SeedSale");
  const seedSale = await SeedFactory.deploy(
    await usdt.getAddress(),
    await micToken.getAddress(),
    await lockManager.getAddress(),
    await mfpNFT.getAddress(),
    await seedBudget.getAddress(),
    admin.address
  ) as unknown as SeedSale;

  // Grant roles
  const SCHEDULE_CREATOR_ROLE = await lockManager.SCHEDULE_CREATOR_ROLE();
  await lockManager.connect(admin).grantRole(SCHEDULE_CREATOR_ROLE, await seedSale.getAddress());

  if (!useMockNFT) {
    const MINTER_ROLE = (await ethers.getContractFactory("MFPNFT")).interface.getFunction("MINTER_ROLE");
    // Use the NFT contract's MINTER_ROLE constant
    const minterRole = await (mfpNFT as MFPNFT).MINTER_ROLE();
    await (mfpNFT as MFPNFT).connect(admin).grantRole(minterRole, await seedSale.getAddress());
  }
  // MockMFPNFT has no access control — anyone can call mintBatch

  const CALLER_ROLE = await seedBudget.CALLER_ROLE();
  await seedBudget.connect(admin).grantRole(CALLER_ROLE, await seedSale.getAddress());

  // Fund SeedSale with 227.5M MIC
  await micToken.connect(admin).transfer(await seedSale.getAddress(), ALLOCATION);

  // Activate sale
  await seedSale.connect(admin).setActive(true);

  // Whitelist buyers
  await seedSale.connect(admin).addToWhitelist([buyer.address, buyer2.address]);

  // Mint USDT for all packages to both buyers
  for (const pkg of PACKAGES) {
    await usdt.mint(buyer.address,  pkg.priceUsdt);
    await usdt.mint(buyer2.address, pkg.priceUsdt);
  }

  // Approve SeedSale for all USDT
  const totalNeeded = PACKAGES.reduce((s, p) => s + p.priceUsdt, 0n);
  await usdt.connect(buyer).approve(await seedSale.getAddress(), totalNeeded);
  await usdt.connect(buyer2).approve(await seedSale.getAddress(), totalNeeded);

  return {
    seedSale, micToken, lockManager, mfpNFT, usdt, seedBudget,
    admin, buyer, buyer2, nonWhitelisted,
    liquidityPool, auditWallet, daoReserve, founder,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("SeedSale", function () {
  // ─── Constructor ───────────────────────────────────────────────────────────

  describe("Constructor", () => {
    let f: Fixture;
    beforeEach(async () => { f = await deployFixture(); });

    it("stores usdt address", async () => {
      expect(await f.seedSale.usdt()).to.equal(await f.usdt.getAddress());
    });

    it("stores micToken address", async () => {
      expect(await f.seedSale.micToken()).to.equal(await f.micToken.getAddress());
    });

    it("stores lockManager address", async () => {
      expect(await f.seedSale.lockManager()).to.equal(await f.lockManager.getAddress());
    });

    it("stores mfpNFT address", async () => {
      expect(await f.seedSale.mfpNFT()).to.equal(await f.mfpNFT.getAddress());
    });

    it("stores seedBudget address", async () => {
      expect(await f.seedSale.seedBudget()).to.equal(await f.seedBudget.getAddress());
    });

    it("grants DEFAULT_ADMIN_ROLE to admin", async () => {
      const role = await f.seedSale.DEFAULT_ADMIN_ROLE();
      expect(await f.seedSale.hasRole(role, f.admin.address)).to.be.true;
    });

    it("grants WHITELISTER_ROLE to admin", async () => {
      const role = await f.seedSale.WHITELISTER_ROLE();
      expect(await f.seedSale.hasRole(role, f.admin.address)).to.be.true;
    });

    it("sets ALLOCATION constant correctly", async () => {
      expect(await f.seedSale.ALLOCATION()).to.equal(ALLOCATION);
    });

    it("sets all 4 packages correctly", async () => {
      for (let i = 0; i < 4; i++) {
        const pkg = await f.seedSale.packages(i);
        expect(pkg.priceUsdt).to.equal(PACKAGES[i].priceUsdt, `Package ${i} priceUsdt`);
        expect(pkg.micAmount).to.equal(PACKAGES[i].micAmount, `Package ${i} micAmount`);
        expect(pkg.nftCount).to.equal(PACKAGES[i].nftCount,  `Package ${i} nftCount`);
      }
    });

    it("sale starts inactive (active = false)", async () => {
      const SeedFactory = await ethers.getContractFactory("SeedSale");
      const freshSeed = await SeedFactory.deploy(
        await f.usdt.getAddress(),
        await f.micToken.getAddress(),
        await f.lockManager.getAddress(),
        await f.mfpNFT.getAddress(),
        await f.seedBudget.getAddress(),
        f.admin.address
      );
      expect(await freshSeed.active()).to.be.false;
    });

    it("reverts if usdt is zero address", async () => {
      const [admin] = await ethers.getSigners();
      const SeedFactory = await ethers.getContractFactory("SeedSale");
      await expect(SeedFactory.deploy(
        ethers.ZeroAddress,
        await f.micToken.getAddress(),
        await f.lockManager.getAddress(),
        await f.mfpNFT.getAddress(),
        await f.seedBudget.getAddress(),
        admin.address
      )).to.be.revertedWith("Seed: zero usdt");
    });

    it("reverts if micToken is zero address", async () => {
      const [admin] = await ethers.getSigners();
      const SeedFactory = await ethers.getContractFactory("SeedSale");
      await expect(SeedFactory.deploy(
        await f.usdt.getAddress(),
        ethers.ZeroAddress,
        await f.lockManager.getAddress(),
        await f.mfpNFT.getAddress(),
        await f.seedBudget.getAddress(),
        admin.address
      )).to.be.revertedWith("Seed: zero micToken");
    });

    it("reverts if lockManager is zero address", async () => {
      const [admin] = await ethers.getSigners();
      const SeedFactory = await ethers.getContractFactory("SeedSale");
      await expect(SeedFactory.deploy(
        await f.usdt.getAddress(),
        await f.micToken.getAddress(),
        ethers.ZeroAddress,
        await f.mfpNFT.getAddress(),
        await f.seedBudget.getAddress(),
        admin.address
      )).to.be.revertedWith("Seed: zero lockManager");
    });

    it("reverts if mfpNFT is zero address", async () => {
      const [admin] = await ethers.getSigners();
      const SeedFactory = await ethers.getContractFactory("SeedSale");
      await expect(SeedFactory.deploy(
        await f.usdt.getAddress(),
        await f.micToken.getAddress(),
        await f.lockManager.getAddress(),
        ethers.ZeroAddress,
        await f.seedBudget.getAddress(),
        admin.address
      )).to.be.revertedWith("Seed: zero mfpNFT");
    });

    it("reverts if seedBudget is zero address", async () => {
      const [admin] = await ethers.getSigners();
      const SeedFactory = await ethers.getContractFactory("SeedSale");
      await expect(SeedFactory.deploy(
        await f.usdt.getAddress(),
        await f.micToken.getAddress(),
        await f.lockManager.getAddress(),
        await f.mfpNFT.getAddress(),
        ethers.ZeroAddress,
        admin.address
      )).to.be.revertedWith("Seed: zero seedBudget");
    });
  });

  // ─── Packages 0 & 1 with real MFPNFT ────────────────────────────────────────
  // Package 0: 20 NFTs (~2.3M gas) — fits easily
  // Package 1: 60 NFTs (~6.9M gas) — fits within 12M limit

  describe("buyPackage — Package 0 (EARLY BIRD, 20 NFTs) — real MFPNFT", () => {
    let f: Fixture;
    const PKG = PACKAGES[0];
    const GAS = 5_000_000n;

    beforeEach(async () => { f = await deployFixture(false); });

    it("transfers MIC to buyer", async () => {
      const before = await f.micToken.balanceOf(f.buyer.address);
      await f.seedSale.connect(f.buyer).buyPackage(0, { gasLimit: GAS });
      expect(await f.micToken.balanceOf(f.buyer.address) - before).to.equal(PKG.micAmount);
    });

    it("USDT forwarded to SeedBudget (buyer loses full price, SeedSale keeps 0)", async () => {
      const before = await f.usdt.balanceOf(f.buyer.address);
      await f.seedSale.connect(f.buyer).buyPackage(0, { gasLimit: GAS });
      expect(before - await f.usdt.balanceOf(f.buyer.address)).to.equal(PKG.priceUsdt);
      expect(await f.usdt.balanceOf(await f.seedSale.getAddress())).to.equal(0n);
    });

    it("creates vesting schedule in LockManager", async () => {
      await f.seedSale.connect(f.buyer).buyPackage(0, { gasLimit: GAS });
      const schedules = await f.lockManager.getSchedules(f.buyer.address);
      expect(schedules.length).to.equal(1);
      expect(schedules[0].totalAmount).to.equal(PKG.micAmount);
      expect(schedules[0].cliffDuration).to.equal(BigInt(180 * 24 * 3600)); // 180 days
      expect(schedules[0].cliffUnlockBps).to.equal(1000n);    // 10%
      expect(schedules[0].monthlyUnlockBps).to.equal(250n);   // 2.5%
    });

    it("mints 20 MFP-NFTs to buyer", async () => {
      await f.seedSale.connect(f.buyer).buyPackage(0, { gasLimit: GAS });
      expect(await f.mfpNFT.balanceOf(f.buyer.address)).to.equal(PKG.nftCount);
    });

    it("MIC is locked when LockManager is wired to MICToken", async () => {
      await f.micToken.connect(f.admin).setLockManager(await f.lockManager.getAddress());
      await f.seedSale.connect(f.buyer).buyPackage(0, { gasLimit: GAS });
      const micBal = await f.micToken.balanceOf(f.buyer.address);
      await expect(
        f.micToken.connect(f.buyer).transfer(f.buyer2.address, micBal)
      ).to.be.revertedWith("MIC: transfer exceeds unlocked balance");
    });

    it("emits SeedPurchase event", async () => {
      await expect(f.seedSale.connect(f.buyer).buyPackage(0, { gasLimit: GAS }))
        .to.emit(f.seedSale, "SeedPurchase")
        .withArgs(f.buyer.address, 0n, PKG.priceUsdt, PKG.micAmount, PKG.nftCount);
    });

    it("updates totalSold", async () => {
      await f.seedSale.connect(f.buyer).buyPackage(0, { gasLimit: GAS });
      expect(await f.seedSale.totalSold()).to.equal(PKG.micAmount);
    });
  });

  describe("buyPackage — Package 1 (FOUNDING PARTNER I, 60 NFTs) — real MFPNFT", () => {
    let f: Fixture;
    const PKG = PACKAGES[1];
    const GAS = 10_000_000n;

    beforeEach(async () => { f = await deployFixture(false); });

    it("transfers MIC to buyer", async () => {
      const before = await f.micToken.balanceOf(f.buyer.address);
      await f.seedSale.connect(f.buyer).buyPackage(1, { gasLimit: GAS });
      expect(await f.micToken.balanceOf(f.buyer.address) - before).to.equal(PKG.micAmount);
    });

    it("USDT forwarded to SeedBudget", async () => {
      const before = await f.usdt.balanceOf(f.buyer.address);
      await f.seedSale.connect(f.buyer).buyPackage(1, { gasLimit: GAS });
      expect(before - await f.usdt.balanceOf(f.buyer.address)).to.equal(PKG.priceUsdt);
      expect(await f.usdt.balanceOf(await f.seedSale.getAddress())).to.equal(0n);
    });

    it("creates vesting schedule in LockManager", async () => {
      await f.seedSale.connect(f.buyer).buyPackage(1, { gasLimit: GAS });
      const schedules = await f.lockManager.getSchedules(f.buyer.address);
      expect(schedules.length).to.equal(1);
      expect(schedules[0].totalAmount).to.equal(PKG.micAmount);
      expect(schedules[0].cliffDuration).to.equal(BigInt(180 * 24 * 3600));
      expect(schedules[0].cliffUnlockBps).to.equal(1000n);
      expect(schedules[0].monthlyUnlockBps).to.equal(250n);
    });

    it("mints 60 MFP-NFTs to buyer", async () => {
      await f.seedSale.connect(f.buyer).buyPackage(1, { gasLimit: GAS });
      expect(await f.mfpNFT.balanceOf(f.buyer.address)).to.equal(PKG.nftCount);
    });

    it("MIC is locked when LockManager is wired to MICToken", async () => {
      await f.micToken.connect(f.admin).setLockManager(await f.lockManager.getAddress());
      await f.seedSale.connect(f.buyer).buyPackage(1, { gasLimit: GAS });
      const micBal = await f.micToken.balanceOf(f.buyer.address);
      await expect(
        f.micToken.connect(f.buyer).transfer(f.buyer2.address, micBal)
      ).to.be.revertedWith("MIC: transfer exceeds unlocked balance");
    });

    it("emits SeedPurchase event", async () => {
      await expect(f.seedSale.connect(f.buyer).buyPackage(1, { gasLimit: GAS }))
        .to.emit(f.seedSale, "SeedPurchase")
        .withArgs(f.buyer.address, 1n, PKG.priceUsdt, PKG.micAmount, PKG.nftCount);
    });

    it("updates totalSold", async () => {
      await f.seedSale.connect(f.buyer).buyPackage(1, { gasLimit: GAS });
      expect(await f.seedSale.totalSold()).to.equal(PKG.micAmount);
    });
  });

  // ─── Packages 2 & 3 with MockMFPNFT ─────────────────────────────────────────
  // Packages 2 (150 NFTs) and 3 (350 NFTs) require ~17–40M gas for real ERC-721.
  // On BSC mainnet this is fine (140M block gas limit). In Hardhat EDR tests, the
  // per-transaction gas cap is 16,777,216 — too small. We use MockMFPNFT which
  // records mints without ERC-721 overhead, letting us verify all other SeedSale logic.

  describe("buyPackage — Package 2 (FOUNDING PARTNER II, 150 NFTs) — MockMFPNFT", () => {
    let f: Fixture;
    const PKG = PACKAGES[2];

    beforeEach(async () => { f = await deployFixture(true); });

    it("transfers MIC to buyer", async () => {
      const before = await f.micToken.balanceOf(f.buyer.address);
      await f.seedSale.connect(f.buyer).buyPackage(2);
      expect(await f.micToken.balanceOf(f.buyer.address) - before).to.equal(PKG.micAmount);
    });

    it("USDT forwarded to SeedBudget", async () => {
      const before = await f.usdt.balanceOf(f.buyer.address);
      await f.seedSale.connect(f.buyer).buyPackage(2);
      expect(before - await f.usdt.balanceOf(f.buyer.address)).to.equal(PKG.priceUsdt);
      expect(await f.usdt.balanceOf(await f.seedSale.getAddress())).to.equal(0n);
    });

    it("creates vesting schedule in LockManager", async () => {
      await f.seedSale.connect(f.buyer).buyPackage(2);
      const schedules = await f.lockManager.getSchedules(f.buyer.address);
      expect(schedules.length).to.equal(1);
      expect(schedules[0].totalAmount).to.equal(PKG.micAmount);
      expect(schedules[0].cliffDuration).to.equal(BigInt(180 * 24 * 3600));
      expect(schedules[0].cliffUnlockBps).to.equal(1000n);
      expect(schedules[0].monthlyUnlockBps).to.equal(250n);
    });

    it("mints 150 MFP-NFTs to buyer (via MockMFPNFT)", async () => {
      await f.seedSale.connect(f.buyer).buyPackage(2);
      expect(await f.mfpNFT.balanceOf(f.buyer.address)).to.equal(PKG.nftCount);
    });

    it("MIC is locked when LockManager is wired to MICToken", async () => {
      await f.micToken.connect(f.admin).setLockManager(await f.lockManager.getAddress());
      await f.seedSale.connect(f.buyer).buyPackage(2);
      const micBal = await f.micToken.balanceOf(f.buyer.address);
      await expect(
        f.micToken.connect(f.buyer).transfer(f.buyer2.address, micBal)
      ).to.be.revertedWith("MIC: transfer exceeds unlocked balance");
    });

    it("emits SeedPurchase event", async () => {
      await expect(f.seedSale.connect(f.buyer).buyPackage(2))
        .to.emit(f.seedSale, "SeedPurchase")
        .withArgs(f.buyer.address, 2n, PKG.priceUsdt, PKG.micAmount, PKG.nftCount);
    });

    it("updates totalSold", async () => {
      await f.seedSale.connect(f.buyer).buyPackage(2);
      expect(await f.seedSale.totalSold()).to.equal(PKG.micAmount);
    });
  });

  describe("buyPackage — Package 3 (FOUNDING PARTNER III, 350 NFTs) — MockMFPNFT", () => {
    let f: Fixture;
    const PKG = PACKAGES[3];

    beforeEach(async () => { f = await deployFixture(true); });

    it("transfers MIC to buyer", async () => {
      const before = await f.micToken.balanceOf(f.buyer.address);
      await f.seedSale.connect(f.buyer).buyPackage(3);
      expect(await f.micToken.balanceOf(f.buyer.address) - before).to.equal(PKG.micAmount);
    });

    it("USDT forwarded to SeedBudget", async () => {
      const before = await f.usdt.balanceOf(f.buyer.address);
      await f.seedSale.connect(f.buyer).buyPackage(3);
      expect(before - await f.usdt.balanceOf(f.buyer.address)).to.equal(PKG.priceUsdt);
      expect(await f.usdt.balanceOf(await f.seedSale.getAddress())).to.equal(0n);
    });

    it("creates vesting schedule in LockManager", async () => {
      await f.seedSale.connect(f.buyer).buyPackage(3);
      const schedules = await f.lockManager.getSchedules(f.buyer.address);
      expect(schedules.length).to.equal(1);
      expect(schedules[0].totalAmount).to.equal(PKG.micAmount);
      expect(schedules[0].cliffDuration).to.equal(BigInt(180 * 24 * 3600));
      expect(schedules[0].cliffUnlockBps).to.equal(1000n);
      expect(schedules[0].monthlyUnlockBps).to.equal(250n);
    });

    it("mints 350 MFP-NFTs to buyer (via MockMFPNFT)", async () => {
      await f.seedSale.connect(f.buyer).buyPackage(3);
      expect(await f.mfpNFT.balanceOf(f.buyer.address)).to.equal(PKG.nftCount);
    });

    it("MIC is locked when LockManager is wired to MICToken", async () => {
      await f.micToken.connect(f.admin).setLockManager(await f.lockManager.getAddress());
      await f.seedSale.connect(f.buyer).buyPackage(3);
      const micBal = await f.micToken.balanceOf(f.buyer.address);
      await expect(
        f.micToken.connect(f.buyer).transfer(f.buyer2.address, micBal)
      ).to.be.revertedWith("MIC: transfer exceeds unlocked balance");
    });

    it("emits SeedPurchase event", async () => {
      await expect(f.seedSale.connect(f.buyer).buyPackage(3))
        .to.emit(f.seedSale, "SeedPurchase")
        .withArgs(f.buyer.address, 3n, PKG.priceUsdt, PKG.micAmount, PKG.nftCount);
    });

    it("updates totalSold", async () => {
      await f.seedSale.connect(f.buyer).buyPackage(3);
      expect(await f.seedSale.totalSold()).to.equal(PKG.micAmount);
    });
  });

  // ─── USDT routing to SeedBudget ─────────────────────────────────────────────

  describe("USDT routing to SeedBudget", () => {
    let f: Fixture;
    beforeEach(async () => { f = await deployFixture(); });

    it("SeedBudget receives and distributes USDT correctly (40% liquidity, 5% audit, 5% DAO, 7% founder pending)", async () => {
      const price = PACKAGES[0].priceUsdt; // $1,000
      await f.seedSale.connect(f.buyer).buyPackage(0, { gasLimit: 5_000_000n });

      expect(await f.usdt.balanceOf(f.liquidityPool.address))
        .to.equal((price * 4000n) / 10_000n, "40% to liquidity");
      expect(await f.usdt.balanceOf(f.auditWallet.address))
        .to.equal((price * 500n) / 10_000n, "5% to audit");
      expect(await f.usdt.balanceOf(f.daoReserve.address))
        .to.equal((price * 500n) / 10_000n, "5% to DAO reserve");
      expect(await f.seedBudget.pendingLeadership(0))
        .to.equal((price * 700n) / 10_000n, "7% pending for founder");
    });

    it("SeedSale holds zero USDT after purchase", async () => {
      await f.seedSale.connect(f.buyer).buyPackage(0, { gasLimit: 5_000_000n });
      expect(await f.usdt.balanceOf(await f.seedSale.getAddress())).to.equal(0n);
    });
  });

  // ─── Access control ──────────────────────────────────────────────────────────

  describe("Access Control — buyPackage", () => {
    let f: Fixture;
    beforeEach(async () => { f = await deployFixture(); });

    it("reverts if sale not active", async () => {
      await f.seedSale.connect(f.admin).setActive(false);
      await expect(f.seedSale.connect(f.buyer).buyPackage(0))
        .to.be.revertedWith("Seed: sale not active");
    });

    it("reverts if buyer not whitelisted", async () => {
      await expect(f.seedSale.connect(f.nonWhitelisted).buyPackage(0))
        .to.be.revertedWith("Seed: not whitelisted");
    });

    it("reverts if packageIndex >= 4", async () => {
      await expect(f.seedSale.connect(f.buyer).buyPackage(4))
        .to.be.revertedWith("Seed: invalid package");
    });
  });

  // ─── Allocation cap ──────────────────────────────────────────────────────────

  describe("Allocation cap", () => {
    it("reverts when SeedSale runs out of MIC (cap enforced)", async () => {
      const f = await deployFixture(true); // use MockMFPNFT for speed

      // Deploy a tight sale funded with exactly 1 Early Bird's worth of MIC
      const SeedFactory = await ethers.getContractFactory("SeedSale");
      const tightSale = await SeedFactory.deploy(
        await f.usdt.getAddress(),
        await f.micToken.getAddress(),
        await f.lockManager.getAddress(),
        await f.mfpNFT.getAddress(),
        await f.seedBudget.getAddress(),
        f.admin.address
      ) as unknown as SeedSale;

      const SCHEDULE_CREATOR_ROLE = await f.lockManager.SCHEDULE_CREATOR_ROLE();
      await f.lockManager.connect(f.admin).grantRole(SCHEDULE_CREATOR_ROLE, await tightSale.getAddress());
      const CALLER_ROLE = await f.seedBudget.CALLER_ROLE();
      await f.seedBudget.connect(f.admin).grantRole(CALLER_ROLE, await tightSale.getAddress());

      // Transfer only enough MIC for one Early Bird (400K MIC)
      await f.micToken.connect(f.admin).transfer(await tightSale.getAddress(), PACKAGES[0].micAmount);

      await tightSale.connect(f.admin).setActive(true);
      await tightSale.connect(f.admin).addToWhitelist([f.buyer.address, f.buyer2.address]);

      await f.usdt.mint(f.buyer.address,  PACKAGES[0].priceUsdt);
      await f.usdt.mint(f.buyer2.address, PACKAGES[0].priceUsdt);
      await f.usdt.connect(f.buyer).approve(await tightSale.getAddress(), PACKAGES[0].priceUsdt);
      await f.usdt.connect(f.buyer2).approve(await tightSale.getAddress(), PACKAGES[0].priceUsdt);

      // First purchase succeeds
      await tightSale.connect(f.buyer).buyPackage(0);

      // Second purchase fails — SeedSale is out of MIC (ERC20 transfer reverts)
      await expect(tightSale.connect(f.buyer2).buyPackage(0)).to.be.reverted;
    });

    it("totalSold tracks cumulative MIC across purchases", async () => {
      const f = await deployFixture(true);
      await f.seedSale.connect(f.buyer).buyPackage(0);
      expect(await f.seedSale.totalSold()).to.equal(PACKAGES[0].micAmount);

      await f.seedSale.connect(f.buyer2).buyPackage(0);
      expect(await f.seedSale.totalSold()).to.equal(PACKAGES[0].micAmount * 2n);
    });
  });

  // ─── Whitelist management ────────────────────────────────────────────────────

  describe("Whitelist management", () => {
    let f: Fixture;
    beforeEach(async () => { f = await deployFixture(); });

    it("admin can add addresses to whitelist", async () => {
      expect(await f.seedSale.whitelisted(f.nonWhitelisted.address)).to.be.false;
      await expect(f.seedSale.connect(f.admin).addToWhitelist([f.nonWhitelisted.address]))
        .to.emit(f.seedSale, "WhitelistUpdated")
        .withArgs(f.nonWhitelisted.address, true);
      expect(await f.seedSale.whitelisted(f.nonWhitelisted.address)).to.be.true;
    });

    it("admin can remove addresses from whitelist", async () => {
      await f.seedSale.connect(f.admin).removeFromWhitelist([f.buyer.address]);
      expect(await f.seedSale.whitelisted(f.buyer.address)).to.be.false;
      await expect(f.seedSale.connect(f.buyer).buyPackage(0))
        .to.be.revertedWith("Seed: not whitelisted");
    });

    it("non-WHITELISTER_ROLE cannot add to whitelist", async () => {
      await expect(
        f.seedSale.connect(f.buyer).addToWhitelist([f.nonWhitelisted.address])
      ).to.be.reverted;
    });

    it("non-WHITELISTER_ROLE cannot remove from whitelist", async () => {
      await expect(
        f.seedSale.connect(f.buyer).removeFromWhitelist([f.buyer2.address])
      ).to.be.reverted;
    });

    it("can batch whitelist multiple addresses", async () => {
      await f.seedSale.connect(f.admin).addToWhitelist([f.buyer.address, f.nonWhitelisted.address]);
      expect(await f.seedSale.whitelisted(f.nonWhitelisted.address)).to.be.true;
    });

    it("removeFromWhitelist emits WhitelistUpdated(false)", async () => {
      await expect(f.seedSale.connect(f.admin).removeFromWhitelist([f.buyer.address]))
        .to.emit(f.seedSale, "WhitelistUpdated")
        .withArgs(f.buyer.address, false);
    });
  });

  // ─── setActive ────────────────────────────────────────────────────────────────

  describe("setActive", () => {
    let f: Fixture;
    beforeEach(async () => { f = await deployFixture(); });

    it("admin can deactivate sale", async () => {
      await f.seedSale.connect(f.admin).setActive(false);
      expect(await f.seedSale.active()).to.be.false;
    });

    it("admin can reactivate sale", async () => {
      await f.seedSale.connect(f.admin).setActive(false);
      await f.seedSale.connect(f.admin).setActive(true);
      expect(await f.seedSale.active()).to.be.true;
    });

    it("emits SaleActivated event", async () => {
      await expect(f.seedSale.connect(f.admin).setActive(false))
        .to.emit(f.seedSale, "SaleActivated")
        .withArgs(false);
    });

    it("non-admin cannot call setActive", async () => {
      await expect(f.seedSale.connect(f.buyer).setActive(false)).to.be.reverted;
    });
  });

  // ─── No referral ─────────────────────────────────────────────────────────────

  describe("No referral (SEED has no referral program)", () => {
    let f: Fixture;
    beforeEach(async () => { f = await deployFixture(); });

    it("buyPackage only takes packageIndex — no referral parameter", async () => {
      // Verifies the function works with exactly one argument (no referral address)
      const tx = await f.seedSale.connect(f.buyer).buyPackage(0, { gasLimit: 5_000_000n });
      await expect(tx).to.not.be.reverted;
    });
  });

  // ─── MIC Lock integration ─────────────────────────────────────────────────────

  describe("MIC Lock integration with MICToken", () => {
    let f: Fixture;
    beforeEach(async () => { f = await deployFixture(); });

    it("LockManager.lockedOf() returns full MIC amount after purchase", async () => {
      await f.seedSale.connect(f.buyer).buyPackage(0, { gasLimit: 5_000_000n });
      expect(await f.lockManager.lockedOf(f.buyer.address)).to.equal(PACKAGES[0].micAmount);
    });

    it("MICToken.lockedBalanceOf() reflects lock when LockManager is set", async () => {
      await f.micToken.connect(f.admin).setLockManager(await f.lockManager.getAddress());
      await f.seedSale.connect(f.buyer).buyPackage(0, { gasLimit: 5_000_000n });
      expect(await f.micToken.lockedBalanceOf(f.buyer.address)).to.equal(PACKAGES[0].micAmount);
    });
  });

  // ─── Multiple vesting schedules ───────────────────────────────────────────────

  describe("Multiple vesting schedules", () => {
    let f: Fixture;
    beforeEach(async () => { f = await deployFixture(); });

    it("buyer accumulates separate LockManager schedules per purchase", async () => {
      await f.seedSale.connect(f.buyer).buyPackage(0, { gasLimit: 5_000_000n });

      // Approve extra USDT for second purchase
      await f.usdt.mint(f.buyer.address, PACKAGES[1].priceUsdt);
      await f.usdt.connect(f.buyer).approve(await f.seedSale.getAddress(), PACKAGES[1].priceUsdt);
      await f.seedSale.connect(f.buyer).buyPackage(1, { gasLimit: 10_000_000n });

      expect(await f.lockManager.scheduleCount(f.buyer.address)).to.equal(2n);
      const schedules = await f.lockManager.getSchedules(f.buyer.address);
      expect(schedules[0].totalAmount).to.equal(PACKAGES[0].micAmount);
      expect(schedules[1].totalAmount).to.equal(PACKAGES[1].micAmount);
    });
  });
});
