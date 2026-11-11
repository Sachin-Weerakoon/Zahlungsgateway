# Developer Task Allocation — MVP Completion

## Purpose

This document converts the current repository state into eight owner-led workstreams. It is a
delivery plan, not a claim that the MVP is complete. Keep the agreed testnet-only scope frozen;
finish and verify the must-have acceptance paths before taking on Should/Could items.

## Current Snapshot

- SIWE API, merchant-scoped APIs, invoice creation/list APIs, indexer, worker, contract sources,
  and the generated ABI are present.
- The web app now has SIWE login, a basic merchant overview, invoice create/list, and public
  checkout routes. These pages have passed local lint, typecheck, and production build checks.
- Local checks previously passed 46 shared-package tests and 31 Foundry tests. The configured
  dependency audit threshold passes; the latest audit reported moderate advisories only.
- The dashboard is still a first slice: it does not yet meet the 1/7/30-day metric, timeline,
  payment detail, settings, refund, reporting, or admin UI requirements.
- The demo script asks for an expiry countdown and visible contract address in checkout; the
  current checkout shows an expiry timestamp and payout/token addresses but not that full
  acceptance experience.
- The current environment has no Docker/PostgreSQL and no deployed test token address. Real
  login, invoice creation, indexer integration, and payment acceptance therefore remain
  unverified here. The invoice form correctly stays disabled until the test token is configured.
- `docs/06-phase-plan.md` and `docs/07-requirements-traceability.md` have not yet been reconciled
  with all of the new web pages and API routes. Keep `done` separate from `verified` on staging.

## Allocation Summary

| #   | Workstream                                            | Primary owner | Supporting owners                      | Priority | Depends on                                        |
| --- | ----------------------------------------------------- | ------------- | -------------------------------------- | -------- | ------------------------------------------------- |
| 1   | Checkout acceptance and wallet reliability            | SE2           | SE3, DevOps2, DevSecOps                | P0       | Testnet config, deployed token/processor          |
| 2   | Merchant dashboard and invoice detail                 | SE2           | SE3                                    | P0       | Authenticated API, status history                 |
| 3   | Merchant settings, refunds, and API-key UX            | SE2           | SE3, DevOps3, DevSecOps                | P0       | Session/authz, signed payout API, contract refund |
| 4   | Admin console and operational controls                | SE2           | SE3, SE1, DevOps1/4                    | P1       | Admin APIs, on-chain config events                |
| 5   | Settlement, reconciliation, and webhook operations UI | SE2           | SE3, DevOps3, DevOps2                  | P1       | Reports/CSV APIs, delivery records, indexer state |
| 6   | Database/Anvil integration and acceptance tests       | DevOps2       | SE3, DevOps3, SE1, SE2                 | P0       | Docker-capable runner, migrations, local Anvil    |
| 7   | Contract security and deployment verification         | SE1           | DevSecOps, DevOps1/4                   | P0       | Gate 1 contract build, testnet deployment         |
| 8   | Staging, observability, runbook, and final demo       | DevOps1/4     | DevOps2, DevOps3, DevSecOps, all leads | P0       | Workstreams 1–7                                   |

P0 means required before the full staging demo. P1 follows once P0 flows are stable; do not allow
P1 polish to block a must-have acceptance fix. Assign individual names and sprint dates in the
team tracker; role labels here follow the original workstream ownership plan.

## Workstream Details

### 1. Checkout Acceptance and Wallet Reliability

**Lead:** SE2. **Support:** SE3 for API behavior, DevOps2 for indexer events, DevSecOps for wallet
and trust-boundary review.

**Current state:** `/pay/[invoiceId]` loads public invoice data, requests wallet access, switches to
the invoice network, checks balance/allowance, approves the exact amount, calls `pay`, reports the
transaction hash, links to the explorer, and displays SSE status. This is locally rendered with
mocked invoice data but is not yet a real testnet acceptance run.

**Tasks:**

- Configure and verify `CHAIN_ID`, `NEXT_PUBLIC_CHAIN_ID`, `TEST_USDC_ADDRESS`,
  `NEXT_PUBLIC_TEST_USDC_ADDRESS`, `PAYMENT_PROCESSOR_ADDRESS`, and
  `NEXT_PUBLIC_PAYMENT_PROCESSOR_ADDRESS` against the deployment manifest. Fail closed on any
  mismatch; never enable payment against the zero address.
- Show the configured processor address, merchant payout address, token, amount, network, and a
  live UTC expiry countdown. Match the demo script's wording and values.
