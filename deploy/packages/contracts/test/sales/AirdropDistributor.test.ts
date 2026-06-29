import { expect } from "chai";
import { ethers } from "hardhat";
import { AirdropDistributor, MICToken, LockManager, MockUSDT } from "../../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

// ─── Merkle Tree Helpers ──────────────────────────────────────────────────────
// Manually construct a Merkle tree for testing (no external package needed).
// Leaf = keccak256(abi.encodePacked(address, uint256))
// Tree is sorted for determinism.

function makeLeaf(address: string, amount: bigint): string {
  return ethers.keccak256(
    ethers.solidityPacked(["address", "uint256"], [address, amount])
  );
}

function hashPair(a: string, b: string): string {
  // Sorted to match OpenZeppelin MerkleProof convention
  const [lo, hi] = a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
  return ethers.keccak256(ethers.concat([lo, hi]));
}

/**
 * Build a balanced Merkle tree from an array of leaves.
 * Returns { root, getProof(index) }.
 */
function buildMerkleTree(leaves: string[]): {
  root: string;
  getProof: (index: number) => string[];
} {
  if (leaves.length === 0) throw new Error("empty leaves");

  // Pad to a power of 2 (duplicate last leaf)
  let layer = [...leaves];
  while ((layer.length & (layer.length - 1)) !== 0) {
    layer.push(layer[layer.length - 1]);
  }

  const layers: string[][] = [layer];
  while (layers[layers.length - 1].length > 1) {
    const prev = layers[layers.length - 1];
    const next: string[] = [];
    for (let i = 0; i < prev.length; i += 2) {
      next.push(hashPair(prev[i], prev[i + 1]));
    }
    layers.push(next);
  }

  const root = layers[layers.length - 1][0];

  function getProof(index: number): string[] {
    const proof: string[] = [];
    for (let i = 0; i < layers.length - 1; i++) {
      const sibling = index % 2 === 0 ? index + 1 : index - 1;
      proof.push(layers[i][sibling]);
      index = Math.floor(index / 2);
    }
    return proof;
  }

  return { root, getProof };
}

// ─── Airdrop allocation spec ─────────────────────────────────────────────────
// 0.25% of 7,000,000,000 = 17,500,000 MIC
const AIRDROP_ALLOCATION = 17_500_000n * 10n ** 18n;

// ─── Constants ───────────────────────────────────────────────────────────────
const CLIFF_DURATION = 180n * 24n * 60n * 60n; // 180 days in seconds
const CLIFF_UNLOCK_BPS = 1000n;                  // 10%
const MONTHLY_UNLOCK_BPS = 250n;                 // 2.5%

// ─── Fixture ─────────────────────────────────────────────────────────────────

interface Fixture {
  distributor: AirdropDistributor;
  micToken: MICToken;
  lockManager: LockManager;
  admin: SignerWithAddress;
  claimant1: SignerWithAddress;
  claimant2: SignerWithAddress;
  claimant3: SignerWithAddress;
  stranger: SignerWithAddress;
}

