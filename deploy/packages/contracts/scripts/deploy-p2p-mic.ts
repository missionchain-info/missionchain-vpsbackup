/**
 * Deploy P2PEscrowMIC to BSC mainnet.
 *
 * Pre-flight reads `decimals()` off the live tokens before spending gas. The constructor
 * checks it too, but a revert at deploy time costs a failed transaction and a confusing
 * error; this fails on the reading instead, and says which token was wrong.
 */
import { ethers } from 'hardhat'

const USDT = '0x55d398326f99059fF775485246999027B3197955' // BSC-USD, 18 decimals
const MIC = '0xf27ec0c311728b923b22828002c992c799326182'
const TREASURY = '0x1ed5C848D1244a618Bd95Ff92d4f8C2356d3a42F' // TreasuryManager
const ADMIN = '0xD32e666381b56f979D60C57831838f05F33AD6c2' // Owner

async function main() {
  const [deployer] = await ethers.getSigners()
  console.log('deployer   ', deployer.address)
  console.log('balance    ', ethers.formatEther(await ethers.provider.getBalance(deployer.address)), 'BNB')

  const erc20 = ['function decimals() view returns (uint8)', 'function symbol() view returns (string)']
  for (const [label, addr] of [['USDT', USDT], ['MIC', MIC]] as const) {
    const t = new ethers.Contract(addr, erc20, ethers.provider)
    const d = Number(await t.decimals())
    console.log(`${label.padEnd(11)}`, addr, await t.symbol(), `${d} decimals`)
    if (d !== 18) throw new Error(`${label} at ${addr} reports ${d} decimals — refusing to deploy`)
  }

  const P2P = await ethers.getContractFactory('P2PEscrowMIC')
  const p2p = await P2P.deploy(USDT, MIC, TREASURY, ADMIN)
  await p2p.waitForDeployment()
  const addr = await p2p.getAddress()

  console.log('\nP2PEscrowMIC', addr)
  console.log('  version   ', await p2p.VERSION())
  console.log('  feeBps    ', String(await p2p.feeBps()))
  console.log('  recipient ', await p2p.feeRecipient())
  console.log('  minPrice  ', ethers.formatUnits(await p2p.minPriceUsdt(), 18), 'USD')
  console.log('  maxPrice  ', ethers.formatUnits(await p2p.maxPriceUsdt(), 18), 'USD')
  console.log('  paused    ', await p2p.paused())
  console.log('\nverify:')
  console.log(`npx hardhat verify --network bsc ${addr} ${USDT} ${MIC} ${TREASURY} ${ADMIN}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
