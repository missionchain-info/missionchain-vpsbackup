import { ethers } from 'hardhat'

async function main() {
  const [deployer] = await ethers.getSigners()
  console.log('Signer:', deployer.address)

  const seedSale = await ethers.getContractAt('SeedSale', '0x6DDa34fB238a177E1DE7815A7975c023Ba816225')

  // Try actual transaction
  console.log('Sending buyPackage(0) with gasLimit 5M...')
  try {
    const tx = await seedSale.buyPackage(0, { gasLimit: 5_000_000 })
    console.log('TX sent:', tx.hash)
    const receipt = await tx.wait()
    console.log('TX confirmed! Status:', receipt?.status)
    console.log('Gas used:', receipt?.gasUsed.toString())
  } catch (e: any) {
    console.log('TX FAILED:', e.message?.slice(0, 500))
    if (e.receipt) {
      console.log('Receipt status:', e.receipt.status)
      console.log('Gas used:', e.receipt.gasUsed?.toString())
    }
    if (e.data) console.log('Revert data:', e.data)
  }
}

main().catch(e => { console.error((e as Error).message?.slice(0, 300)); process.exit(1) })