async function deployFixture(): Promise<Fixture> {
  const [admin, claimant1, claimant2, claimant3, stranger] =
    await ethers.getSigners();

  // MockUSDT not needed here, but MICToken requires admin address
  const MICFactory = await ethers.getContractFactory("MICToken");
  const micToken = (await MICFactory.deploy(
    admin.address
  )) as unknown as MICToken;

  const LMFactory = await ethers.getContractFactory("LockManager");
  const lockManager = (await LMFactory.deploy()) as unknown as LockManager;

  const AirdropFactory = await ethers.getContractFactory("AirdropDistributor");
  const distributor = (await AirdropFactory.deploy(
    await micToken.getAddress(),
    await lockManager.getAddress(),
    admin.address
  )) as unknown as AirdropDistributor;

  // Grant SCHEDULE_CREATOR_ROLE so distributor can call createSchedule
  const SCHEDULE_CREATOR_ROLE = await lockManager.SCHEDULE_CREATOR_ROLE();
  await lockManager
    .connect(admin)
    .grantRole(SCHEDULE_CREATOR_ROLE, await distributor.getAddress());

  // Fund distributor with airdrop allocation (17.5M MIC)
  await micToken
    .connect(admin)
    .transfer(await distributor.getAddress(), AIRDROP_ALLOCATION);

  return {
    distributor,
    micToken,
    lockManager,
    admin,
    claimant1,
    claimant2,
    claimant3,
    stranger,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("AirdropDistributor", function () {
  // ─── Constructor ─────────────────────────────────────────────────────────

  describe("Constructor", () => {
    let f: Fixture;
    beforeEach(async () => {
      f = await deployFixture();
    });

    it("stores micToken address", async () => {
      expect(await f.distributor.micToken()).to.equal(
        await f.micToken.getAddress()
      );
    });

    it("stores lockManager address", async () => {
      expect(await f.distributor.lockManager()).to.equal(
        await f.lockManager.getAddress()
      );
    });

    it("grants DEFAULT_ADMIN_ROLE to admin", async () => {
      const role = await f.distributor.DEFAULT_ADMIN_ROLE();
      expect(await f.distributor.hasRole(role, f.admin.address)).to.be.true;
    });

    it("merkleRoot starts as zero bytes32", async () => {
      expect(await f.distributor.merkleRoot()).to.equal(ethers.ZeroHash);
    });

    it("totalClaimed starts at 0", async () => {
      expect(await f.distributor.totalClaimed()).to.equal(0n);
    });

    it("reverts if micToken is zero address", async () => {
      const [, , , , , newAdmin] = await ethers.getSigners();
      const LMFactory = await ethers.getContractFactory("LockManager");
      const lm = await LMFactory.deploy();
      const AirdropFactory =
        await ethers.getContractFactory("AirdropDistributor");
      await expect(
        AirdropFactory.deploy(
          ethers.ZeroAddress,
          await lm.getAddress(),
          newAdmin.address
        )
      ).to.be.revertedWith("Airdrop: zero micToken");
    });

    it("reverts if lockManager is zero address", async () => {
      const [, , , , , newAdmin] = await ethers.getSigners();
      const MICFactory = await ethers.getContractFactory("MICToken");
      const mic = await MICFactory.deploy(newAdmin.address);
      const AirdropFactory =
        await ethers.getContractFactory("AirdropDistributor");
      await expect(
        AirdropFactory.deploy(
          await mic.getAddress(),
          ethers.ZeroAddress,
          newAdmin.address
        )
      ).to.be.revertedWith("Airdrop: zero lockManager");
    });
  });

  // ─── setMerkleRoot ────────────────────────────────────────────────────────

  describe("setMerkleRoot", () => {
    let f: Fixture;
    beforeEach(async () => {
      f = await deployFixture();
    });

    it("admin can set merkle root", async () => {
      const newRoot = ethers.keccak256(ethers.toUtf8Bytes("test-root"));
      await f.distributor.connect(f.admin).setMerkleRoot(newRoot);
      expect(await f.distributor.merkleRoot()).to.equal(newRoot);
    });

    it("emits MerkleRootUpdated event", async () => {
      const oldRoot = await f.distributor.merkleRoot();
      const newRoot = ethers.keccak256(ethers.toUtf8Bytes("root-v2"));
      await expect(f.distributor.connect(f.admin).setMerkleRoot(newRoot))
        .to.emit(f.distributor, "MerkleRootUpdated")
        .withArgs(oldRoot, newRoot);
    });

    it("admin can update merkle root multiple times", async () => {
      const root1 = ethers.keccak256(ethers.toUtf8Bytes("root-1"));
      const root2 = ethers.keccak256(ethers.toUtf8Bytes("root-2"));
      await f.distributor.connect(f.admin).setMerkleRoot(root1);
      expect(await f.distributor.merkleRoot()).to.equal(root1);
      await f.distributor.connect(f.admin).setMerkleRoot(root2);
      expect(await f.distributor.merkleRoot()).to.equal(root2);
    });

    it("non-admin cannot set merkle root", async () => {
      const newRoot = ethers.keccak256(ethers.toUtf8Bytes("malicious-root"));
      await expect(
        f.distributor.connect(f.stranger).setMerkleRoot(newRoot)
      ).to.be.reverted;
    });
  });

  // ─── claim — valid proof ──────────────────────────────────────────────────

  describe("claim — valid Merkle proof", () => {
    let f: Fixture;
    let root: string;
    let getProof: (index: number) => string[];
    const amount1 = 1_000n * 10n ** 18n; // 1,000 MIC
    const amount2 = 5_000n * 10n ** 18n; // 5,000 MIC
    const amount3 = 500n * 10n ** 18n;   // 500 MIC

    beforeEach(async () => {
      f = await deployFixture();

      // Build a Merkle tree for 3 claimants
      const leaves = [
        makeLeaf(f.claimant1.address, amount1),
        makeLeaf(f.claimant2.address, amount2),
        makeLeaf(f.claimant3.address, amount3),
      ];
      ({ root, getProof } = buildMerkleTree(leaves));
      await f.distributor.connect(f.admin).setMerkleRoot(root);
    });

    it("transfers MIC directly to claimant wallet", async () => {
      const proof = getProof(0);
      const balBefore = await f.micToken.balanceOf(f.claimant1.address);
      await f.distributor.connect(f.claimant1).claim(proof, amount1);
      const balAfter = await f.micToken.balanceOf(f.claimant1.address);
      expect(balAfter - balBefore).to.equal(amount1);
    });

    it("creates a vesting schedule on LockManager", async () => {
      const proof = getProof(0);
      await f.distributor.connect(f.claimant1).claim(proof, amount1);

      const schedules = await f.lockManager.getSchedules(f.claimant1.address);
      expect(schedules.length).to.equal(1);

      const s = schedules[0];
      expect(s.totalAmount).to.equal(amount1);
      expect(s.cliffDuration).to.equal(CLIFF_DURATION);
      expect(s.cliffUnlockBps).to.equal(CLIFF_UNLOCK_BPS);
      expect(s.monthlyUnlockBps).to.equal(MONTHLY_UNLOCK_BPS);
    });

    it("locks the claimed MIC (lockedOf = amount right after claim)", async () => {
      const proof = getProof(0);
      await f.distributor.connect(f.claimant1).claim(proof, amount1);
      // Right after claim, all tokens should be locked (cliff not reached)
      const locked = await f.lockManager.lockedOf(f.claimant1.address);
      expect(locked).to.equal(amount1);
    });

    it("emits AirdropClaimed event", async () => {
      const proof = getProof(0);
      await expect(f.distributor.connect(f.claimant1).claim(proof, amount1))
        .to.emit(f.distributor, "AirdropClaimed")
        .withArgs(f.claimant1.address, amount1);
    });

    it("increments totalClaimed", async () => {
      const proof1 = getProof(0);
      const proof2 = getProof(1);
      await f.distributor.connect(f.claimant1).claim(proof1, amount1);
      await f.distributor.connect(f.claimant2).claim(proof2, amount2);
      expect(await f.distributor.totalClaimed()).to.equal(amount1 + amount2);
    });

    it("marks leaf as claimed after successful claim", async () => {
      const proof = getProof(0);
      expect(await f.distributor.isClaimed(f.claimant1.address, amount1)).to.be
        .false;
      await f.distributor.connect(f.claimant1).claim(proof, amount1);
      expect(await f.distributor.isClaimed(f.claimant1.address, amount1)).to.be
        .true;
    });

    it("multiple claimants can each claim independently", async () => {
      await f.distributor.connect(f.claimant1).claim(getProof(0), amount1);
      await f.distributor.connect(f.claimant2).claim(getProof(1), amount2);
      await f.distributor.connect(f.claimant3).claim(getProof(2), amount3);

      expect(await f.micToken.balanceOf(f.claimant1.address)).to.equal(amount1);
      expect(await f.micToken.balanceOf(f.claimant2.address)).to.equal(amount2);
      expect(await f.micToken.balanceOf(f.claimant3.address)).to.equal(amount3);
    });

    it("distributor balance decreases by claimed amount", async () => {
      const distAddr = await f.distributor.getAddress();
      const balBefore = await f.micToken.balanceOf(distAddr);
      await f.distributor.connect(f.claimant1).claim(getProof(0), amount1);
      const balAfter = await f.micToken.balanceOf(distAddr);
      expect(balBefore - balAfter).to.equal(amount1);
    });
  });

  // ─── claim — double claim prevention ─────────────────────────────────────

  describe("claim — double claim prevention", () => {
    let f: Fixture;
    let root: string;
    let getProof: (index: number) => string[];
    const amount1 = 2_000n * 10n ** 18n;

    beforeEach(async () => {
      f = await deployFixture();
      const leaves = [makeLeaf(f.claimant1.address, amount1)];
      ({ root, getProof } = buildMerkleTree(leaves));
      await f.distributor.connect(f.admin).setMerkleRoot(root);
    });

    it("reverts on second claim attempt for same address+amount", async () => {
      const proof = getProof(0);
      await f.distributor.connect(f.claimant1).claim(proof, amount1);
      await expect(
        f.distributor.connect(f.claimant1).claim(proof, amount1)
      ).to.be.revertedWith("Airdrop: already claimed");
    });

    it("does not transfer MIC on double claim attempt", async () => {
      const proof = getProof(0);
      await f.distributor.connect(f.claimant1).claim(proof, amount1);
      const balAfterFirst = await f.micToken.balanceOf(f.claimant1.address);
      // Second attempt should revert
      await expect(
        f.distributor.connect(f.claimant1).claim(proof, amount1)
      ).to.be.reverted;
      const balAfterSecond = await f.micToken.balanceOf(f.claimant1.address);
      expect(balAfterFirst).to.equal(balAfterSecond);
    });
  });

  // ─── claim — invalid proof ────────────────────────────────────────────────

  describe("claim — invalid Merkle proof", () => {
    let f: Fixture;
    let root: string;
    let getProof: (index: number) => string[];
    const amount1 = 1_000n * 10n ** 18n;
    const wrongAmount = 9_999_999n * 10n ** 18n;

    beforeEach(async () => {
      f = await deployFixture();
      const leaves = [
        makeLeaf(f.claimant1.address, amount1),
        makeLeaf(f.claimant2.address, 2_000n * 10n ** 18n),
      ];
      ({ root, getProof } = buildMerkleTree(leaves));
      await f.distributor.connect(f.admin).setMerkleRoot(root);
    });

    it("reverts with wrong amount in proof", async () => {
      const proof = getProof(0); // proof is for amount1, not wrongAmount
      await expect(
        f.distributor.connect(f.claimant1).claim(proof, wrongAmount)
      ).to.be.revertedWith("Airdrop: invalid proof");
    });

    it("reverts when stranger uses another claimant's proof", async () => {
      const proof = getProof(0); // proof for claimant1
      // stranger tries to use claimant1's proof with amount1
      await expect(
        f.distributor.connect(f.stranger).claim(proof, amount1)
      ).to.be.revertedWith("Airdrop: invalid proof");
    });

    it("reverts with empty proof array when root is set", async () => {
      await expect(
        f.distributor.connect(f.claimant1).claim([], amount1)
      ).to.be.revertedWith("Airdrop: invalid proof");
    });

    it("reverts when merkle root is zero (not set)", async () => {
      // Deploy fresh distributor without setting root
      const MICFactory = await ethers.getContractFactory("MICToken");
      const [tmpAdmin, tmpUser] = await ethers.getSigners();
      const mic = await MICFactory.deploy(tmpAdmin.address);
      const LMFactory = await ethers.getContractFactory("LockManager");
      const lm = await LMFactory.deploy();
      const AirdropFactory =
        await ethers.getContractFactory("AirdropDistributor");
      const freshDist = await AirdropFactory.deploy(
        await mic.getAddress(),
        await lm.getAddress(),
        tmpAdmin.address
      );
      await expect(
        freshDist.connect(tmpUser).claim([], 100n * 10n ** 18n)
      ).to.be.revertedWith("Airdrop: invalid proof");
    });

    it("reverts with zero amount", async () => {
      const proof = getProof(0);
      await expect(
        f.distributor.connect(f.claimant1).claim(proof, 0n)
      ).to.be.revertedWith("Airdrop: zero amount");
    });
  });

  // ─── isClaimed ────────────────────────────────────────────────────────────

  describe("isClaimed view", () => {
    let f: Fixture;
    let root: string;
    let getProof: (index: number) => string[];
    const amount1 = 3_000n * 10n ** 18n;

    beforeEach(async () => {
      f = await deployFixture();
      const leaves = [makeLeaf(f.claimant1.address, amount1)];
      ({ root, getProof } = buildMerkleTree(leaves));
      await f.distributor.connect(f.admin).setMerkleRoot(root);
    });

    it("returns false before claim", async () => {
      expect(await f.distributor.isClaimed(f.claimant1.address, amount1)).to.be
        .false;
    });

    it("returns true after claim", async () => {
      await f.distributor.connect(f.claimant1).claim(getProof(0), amount1);
      expect(await f.distributor.isClaimed(f.claimant1.address, amount1)).to.be
        .true;
    });

    it("returns false for different amount (different leaf)", async () => {
      await f.distributor.connect(f.claimant1).claim(getProof(0), amount1);
      const differentAmount = amount1 + 1n;
      expect(
        await f.distributor.isClaimed(f.claimant1.address, differentAmount)
      ).to.be.false;
    });

    it("returns false for stranger even after claimant1 claimed", async () => {
      await f.distributor.connect(f.claimant1).claim(getProof(0), amount1);
      expect(await f.distributor.isClaimed(f.stranger.address, amount1)).to.be
        .false;
    });
  });

  // ─── withdrawRemaining ────────────────────────────────────────────────────

  describe("withdrawRemaining", () => {
    let f: Fixture;
    let root: string;
    let getProof: (index: number) => string[];
    const amount1 = 100n * 10n ** 18n;

    beforeEach(async () => {
      f = await deployFixture();
      const leaves = [makeLeaf(f.claimant1.address, amount1)];
      ({ root, getProof } = buildMerkleTree(leaves));
      await f.distributor.connect(f.admin).setMerkleRoot(root);
    });

    it("admin can withdraw remaining balance", async () => {
      const distAddr = await f.distributor.getAddress();
      const remaining = await f.micToken.balanceOf(distAddr);
      const adminBalBefore = await f.micToken.balanceOf(f.admin.address);
      await f.distributor.connect(f.admin).withdrawRemaining(f.admin.address);
      const adminBalAfter = await f.micToken.balanceOf(f.admin.address);
      expect(adminBalAfter - adminBalBefore).to.equal(remaining);
      expect(await f.micToken.balanceOf(distAddr)).to.equal(0n);
    });

    it("admin can withdraw to a different recipient", async () => {
      const distAddr = await f.distributor.getAddress();
      const remaining = await f.micToken.balanceOf(distAddr);
      const strangerBalBefore = await f.micToken.balanceOf(f.stranger.address);
      await f.distributor
        .connect(f.admin)
        .withdrawRemaining(f.stranger.address);
      const strangerBalAfter = await f.micToken.balanceOf(f.stranger.address);
      expect(strangerBalAfter - strangerBalBefore).to.equal(remaining);
    });

    it("reverts if no balance remains", async () => {
      // Drain balance first
      await f.distributor.connect(f.admin).withdrawRemaining(f.admin.address);
      await expect(
        f.distributor.connect(f.admin).withdrawRemaining(f.admin.address)
      ).to.be.revertedWith("Airdrop: no balance");
    });

    it("non-admin cannot withdraw", async () => {
      await expect(
        f.distributor
          .connect(f.stranger)
          .withdrawRemaining(f.stranger.address)
      ).to.be.reverted;
    });

    it("reverts if recipient is zero address", async () => {
      await expect(
        f.distributor.connect(f.admin).withdrawRemaining(ethers.ZeroAddress)
      ).to.be.revertedWith("Airdrop: zero recipient");
    });
  });

  // ─── Vesting schedule constants ───────────────────────────────────────────

  describe("Vesting schedule constants", () => {
    let f: Fixture;
    beforeEach(async () => {
      f = await deployFixture();
    });

    it("CLIFF_DURATION is 180 days", async () => {
      expect(await f.distributor.CLIFF_DURATION()).to.equal(
        180n * 24n * 60n * 60n
      );
    });

    it("CLIFF_UNLOCK_BPS is 1000 (10%)", async () => {
      expect(await f.distributor.CLIFF_UNLOCK_BPS()).to.equal(1000n);
    });

    it("MONTHLY_UNLOCK_BPS is 250 (2.5%)", async () => {
      expect(await f.distributor.MONTHLY_UNLOCK_BPS()).to.equal(250n);
    });
  });

  // ─── Large airdrop tree ───────────────────────────────────────────────────

  describe("Large Merkle tree (many claimants)", () => {
    it("correctly handles a tree with 4 claimants", async () => {
      const [admin, c1, c2, c3, c4] = await ethers.getSigners();

      const MICFactory = await ethers.getContractFactory("MICToken");
      const mic = (await MICFactory.deploy(admin.address)) as unknown as MICToken;
      const LMFactory = await ethers.getContractFactory("LockManager");
      const lm = (await LMFactory.deploy()) as unknown as LockManager;
      const AirdropFactory =
        await ethers.getContractFactory("AirdropDistributor");
      const dist = (await AirdropFactory.deploy(
        await mic.getAddress(),
        await lm.getAddress(),
        admin.address
      )) as unknown as AirdropDistributor;

      const CREATOR = await lm.SCHEDULE_CREATOR_ROLE();
      await lm.connect(admin).grantRole(CREATOR, await dist.getAddress());

      const amounts = [
        1_000n * 10n ** 18n,
        2_000n * 10n ** 18n,
        3_000n * 10n ** 18n,
        4_000n * 10n ** 18n,
      ];
      const claimants = [c1, c2, c3, c4];

      const totalNeeded = amounts.reduce((a, b) => a + b, 0n);
      await mic.connect(admin).transfer(await dist.getAddress(), totalNeeded);

      const leaves = claimants.map((c, i) => makeLeaf(c.address, amounts[i]));
      const { root, getProof } = buildMerkleTree(leaves);
      await dist.connect(admin).setMerkleRoot(root);

      // Each claimant claims successfully
      for (let i = 0; i < claimants.length; i++) {
        await dist.connect(claimants[i]).claim(getProof(i), amounts[i]);
        expect(await mic.balanceOf(claimants[i].address)).to.equal(amounts[i]);
        expect(await dist.isClaimed(claimants[i].address, amounts[i])).to.be
          .true;
      }

      expect(await dist.totalClaimed()).to.equal(totalNeeded);
    });
  });
});
