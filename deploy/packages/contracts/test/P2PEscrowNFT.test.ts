import { expect } from "chai";
import { ethers } from "hardhat";
import { time, loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";

/**
 * P2PEscrowNFT — the replacement for P2PEscrowMFP.
 *
 * The predecessor passed its own tests and was unusable on mainnet for three months, so
 * these are written against the two things that suite never checked: whether a listing at
 * a **real dollar price** is accepted, and whether the contract works against a collection
 * that does not implement ERC-2981.
 *
 * Prices are expressed with `parseEther`, never as a repeated literal. `MICELicense.test.ts`
 * asserted `100n * 1_000_000n` against a contract returning `100 * 1_000_000` — perfect
 * agreement, both wrong. A test must not restate the constant it is checking.
 */

const USD = (n: string) => ethers.parseEther(n);
const DAY = 24 * 60 * 60;

async function fixture() {
  const [admin, seller, buyer, feeTo, royaltyTo, stranger] = await ethers.getSigners();

  const usdt = await (await ethers.getContractFactory("MockUSDT")).deploy();
  const usdt6 = await (await ethers.getContractFactory("MockUSDT6")).deploy();

  // 5%, matching the live MFPNFT reading on mainnet.
  const royaltyNft = await (await ethers.getContractFactory("MockNFT721Royalty"))
    .deploy(royaltyTo.address, 500);
  const plainNft = await (await ethers.getContractFactory("MockNFT721")).deploy();

  const F = await ethers.getContractFactory("P2PEscrowNFT");
  const escrow: any = await F.deploy(
    await usdt.getAddress(), await royaltyNft.getAddress(), feeTo.address, admin.address,
  );
  const plainEscrow: any = await F.deploy(
    await usdt.getAddress(), await plainNft.getAddress(), feeTo.address, admin.address,
  );

  for (const nft of [royaltyNft, plainNft]) {
    await (nft as any).mint(seller.address, 1);
    await (nft as any).mint(seller.address, 2);
    await (nft as any).connect(seller).setApprovalForAll(await escrow.getAddress(), true);
    await (nft as any).connect(seller).setApprovalForAll(await plainEscrow.getAddress(), true);
  }

  for (const who of [buyer, seller, stranger]) {
    await usdt.mint(who.address, USD("100000"));
    await usdt.connect(who).approve(await escrow.getAddress(), ethers.MaxUint256);
    await usdt.connect(who).approve(await plainEscrow.getAddress(), ethers.MaxUint256);
  }

  return {
    admin, seller, buyer, feeTo, royaltyTo, stranger,
    usdt, usdt6, royaltyNft, plainNft, escrow, plainEscrow,
  };
}

describe("P2PEscrowNFT", () => {
  describe("constructor guards", () => {
    it("refuses a 6-decimal USDT", async () => {
      const { usdt6, royaltyNft, feeTo, admin } = await loadFixture(fixture);
      const F = await ethers.getContractFactory("P2PEscrowNFT");
      await expect(
        F.deploy(await usdt6.getAddress(), await royaltyNft.getAddress(), feeTo.address, admin.address),
      ).to.be.revertedWith("P2PN: USDT must be 18 decimals");
    });

    it("refuses something that is not an ERC-721", async () => {
      const { usdt, feeTo, admin } = await loadFixture(fixture);
      const notNft = await (await ethers.getContractFactory("MockNotAnNFT")).deploy();
      const F = await ethers.getContractFactory("P2PEscrowNFT");
      await expect(
        F.deploy(await usdt.getAddress(), await notNft.getAddress(), feeTo.address, admin.address),
      ).to.be.revertedWith("P2PN: not an ERC-721");
    });

    it("records whether the collection answers ERC-2981", async () => {
      const { escrow, plainEscrow } = await loadFixture(fixture);
      expect(await escrow.royaltyAware()).to.equal(true);
      expect(await plainEscrow.royaltyAware()).to.equal(false);
    });
  });

  describe("the defect that killed P2PEscrowMFP", () => {
    it("accepts a listing at a real dollar price", async () => {
      const { escrow, seller } = await loadFixture(fixture);
      // The predecessor's ceiling was 1_000_000e6 = $0.000001, so this exact call reverted.
      await expect(escrow.connect(seller).createOrder(1, USD("500"), 7 * DAY)).to.not.be.reverted;
    });

    it("its price ceiling is a real $1,000,000, not a millionth of a dollar", async () => {
      const { escrow } = await loadFixture(fixture);
      expect(await escrow.maxPriceUsdt()).to.equal(USD("1000000"));
      expect(await escrow.maxPriceUsdt()).to.be.greaterThan(USD("1"));
      expect(await escrow.minPriceUsdt()).to.equal(USD("1"));
    });

    it("the bounds can be moved, which is the whole point of the redeploy", async () => {
      const { escrow, admin, seller } = await loadFixture(fixture);
      await escrow.connect(admin).setPriceBounds(USD("0.5"), USD("2000000"));
      expect(await escrow.minPriceUsdt()).to.equal(USD("0.5"));
      await expect(escrow.connect(seller).createOrder(1, USD("0.75"), 7 * DAY)).to.not.be.reverted;
    });

    it("keeps hard fences a mistyped setter cannot cross", async () => {
      const { escrow, admin } = await loadFixture(fixture);
      await expect(escrow.connect(admin).setPriceBounds(1n, USD("100")))
        .to.be.revertedWith("P2PN: min below floor");
      await expect(escrow.connect(admin).setPriceBounds(USD("1"), USD("999999999")))
        .to.be.revertedWith("P2PN: max above ceiling");
      await expect(escrow.connect(admin).setPriceBounds(USD("100"), USD("10")))
        .to.be.revertedWith("P2PN: min must be below max");
    });

    it("only an admin may move them", async () => {
      const { escrow, stranger } = await loadFixture(fixture);
      await expect(escrow.connect(stranger).setPriceBounds(USD("1"), USD("100"))).to.be.reverted;
    });
  });

  describe("listing", () => {
    it("escrows the token", async () => {
      const { escrow, royaltyNft, seller } = await loadFixture(fixture);
      await escrow.connect(seller).createOrder(1, USD("500"), 7 * DAY);
      expect(await royaltyNft.ownerOf(1)).to.equal(await escrow.getAddress());
      expect(await escrow.totalEscrowedTokens()).to.equal(1);
      expect(await escrow.activeOrderForToken(1)).to.equal(1);
    });

    it("refuses a second listing of the same token", async () => {
      const { escrow, seller } = await loadFixture(fixture);
      await escrow.connect(seller).createOrder(1, USD("500"), 7 * DAY);
      await expect(escrow.connect(seller).createOrder(1, USD("600"), 7 * DAY))
        .to.be.revertedWith("P2PN: token already listed");
    });

    it("refuses a price outside the bounds", async () => {
      const { escrow, seller } = await loadFixture(fixture);
      await expect(escrow.connect(seller).createOrder(1, USD("0.5"), 7 * DAY))
        .to.be.revertedWith("P2PN: price out of range");
      await expect(escrow.connect(seller).createOrder(1, USD("2000000"), 7 * DAY))
        .to.be.revertedWith("P2PN: price out of range");
    });

    it("refuses an expiry outside the bounds", async () => {
      const { escrow, seller } = await loadFixture(fixture);
      await expect(escrow.connect(seller).createOrder(1, USD("500"), 60))
        .to.be.revertedWith("P2PN: expiry out of range");
      await expect(escrow.connect(seller).createOrder(1, USD("500"), 31 * DAY))
        .to.be.revertedWith("P2PN: expiry out of range");
    });

    it("returns the token on cancel, and frees it for relisting", async () => {
      const { escrow, royaltyNft, seller } = await loadFixture(fixture);
      await escrow.connect(seller).createOrder(1, USD("500"), 7 * DAY);
      await escrow.connect(seller).cancelOrder(1);
      expect(await royaltyNft.ownerOf(1)).to.equal(seller.address);
      expect(await escrow.totalEscrowedTokens()).to.equal(0);
      expect(await escrow.activeOrderForToken(1)).to.equal(0);
      await expect(escrow.connect(seller).createOrder(1, USD("600"), 7 * DAY)).to.not.be.reverted;
    });

    it("lets nobody but the seller cancel", async () => {
      const { escrow, seller, stranger } = await loadFixture(fixture);
      await escrow.connect(seller).createOrder(1, USD("500"), 7 * DAY);
      await expect(escrow.connect(stranger).cancelOrder(1)).to.be.revertedWith("P2PN: not seller");
    });

    it("returns the token to the seller on expiry, whoever calls", async () => {
      const { escrow, royaltyNft, seller, stranger } = await loadFixture(fixture);
      await escrow.connect(seller).createOrder(1, USD("500"), 2 * DAY);
      await time.increase(3 * DAY);
      await escrow.connect(stranger).expireOrder(1);
      expect(await royaltyNft.ownerOf(1)).to.equal(seller.address);
    });
  });

  describe("settlement with royalty", () => {
    it("pays royalty, fee and seller from one payment", async () => {
      const { escrow, usdt, royaltyNft, seller, buyer, feeTo, royaltyTo } = await loadFixture(fixture);
      const price = USD("1000");
      await escrow.connect(seller).createOrder(1, price, 7 * DAY);

      const before = {
        seller: await usdt.balanceOf(seller.address),
        fee: await usdt.balanceOf(feeTo.address),
        roy: await usdt.balanceOf(royaltyTo.address),
        buyer: await usdt.balanceOf(buyer.address),
      };

      await escrow.connect(buyer).matchOrder(1, price);

      // 5% royalty + 1.5% fee = $65; seller keeps $935.
      expect(await usdt.balanceOf(royaltyTo.address) - before.roy).to.equal(USD("50"));
      expect(await usdt.balanceOf(feeTo.address) - before.fee).to.equal(USD("15"));
      expect(await usdt.balanceOf(seller.address) - before.seller).to.equal(USD("935"));
      expect(before.buyer - await usdt.balanceOf(buyer.address)).to.equal(price);
      expect(await royaltyNft.ownerOf(1)).to.equal(buyer.address);
    });

    it("quotes the same split it settles", async () => {
      const { escrow, seller } = await loadFixture(fixture);
      await escrow.connect(seller).createOrder(1, USD("1000"), 7 * DAY);
      const q = await escrow.quote(1);
      expect(q[0]).to.equal(USD("1000"));
      expect(q[1]).to.equal(USD("50"));
      expect(q[2]).to.equal(USD("15"));
      expect(q[3]).to.equal(USD("935"));
    });

    it("caps a greedy collection at 20%", async () => {
      const { escrow, usdt, royaltyNft, seller, buyer, royaltyTo } = await loadFixture(fixture);
      await royaltyNft.setRoyalty(royaltyTo.address, 9000); // 90%
      await escrow.connect(seller).createOrder(1, USD("1000"), 7 * DAY);
      const before = await usdt.balanceOf(royaltyTo.address);
      await escrow.connect(buyer).matchOrder(1, USD("1000"));
      expect(await usdt.balanceOf(royaltyTo.address) - before).to.equal(USD("200"));
    });

    it("nothing is left over — royalty + fee + seller equals the price", async () => {
      const { escrow, seller } = await loadFixture(fixture);
      await escrow.connect(seller).createOrder(1, USD("777.77"), 7 * DAY);
      const q = await escrow.quote(1);
      expect(q[1] + q[2] + q[3]).to.equal(q[0]);
    });
  });

  describe("settlement without royalty — the Community NFT case", () => {
    it("trades a collection that has no ERC-2981 at all", async () => {
      const { plainEscrow, usdt, plainNft, seller, buyer, feeTo } = await loadFixture(fixture);
      await plainEscrow.connect(seller).createOrder(1, USD("1000"), 7 * DAY);
      const beforeSeller = await usdt.balanceOf(seller.address);
      const beforeFee = await usdt.balanceOf(feeTo.address);

      await plainEscrow.connect(buyer).matchOrder(1, USD("1000"));

      expect(await usdt.balanceOf(seller.address) - beforeSeller).to.equal(USD("985"));
      expect(await usdt.balanceOf(feeTo.address) - beforeFee).to.equal(USD("15"));
      expect(await plainNft.ownerOf(1)).to.equal(buyer.address);
    });

    it("survives a collection that claims ERC-2981 and then reverts", async () => {
      const { usdt, feeTo, admin, seller, buyer } = await loadFixture(fixture);
      const bad = await (await ethers.getContractFactory("MockNFT721BadRoyalty")).deploy();
      const F = await ethers.getContractFactory("P2PEscrowNFT");
      const esc: any = await F.deploy(
        await usdt.getAddress(), await bad.getAddress(), feeTo.address, admin.address,
      );
      await bad.mint(seller.address, 1);
      await bad.connect(seller).setApprovalForAll(await esc.getAddress(), true);
      await usdt.connect(buyer).approve(await esc.getAddress(), ethers.MaxUint256);

      await esc.connect(seller).createOrder(1, USD("1000"), 7 * DAY);
      // The collection is broken; the trade still settles, with no royalty paid.
      await expect(esc.connect(buyer).matchOrder(1, USD("1000"))).to.not.be.reverted;
      expect(await bad.ownerOf(1)).to.equal(buyer.address);
    });
  });

  describe("buyer protections", () => {
    it("refuses to overpay a moved price", async () => {
      const { escrow, seller, buyer } = await loadFixture(fixture);
      await escrow.connect(seller).createOrder(1, USD("1000"), 7 * DAY);
      await expect(escrow.connect(buyer).matchOrder(1, USD("900")))
        .to.be.revertedWith("P2PN: price moved");
    });

    it("refuses a self-trade", async () => {
      const { escrow, seller } = await loadFixture(fixture);
      await escrow.connect(seller).createOrder(1, USD("1000"), 7 * DAY);
      await expect(escrow.connect(seller).matchOrder(1, USD("1000")))
        .to.be.revertedWith("P2PN: self-trade");
    });

    it("refuses an expired listing", async () => {
      const { escrow, seller, buyer } = await loadFixture(fixture);
      await escrow.connect(seller).createOrder(1, USD("1000"), 2 * DAY);
      await time.increase(3 * DAY);
      await expect(escrow.connect(buyer).matchOrder(1, USD("1000")))
        .to.be.revertedWith("P2PN: expired");
    });
  });

  describe("bids — the side P2PEscrowMFP never had", () => {
    it("escrows the buyer's USDT when the bid is posted", async () => {
      const { escrow, usdt, buyer } = await loadFixture(fixture);
      const before = await usdt.balanceOf(buyer.address);
      await escrow.connect(buyer).createBuyOrder(1, false, USD("800"), 7 * DAY);
      expect(before - await usdt.balanceOf(buyer.address)).to.equal(USD("800"));
      expect(await escrow.totalEscrowedUsdt()).to.equal(USD("800"));
    });

    it("settles when a holder delivers the token", async () => {
      const { escrow, usdt, royaltyNft, seller, buyer, feeTo, royaltyTo } = await loadFixture(fixture);
      await escrow.connect(buyer).createBuyOrder(1, false, USD("1000"), 7 * DAY);
      const beforeSeller = await usdt.balanceOf(seller.address);

      await escrow.connect(seller).fillBuyOrder(1, 1, USD("1000"));

      expect(await royaltyNft.ownerOf(1)).to.equal(buyer.address);
      expect(await usdt.balanceOf(seller.address) - beforeSeller).to.equal(USD("935"));
      expect(await usdt.balanceOf(royaltyTo.address)).to.equal(USD("50"));
      expect(await usdt.balanceOf(feeTo.address)).to.equal(USD("15"));
      expect(await escrow.totalEscrowedUsdt()).to.equal(0);
    });

    it("takes any token in the collection when the bid says so", async () => {
      const { escrow, royaltyNft, seller, buyer } = await loadFixture(fixture);
      await escrow.connect(buyer).createBuyOrder(0, true, USD("1000"), 7 * DAY);
      await escrow.connect(seller).fillBuyOrder(1, 2, USD("1000"));
      expect(await royaltyNft.ownerOf(2)).to.equal(buyer.address);
    });

    it("refuses the wrong token for a specific bid", async () => {
      const { escrow, seller, buyer } = await loadFixture(fixture);
      await escrow.connect(buyer).createBuyOrder(1, false, USD("1000"), 7 * DAY);
      await expect(escrow.connect(seller).fillBuyOrder(1, 2, USD("1000")))
        .to.be.revertedWith("P2PN: wrong token");
    });

    it("refuses to sell below the seller's floor", async () => {
      const { escrow, seller, buyer } = await loadFixture(fixture);
      await escrow.connect(buyer).createBuyOrder(1, false, USD("800"), 7 * DAY);
      await expect(escrow.connect(seller).fillBuyOrder(1, 1, USD("900")))
        .to.be.revertedWith("P2PN: price moved");
    });

    it("will not let a token already escrowed against a listing be delivered", async () => {
      const { escrow, seller, buyer } = await loadFixture(fixture);
      await escrow.connect(seller).createOrder(1, USD("500"), 7 * DAY);
      await escrow.connect(buyer).createBuyOrder(1, false, USD("1000"), 7 * DAY);
      await expect(escrow.connect(seller).fillBuyOrder(1, 1, USD("1000")))
        .to.be.revertedWith("P2PN: token is listed");
    });

    it("returns the escrow on cancel and on expiry", async () => {
      const { escrow, usdt, buyer, stranger } = await loadFixture(fixture);
      const start = await usdt.balanceOf(buyer.address);

      await escrow.connect(buyer).createBuyOrder(1, false, USD("800"), 7 * DAY);
      await escrow.connect(buyer).cancelBuyOrder(1);
      expect(await usdt.balanceOf(buyer.address)).to.equal(start);

      await escrow.connect(buyer).createBuyOrder(1, false, USD("800"), 2 * DAY);
      await time.increase(3 * DAY);
      await escrow.connect(stranger).expireBuyOrder(2);
      expect(await usdt.balanceOf(buyer.address)).to.equal(start);
      expect(await escrow.totalEscrowedUsdt()).to.equal(0);
    });
  });

  describe("escrow is unreachable by an admin", () => {
    it("refuses to sweep USDT that belongs to an open bid", async () => {
      const { escrow, usdt, admin, buyer } = await loadFixture(fixture);
      await escrow.connect(buyer).createBuyOrder(1, false, USD("800"), 7 * DAY);
      await expect(
        escrow.connect(admin).sweepStray(await usdt.getAddress(), admin.address, USD("1")),
      ).to.be.revertedWith("P2PN: no stray USDT");
    });

    it("sweeps only the surplus above escrowed bids", async () => {
      const { escrow, usdt, admin, buyer, stranger } = await loadFixture(fixture);
      await escrow.connect(buyer).createBuyOrder(1, false, USD("800"), 7 * DAY);
      await usdt.connect(stranger).transfer(await escrow.getAddress(), USD("10"));

      await expect(
        escrow.connect(admin).sweepStray(await usdt.getAddress(), admin.address, USD("11")),
      ).to.be.revertedWith("P2PN: would touch escrow");

      await expect(
        escrow.connect(admin).sweepStray(await usdt.getAddress(), admin.address, USD("10")),
      ).to.not.be.reverted;
      expect(await escrow.totalEscrowedUsdt()).to.equal(USD("800"));
    });

    it("refuses to sweep a token that backs a live listing", async () => {
      const { escrow, admin, seller } = await loadFixture(fixture);
      await escrow.connect(seller).createOrder(1, USD("500"), 7 * DAY);
      await expect(escrow.connect(admin).sweepStrayNft(1, admin.address))
        .to.be.revertedWith("P2PN: token is escrowed");
    });

    it("returns an NFT pushed in with no order attached", async () => {
      const { escrow, royaltyNft, admin, seller } = await loadFixture(fixture);
      await royaltyNft.connect(seller)["safeTransferFrom(address,address,uint256)"](
        seller.address, await escrow.getAddress(), 2,
      );
      await escrow.connect(admin).sweepStrayNft(2, seller.address);
      expect(await royaltyNft.ownerOf(2)).to.equal(seller.address);
    });
  });

  describe("pause", () => {
    it("stops new orders, bids and fills but never traps an escrow", async () => {
      const { escrow, royaltyNft, admin, seller, buyer } = await loadFixture(fixture);
      await escrow.connect(seller).createOrder(1, USD("500"), 7 * DAY);
      await escrow.connect(buyer).createBuyOrder(2, false, USD("500"), 7 * DAY);

      await escrow.connect(admin).setPaused(true);

      await expect(escrow.connect(seller).createOrder(2, USD("500"), 7 * DAY))
        .to.be.revertedWith("P2PN: paused");
      await expect(escrow.connect(buyer).matchOrder(1, USD("500")))
        .to.be.revertedWith("P2PN: paused");
      await expect(escrow.connect(buyer).createBuyOrder(2, false, USD("500"), 7 * DAY))
        .to.be.revertedWith("P2PN: paused");

      // The way out stays open for both sides.
      await expect(escrow.connect(seller).cancelOrder(1)).to.not.be.reverted;
      await expect(escrow.connect(buyer).cancelBuyOrder(1)).to.not.be.reverted;
      expect(await royaltyNft.ownerOf(1)).to.equal(seller.address);
    });
  });

  describe("fee", () => {
    it("is capped at 10% and only an admin may set it", async () => {
      const { escrow, admin, stranger } = await loadFixture(fixture);
      await expect(escrow.connect(admin).setFee(1001)).to.be.revertedWith("P2PN: fee out of range");
      await expect(escrow.connect(stranger).setFee(100)).to.be.reverted;
      await escrow.connect(admin).setFee(0);
      expect(await escrow.feeBps()).to.equal(0);
    });

    it("a zero fee pays the seller everything left after royalty", async () => {
      const { escrow, usdt, admin, seller, buyer } = await loadFixture(fixture);
      await escrow.connect(admin).setFee(0);
      await escrow.connect(seller).createOrder(1, USD("1000"), 7 * DAY);
      const before = await usdt.balanceOf(seller.address);
      await escrow.connect(buyer).matchOrder(1, USD("1000"));
      expect(await usdt.balanceOf(seller.address) - before).to.equal(USD("950"));
    });
  });
});
