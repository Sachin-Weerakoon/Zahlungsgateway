-- Single-indexer lease (NFR-SCAL-1).
-- The indexer claims the row for its chain with a short lease and renews it on every tick.
-- A crashed instance stops renewing, so another instance can take over after the lease expires.

ALTER TABLE "IndexerState" ADD COLUMN "lockedBy" VARCHAR(64),
ADD COLUMN "lockedUntil" TIMESTAMP(3);
