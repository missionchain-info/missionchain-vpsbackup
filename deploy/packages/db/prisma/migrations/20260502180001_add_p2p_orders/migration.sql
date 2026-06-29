-- CreateEnum
CREATE TYPE "P2POrderStatus" AS ENUM ('PENDING', 'EXECUTED', 'CANCELLED', 'EXPIRED');

-- CreateTable
CREATE TABLE "P2POrder" (
    "id" TEXT NOT NULL,
    "onChainId" BIGINT NOT NULL,
    "seller" VARCHAR(42) NOT NULL,
    "tokenId" BIGINT NOT NULL,
    "priceUsdt" DECIMAL(18,6) NOT NULL,
    "status" "P2POrderStatus" NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "buyer" VARCHAR(42),
    "royaltyAmount" DECIMAL(18,6),
    "feeAmount" DECIMAL(18,6),
    "sellerNet" DECIMAL(18,6),
    "createdTxHash" VARCHAR(66),
    "executedTxHash" VARCHAR(66),
    "cancelledTxHash" VARCHAR(66),
    "expiredTxHash" VARCHAR(66),

    CONSTRAINT "P2POrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "P2POrder_onChainId_key" ON "P2POrder"("onChainId");
CREATE INDEX "P2POrder_seller_status_idx" ON "P2POrder"("seller", "status");
CREATE INDEX "P2POrder_buyer_idx" ON "P2POrder"("buyer");
CREATE INDEX "P2POrder_status_expiresAt_idx" ON "P2POrder"("status", "expiresAt");
CREATE INDEX "P2POrder_tokenId_idx" ON "P2POrder"("tokenId");
