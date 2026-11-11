# Operations runbook

## Local environment

```bash
cp .env.example .env
npm install
npm run db:generate
docker compose up -d postgres anvil
npm run db:migrate
npm run dev            # web on :3000
npm run dev:indexer    # health on :9464
npm run dev:worker     # health on :9465
```

Health checks: `GET /healthz` (liveness) and `GET /readyz` (indexer readiness).

## Environment variables

All settings come from environment variables; `.env.example` is the authoritative list. Separate
values are required for local, staging and demo. Never commit `.env` or any private key.

| Variable                               | Purpose                                      |
| -------------------------------------- | -------------------------------------------- |
| `DATABASE_URL`                         | PostgreSQL connection string                 |
| `AUTH_SECRET`                          | Session signing secret (32+ chars)           |
| `WEBHOOK_ENCRYPTION_KEY`               | Encrypts webhook signing secrets (32+ chars) |
| `RPC_URL_PRIMARY` / `RPC_URL_FALLBACK` | Testnet RPC endpoints                        |
| `PAYMENT_PROCESSOR_ADDRESS`            | Deployed contract address                    |
| `INDEXER_CONFIRMATIONS`                | Confirmations before settlement (default 5)  |
| `INDEXER_LEASE_SECONDS`                | Single-indexer lease duration (default 60)   |
| `INDEXER_HEALTH_PORT`                  | Indexer health endpoint (default 9464)       |
| `WORKER_HEALTH_PORT`                   | Worker health endpoint (default 9465)        |
| `ADMIN_WALLETS`                        | Comma-separated admin addresses              |

Webhook delivery is a database-backed queue (`WebhookEvent` + `WebhookDelivery`); Redis is not
required. See `docs/02-adr/0002-database-backed-webhook-queue.md`.

## Contract deployment (Phase 1+)

1. Deploy from a developer machine or multisig — never from CI or a service.
2. Run the reviewed deploy workflow/script; it writes `contracts/deployments/<chainId>.json`.
3. Verify the source on the block explorer.
4. Update `PAYMENT_PROCESSOR_ADDRESS`, `TEST_USDC_ADDRESS` and public equivalents.
5. Transfer ownership to the 2-of-3 multisig when available.

## Indexer operations

- **Restart:** the indexer resumes from `IndexerState.lastProcessedBlock`; no manual step needed.
- **Single writer:** each instance holds a lease on the `IndexerState` row and renews it every
  tick. A second instance waits; a crashed instance is replaced after `INDEXER_LEASE_SECONDS`.
  An instance that loses its lease exits with code 1 rather than writing the cursor twice.
- **Lag alert:** > 20 blocks for 5 minutes (Phase 4 alert). Check RPC health first, then DB locks.
- **Re-scan:** stop the indexer, reset `IndexerState.lastProcessedBlock` to the target block, restart.
  Writes are idempotent on `(txHash, logIndex)`, so replay is safe.
- **Reorg:** the indexer compares stored block hashes; payments below the confirmation threshold
  return to `PENDING` and a `payment.reorged` event is emitted.

## Webhook operations

- Failed deliveries retry after 1 m, 5 m, 30 m, 2 h and 12 h, then are marked failed.
- Delivery logs are retained for 30 days.
- An endpoint with 7 days of continuous failures is disabled and flagged on the dashboard.
- Never re-send a webhook manually without checking the merchant's event ID deduplication.

## Backups and restore

- Daily PostgreSQL snapshot, 7 retained (Phase 4 automation).
- Restore drill: restore the latest snapshot into a scratch database, run `prisma migrate deploy`,
  verify invoice/payment counts, then discard.

## Security checks

- CI blocks merges on gitleaks findings, high/critical dependency advisories, CodeQL/Semgrep,
  Trivy image findings and unresolved Slither high/medium findings.
- Rotate a leaked API key immediately (dashboard → revoke); revoked keys are rejected within 1 minute.
- Rotate `WEBHOOK_ENCRYPTION_KEY` only with a re-encryption migration.

## Incident checklist

1. Identify the failing layer (web, indexer, worker, RPC, database).
2. Check `/healthz`, structured logs, indexer lag and queue depth.
3. If RPC is failing, confirm the fallback provider is active; never mark payments manually.
4. If the database is unavailable, keep the API read-only and pause webhook delivery.
5. Record the incident, timeline and follow-up actions in the audit log or team notes.
