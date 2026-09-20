// Figures here were read from MFPNFT 0xAE6F32A6fdf80F5e54ba85441386dBA6a381f565 and
// CommunityNFTv2 0x28263C00C371A6DE9592E2477f2813408F337E96 at block 123,004,822, and from
// MFPRewardPool 0xFb79deC4F0CDe13A667018e567dD636255D61d6d and CommunityNFTRewardPool
// 0xae26BA0f1c639beA93e5a4dD9313F5765A29Ee5a at block 123,005,055, on 2026-09-20. Only
// constants the contract cannot change are stated as numbers; live values are on the page.
import type { Guide } from './types'

export const nft: Guide = {
  title: 'NFT',
  intro:
    'There are two collections. The Mission Founding Partner NFT is a permanent credential that ' +
    'comes with the founding and strategic-partner rounds. The Community NFT is a tier credential ' +
    'awarded for participation, and it has a lifetime after which it stops counting. This page ' +
    'shows what you hold, enrols it into the reward pools and lets you claim what it has earned.',
  howItWorks: [
    'Both collections are plain ERC-721. Every token is a unique serial you own outright — there is no shared balance, no quantity per id and no semi-fungible edition. An older Community collection was built as ERC-1155; it is not the contract this app uses, and nothing here reads it.',
    'The Mission Founding Partner NFT has no expiry. Its supply is capped, and the cap can be lifted exactly once by an administrator, by no more than the original cap again — there is no path to a third raise.',
    'A Community NFT is minted at one of three tiers. Each tier carries its own reward weight and its own lifetime, and both are settings an administrator may adjust between a fixed floor and ceiling, so read the tier figures off the page rather than memorising them. When a token\'s lifetime runs out it stops earning; the pool retires it.',
    'A token earns nothing until it is enrolled in its reward pool. Enrolment is a separate transaction, it is open to anyone, and until it happens the pool counts your token as weight zero no matter how long you have held it.',
    'In the Mission Founding Partner pool every enrolled token carries exactly the same weight. There is no multiplier: your share is your enrolled count over everyone\'s enrolled count, and nothing else.',
    'In the Community pool weight follows the tier, so a higher tier is a larger slice of the same pool rather than a separate pool.',
    'Rewards accrue continuously and are pulled, not pushed: the pool holds your balance until you claim it from your own wallet. The separate weekly and monthly US dollar pools work the same way — each is claimed on its own button.',
    'After a transfer the new holder has to resync the token so its weight follows the owner. Resync is open to anyone, so a holder is never waiting on an operator to be credited.',
  ],
  tips: [
    'Holding an NFT gives you no vote. Governance membership is a separate registry of wallets, and no contract reads an NFT balance to decide who may propose or approve.',
    'No NFT multiplier is applied to mining or to staking anywhere today. The Mission Founding Partner contract still carries an old staking-multiplier constant in its storage; nothing reads it, and any document quoting a mining boost from holding one is describing a design that was never wired up.',
    'Enrol every token, not just the first. Weight is tracked per token id, so an unenrolled serial sitting in the same wallet as an enrolled one still earns nothing.',
    'If you sell a Mission Founding Partner NFT, a royalty is taken out of the sale price and paid to the address that contract names. Community NFTs carry no royalty at all — that contract does not implement the standard, and the marketplace pays none.',
    'An expired Community NFT stays in your wallet and stays sellable. Expiry ends its reward weight; it does not burn the token.',
  ],
}
