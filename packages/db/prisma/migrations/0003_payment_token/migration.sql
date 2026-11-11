-- AlterTable
ALTER TABLE "Payment" ADD COLUMN "tokenAddress" VARCHAR(42) NOT NULL;

-- CreateIndex
CREATE INDEX "Payment_tokenAddress_idx" ON "Payment"("tokenAddress");
