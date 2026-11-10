# Requirements traceability tracker

Status values: `todo` · `in progress` · `done` · `verified` (acceptance passed on staging).

## Functional requirements

### Authentication (FR-AUTH)

| ID                                                                 | Priority | Phase | Status |
| ------------------------------------------------------------------ | -------- | ----- | ------ |
| FR-AUTH-1 SIWE login, no password                                  | M        | 2     | todo   |
| FR-AUTH-2 Single-use nonce, 5 min, reject reuse/expiry             | M        | 2     | todo   |
| FR-AUTH-3 HttpOnly/Secure/SameSite=Lax session, 8 h, server logout | M        | 2     | todo   |
| FR-AUTH-4 First login creates ACTIVE merchant                      | M        | 2     | todo   |
| FR-AUTH-5 Admin list in DB, editable by admins only                | M        | 2     | todo   |
| FR-AUTH-6 Invite viewer team member                                | S        | 3     | todo   |
| FR-AUTH-7 Edit business profile                                    | S        | 3     | todo   |

### Merchant settings (FR-MER)

| ID                                                   | Priority | Phase | Status   |
| ---------------------------------------------------- | -------- | ----- | -------- |
| FR-MER-1 Checksummed payout address                  | M        | 2     | todo     |
| FR-MER-2 Payout change requires signature + audit    | M        | 2     | todo     |
| FR-MER-3 API key shown once, hash + prefix stored    | M        | 2     | todo     |
| FR-MER-4 Revoke/rotate key, rejected within 1 minute | M        | 2     | todo     |
| FR-MER-5 One webhook URL + rotatable secret          | M        | 2     | todo     |
| FR-MER-6 Merchant token selection                    | S        | 3     | todo     |
| FR-MER-7 Checkout branding                           | C        | —     | deferred |

### Invoices (FR-INV)

| ID                                                    | Priority | Phase | Status                            |
| ----------------------------------------------------- | -------- | ----- | --------------------------------- |
| FR-INV-1 Create via dashboard/API with full field set | M        | 2     | todo                              |
| FR-INV-2 Default 30 min expiry, 5 min–7 days          | M        | 2     | todo                              |
| FR-INV-3 UUID + unique 32-byte reference              | M        | 2     | todo                              |
| FR-INV-4 Nine statuses, transitions enforced          | M        | 0/2   | in progress (shared machine done) |
| FR-INV-5 Idempotency-Key replay for 24 h              | M        | 2     | todo                              |
| FR-INV-6 Cancel only in CREATED                       | M        | 2     | todo                              |
| FR-INV-7 Expiry job within 60 s                       | M        | 2     | todo                              |
| FR-INV-8 Payment link + QR                            | S        | 3     | todo                              |
| FR-INV-9 Filtered, paginated invoice list             | S        | 3     | todo                              |
| FR-INV-10 Email invoice link                          | C        | —     | deferred                          |

### Checkout (FR-CUS)

| ID                                                   | Priority | Phase | Status   |
| ---------------------------------------------------- | -------- | ----- | -------- |
| FR-CUS-1 Public checkout without login               | M        | 3     | todo     |
| FR-CUS-2 Wallet connect + network switch             | M        | 3     | todo     |
| FR-CUS-3 Balance/allowance, exact approve before pay | M        | 3     | todo     |
| FR-CUS-4 Tx hash + explorer link + live status       | M        | 3     | todo     |
| FR-CUS-5 Disable payment when not payable            | M        | 3     | todo     |
| FR-CUS-6 Plain-language failure messages             | M        | 3     | todo     |
| FR-CUS-7 Printable receipt                           | S        | 3     | todo     |
| FR-CUS-8 tUSDC mint + faucet link                    | S        | 3     | todo     |
| FR-CUS-9 WalletConnect mobile QR                     | C        | —     | deferred |

### Payment processing and indexing (FR-PAY)

| ID                                                  | Priority | Phase | Status   |
| --------------------------------------------------- | -------- | ----- | -------- |
| FR-PAY-1 Only contract events mark payment          | M        | 2     | todo     |
| FR-PAY-2 Ordered, resumable, idempotent indexer     | M        | 2     | todo     |
| FR-PAY-3 Match event by ref, verify merchant/token  | M        | 2     | todo     |
| FR-PAY-4 CONFIRMING then PAID after N confirmations | M        | 2     | todo     |
| FR-PAY-5 PAID/UNDERPAID/OVERPAID comparison         | M        | 2     | todo     |
| FR-PAY-6 Reorg returns invoice to PENDING           | M        | 2     | todo     |
| FR-PAY-7 Late payment flagged, not PAID             | M        | 2     | todo     |
| FR-PAY-8 Signed full/partial refund                 | M        | 1/2   | todo     |
| FR-PAY-9 Gross/fee/net in dashboard                 | S        | 3     | todo     |
| FR-PAY-10 RPC failover after 3 errors + alert       | S        | 2     | todo     |
| FR-PAY-11 Native ETH payments                       | C        | —     | deferred |

### Webhooks (FR-WH)

