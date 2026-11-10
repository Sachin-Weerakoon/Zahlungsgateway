# Phase plan and checklist

Each phase ends at a gate. A failed gate is fixed before new work starts. The must-have list is
frozen after Phase 0.

## Phase 0 — Foundation (current)

- [x] npm workspace monorepo: web, indexer, worker, shared, db, contracts
- [x] Strict TypeScript, ESLint, Prettier, EditorConfig
- [x] Domain model: enums, constants, invoice status machine, money maths, zod schemas
- [x] PostgreSQL schema with constraints, indexes and audit log
- [x] Service skeletons with validated config, structured logging and health endpoints
- [x] Web app skeleton with testnet banner, security headers and health route
- [x] Docker Compose: PostgreSQL, Redis, local Anvil
- [x] `.env.example`, CI quality/security workflow, gitleaks config
- [x] Scope freeze, architecture, ADR, API conventions, runbook, demo script
- [x] Install dependencies and verify lint, typecheck, tests, build
- [x] Create the initial Prisma migration SQL (`0001_init`)
- [ ] Install Foundry (required before Phase 1)
- [ ] First commit

**Gate 0:** `npm run lint && npm run typecheck && npm run test && npm run build` passes; the schema
validates; scope is frozen.

## Phase 1 — Contracts and event contract

- [ ] `TestUSDC` (6 decimals, 1,000-token mint cap)
- [ ] `PaymentProcessor` (`pay`, `refund`, fee cap, treasury, allowlist, pause)
- [ ] OpenZeppelin SafeERC20, ReentrancyGuard, Pausable, Ownable2Step, custom errors
- [ ] Unit + fuzz + invariant tests (95% lines, zero contract balance)
- [ ] Gas snapshot, Slither clean, source verification
- [ ] Deploy script writing `deployments/<chainId>.json`
- [ ] Export ABI to `@cryptopay/shared`

**Gate 1:** contract behaviour matches SC-1 to SC-13 locally; ABI frozen for the indexer.

## Phase 2 — API, indexer, worker

- [ ] SIWE auth, sessions, admin list, merchant scoping
- [ ] API keys (hash, prefix, revoke), payout address change with signature + audit
- [ ] Invoice create/list/get/cancel, idempotency, expiry job
- [ ] Indexer: ordered polling, cursor, confirmations, reorgs, RPC failover, late payments
- [ ] Webhooks: signing, retries, delivery logs, SSRF checks
- [ ] Integration tests against local Anvil

**Gate 2:** AC-3 to AC-7 foundations pass; indexer restart/replay is safe.

## Phase 3 — Checkout, dashboard, admin

- [ ] Checkout with wallet connect, network switch, approve + pay, SSE, error messages
- [ ] Dashboard overview, invoices, payments, refunds, settings
- [ ] Admin console: merchants, fee, tokens, audit log, health
- [ ] Settlement report, CSV export, reconciliation view
- [ ] Webhook delivery log UI, test/resend

**Gate 3:** AC-1 to AC-5, AC-7 to AC-9, AC-12, AC-14 verifiable on staging.

## Phase 4 — Hardening, operations, acceptance

- [ ] Security headers/CSRF/rate limits, dependency and image scans, ZAP baseline
- [ ] Metrics, dashboards, alerts, backups and one restore drill
- [ ] Playwright E2E, k6 load smoke, OpenAPI file finalized
- [ ] Staging/demo deploy workflows, seed scripts, pre-funded demo wallets
- [ ] Run the demo script three times without manual fixes

**Gate 4:** Definition of done satisfied.
