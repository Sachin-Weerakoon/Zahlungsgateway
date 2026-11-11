-- Bind each invoice to its on-chain terms (merchant payout, token, amount, salt) and record the
-- block of every refund so reorgs can roll refunds back.

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN "salt" CHAR(66),
ADD COLUMN "payoutAddress" VARCHAR(42);

-- AlterTable
ALTER TABLE "Refund" ADD COLUMN "blockNumber" BIGINT;

-- CreateIndex
CREATE INDEX "Refund_blockNumber_idx" ON "Refund"("blockNumber");
