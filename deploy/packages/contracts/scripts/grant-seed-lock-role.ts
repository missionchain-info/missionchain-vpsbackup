/**
 * Grant SCHEDULE_CREATOR_ROLE to SeedSale on LockManager.
 *
 * This fixes the "missing revert data" error when buying SEED packages.
 * SeedSale.buyPackage() calls lockManager.createSchedule() which requires
 * SCHEDULE_CREATOR_ROLE.
 *
 * Usage:
 *   DEPLOYER_KEY=0x... npx hardhat run scripts/grant-seed-lock-role.ts --network bscTestnet
 */

import { ethers } from 'hardhat'

const LOCK_MANAGER = '0xB75B8800bBB06d085a72bdA8fA75da4C885C4d1E'
const SEED_SALE    = '0x6DDa34fB238a177E1DE7815A7975c023Ba816225'

async function main() {
  const [deployer] = await ethers.getSigners()
  console.log('Deployer:', deployer.address)

  const lockManager = await ethers.getContractAt('LockManager', LOCK_MANAGER)

  // Get role hash
  const SCHEDULE_CREATOR_ROLE = await lockManager.SCHEDULE_CREATOR_ROLE()
  console.log('SCHEDULE_CREATOR_ROLE:', SCHEDULE_CREATOR_ROLE)

  // Check if already granted
  const hasRole = await lockManager.hasRole(SCHEDULE_CREATOR_ROLE, SEED_SALE)
  console.log('SeedSale already has role:', hasRole)

  if (hasRole) {
    console.log('✅ Role already granted. Nothing to do.')
    return
  }

  // Check deployer has admin role
  const DEFAULT_ADMIN_ROLE = await lockManager.DEFAULT_ADMIN_ROLE()
  const isAdmin = await lockManager.hasRole(DEFAULT_ADMIN_ROLE, deployer.address)
  console.log('Deployer is admin:', isAdmin)

  if (!isAdmin) {
    console.error('❌ Deployer does not have DEFAULT_ADMIN_ROLE on LockManager!')
    process.exit(1)
  }

  // Grant the role
  console.log('Granting SCHEDULE_CREATOR_ROLE to SeedSale...')
  const tx = await lockManager.grantRole(SCHEDULE_CREATOR_ROLE, SEED_SALE)
  console.log('TX hash:', tx.hash)
  await tx.wait()
  console.log('✅ TX confirmed!')

  // Verify
  const verified = await lockManager.hasRole(SCHEDULE_CREATOR_ROLE, SEED_SALE)
  console.log('SeedSale has SCHEDULE_CREATOR_ROLE:', verified)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