- Handle wallet account and chain changes after connect. Refresh balance/allowance on changes,
  clear stale account data, disable actions while switching/submitting, and prevent duplicate
  approvals or payment submissions.
- Confirm the selected account can pay and the invoice remains payable immediately before wallet
  submission. A browser hash or API report must remain informational; only indexed contract
  events advance the invoice to `CONFIRMING`/settled states.
- Cover rejected signature, wrong chain, insufficient balance, rejected approval, reverted payment,
  RPC timeout, expired/cancelled invoice, SSE reconnect, and explorer-link states with plain-language
  recovery actions.
- Keep MVP token support to configured allowlisted ERC-20/tUSDC. Do not add native ETH or
  multi-network runtime selection.

**Acceptance evidence:** AC-3, AC-4, AC-5, FR-CUS-1 through FR-CUS-6, and SEC-11 pass on Base
Sepolia. A customer can pay once from a clean browser; the UI never labels a reported hash as paid;
the indexer drives the final status without manual refresh.

### 2. Merchant Dashboard and Invoice Detail

**Lead:** SE2. **Support:** SE3.

**Current state:** `/dashboard` shows basic all-time invoice counts, current-month gross volume by
token, five recent invoices, and five recent payments. `/dashboard/invoices` lists invoices with
status filtering and cursor pagination. The current summary is not the required 1/7/30-day overview.

**Tasks:**

- Add date-range metrics for 1, 7, and 30 days: gross, fee, net, payment count, and counts by
  invoice status, grouped by token with base-unit-safe formatting.
- Add a merchant-scoped invoice detail page with status timeline, reported/confirmed transaction
  hashes, payment amounts, fee/net, confirmation count, expiry, and explorer links.
- Add a payments list/detail view with payer, block, confirmations, reorg/late flags, gross/fee/net,
  refund totals, and invoice association.
- Use a chart only if it improves comparison; any daily volume chart must use UTC buckets and an
  accessible tabular equivalent. Treat FR-DASH-4 as Should, after the required metrics and details.
- Add robust empty, loading, 401, 403, API failure, and narrow-screen states; keep all amounts in
  integer base units in APIs and format only at the UI boundary.

**Acceptance evidence:** FR-DASH-1 through FR-DASH-3 pass with fixtures covering empty data,
multiple tokens, partial refunds, and status changes. AC-14 reconciliation inputs can be traced to
the same merchant-scoped records.

### 3. Merchant Settings, Refunds, and API-Key UX

**Lead:** SE2. **Support:** SE3 for settings APIs, DevOps3 for webhook delivery behavior,
DevSecOps for secrets and authorization review.

**Tasks:**

- Build settings for business profile, payout address, API keys, and webhook endpoint using the
  existing authenticated APIs. Display API-key plaintext only once and make revoke/rotation
  confirmation explicit.
- Payout changes must request a wallet signature over the server's canonical message and show the
  previous/new address before confirmation. Do not accept address changes by ordinary form POST.
- Show webhook URL, secret-set/rotation state (never return the secret after creation), recent
  delivery outcomes, retry timing, and a useful test/resend action if the required endpoint exists.
- Add payment detail refund controls for partial and full refunds. The contract only authorizes the
  recorded merchant payout address to call `refund`; verify the connected wallet matches that
  address before enabling the action, show refundable net (platform fee is not refundable), and
  require a clear confirmation of amount and payer.
- Refresh invoice/payment state only from API/indexer results. A successful wallet transaction is
  not sufficient to label a refund complete.

**Acceptance evidence:** FR-MER-1 through FR-MER-5, FR-PAY-8, and API-key revocation timing pass.
Test owner/viewer/admin authorization, cross-merchant isolation, cancelled signatures, and partial
refund followed by final refund. API keys and webhook secrets never appear in logs or later reads.

### 4. Admin Console and Operational Controls

**Lead:** SE2. **Support:** SE3, SE1, DevOps1/4.

**Current state:** Admin API routes exist for merchant listing/status, chain values, tokens, audit,
and health; the web `app` tree has no admin pages. Treat API presence as implementation, not user
acceptance.

**Tasks:**

- Add admin-only pages for merchant search, suspend/reactivate, current fee, token allowlist,
  pause state, audit history, and health. Hide navigation for non-admins and retain server-side
  authorization on every mutation.
- Mirror on-chain fee/token/pause state from contract reads/events. A database-only change must not
  be presented as effective until its on-chain transaction is confirmed and the readback matches.
