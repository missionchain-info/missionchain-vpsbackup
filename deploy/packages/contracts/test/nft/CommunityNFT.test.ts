import { expect } from "chai";
import { ethers } from "hardhat";
import { CommunityNFT } from "../../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("CommunityNFT", function () {
  let nft: CommunityNFT;
  let admin: SignerWithAddress;
  let minter: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let nonAdmin: SignerWithAddress;

  const BASE_URI = "https://meta.missionchain.io/community/";
  const BUILDER  = 1n;
  const MAKER    = 2n;
  const LUMINARY = 3n;

  const DAY = 86400n;
  const DURATION_BUILDER  = 60n  * DAY;  // 60 days
  const DURATION_MAKER    = 90n  * DAY;  // 90 days
  const DURATION_LUMINARY = 180n * DAY;  // 180 days
  const MIN_DURATION = 30n  * DAY;       // 30 days
  const MAX_DURATION = 720n * DAY;       // 720 days

  beforeEach(async () => {
    [admin, minter, user1, user2, nonAdmin] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("CommunityNFT");
    nft = await Factory.deploy(BASE_URI, admin.address);

    // Grant minter role to minter signer
    const MINTER_ROLE = await nft.MINTER_ROLE();
    await nft.connect(admin).grantRole(MINTER_ROLE, minter.address);
  });

  // ─── Constructor ───────────────────────────────────────────────────────────

  describe("Constructor", () => {
    it("sets default BUILDER duration to 60 days", async () => {
      expect(await nft.tierDuration(BUILDER)).to.equal(DURATION_BUILDER);
    });

    it("sets default MAKER duration to 90 days", async () => {
      expect(await nft.tierDuration(MAKER)).to.equal(DURATION_MAKER);
    });

    it("sets default LUMINARY duration to 180 days", async () => {
      expect(await nft.tierDuration(LUMINARY)).to.equal(DURATION_LUMINARY);
    });

    it("grants DEFAULT_ADMIN_ROLE to admin", async () => {
      const DEFAULT_ADMIN = await nft.DEFAULT_ADMIN_ROLE();
      expect(await nft.hasRole(DEFAULT_ADMIN, admin.address)).to.be.true;
    });

    it("grants MINTER_ROLE to admin by default", async () => {
      const Factory = await ethers.getContractFactory("CommunityNFT");
      const fresh = await Factory.deploy(BASE_URI, admin.address);
      const MINTER_ROLE = await fresh.MINTER_ROLE();
      expect(await fresh.hasRole(MINTER_ROLE, admin.address)).to.be.true;
    });
  });

  // ─── setDurations ──────────────────────────────────────────────────────────

  describe("setDurations", () => {
    it("allows admin to update durations", async () => {
      const newBuilder  = 60n * DAY;
      const newMaker    = 120n * DAY;
      const newLuminary = 240n * DAY;

      await expect(nft.connect(admin).setDurations(newBuilder, newMaker, newLuminary))
        .to.emit(nft, "DurationsUpdated")
        .withArgs(newBuilder, newMaker, newLuminary);

      expect(await nft.tierDuration(BUILDER)).to.equal(newBuilder);
      expect(await nft.tierDuration(MAKER)).to.equal(newMaker);
      expect(await nft.tierDuration(LUMINARY)).to.equal(newLuminary);
    });

    it("reverts when called by non-admin", async () => {
      await expect(
        nft.connect(nonAdmin).setDurations(60n * DAY, 120n * DAY, 240n * DAY)
      ).to.be.reverted;
    });

    it("reverts when builder < 30 days", async () => {
      await expect(
        nft.connect(admin).setDurations(
          MIN_DURATION - 1n,  // 29 days + 23h... seconds
          DURATION_MAKER,
          DURATION_LUMINARY
        )
      ).to.be.revertedWith("CNFT: builder out of range");
    });

    it("reverts when builder > 720 days", async () => {
      await expect(
        nft.connect(admin).setDurations(
          MAX_DURATION + 1n,
          MAX_DURATION + 2n,
          MAX_DURATION + 3n
        )
      ).to.be.revertedWith("CNFT: builder out of range");
    });

    it("reverts when maker < 30 days", async () => {
      await expect(
        nft.connect(admin).setDurations(
          30n * DAY,
          MIN_DURATION - 1n,
          DURATION_LUMINARY
        )
      ).to.be.revertedWith("CNFT: maker out of range");
    });

    it("reverts when maker > 720 days", async () => {
      await expect(
        nft.connect(admin).setDurations(
          DURATION_BUILDER,
          MAX_DURATION + 1n,
          MAX_DURATION + 2n
        )
      ).to.be.revertedWith("CNFT: maker out of range");
    });

    it("reverts when luminary < 30 days", async () => {
      await expect(
        nft.connect(admin).setDurations(
          30n * DAY,
          60n * DAY,
          MIN_DURATION - 1n
        )
      ).to.be.revertedWith("CNFT: luminary out of range");
    });

    it("reverts when luminary > 720 days", async () => {
      await expect(
        nft.connect(admin).setDurations(
          DURATION_BUILDER,
          DURATION_MAKER,
          MAX_DURATION + 1n
        )
      ).to.be.revertedWith("CNFT: luminary out of range");
    });

    it("reverts when builder > maker (not ascending)", async () => {
      // builder = maker → should revert (N+1 > N, equal is NOT ascending)
      await expect(
        nft.connect(admin).setDurations(
          120n * DAY,
          120n * DAY,  // builder == maker: not strictly ascending
          240n * DAY
        )
      ).to.be.revertedWith("CNFT: must be ascending");
    });

    it("reverts when maker > luminary (not ascending)", async () => {
      await expect(
        nft.connect(admin).setDurations(
          60n * DAY,
          240n * DAY,
          120n * DAY   // luminary < maker
        )
      ).to.be.revertedWith("CNFT: must be ascending");
    });

    it("reverts when maker == luminary (equal is not ascending)", async () => {
      await expect(
        nft.connect(admin).setDurations(
          60n * DAY,
          120n * DAY,
          120n * DAY  // maker == luminary
        )
      ).to.be.revertedWith("CNFT: must be ascending");
    });

    it("accepts boundary values: 30d / 31d / 32d", async () => {
      await expect(
        nft.connect(admin).setDurations(30n * DAY, 31n * DAY, 32n * DAY)
      ).to.not.be.reverted;
    });

    it("accepts boundary values: 718d / 719d / 720d", async () => {
      await expect(
        nft.connect(admin).setDurations(718n * DAY, 719n * DAY, 720n * DAY)
      ).to.not.be.reverted;
    });

    it("minter role (non-admin) cannot call setDurations", async () => {
      await expect(
        nft.connect(minter).setDurations(60n * DAY, 120n * DAY, 240n * DAY)
      ).to.be.reverted;
    });
  });

  // ─── Minting ───────────────────────────────────────────────────────────────

  describe("Minting with default durations", () => {
    it("mint creates correct expiry for BUILDER (60 days)", async () => {
      const tx = await nft.connect(minter).mint(user1.address, BUILDER);
      const receipt = await tx.wait();
      const blockTs = BigInt((await ethers.provider.getBlock(receipt!.blockNumber))!.timestamp);

      const inst = await nft.instances(0n);
      expect(inst.tier).to.equal(BUILDER);
      expect(inst.expiryTime).to.equal(blockTs + DURATION_BUILDER);
    });

    it("mint creates correct expiry for MAKER (90 days)", async () => {
      const tx = await nft.connect(minter).mint(user1.address, MAKER);
      const receipt = await tx.wait();
      const blockTs = BigInt((await ethers.provider.getBlock(receipt!.blockNumber))!.timestamp);

      const inst = await nft.instances(0n);
      expect(inst.tier).to.equal(MAKER);
      expect(inst.expiryTime).to.equal(blockTs + DURATION_MAKER);
    });

    it("mint creates correct expiry for LUMINARY (180 days)", async () => {
      const tx = await nft.connect(minter).mint(user1.address, LUMINARY);
      const receipt = await tx.wait();
      const blockTs = BigInt((await ethers.provider.getBlock(receipt!.blockNumber))!.timestamp);

      const inst = await nft.instances(0n);
      expect(inst.tier).to.equal(LUMINARY);
      expect(inst.expiryTime).to.equal(blockTs + DURATION_LUMINARY);
    });

    it("mints increment totalInstances", async () => {
      await nft.connect(minter).mint(user1.address, BUILDER);
      await nft.connect(minter).mint(user1.address, MAKER);
      expect(await nft.totalInstances()).to.equal(2n);
    });

    it("mint reverts for invalid tier", async () => {
      await expect(nft.connect(minter).mint(user1.address, 0n)).to.be.reverted;
      await expect(nft.connect(minter).mint(user1.address, 4n)).to.be.reverted;
    });

    it("mint reverts for zero address", async () => {
      await expect(nft.connect(minter).mint(ethers.ZeroAddress, BUILDER)).to.be.revertedWith("CNFT: zero address");
    });

    it("only minter can mint", async () => {
      await expect(nft.connect(nonAdmin).mint(user1.address, BUILDER)).to.be.reverted;
    });
  });

  // ─── After setDurations — new mints use updated duration ──────────────────

  describe("Minting after setDurations", () => {
    const newBuilder  = 45n * DAY;
    const newMaker    = 60n * DAY;
    const newLuminary = 120n * DAY;

    beforeEach(async () => {
      await nft.connect(admin).setDurations(newBuilder, newMaker, newLuminary);
    });

    it("new Builder mint uses updated duration (45d)", async () => {
      const tx = await nft.connect(minter).mint(user1.address, BUILDER);
      const receipt = await tx.wait();
      const blockTs = BigInt((await ethers.provider.getBlock(receipt!.blockNumber))!.timestamp);

      const inst = await nft.instances(0n);
      expect(inst.expiryTime).to.equal(blockTs + newBuilder);
    });

    it("new Maker mint uses updated duration (60d)", async () => {
      const tx = await nft.connect(minter).mint(user1.address, MAKER);
      const receipt = await tx.wait();
      const blockTs = BigInt((await ethers.provider.getBlock(receipt!.blockNumber))!.timestamp);

      const inst = await nft.instances(0n);
      expect(inst.expiryTime).to.equal(blockTs + newMaker);
    });

    it("new Luminary mint uses updated duration (120d)", async () => {
      const tx = await nft.connect(minter).mint(user1.address, LUMINARY);
      const receipt = await tx.wait();
      const blockTs = BigInt((await ethers.provider.getBlock(receipt!.blockNumber))!.timestamp);

      const inst = await nft.instances(0n);
      expect(inst.expiryTime).to.equal(blockTs + newLuminary);
    });

    it("existing NFTs keep their original expiry after setDurations", async () => {
      // Mint before updating durations
      const Factory2 = await ethers.getContractFactory("CommunityNFT");
      const nft2 = await Factory2.deploy(BASE_URI, admin.address);
      const MINTER_ROLE = await nft2.MINTER_ROLE();
      await nft2.connect(admin).grantRole(MINTER_ROLE, minter.address);

      const tx = await nft2.connect(minter).mint(user1.address, BUILDER);
      const receipt = await tx.wait();
      const blockTs = BigInt((await ethers.provider.getBlock(receipt!.blockNumber))!.timestamp);

      const originalExpiry = blockTs + DURATION_BUILDER;  // 60 days
      const instBefore = await nft2.instances(0n);
      expect(instBefore.expiryTime).to.equal(originalExpiry);

      // Update durations
      await nft2.connect(admin).setDurations(newBuilder, newMaker, newLuminary);

      // Existing NFT expiry unchanged
      const instAfter = await nft2.instances(0n);
      expect(instAfter.expiryTime).to.equal(originalExpiry);
    });
  });

  // ─── mintBatch ────────────────────────────────────────────────────────────

  describe("mintBatch", () => {
    it("mints multiple instances with correct expiry", async () => {
      const amount = 3n;
      const tx = await nft.connect(minter).mintBatch(user1.address, MAKER, amount);
      const receipt = await tx.wait();
      const blockTs = BigInt((await ethers.provider.getBlock(receipt!.blockNumber))!.timestamp);

      expect(await nft.totalInstances()).to.equal(amount);

      for (let i = 0n; i < amount; i++) {
        const inst = await nft.instances(i);
        expect(inst.tier).to.equal(MAKER);
        expect(inst.expiryTime).to.equal(blockTs + DURATION_MAKER);
        expect(inst.active).to.be.true;
      }
    });

    it("mintBatch reverts for zero amount", async () => {
      await expect(nft.connect(minter).mintBatch(user1.address, BUILDER, 0n))
        .to.be.revertedWith("CNFT: zero amount");
    });

    it("uses updated duration after setDurations", async () => {
      const newMaker = 60n * DAY;
      await nft.connect(admin).setDurations(30n * DAY, newMaker, 90n * DAY);

      const tx = await nft.connect(minter).mintBatch(user1.address, MAKER, 2n);
      const receipt = await tx.wait();
      const blockTs = BigInt((await ethers.provider.getBlock(receipt!.blockNumber))!.timestamp);

      const inst0 = await nft.instances(0n);
      const inst1 = await nft.instances(1n);
      expect(inst0.expiryTime).to.equal(blockTs + newMaker);
      expect(inst1.expiryTime).to.equal(blockTs + newMaker);
    });
  });

  // ─── Expiry ────────────────────────────────────────────────────────────────

  describe("Expiry", () => {
    it("isActive returns true before expiry", async () => {
      await nft.connect(minter).mint(user1.address, BUILDER);
      expect(await nft.isActive(0n)).to.be.true;
    });

    it("isActive returns false after expiry", async () => {
      await nft.connect(minter).mint(user1.address, BUILDER);
      await time.increase(Number(DURATION_BUILDER) + 1);
      expect(await nft.isActive(0n)).to.be.false;
    });

    it("expireInstances marks expired instance inactive", async () => {
      await nft.connect(minter).mint(user1.address, BUILDER);
      await time.increase(Number(DURATION_BUILDER) + 1);

      await nft.expireInstances([0n]);
      const inst = await nft.instances(0n);
      expect(inst.active).to.be.false;
    });
  });

  // ─── tierDuration view ─────────────────────────────────────────────────────

  describe("tierDuration view", () => {
    it("returns BUILDER duration", async () => {
      expect(await nft.tierDuration(BUILDER)).to.equal(DURATION_BUILDER);
    });

    it("returns MAKER duration", async () => {
      expect(await nft.tierDuration(MAKER)).to.equal(DURATION_MAKER);
    });

    it("returns LUMINARY duration", async () => {
      expect(await nft.tierDuration(LUMINARY)).to.equal(DURATION_LUMINARY);
    });

    it("reflects updated durations after setDurations", async () => {
      await nft.connect(admin).setDurations(50n * DAY, 100n * DAY, 200n * DAY);
      expect(await nft.tierDuration(BUILDER)).to.equal(50n * DAY);
      expect(await nft.tierDuration(MAKER)).to.equal(100n * DAY);
      expect(await nft.tierDuration(LUMINARY)).to.equal(200n * DAY);
    });
  });

  // ─── Events ────────────────────────────────────────────────────────────────

  describe("Events", () => {
    it("emits DurationsUpdated on setDurations", async () => {
      const b = 60n * DAY;
      const m = 120n * DAY;
      const l = 240n * DAY;
      await expect(nft.connect(admin).setDurations(b, m, l))
        .to.emit(nft, "DurationsUpdated")
        .withArgs(b, m, l);
    });

    it("emits CommunityNFTMinted on mint", async () => {
      await expect(nft.connect(minter).mint(user1.address, BUILDER))
        .to.emit(nft, "CommunityNFTMinted");
    });
  });
});
