import { HardhatUserConfig } from 'hardhat/config'
import '@nomicfoundation/hardhat-toolbox'
import 'dotenv/config'

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.24',
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: 'cancun',
      viaIR: true,
    },
  },
  networks: {
    hardhat: {
      blockGasLimit: 30_000_000, // Increased for large NFT batch mints (up to 350 MFP-NFTs)
      // Fork BSC mainnet only when FORK_BSC=1. Off by default, so the ordinary test run
      // stays offline and deterministic. Used by scripts/forktest-*.ts to rehearse a
      // mainnet operation against real contracts and real tokens before doing it for real.
      forking: process.env.FORK_BSC === '1'
        ? {
            url: process.env.FORK_RPC || 'https://bsc-dataseed.binance.org',
            ...(process.env.FORK_BLOCK ? { blockNumber: Number(process.env.FORK_BLOCK) } : {}),
          }
        : undefined,
      chains: {
        56: { hardforkHistory: { cancun: 0 } },
      },
    },
    bscTestnet: {
      url: 'https://data-seed-prebsc-1-s1.binance.org:8545',
      chainId: 97,
      accounts: process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : [],
      gasPrice: 10_000_000_000,
    },
    bsc: {
      url: 'https://bsc-dataseed.binance.org/',
      chainId: 56,
      accounts: process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : [],
    },
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY || process.env.BSCSCAN_API_KEY || '',
  },
}

export default config
