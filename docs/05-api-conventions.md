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

## Endpoints (planned)

| Method | Path                                      | Auth        | Purpose                         |
| ------ | ----------------------------------------- | ----------- | ------------------------------- |
| GET    | `/api/auth/nonce`                         | none        | SIWE nonce                      |
| POST   | `/api/auth/verify`                        | none        | Verify signature, start session |
| POST   | `/api/auth/logout`                        | session     | End session                     |
| POST   | `/api/v1/invoices`                        | key/session | Create invoice                  |
| GET    | `/api/v1/invoices`                        | key/session | List invoices                   |
| GET    | `/api/v1/invoices/{id}`                   | key/session | Invoice detail                  |
| POST   | `/api/v1/invoices/{id}/cancel`            | key/session | Cancel a CREATED invoice        |
| GET    | `/api/v1/payments`                        | key/session | List payments/refunds           |
| GET    | `/api/v1/reports/settlement`              | session     | Settlement totals               |
| GET    | `/api/v1/exports/{invoices,payments}.csv` | session     | CSV export                      |
| POST   | `/api/v1/webhook-endpoint/test`           | session     | Send test event                 |
| GET    | `/api/public/invoices/{id}`               | none        | Checkout data                   |
| POST   | `/api/public/invoices/{id}/tx`            | none        | Report tx hash (informational)  |
| GET    | `/api/public/invoices/{id}/events`        | none        | SSE status stream               |

## Webhook signature

```
X-Signature = hex(HMAC-SHA256(secret, `${X-Timestamp}.${rawBody}`))
```

Verify in constant time and reject timestamps older than 5 minutes. Every event carries a unique
`id` and a per-invoice `sequence` for deduplication and ordering.
