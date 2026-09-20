// Figures here were read from P2PEscrowMIC 0x7388ed77c06A917B572C1429B2a323a171c3c5ea,
// P2PEscrowNFT_MFP 0xFf730a5E231255b8AD5FFa1a07D7011fc8D77924 and P2PEscrowNFT_Community
// 0x8477d9c0239D9218f259AdF75704aDF5c8e29B07 at block 123,005,173 on 2026-09-20. Only
// constants the contract cannot change are stated as numbers; the live fee, price bounds
// and amount bounds are settings and are shown on the page, not written here.
import type { Guide } from './types'

export const p2p: Guide = {
  title: 'P2P Marketplace',
  intro:
    'P2P is a trade between two members settled by an escrow contract, not by the protocol pool. ' +
    'MIC and each NFT collection have their own escrow, so their order books and their settings ' +
    'are separate. The escrow holds one side of the trade from the moment the order is created, ' +
    'and both legs move in the same transaction or neither does.',
  howItWorks: [
    'Listing to sell moves your asset into the escrow immediately, before any buyer appears. That is the point: a seller cannot offer something they have already spent, and a buyer is never asked to trust that they still hold it.',
    'Posting a bid works the same way in reverse — your USDT is escrowed the moment the bid goes up. For NFTs a bid may name one token or stand for any token in the collection.',
    'Buying pays the asking price in USDT and receives the asset in one transaction. You cannot fill your own order, and a token can only have one open listing at a time.',
    'Cancelling costs nothing. A seller withdrawing an unsold listing gets the asset straight back, and there is no cancellation fee on any of the three escrows.',
    'Every order carries an expiry chosen at listing time, between 1 hour and 30 days. Those two bounds are fixed constants. After the expiry anyone at all may close the order out, and the asset goes back to its owner regardless of who calls — so you are never locked in because an operator was offline.',
    'The platform fee is taken out of the USDT and is paid by the seller from the sale: the buyer pays exactly the asking price, and the seller receives the price less the fee. The fee is a setting the page reads, and each market sets its own — the MIC fee does not have to match the NFT fee. Whatever it is set to, the contract can never charge more than 10%.',
    'A royalty applies to the Mission Founding Partner collection only. Its contract answers the royalty standard, so the escrow reads a receiver and an amount from it and pays that out of the sale price before anything else. The Community collection does not implement the standard at all; its escrow recorded that once when it was deployed and pays no royalty on any trade.',
    'The order of deduction is royalty first, then the platform fee, then whatever is left to the seller. Both escrows expose a quote that returns all four figures before anyone signs, so neither side has to learn the split from the receipt.',
  ],
  tips: [
    'Before listing, read the quote, not the price. The number you type is what the buyer pays; what reaches you is that minus the royalty, if the collection has one, and minus the fee.',
    'On the MIC market the price you set is the total for the whole lot, not the price of one MIC. The form multiplies a per-coin price out for you — check the total before signing.',
    'Minimum and maximum price, and for MIC the minimum and maximum amount, are adjustable settings rather than fixed limits. An order outside them is rejected by the contract, so take the bounds from the form on the day rather than from a figure you remember.',
    'You must approve the escrow to move your asset before the listing transaction will go through. That is a separate signature, and a listing that appears to fail at the first step is usually the approval, not the order.',
    'The royalty on the Mission Founding Partner collection is paid to whatever address that contract names, and that address is a setting on the collection rather than something the marketplace controls. The escrow will not forward more than 20% of a sale as royalty whatever a collection asks for — that ceiling is a fixed constant.',
  ],
}
