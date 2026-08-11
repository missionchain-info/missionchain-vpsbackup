import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import * as fs from "fs";
import * as path from "path";

// Decode a data:...;base64,XXXX URI to its UTF-8 string payload
function decodeDataUri(uri: string): string {
  const b64 = uri.substring(uri.indexOf("base64,") + 7);
  return Buffer.from(b64, "base64").toString("utf8");
}

// Expected "YYYY.MM.DD" (UTC) — the validity format printed on the card
function ymd(ts: number): string {
  const d = new Date(ts * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}.${p(d.getUTCMonth() + 1)}.${p(d.getUTCDate())}`;
}

// Expected "DDMMYY - HHMMSS" (UTC) from a unix timestamp
function expectedStamp(ts: number): string {
  const d = new Date(ts * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}${p(d.getUTCMonth() + 1)}${p(d.getUTCFullYear() % 100)} - ${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

describe("CommunityNFTv2 (ERC-721, unique serial + on-chain SVG)", function () {
  this.timeout(180000); // on-chain SVG generation is heavy; tolerate a slow simulator
  let nft: any;
  let admin: any, minter: any, user1: any, user2: any, outsider: any;

  const BUILDER = 1n, MAKER = 2n, LUMINARY = 3n;
  const DAY = 86400n;

  beforeEach(async () => {
    [admin, minter, user1, user2, outsider] = await ethers.getSigners();
    const F = await ethers.getContractFactory("CommunityNFTv2");
    nft = await F.deploy(admin.address);
    await nft.waitForDeployment();
    // give a dedicated minter (PreSale will hold this role in prod)
    await nft.connect(admin).grantRole(await nft.MINTER_ROLE(), minter.address);
  });

  it("mints unique ERC-721 tokens with a global incrementing serial", async () => {
    await nft.connect(minter).mint(user1.address, BUILDER);   // serial 1
    await nft.connect(minter).mint(user1.address, MAKER);     // serial 2
    await nft.connect(minter).mint(user2.address, LUMINARY);  // serial 3

    expect(await nft.ownerOf(1)).to.equal(user1.address);
    expect(await nft.ownerOf(2)).to.equal(user1.address);
    expect(await nft.ownerOf(3)).to.equal(user2.address);
    expect(await nft.tierOf(1)).to.equal(BUILDER);
    expect(await nft.tierOf(3)).to.equal(LUMINARY);
    expect(await nft.totalSerials()).to.equal(3n);
    expect(await nft.totalMinted(BUILDER)).to.equal(1n);
    expect(await nft.balanceOf(user1.address)).to.equal(2n);
    expect(await nft.isActive(1)).to.equal(true);
  });

  it("is ERC-721 (unique), not ERC-1155", async () => {
    expect(await nft.supportsInterface("0x80ac58cd")).to.equal(true);  // ERC721
    expect(await nft.supportsInterface("0xd9b67a26")).to.equal(false); // ERC1155
  });

  it("serial FOLLOWS the token on transfer (bound to the NFT)", async () => {
    await nft.connect(minter).mint(user1.address, MAKER); // serial 1
    await nft.connect(user1).transferFrom(user1.address, user2.address, 1);
    expect(await nft.ownerOf(1)).to.equal(user2.address);
    expect(await nft.activeCountOf(user2.address, MAKER)).to.equal(1n);
    expect(await nft.activeCountOf(user1.address, MAKER)).to.equal(0n);
    expect(await nft.tierOf(1)).to.equal(MAKER); // serial + tier intact
  });

  it("tokenURI carries on-chain SVG with tier, serial, timestamp (UTC) and stats", async () => {
    // Mint at a known UTC time-of-day so we can assert the printed stamp.
    // NOTE: must be RELATIVE to the current chain clock, not an absolute calendar date —
    // earlier suites in the full run warp the shared hardhat clock decades ahead, and
    // setNextBlockTimestamp() rejects any timestamp below the previous block's.
    const DAY_SECS = 86_400;
    const now = await time.latest();
    const T = Math.floor(now / DAY_SECS + 1) * DAY_SECS + (9 * 3600 + 8 * 60 + 7); // next UTC midnight + 09:08:07Z
    await time.setNextBlockTimestamp(T);
    await nft.connect(minter).mint(user1.address, LUMINARY); // serial 1

    const uri: string = await nft.tokenURI(1);
    expect(uri.startsWith("data:application/json;base64,")).to.equal(true);
    const json = JSON.parse(decodeDataUri(uri));

    expect(json.name).to.contain("Luminary #1");
    const attrs = Object.fromEntries(json.attributes.map((a: any) => [a.trait_type, a.value]));
    expect(attrs.Tier).to.equal("Luminary");
    expect(attrs.Serial).to.equal(1);
    expect(attrs["Tier Weight"]).to.equal("x5.0");
    expect(attrs["Duration (days)"]).to.equal(180);
    expect(attrs.Status).to.equal("Active");

    const svg = decodeDataUri(json.image);
    expect(json.image.startsWith("data:image/svg+xml;base64,")).to.equal(true);
    expect(svg).to.contain('viewBox="0 0 900 1350"');
    expect(svg).to.contain("LUMINARY");
    expect(svg).to.contain("LEGACY TIER");
    expect(svg).to.contain("SERIAL &#8226; MC-0001");
    expect(svg).to.contain("MINING VALIDITY");
    expect(svg).to.contain(ymd(T));                    // start of validity
    expect(svg).to.contain(ymd(T + 180 * DAY_SECS));   // end = start + tier duration
    expect(svg).to.contain("&#215;5.0");
    expect(svg).to.contain("TIER WEIGHT");             // renamed from BOOST
    expect(svg).to.contain("180 DAYS");
    expect(svg).to.contain("PROOF OF PARTICIPATION");
    expect(svg).to.contain("Born of Faith. Built for People.");
    expect(svg).to.not.contain("EXPIRED");
  });

  it("stamps EXPIRED once validity elapses — and never burns the token", async () => {
    await nft.connect(minter).mint(user1.address, BUILDER); // 60 days
    expect(await nft.isActive(1)).to.equal(true);

    await time.increase(61n * 86400n);

    // Benefits end...
    expect(await nft.isActive(1)).to.equal(false);
    expect(await nft.activeCountOf(user1.address, BUILDER)).to.equal(0n);
    expect(await nft.highestActiveTier(user1.address)).to.equal(0n);

    // ...but the credential itself survives as proof of participation.
    expect(await nft.ownerOf(1)).to.equal(user1.address);
    expect(await nft.balanceOf(user1.address)).to.equal(1n);
    expect(await nft.tierOf(1)).to.equal(BUILDER);

    const json = JSON.parse(decodeDataUri(await nft.tokenURI(1)));
    const attrs = Object.fromEntries(json.attributes.map((a: any) => [a.trait_type, a.value]));
    expect(attrs.Status).to.equal("Expired");
    expect(decodeDataUri(json.image)).to.contain("EXPIRED");
  });

  it("boost + duration reflect each tier", async () => {
    await nft.connect(minter).mint(user1.address, BUILDER);
    await nft.connect(minter).mint(user1.address, MAKER);
    const b = JSON.parse(decodeDataUri(await nft.tokenURI(1)));
    const m = JSON.parse(decodeDataUri(await nft.tokenURI(2)));
    const ba = Object.fromEntries(b.attributes.map((a: any) => [a.trait_type, a.value]));
    const ma = Object.fromEntries(m.attributes.map((a: any) => [a.trait_type, a.value]));
    expect(ba["Tier Weight"]).to.equal("x1.0");
    expect(ba["Duration (days)"]).to.equal(60);
    expect(ma["Tier Weight"]).to.equal("x2.5");
    expect(ma["Duration (days)"]).to.equal(90);
  });

  it("expires after its tier duration", async () => {
    await nft.connect(minter).mint(user1.address, BUILDER); // 60 days
    expect(await nft.isActive(1)).to.equal(true);
    await time.increase(61n * DAY);
    expect(await nft.isActive(1)).to.equal(false);
    expect(await nft.highestActiveTier(user1.address)).to.equal(0n);
  });

  it("only MINTER_ROLE can mint", async () => {
    await expect(nft.connect(outsider).mint(user1.address, BUILDER)).to.be.reverted;
  });

  it("EXPORT: writes the three tier SVGs to disk for visual review", async () => {
    const latest = await time.latest();
    await time.setNextBlockTimestamp(latest + 5); // must be strictly increasing
    await nft.connect(minter).mint(user1.address, BUILDER);
    await nft.connect(minter).mint(user1.address, MAKER);
    await nft.connect(minter).mint(user1.address, LUMINARY);
    // Write inside the repo, not a machine-specific temp path — the previous hard-coded
    // path pointed at a scratch directory that no longer exists, so this test failed with
    // ENOENT on any other machine (and here, once that directory was cleaned up).
    const dir = path.join(__dirname, "..", "..", "artifacts", "nft-preview");
    fs.mkdirSync(dir, { recursive: true });
    for (const [id, nm] of [[1, "builder"], [2, "maker"], [3, "luminary"]] as const) {
      const json = JSON.parse(decodeDataUri(await nft.tokenURI(id)));
      fs.writeFileSync(`${dir}/nft_v2_${nm}.svg`, decodeDataUri(json.image));
    }
    // ...plus an expired Luminary so the EXPIRED stamp can be reviewed visually too.
    await time.increase(181n * 86400n);
    fs.writeFileSync(`${dir}/nft_v2_luminary_expired.svg`,
      decodeDataUri(JSON.parse(decodeDataUri(await nft.tokenURI(3))).image));
    fs.writeFileSync(`${dir}/nft_v2_all.html`,
      `<body style="margin:0;background:#0d1b2e;display:flex;gap:16px;padding:16px;flex-wrap:wrap">` +
      [1, 2, 3].map(() => "").join("") +
      ["builder", "maker", "luminary"].map(n => `<img src="nft_v2_${n}.svg" width="300"/>`).join("") +
      `</body>`);
    expect(true).to.equal(true);
  });
});
