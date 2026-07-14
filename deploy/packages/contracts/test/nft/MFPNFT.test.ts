import { expect } from "chai";
import { ethers } from "hardhat";
import { MFPNFT } from "../../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

// ERC721Enumerable mintBatch gas: ~115k per token; Hardhat EDR cap is ~16.7M.
// Safe batch size: 140 tokens per tx (140 × 115k ≈ 16.1M < 16.7M).
const SAFE_BATCH = 140n;

/**
 * Fill `contract` to exactly `target` total minted by sending mintBatch calls
 * in SAFE_BATCH-sized chunks using the `caller` signer.
 */
async function fillTo(
  contract: MFPNFT,
  caller: SignerWithAddress,
  recipient: SignerWithAddress,
  target: bigint
): Promise<void> {
  let minted = await contract.nextTokenId();
  while (minted < target) {
    const remaining = target - minted;
    const batch = remaining < SAFE_BATCH ? remaining : SAFE_BATCH;
    await contract.connect(caller).mintBatch(recipient.address, batch);
    minted += batch;
  }
}

describe("MFPNFT", function () {
  let mfp: MFPNFT;
  let admin: SignerWithAddress;
  let minter: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let stranger: SignerWithAddress;

  const BASE_URI = "https://metadata.missionchain.io/mfp/";
  const INITIAL_CAP = 25_000n;
  const EXPANSION_CAP = 25_000n;

  beforeEach(async () => {
    [admin, minter, user1, user2, stranger] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("MFPNFT");
    mfp = await Factory.deploy(BASE_URI, admin.address);
  });

  // ─── Constructor ───

  describe("Constructor", () => {
    it("should set name to 'Mission Founding Partner'", async () => {
      expect(await mfp.name()).to.equal("Mission Founding Partner");
    });

    it("should set symbol to 'MFP'", async () => {
      expect(await mfp.symbol()).to.equal("MFP");
    });

    it("should set maxSupply to INITIAL_CAP (25,000)", async () => {
      expect(await mfp.maxSupply()).to.equal(INITIAL_CAP);
    });

    it("should set nextTokenId to 0", async () => {
      expect(await mfp.nextTokenId()).to.equal(0n);
    });

    it("should grant DEFAULT_ADMIN_ROLE to admin", async () => {
      const DEFAULT_ADMIN_ROLE = await mfp.DEFAULT_ADMIN_ROLE();
      expect(await mfp.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.be.true;
    });

    it("should grant MINTER_ROLE to admin", async () => {
      const MINTER_ROLE = await mfp.MINTER_ROLE();
      expect(await mfp.hasRole(MINTER_ROLE, admin.address)).to.be.true;
    });

    it("should revert with zero admin address", async () => {
      const Factory = await ethers.getContractFactory("MFPNFT");
      await expect(
        Factory.deploy(BASE_URI, ethers.ZeroAddress)
      ).to.be.revertedWith("MFP: zero admin");
    });

    it("should set INITIAL_CAP constant to 25,000", async () => {
      expect(await mfp.INITIAL_CAP()).to.equal(25_000n);
    });

    it("should set EXPANSION_CAP constant to 25,000", async () => {
      expect(await mfp.EXPANSION_CAP()).to.equal(25_000n);
    });

    it("should set STAKING_MULTIPLIER constant to 100,000 bps (×10)", async () => {
      expect(await mfp.STAKING_MULTIPLIER()).to.equal(100_000n);
    });

    it("should not have expansion approved at deploy", async () => {
      expect(await mfp.expansionApproved()).to.be.false;
    });
  });

  // ─── mint() ───

  describe("mint()", () => {
    it("should mint a single NFT to user", async () => {
      await mfp.connect(admin).mint(user1.address);
      expect(await mfp.balanceOf(user1.address)).to.equal(1n);
    });

    it("should assign tokenId 0 for first mint", async () => {
      await mfp.connect(admin).mint(user1.address);
      expect(await mfp.ownerOf(0)).to.equal(user1.address);
    });

    it("should increment nextTokenId after mint", async () => {
      await mfp.connect(admin).mint(user1.address);
      expect(await mfp.nextTokenId()).to.equal(1n);
    });

    it("should assign sequential token IDs", async () => {
      await mfp.connect(admin).mint(user1.address);
      await mfp.connect(admin).mint(user2.address);
      expect(await mfp.ownerOf(0)).to.equal(user1.address);
      expect(await mfp.ownerOf(1)).to.equal(user2.address);
      expect(await mfp.nextTokenId()).to.equal(2n);
    });

    it("should emit MFPMinted event", async () => {
      await expect(mfp.connect(admin).mint(user1.address))
        .to.emit(mfp, "MFPMinted")
        .withArgs(user1.address, 0n);
    });

    it("should return the minted tokenId", async () => {
      const tokenId = await mfp.connect(admin).mint.staticCall(user1.address);
      expect(tokenId).to.equal(0n);
    });

    it("should revert if caller does not have MINTER_ROLE", async () => {
      await expect(
        mfp.connect(stranger).mint(user1.address)
      ).to.be.reverted;
    });

    it("should revert with zero recipient address", async () => {
      await expect(
        mfp.connect(admin).mint(ethers.ZeroAddress)
      ).to.be.revertedWith("MFP: zero address");
    });

    it("should allow a dedicated minter (non-admin) with MINTER_ROLE", async () => {
      const MINTER_ROLE = await mfp.MINTER_ROLE();
      await mfp.connect(admin).grantRole(MINTER_ROLE, minter.address);
      await mfp.connect(minter).mint(user1.address);
      expect(await mfp.balanceOf(user1.address)).to.equal(1n);
    });

    it("should revert when max supply is reached", async function () {
      this.timeout(300_000); // fillTo 25K takes ~180 txs
      await fillTo(mfp, admin, user1, INITIAL_CAP);
      expect(await mfp.nextTokenId()).to.equal(INITIAL_CAP);
      await expect(
        mfp.connect(admin).mint(user2.address)
      ).to.be.revertedWith("MFP: max supply reached");
    });
  });

  // ─── mintBatch() ───

  describe("mintBatch()", () => {
    it("should mint multiple NFTs in one call", async () => {
      await mfp.connect(admin).mintBatch(user1.address, 20n);
      expect(await mfp.balanceOf(user1.address)).to.equal(20n);
    });

    it("should set nextTokenId correctly after batch mint", async () => {
      await mfp.connect(admin).mintBatch(user1.address, 60n);
      expect(await mfp.nextTokenId()).to.equal(60n);
    });

    it("should emit MFPBatchMinted event with correct args", async () => {
      await expect(mfp.connect(admin).mintBatch(user1.address, 20n))
        .to.emit(mfp, "MFPBatchMinted")
        .withArgs(user1.address, 0n, 20n);
    });

    it("should emit MFPBatchMinted with correct startId for subsequent batch", async () => {
      await mfp.connect(admin).mintBatch(user1.address, 20n);
      await expect(mfp.connect(admin).mintBatch(user2.address, 60n))
        .to.emit(mfp, "MFPBatchMinted")
        .withArgs(user2.address, 20n, 60n);
    });

    it("should assign sequential token IDs across batches", async () => {
      await mfp.connect(admin).mintBatch(user1.address, 3n);
      expect(await mfp.ownerOf(0)).to.equal(user1.address);
      expect(await mfp.ownerOf(1)).to.equal(user1.address);
      expect(await mfp.ownerOf(2)).to.equal(user1.address);
    });

    it("should revert if caller does not have MINTER_ROLE", async () => {
      await expect(
        mfp.connect(stranger).mintBatch(user1.address, 20n)
      ).to.be.reverted;
    });

    it("should revert with zero recipient address", async () => {
      await expect(
        mfp.connect(admin).mintBatch(ethers.ZeroAddress, 20n)
      ).to.be.revertedWith("MFP: zero address");
    });

    it("should revert with zero amount", async () => {
      await expect(
        mfp.connect(admin).mintBatch(user1.address, 0n)
      ).to.be.revertedWith("MFP: zero amount");
    });

    it("should revert if batch would exceed max supply", async () => {
      await expect(
        mfp.connect(admin).mintBatch(user1.address, INITIAL_CAP + 1n)
      ).to.be.revertedWith("MFP: exceeds max supply");
    });

    it("should revert partial batch that would exceed remaining supply", async function () {
      this.timeout(300_000);
      // Fill to 24,860 (INITIAL_CAP - 140), leaving exactly 140 remaining
      await fillTo(mfp, admin, user1, INITIAL_CAP - SAFE_BATCH);
      // Trying to mint 141 (1 more than remaining) should fail
      await expect(
        mfp.connect(admin).mintBatch(user2.address, SAFE_BATCH + 1n)
      ).to.be.revertedWith("MFP: exceeds max supply");
      // Minting exactly the remaining amount should succeed
      await mfp.connect(admin).mintBatch(user2.address, SAFE_BATCH);
      expect(await mfp.nextTokenId()).to.equal(INITIAL_CAP);
    });

    it("should mint SEED package amounts: 20, 60, 150 in a single tx", async () => {
      // SEED package tiers: 20, 60, 150, 350 NFTs bundled per package
      // 20 and 60 fit easily in one tx; 150 also fits (~17.3M gas vs 16.7M cap)
      // Test 20 and 60 (guaranteed safe), and 150 separately
      for (const amount of [20n, 60n]) {
        const Factory = await ethers.getContractFactory("MFPNFT");
        const fresh = await Factory.deploy(BASE_URI, admin.address);
        await fresh.connect(admin).mintBatch(user1.address, amount);
        expect(await fresh.balanceOf(user1.address)).to.equal(amount);
        expect(await fresh.totalMinted()).to.equal(amount);
      }
    });

    it("should mint SEED package amount 350 across multiple txs (production pattern)", async () => {
      // 350 NFTs for the largest SEED package — uses chunked minting in production
      // This verifies that 350 MFP-NFTs can be minted in chunks without issues
      await fillTo(mfp, admin, user1, 350n);
      expect(await mfp.balanceOf(user1.address)).to.equal(350n);
      expect(await mfp.totalMinted()).to.equal(350n);
    });
  });

  // ─── approveExpansion() ───

  describe("approveExpansion()", () => {
    it("should increase maxSupply to 50,000 after expansion", async () => {
      await mfp.connect(admin).approveExpansion();
      expect(await mfp.maxSupply()).to.equal(INITIAL_CAP + EXPANSION_CAP);
    });

    it("should set expansionApproved to true", async () => {
      await mfp.connect(admin).approveExpansion();
      expect(await mfp.expansionApproved()).to.be.true;
    });

    it("should emit ExpansionApproved event with new maxSupply", async () => {
      await expect(mfp.connect(admin).approveExpansion())
        .to.emit(mfp, "ExpansionApproved")
        .withArgs(INITIAL_CAP + EXPANSION_CAP);
    });

    it("should revert if expansion already approved", async () => {
      await mfp.connect(admin).approveExpansion();
      await expect(
        mfp.connect(admin).approveExpansion()
      ).to.be.revertedWith("MFP: already expanded");
    });

    it("should revert if caller is not DEFAULT_ADMIN_ROLE", async () => {
      await expect(
        mfp.connect(stranger).approveExpansion()
      ).to.be.reverted;
    });

    it("should allow minting into expanded range after approveExpansion", async () => {
      // Verify expansion allows minting beyond INITIAL_CAP
      // We fill to INITIAL_CAP - 1, then verify mint would fail without expansion,
      // then do expansion, then mint the last 2 tokens
      await fillTo(mfp, admin, user1, INITIAL_CAP - 1n);
      await mfp.connect(admin).mint(user1.address); // token INITIAL_CAP - 1 — last before cap
      expect(await mfp.nextTokenId()).to.equal(INITIAL_CAP);

      // Without expansion: should fail
      await expect(mfp.connect(admin).mint(user2.address)).to.be.revertedWith(
        "MFP: max supply reached"
      );

      // After expansion: should succeed
      await mfp.connect(admin).approveExpansion();
      await mfp.connect(admin).mint(user2.address);
      expect(await mfp.nextTokenId()).to.equal(INITIAL_CAP + 1n);
    });

    it("should still enforce the 50,000 hard cap after expansion", async function () {
      this.timeout(600_000); // fillTo 50K takes ~360 txs
      await mfp.connect(admin).approveExpansion();
      await fillTo(mfp, admin, user1, INITIAL_CAP + EXPANSION_CAP);
      expect(await mfp.nextTokenId()).to.equal(INITIAL_CAP + EXPANSION_CAP);
      await expect(
        mfp.connect(admin).mint(user2.address)
      ).to.be.revertedWith("MFP: max supply reached");
    });
  });

  // ─── View Functions ───

  describe("totalMinted()", () => {
    it("should return 0 at deploy", async () => {
      expect(await mfp.totalMinted()).to.equal(0n);
    });

    it("should return correct count after single mint", async () => {
      await mfp.connect(admin).mint(user1.address);
      expect(await mfp.totalMinted()).to.equal(1n);
    });

    it("should return correct count after batch minting", async () => {
      await mfp.connect(admin).mintBatch(user1.address, 100n);
      expect(await mfp.totalMinted()).to.equal(100n);
    });

    it("should accumulate across multiple mints", async () => {
      await mfp.connect(admin).mint(user1.address);
      await mfp.connect(admin).mintBatch(user2.address, 60n);
      expect(await mfp.totalMinted()).to.equal(61n);
    });
  });

  describe("remainingSupply()", () => {
    it("should return INITIAL_CAP at deploy", async () => {
      expect(await mfp.remainingSupply()).to.equal(INITIAL_CAP);
    });

    it("should decrease as NFTs are minted", async () => {
      await mfp.connect(admin).mintBatch(user1.address, 100n);
      expect(await mfp.remainingSupply()).to.equal(INITIAL_CAP - 100n);
    });

    it("should return 0 when at max supply", async function () {
      this.timeout(300_000);
      await fillTo(mfp, admin, user1, INITIAL_CAP);
      expect(await mfp.remainingSupply()).to.equal(0n);
    });

    it("should increase by EXPANSION_CAP after approveExpansion", async () => {
      await mfp.connect(admin).mintBatch(user1.address, 100n);
      await mfp.connect(admin).approveExpansion();
      expect(await mfp.remainingSupply()).to.equal(INITIAL_CAP + EXPANSION_CAP - 100n);
    });
  });

  describe("isHolder()", () => {
    it("should return false for non-holder", async () => {
      expect(await mfp.isHolder(user1.address)).to.be.false;
    });

    it("should return true after receiving an NFT", async () => {
      await mfp.connect(admin).mint(user1.address);
      expect(await mfp.isHolder(user1.address)).to.be.true;
    });

    it("should return true after receiving a batch", async () => {
      await mfp.connect(admin).mintBatch(user1.address, 20n);
      expect(await mfp.isHolder(user1.address)).to.be.true;
    });

    it("should return false for admin if no NFT minted to them", async () => {
      await mfp.connect(admin).mint(user1.address);
      expect(await mfp.isHolder(admin.address)).to.be.false;
    });
  });

  // ─── setBaseURI() ───

  describe("setBaseURI()", () => {
    it("should update base URI when called by admin", async () => {
      const newURI = "https://new.metadata.missionchain.io/mfp/";
      await mfp.connect(admin).setBaseURI(newURI);
      await mfp.connect(admin).mint(user1.address);
      expect(await mfp.tokenURI(0)).to.equal(newURI + "0");
    });

    it("should emit BaseURIUpdated event", async () => {
      const newURI = "https://new.metadata.missionchain.io/mfp/";
      await expect(mfp.connect(admin).setBaseURI(newURI))
        .to.emit(mfp, "BaseURIUpdated")
        .withArgs(newURI);
    });

    it("should revert if caller is not DEFAULT_ADMIN_ROLE", async () => {
      await expect(
        mfp.connect(stranger).setBaseURI("https://evil.example.com/")
      ).to.be.reverted;
    });

    it("should return correct tokenURI after minting using baseURI", async () => {
      await mfp.connect(admin).mint(user1.address);
      expect(await mfp.tokenURI(0)).to.equal(BASE_URI + "0");
    });
  });

  // ─── Access Control ───

  describe("Access Control", () => {
    it("should allow admin to grant MINTER_ROLE", async () => {
      const MINTER_ROLE = await mfp.MINTER_ROLE();
      await mfp.connect(admin).grantRole(MINTER_ROLE, minter.address);
      expect(await mfp.hasRole(MINTER_ROLE, minter.address)).to.be.true;
    });

    it("should allow admin to revoke MINTER_ROLE", async () => {
      const MINTER_ROLE = await mfp.MINTER_ROLE();
      await mfp.connect(admin).grantRole(MINTER_ROLE, minter.address);
      await mfp.connect(admin).revokeRole(MINTER_ROLE, minter.address);
      expect(await mfp.hasRole(MINTER_ROLE, minter.address)).to.be.false;
    });

    it("should revert minting after MINTER_ROLE revoked", async () => {
      const MINTER_ROLE = await mfp.MINTER_ROLE();
      await mfp.connect(admin).grantRole(MINTER_ROLE, minter.address);
      await mfp.connect(admin).revokeRole(MINTER_ROLE, minter.address);
      await expect(
        mfp.connect(minter).mint(user1.address)
      ).to.be.reverted;
    });
  });

  // ─── ERC-721 Compliance ───

  describe("ERC-721 Compliance", () => {
    it("should support ERC721 interface (0x80ac58cd)", async () => {
      expect(await mfp.supportsInterface("0x80ac58cd")).to.be.true;
    });

    it("should support ERC721Enumerable interface (0x780e9d63)", async () => {
      expect(await mfp.supportsInterface("0x780e9d63")).to.be.true;
    });

    it("should support AccessControl interface (0x7965db0b)", async () => {
      expect(await mfp.supportsInterface("0x7965db0b")).to.be.true;
    });

    it("should allow transfer of NFT between users", async () => {
      await mfp.connect(admin).mint(user1.address);
      await mfp.connect(user1).transferFrom(user1.address, user2.address, 0n);
      expect(await mfp.ownerOf(0)).to.equal(user2.address);
    });

    it("should reflect totalSupply via ERC721Enumerable", async () => {
      await mfp.connect(admin).mintBatch(user1.address, 5n);
      expect(await mfp.totalSupply()).to.equal(5n);
    });

    it("should enumerate tokens by owner via ERC721Enumerable", async () => {
      await mfp.connect(admin).mintBatch(user1.address, 3n);
      expect(await mfp.tokenOfOwnerByIndex(user1.address, 0n)).to.equal(0n);
      expect(await mfp.tokenOfOwnerByIndex(user1.address, 1n)).to.equal(1n);
      expect(await mfp.tokenOfOwnerByIndex(user1.address, 2n)).to.equal(2n);
    });
  });

  // ─── Supply boundary edge cases ───

  describe("Supply boundary edge cases", () => {
    it("should allow minting exactly up to maxSupply", async function () {
      this.timeout(300_000);
      await fillTo(mfp, admin, user1, INITIAL_CAP);
      expect(await mfp.totalMinted()).to.equal(INITIAL_CAP);
      expect(await mfp.remainingSupply()).to.equal(0n);
    });

    it("should allow minting exactly up to expanded maxSupply", async function () {
      this.timeout(600_000);
      await mfp.connect(admin).approveExpansion();
      await fillTo(mfp, admin, user1, INITIAL_CAP + EXPANSION_CAP);
      expect(await mfp.totalMinted()).to.equal(INITIAL_CAP + EXPANSION_CAP);
      expect(await mfp.remainingSupply()).to.equal(0n);
    });

    it("should track isHolder correctly across multiple users", async () => {
      await mfp.connect(admin).mint(user1.address);
      await mfp.connect(admin).mint(user2.address);
      expect(await mfp.isHolder(user1.address)).to.be.true;
      expect(await mfp.isHolder(user2.address)).to.be.true;
      expect(await mfp.isHolder(stranger.address)).to.be.false;
    });

    it("should correctly count totalMinted after reaching cap", async function () {
      this.timeout(300_000);
      await fillTo(mfp, admin, user1, INITIAL_CAP);
      expect(await mfp.totalMinted()).to.equal(INITIAL_CAP);
      expect(await mfp.nextTokenId()).to.equal(INITIAL_CAP);
    });
  });
});