- Require a second confirmation for suspend, fee changes, token removal, and pause/unpause. Display
  signer/transaction reference and append the actor/action/result to the audit trail.
- Show indexer cursor/lag, RPC status, last webhook attempt/failure, and worker/database readiness;
  mark stale data as stale instead of displaying it as healthy.

**Acceptance evidence:** FR-ADM-1 through FR-ADM-4 pass for both allowed and denied roles; admin
mutations have audit entries and chain readback. Health indicators distinguish unavailable from
zero activity.

### 5. Settlement, Reconciliation, and Webhook Operations UI

**Lead:** SE2. **Support:** SE3, DevOps3, DevOps2.

**Current state:** settlement and CSV APIs exist; a database-backed webhook queue is documented in
ADR 0002. Reconciliation and delivery-operation views are not present in the web route tree.

**Tasks:**

- Build a date-range settlement report with token, payment count, gross, fee, net, and refunds.
  Add CSV download with UTF-8 BOM, ISO 8601 UTC timestamps, and a clear range in the filename.
- Add reconciliation view comparing indexed database totals to on-chain totals for a selected
  range/token. Document block range, confirmation cutoff, handling of reorged/late payments, and
  expected tolerances; never silently “correct” ledger data from a report screen.
- Build webhook delivery history with event ID/sequence, attempt, HTTP status, duration, next retry,
  and a redacted error. Expose test/resend only through an authenticated, audited operation with
  duplicate delivery semantics documented.
- Verify retention and failure-disable behavior against worker code and schema; either implement
  the seven-day disable policy or update the runbook/SRS mapping if it is not a Must requirement.

**Acceptance evidence:** FR-SET-1 through FR-SET-4 and FR-WH-6/7 pass. CSV totals equal the report;
reconciliation explains every intentional difference; webhook retries preserve event identity and
sequence.

### 6. Database/Anvil Integration and Acceptance Tests

**Lead:** DevOps2. **Support:** SE3, DevOps3, SE1, SE2.

**Tasks:**

- Provide a Docker-capable local/CI path for PostgreSQL and Anvil; wait for health checks before
  migrations or tests. Redis is not required under the accepted database-backed queue ADR.
- Add API integration tests for SIWE nonce reuse/expiry, invoice idempotency, merchant scoping,
  cancellation, expiry, payout signature, webhook signing/retry, and CSV export.
- Add an Anvil end-to-end harness that deploys contracts, seeds tUSDC/merchant data, creates an
  invoice, pays it, indexes the event, restarts the indexer, introduces a reorg where practical,
  and verifies webhook delivery.
- Add checkout/dashboard Playwright coverage for sign-in, create invoice, wrong network, exact
  approval, paid status, refund, and responsive layout. Mock RPC only for component tests; at least
  one staging-like flow must use a real local Anvil node.
- Make CI run the integration suite in an isolated database/chain and clean up deterministically.

**Acceptance evidence:** AC-1 through AC-10 and AC-12 through AC-14 have automated local or CI
coverage. Indexer restart/replay produces no duplicate payments/webhook sequences. Record which
acceptance scenarios remain staging-only.

### 7. Contract Security and Deployment Verification

**Lead:** SE1. **Support:** DevSecOps, DevOps1/4.

**Current state:** local unit/fuzz/invariant tests pass; the `pay` gas snapshot is 137,339. Slither
is not installed in the current environment, and explorer verification requires a testnet deploy.
Coverage is not yet measured against SC-9's 95% target.

**Tasks:**

- Measure Foundry line/branch coverage; close gaps or document justified exclusions until SC-9's
  ≥95% line threshold is met.
- Run Slither in a pinned, reproducible environment; triage every finding and block unresolved
  high/medium issues in CI. Keep static analysis separate from a claim of formal audit.
- Re-run fuzz/invariant tests in CI/nightly and preserve the zero-contract-balance invariant and
  one-payment-per-reference checks.
- Deploy reviewed sources to Base Sepolia using a controlled signer, record chain ID, addresses,
  deployment block, transaction hashes, compiler/settings, and ABI version in the manifest; verify
  source on the explorer.
- Confirm contract owner/treasury/token/fee configuration and create the multisig transfer plan.
  Never place deployment keys in web, indexer, worker, or CI runtime environments.

**Acceptance evidence:** SC-1 through SC-13 pass; SC-9 coverage and SC-10 Slither/source verification
have attached outputs; deployment manifest matches on-chain reads. Any security exception has an
owner, mitigation, and explicit approval.

### 8. Staging, Observability, Runbook, and Final Demo