| ID                                          | Priority | Phase | Status                     |
| ------------------------------------------- | -------- | ----- | -------------------------- |
| FR-WH-1 Eight event types                   | M        | 2     | todo                       |
| FR-WH-2 HMAC-SHA256 over timestamp.body     | M        | 2     | todo (signing helper done) |
| FR-WH-3 10 s timeout, retry schedule        | M        | 2     | todo                       |
| FR-WH-4 At-least-once, unique ID + sequence | M        | 2     | todo                       |
| FR-WH-5 HTTPS + SSRF protection             | M        | 2     | todo                       |
| FR-WH-6 Delivery log retained 30 days       | M        | 2     | todo                       |
| FR-WH-7 Resend/test event                   | S        | 3     | todo                       |
| FR-WH-8 Disable after 7 days of failures    | S        | 3     | todo                       |

### Settlement and reporting (FR-SET)

| ID                                             | Priority | Phase | Status   |
| ---------------------------------------------- | -------- | ----- | -------- |
| FR-SET-1 Settlement inside payment transaction | M        | 1     | todo     |
| FR-SET-2 Settlement report by range and token  | M        | 3     | todo     |
| FR-SET-3 CSV export (UTF-8, ISO 8601)          | M        | 3     | todo     |
| FR-SET-4 Reconciliation view                   | S        | 3     | todo     |
| FR-SET-5 Daily email/Slack summary             | C        | —     | deferred |

### Dashboard (FR-DASH)

| ID                                         | Priority | Phase | Status   |
| ------------------------------------------ | -------- | ----- | -------- |
| FR-DASH-1 Overview metrics for 1/7/30 days | M        | 3     | todo     |
| FR-DASH-2 Invoice status timeline          | M        | 3     | todo     |
| FR-DASH-3 Payments list with tx details    | M        | 3     | todo     |
| FR-DASH-4 Daily volume chart               | S        | 3     | todo     |
| FR-DASH-5 Network + contract banner        | S        | 3     | todo     |
| FR-DASH-6 Dark theme                       | C        | —     | deferred |

### Admin (FR-ADM)

| ID                                              | Priority | Phase | Status   |
| ----------------------------------------------- | -------- | ----- | -------- |
| FR-ADM-1 List/search/suspend merchants          | M        | 3     | todo     |
| FR-ADM-2 Token allowlist mirrored from chain    | M        | 3     | todo     |
| FR-ADM-3 Fee within cap, current on-chain value | M        | 3     | todo     |
| FR-ADM-4 Append-only audit log                  | M        | 2     | todo     |
| FR-ADM-5 Health page                            | S        | 4     | todo     |
| FR-ADM-6 Pause/unpause contract                 | S        | 3     | todo     |
| FR-ADM-7 Re-scan block range                    | C        | —     | deferred |

## Smart contract requirements

| ID                                    | Priority | Phase | Status |
| ------------------------------------- | -------- | ----- | ------ |
| SC-1 Fee maths, floor, fee ≤ amount   | M        | 1     | todo   |
| SC-2 One payment per reference        | M        | 1     | todo   |
| SC-3 PaymentReceived shape/indexing   | M        | 1     | todo   |
| SC-4 PaymentRefunded shape/indexing   | M        | 1     | todo   |
| SC-5 OZ libs, CEI, custom errors      | M        | 1     | todo   |
| SC-6 Zero contract balance invariant  | M        | 1     | todo   |
| SC-7 Allowlisted standard ERC-20 only | M        | 1     | todo   |
| SC-8 Non-upgradeable                  | M        | 1     | todo   |
| SC-9 ≥95% lines, fuzz tests           | M        | 1     | todo   |
| SC-10 Slither clean + verified source | M        | 1     | todo   |
| SC-11 2-of-3 multisig owner           | S        | 1/4   | todo   |
| SC-12 pay < 150k gas snapshot         | S        | 1     | todo   |
| SC-13 NatSpec + deployment manifest   | S        | 1     | todo   |

## Non-functional requirements

