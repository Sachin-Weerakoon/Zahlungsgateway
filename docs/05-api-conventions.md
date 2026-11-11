# API conventions

Base path: `/api/v1`. Public checkout endpoints live under `/api/public`. Admin endpoints live
under `/api/admin`.

## Authentication

| Caller             | Credential                                           |
| ------------------ | ---------------------------------------------------- |
| Merchant dashboard | Session cookie (HttpOnly, Secure, SameSite=Lax, 8 h) |
| Merchant server    | `Authorization: Bearer <api key>`                    |
| Customer           | None (public endpoints only)                         |
| Admin              | Session cookie + wallet on the admin list            |

Merchant identity is always derived from the credential, never from the request payload.

## Requests

- JSON bodies; amounts are decimal strings in base units (`"25000000"`).
- Timestamps are ISO 8601 UTC with a `Z` suffix.
- `Idempotency-Key` is honoured on invoice creation for 24 hours.
- Lists use cursor pagination: `limit` (default 25, max 100) and `cursor`.

## Responses

Single error shape:

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "amount must be greater than zero",
    "requestId": "req_01J..."
  }
}
```

Rate limits: 100 req/min per API key, 30 req/min per IP on public endpoints. Exceeding them
returns `429` with `Retry-After`.

## Endpoints

### Authentication and merchant

| Method    | Path                            | Auth        | Purpose                                   |
| --------- | ------------------------------- | ----------- | ----------------------------------------- |
| GET       | `/api/auth/nonce`               | none        | Single-use SIWE nonce (5 min)             |
| POST      | `/api/auth/verify`              | none        | Verify signature, start session           |
| POST      | `/api/auth/logout`              | session     | End session                               |
| GET       | `/api/auth/session`             | key/session | Current merchant and admin flag           |
| GET/PATCH | `/api/v1/me`                    | key/session | Read/update business profile              |
| POST      | `/api/v1/me/payout-address`     | key/session | Change payout address (wallet signature)  |
| GET/POST  | `/api/v1/api-keys`              | key/session | List/create API keys (secret shown once)  |
| DELETE    | `/api/v1/api-keys/{id}`         | key/session | Revoke an API key                         |
| GET/PUT/DELETE | `/api/v1/webhook-endpoint` | key/session | Read/set+rotate secret/disable endpoint   |

### Invoices, payments, reports

| Method | Path                                      | Auth        | Purpose                         |
| ------ | ----------------------------------------- | ----------- | ------------------------------- |
| POST   | `/api/v1/invoices`                        | key/session | Create invoice                  |
| GET    | `/api/v1/invoices`                        | key/session | List invoices                   |
| GET    | `/api/v1/invoices/{id}`                   | key/session | Invoice detail                  |
| POST   | `/api/v1/invoices/{id}/cancel`            | key/session | Cancel a CREATED invoice        |
| GET    | `/api/v1/payments`                        | key/session | List payments/refunds           |
| GET    | `/api/v1/reports/settlement`              | key/session | Settlement totals               |
| GET    | `/api/v1/exports/invoices`                | key/session | Invoice CSV export              |
| GET    | `/api/v1/exports/payments`                | key/session | Payment CSV export              |

### Public checkout

| Method | Path                              | Auth | Purpose                        |
| ------ | --------------------------------- | ---- | ------------------------------ |
| GET    | `/api/public/invoices/{id}`       | none | Checkout data                  |
| POST   | `/api/public/invoices/{id}/tx`    | none | Report tx hash (informational) |
| GET    | `/api/public/invoices/{id}/events`| none | SSE status stream              |

### Admin (wallet allowlist)

| Method | Path                                 | Auth  | Purpose                         |
| ------ | ------------------------------------ | ----- | ------------------------------- |
| GET    | `/api/admin/merchants`               | admin | List/search merchants           |
| POST   | `/api/admin/merchants/{id}/status`   | admin | Suspend or reactivate           |
| GET    | `/api/admin/tokens`                  | admin | Token allowlist mirror          |
| POST   | `/api/admin/tokens`                  | admin | Upsert allowlisted token        |
| GET    | `/api/admin/audit`                   | admin | Append-only audit log           |
| GET    | `/api/admin/health`                  | admin | Database, indexer and queue     |
| GET    | `/api/admin/chain`                   | admin | Live contract configuration     |
| GET    | `/api/health`                        | none  | Liveness                        |

## Webhook signature

```
X-Signature = hex(HMAC-SHA256(secret, `${X-Timestamp}.${rawBody}`))
```

Verify in constant time and reject timestamps older than 5 minutes. Every event carries a unique
`id` and a per-invoice `sequence` for deduplication and ordering.