**Lead:** DevOps1/4. **Support:** DevOps2, DevOps3, DevSecOps, all workstream leads.

**Tasks:**

- Publish separate local/staging/demo environment templates and a secrets checklist. Validate
  chain ID, token/processor addresses, RPC providers, confirmation depth, APP_URL, database URL,
  webhook encryption key, and admin wallet list at deployment/startup.
- Make the local demo path reproducible with one documented command sequence, migrations, deploy
  script, seed data, pre-funded Anvil wallets, and a sample HTTPS webhook receiver. Include a safe
  reset path that cannot target a staging/production database accidentally.
- Add structured service metrics for indexer lag, processed blocks, RPC failures, queue backlog,
  webhook attempts/failures, API latency, and database health. Add alert thresholds and dashboard
  panels before enabling staging traffic.
- Implement daily backups and complete one restore drill. Add container/image scanning, non-root
  runtime checks, SBOM, TLS/security header checks, and staging ZAP baseline.
- Run k6 smoke against the agreed 100 concurrent checkout / 20 payments-per-minute staging target;
  report correctness, p95 latency, indexer lag, and webhook delivery rate, not just throughput.
- Update README, OpenAPI, runbook, demo script, phase checklist, and traceability statuses to match
  implemented and staging-verified behavior. Keep the deployment manifest/ABI version consistent.
- Execute the full demo script three consecutive times on Base Sepolia. Record run ID, timestamp,
  network, contract addresses, outcome, and any manual intervention.

**Acceptance evidence:** NFR-1/2/3/OBS/PERF, DEV-2 through DEV-10, and Gate 4 have evidence. All
Must acceptance scenarios are `verified` on staging, no open high/critical security findings
remain, restore drill passes, and three demos complete without manual fixes.

## Execution Order and Handoffs

1. **Unblock shared environment:** DevOps1/4 supplies a Docker-capable CI/local target and valid
   staging configuration. SE1 supplies the verified testnet manifest when deployment is approved.
2. **Parallel P0 implementation:** SE2 completes checkout/dashboard/settings UI; SE3 closes any API
   gaps; DevOps2 and DevOps3 wire integration tests and event/webhook evidence; SE1/DevSecOps finish
   contract security evidence.
3. **Integrate by acceptance path:** create invoice → customer pay → indexed confirmation → webhook
   → dashboard timeline → refund → reconciliation/CSV. Fix failures at the owning boundary before
   adding more UI.
4. **P1 operations UI:** admin console and webhook/reconciliation surfaces consume stable APIs and
   on-chain readback; avoid UI-only state for chain controls.
5. **Gate 4:** DevOps1/4 coordinates security, performance, backup/restore, docs, and three clean
   demo runs. Release approval is based on evidence, not checklist checkmarks alone.

## Team Definition of Done

- Each task has a named implementer/reviewer, linked PRs, and automated acceptance evidence.
- No user-facing amount is calculated using floating-point arithmetic; JSON amounts remain decimal
  base-unit strings.
- Merchant data access is scoped server-side; chain state remains the payment source of truth.
- Every Must requirement is `verified` on staging, and no high/critical security finding is open.
- The demo script passes three consecutive times; README, OpenAPI, runbook, and deployment manifest
  are current and independently usable.

## Suggested First Sprint Board

| Order | Owner                 | First deliverable                                                       | Blocks                                |
| ----- | --------------------- | ----------------------------------------------------------------------- | ------------------------------------- |
| 1     | DevOps1/4             | Docker-capable integration runner + validated staging env checklist     | Integration tests, real UI validation |
| 2     | SE1 + DevSecOps       | Coverage report, Slither run, Base Sepolia deployment/verification plan | Real payment acceptance               |
| 3     | SE2                   | Checkout acceptance fixes + invoice timeline/detail                     | AC-3/4/5, customer demo               |
| 4     | SE3 + DevOps2/3       | DB/Anvil integration suite and replay/reorg evidence                    | Gate 2 and Gate 3 confidence          |
| 5     | SE2 + SE3             | Merchant settings and refund UI/API completion                          | Refund/webhook demo path              |
| 6     | SE2 + SE3             | Settlement/reconciliation and webhook delivery UI                       | AC-7/14, merchant operations          |
| 7     | SE2 + SE3             | Admin UI backed by on-chain readback and audit trail                    | Admin acceptance                      |
| 8     | DevOps1/4 + all leads | Observability, restore drill, docs, three-run staging demo              | Gate 4 release decision               |
