-- CreateTable
CREATE TABLE "ReportedTransaction" (
    "id" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "txHash" VARCHAR(66) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportedTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReportedTransaction_invoiceId_txHash_key" ON "ReportedTransaction"("invoiceId", "txHash");

-- CreateIndex
CREATE INDEX "ReportedTransaction_txHash_idx" ON "ReportedTransaction"("txHash");

-- AddForeignKey
ALTER TABLE "ReportedTransaction" ADD CONSTRAINT "ReportedTransaction_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
