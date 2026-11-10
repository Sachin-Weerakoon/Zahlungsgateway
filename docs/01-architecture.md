# Architecture

## Runtime shape

```
Merchant server ──REST/API key──┐
Merchant browser ──session──────┤        ┌──────────────┐
Customer browser ──checkout─────┼───────▶│  Next.js app │──▶ PostgreSQL
                                │        │  + REST API  │
                                │        └──────┬───────┘
                                │               │ enqueue
                                │        ┌──────▼───────┐
                                │        │ Redis queues │
                                │        └──┬────────┬──┘
                                │           │        │
Customer wallet ──pay()──▶ PaymentProcessor │        │
                                │           │        │
                           (events)    ┌────▼────┐ ┌─▼────────────┐
                                └──────▶│ Indexer │ │Webhook worker│──▶ Merchant HTTPS
                                        └────┬────┘ └──────┬───────┘
                                             └──▶ PostgreSQL ◀┘
```

Three services (web, indexer, worker), two data stores (PostgreSQL, Redis) and one contract.
The web app, indexer and worker hold no key that can sign blockchain transactions.

## Trust boundaries

1. **The chain decides what was paid.** A transaction hash reported by the browser is
   informational (`PENDING`). Only a `PaymentReceived` event from the configured
   `PaymentProcessor` can move an invoice to `CONFIRMING`/`PAID`.
2. **Merchant identity comes from the session or API key**, never from a request body or query.
3. **Webhooks leave the platform** through a worker that must not reach private networks or cloud
   metadata endpoints.
4. **Secrets:** API keys stored as hashes, webhook secrets encrypted with a key held outside the
   database, no secrets in logs.

## Payment lifecycle

1. Merchant `POST /api/v1/invoices` → invoice stored, checkout URL returned.
2. Customer opens `/pay/{invoiceId}`, connects wallet, reviews payout and contract addresses.
3. Customer approves the exact amount, then calls `pay(invoiceRef, merchant, token, amount)`.
4. Contract sends fee to treasury and net to merchant, emits `PaymentReceived`.
5. Indexer matches the event by reference, verifies merchant + token, writes `CONFIRMING`,
   status history and webhook event in one transaction.
6. After N confirmations (default 5) the invoice becomes `PAID`, `UNDERPAID` or `OVERPAID`.
7. Worker delivers the signed webhook with retries; checkout updates over SSE.
8. Merchant may sign a `refund` transaction; the indexer records it and the invoice becomes
   `REFUNDED` once the net amount has been fully refunded.

## Contract events

```solidity
event PaymentReceived(
  bytes32 indexed invoiceRef,
  address indexed merchant,
  address indexed payer,
  address token,
  uint256 grossAmount,
  uint256 fee
);

event PaymentRefunded(
  bytes32 indexed invoiceRef,
  address indexed merchant,
  address payer,
  uint256 amount
);
```

## Invoice status machine

| From                           | Allowed to                                 |
| ------------------------------ | ------------------------------------------ |
| CREATED                        | PENDING, EXPIRED, CANCELLED                |
| PENDING                        | CONFIRMING, EXPIRED                        |
| CONFIRMING                     | PAID, UNDERPAID, OVERPAID, PENDING (reorg) |
| PAID                           | REFUNDED                                   |
| UNDERPAID                      | REFUNDED                                   |
| OVERPAID                       | REFUNDED                                   |
| EXPIRED / CANCELLED / REFUNDED | — (final)                                  |

Status changes are written atomically with their history row and webhook event.

## Shared packages

- `@cryptopay/shared` — enums, constants, status machine, money maths, zod schemas, DTOs,
  webhook signing helpers. Single source of truth for both services and UI.
- `@cryptopay/db` — Prisma schema and client.

## Non-negotiable invariants

- Amounts are integer base units (`numeric(78,0)` in PostgreSQL, decimal strings in JSON).
- One payment per invoice reference (contract-enforced).
- Indexer writes are idempotent on `(txHash, logIndex)`.
- The contract holds zero token balance after every call.
- Audit log is append-only.
