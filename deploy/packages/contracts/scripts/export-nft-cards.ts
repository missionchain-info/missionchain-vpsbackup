import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// Renders the 3 Community NFT (v2) cards straight from the on-chain tokenURI and writes
// the SVGs (+ a combined HTML preview) into ./nft-cards at the repo root.
function decodeDataUri(uri: string): string {
  return Buffer.from(uri.substring(uri.indexOf("base64,") + 7), "base64").toString("utf8");
}

async function main() {
  const [admin, user] = await ethers.getSigners();
  const nft: any = await (await ethers.getContractFactory("CommunityNFTv2")).deploy(admin.address);
  await nft.waitForDeployment();

  // Fixed timestamp so the "TIME CREATED" stamp is stable
  const T = Math.floor(Date.UTC(2026, 6, 20, 20, 57, 30) / 1000); // 20/07/26 - 205730 UTC
  await ethers.provider.send("evm_setNextBlockTimestamp", [T]);
  await nft.connect(admin).mint(user.address, 1); // Builder  #0001
  await nft.connect(admin).mint(user.address, 2); // Maker    #0002
  await nft.connect(admin).mint(user.address, 3); // Luminary #0003

  const outDir = path.resolve(__dirname, "../../../nft-cards");
  fs.mkdirSync(outDir, { recursive: true });

  const names = ["builder", "maker", "luminary"];
  const svgs: string[] = [];
  for (let id = 1; id <= 3; id++) {
    const json = JSON.parse(decodeDataUri(await nft.tokenURI(id)));
    const svg = decodeDataUri(json.image);
    svgs.push(svg);
    fs.writeFileSync(path.join(outDir, `community-nft-${names[id - 1]}.svg`), svg);
  }

  fs.writeFileSync(
    path.join(outDir, "community-nft-all.html"),
    `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#0d1526;display:flex;gap:20px;flex-wrap:wrap;justify-content:center;padding:24px">` +
      svgs.map((s) => `<div style="width:320px">${s}</div>`).join("") +
      `</body>`
  );

  console.log("WROTE 3 SVGs + all.html to:", outDir);
}

main().catch((e) => { console.error(e); process.exit(1); });