| ID                                                      | Priority | Phase | Status        |
| ------------------------------------------------------- | -------- | ----- | ------------- |
| NFR-PERF-1 p95 ≤ 300 ms at 50 rps                       | M        | 4     | todo          |
| NFR-PERF-2 LCP ≤ 2.5 s on 4G                            | M        | 4     | todo          |
| NFR-PERF-3 CONFIRMING ≤ 10 s, lag ≤ 3 blocks            | M        | 2/4   | todo          |
| NFR-PERF-4 First webhook ≤ 5 s                          | S        | 2/4   | todo          |
| NFR-REL-1 Indexer restart ≤ 60 s, no loss/dupes         | M        | 2     | todo          |
| NFR-REL-2 99% monthly availability                      | M        | 4     | todo          |
| NFR-REL-3 Daily backup + tested restore                 | M        | 4     | todo          |
| NFR-REL-4 RPC outage degrades gracefully                | M        | 2/4   | todo          |
| NFR-SCAL-1 Stateless web, single indexer lock           | M        | 2/4   | todo          |
| NFR-SCAL-2 Load test 100 sessions / 20 payments per min | S        | 4     | todo          |
| NFR-OBS-1 Structured JSON logs, no secrets              | M        | 0/4   | in progress   |
| NFR-OBS-2 Prometheus metrics + Grafana                  | M        | 4     | todo          |
| NFR-OBS-3 Slack alerts                                  | M        | 4     | todo          |
| NFR-OBS-4 OpenTelemetry tracing                         | C        | —     | deferred      |
| NFR-USAB-1 WCAG 2.1 AA                                  | M        | 3/4   | todo          |
| NFR-USAB-2 360 px responsive                            | M        | 3/4   | todo          |
| NFR-USAB-3 Payment under 2 minutes                      | S        | 3/4   | todo          |
| NFR-USAB-4 Message files for i18n                       | C        | —     | deferred      |
| NFR-MNT-1 Monorepo, strict TS, ESLint, Prettier         | M        | 0     | done          |
| NFR-MNT-2 80% unit coverage + Anvil E2E                 | M        | 4     | todo          |
| NFR-MNT-3 README, OpenAPI, runbook                      | M        | 0/4   | in progress   |
| NFR-POR-1 One `docker compose up`                       | M        | 0/4   | in progress   |
| NFR-POR-2 IaC (Terraform/Helm)                          | S        | —     | deferred      |
| NFR-LEG-1 Testnet/no-value notices                      | M        | 0/3   | in progress   |
| NFR-LEG-2 Only wallet addresses + optional email        | M        | 0/2   | done (schema) |

## Security requirements

| ID                                                       | Priority | Phase | Status        |
| -------------------------------------------------------- | -------- | ----- | ------------- |
| SEC-1 TLS 1.2+, HSTS, security headers                   | M        | 4     | todo          |
| SEC-2 Secrets outside repo + secret scanning             | M        | 0/4   | in progress   |
| SEC-3 No signing keys in services                        | M        | 0     | done (design) |
| SEC-4 Schema validation + parameterised queries          | M        | 2     | todo          |
| SEC-5 Constant-time API keys, scoped, rate limited       | M        | 2     | todo          |
| SEC-6 CSRF: SameSite + origin check                      | M        | 2     | todo          |
| SEC-7 Merchant scoping tests                             | M        | 2     | todo          |
| SEC-8 CI blocks high findings (audit/SAST/image/Slither) | M        | 4     | in progress   |
| SEC-9 Non-root minimal containers                        | M        | 4     | todo          |
| SEC-10 Isolated webhook egress worker                    | S        | 2/4   | todo          |
| SEC-11 Checkout shows payout + contract                  | S        | 3     | todo          |
| SEC-12 ZAP baseline on staging                           | S        | 4     | todo          |
| SEC-13 SBOM per build                                    | S        | 4     | todo          |
| SEC-14 Review + signed commits                           | S        | 4     | todo          |
| SEC-15 Security checklist sign-off                       | S        | 4     | todo          |
| SEC-16 Nightly invariant tests                           | C        | —     | deferred      |
| SEC-17 EIP-712 signed quotes                             | C        | —     | deferred      |

## DevOps requirements

| ID                                                      | Priority | Phase | Status      |
| ------------------------------------------------------- | -------- | ----- | ----------- |
| DEV-1 PR pipeline blocks merge                          | M        | 0     | done        |
| DEV-2 Security gates in pipeline                        | M        | 0/4   | in progress |
| DEV-3 Images tagged with commit SHA                     | M        | 4     | todo        |
| DEV-4 Auto staging, manual demo approval                | M        | 4     | todo        |
| DEV-5 Reviewed contract deploy + verify                 | M        | 1/4   | todo        |
| DEV-6 Deploy-time migrations, one-version compatibility | M        | 4     | todo        |
| DEV-7 Env vars per environment                          | M        | 0     | done        |
| DEV-8 Monitoring stack from repo                        | M        | 4     | todo        |
| DEV-9 PR preview environment                            | S        | —     | deferred    |
| DEV-10 Zero-downtime rollout + backup drill             | S        | 4     | todo        |

## Acceptance scenarios

| ID                                      | Phase | Status      |
| --------------------------------------- | ----- | ----------- |
| AC-1 SIWE login/nonce reuse             | 2     | todo        |
| AC-2 Idempotent invoice creation        | 2     | todo        |
| AC-3 Pay → hash → CONFIRMING → PAID     | 2/3   | todo        |
| AC-4 Exact/under/over payment           | 2     | todo        |
| AC-5 Late payment stays EXPIRED         | 2     | todo        |
| AC-6 Indexer restart/reorg              | 2     | todo        |
| AC-7 Webhook retries and recovery       | 2     | todo        |
| AC-8 Signature/timestamp verification   | 0/2   | helper done |
| AC-9 Reject internal webhook URLs       | 2     | todo        |
| AC-10 Refund sequence                   | 1/2   | todo        |
| AC-11 Zero contract balance invariant   | 1     | todo        |
| AC-12 Cross-merchant access returns 404 | 2     | todo        |
| AC-13 Fee cap enforcement               | 1/2   | todo        |
| AC-14 Settlement/reconciliation totals  | 3     | todo        |
