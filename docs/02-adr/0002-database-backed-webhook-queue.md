# ADR 0002 — Database-backed webhook delivery queue

- **Status:** Accepted
- **Date:** 2026-11-11
- **Phase:** 2

## Context

Webhook delivery must be durable, retried on the SRS schedule (60 s, 5 min, 30 min, 2 h, 12 h),
observable and safe to restart. The Phase 0 scaffold assumed BullMQ on Redis. Redis is not part of
the required runtime for the demo, adds a second stateful service to operate, and its queue state
would need a separate backup/restore story. The SRS does not mandate a particular broker.

PostgreSQL is already required, transactional and backed up. The invoice status change and the
webhook event must be committed atomically (architecture rule 5), which is trivial when both live
in the same database.

## Decision

Use the `WebhookEvent` and `WebhookDelivery` tables as the delivery queue.

- A status change writes the `WebhookEvent` row in the same transaction as the invoice update and
  status history row.
- If the merchant has an `ACTIVE` webhook endpoint, one `WebhookDelivery` row (`attempt = 1`,
  `status = PENDING`, `nextRetryAt = now`) is inserted in that same transaction.
- The worker polls `PENDING` rows where `nextRetryAt <= now`, claims each row with a conditional
  `updateMany` lease (`nextRetryAt = now + WEBHOOK_LEASE_SECONDS`), and delivers it.
- Each attempt is one row. A failed attempt becomes `FAILED` and, when attempts remain, a new
  `PENDING` row with `attempt + 1` and the next `nextRetryAt` is inserted. The unique constraint
  `(eventId, attempt)` makes retry creation idempotent.
- `SUCCEEDED`/`FAILED` rows are the delivery log and are retained for 30 days (FR-WH-6).
- The lease means a crashed worker's rows become eligible again automatically; no in-memory state
  is required.

## Consequences

**Positive**

- One stateful dependency (PostgreSQL) for API, indexer and worker.
- Webhook events are atomic with invoice state; a replay can rebuild the queue from `WebhookEvent`.
- Delivery log, retries and observability use plain SQL and the admin health endpoint.
- Restart safety: no jobs are lost because nothing lives in process memory.

**Negative**

- Polling adds a small, constant database load (`WEBHOOK_POLL_INTERVAL_MS`, default 1 s).
- Throughput is bounded by the worker concurrency and the poll query, which is ample for the
  testnet MVP but below a dedicated broker's ceiling.
- Horizontal worker scaling is safe because claims are conditional, but the polling query becomes
  the bottleneck before BullMQ would.

## Alternatives considered

- **BullMQ + Redis:** stronger scheduling primitives and higher throughput, but a second stateful
  service, a split transaction between PostgreSQL and Redis, and a separate backup story. Rejected
  for the MVP; the `WebhookDelivery` table remains a clean migration source.
- **In-process timers:** loses deliveries on restart. Rejected.

## Migration path

If throughput demands it, a worker can drain `WebhookDelivery` into BullMQ while keeping the table
as the durable log. The event payload, signing scheme and retry schedule stay unchanged.
