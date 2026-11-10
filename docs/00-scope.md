# Scope (frozen for MVP)

Source: `Crypto Payment Gateway - SRS & FRS` (Nov 10, 2026).

## Product

CryptoPay Gateway lets a merchant accept stablecoin payments without custodying customer funds.
A merchant creates an invoice, the customer pays from their own wallet through the
`PaymentProcessor` contract, and the platform confirms the payment on-chain and notifies the
merchant by signed webhook.

## In scope

- Merchant SIWE wallet login, sessions, admin list, API keys, payout address.
- Invoices with UUID + 32-byte on-chain reference, idempotency, expiry and status machine.
- Public hosted checkout at `/pay/{invoiceId}` with wallet connect, approve + pay and live status.
- `PaymentProcessor` + `TestUSDC` contracts on Base Sepolia (fallback: Ethereum Sepolia).
- Polling indexer: ordered logs, persisted cursor, confirmations, reorg handling, RPC fallback.
- Signed webhooks with retry schedule, delivery log and SSRF protection.
- Merchant dashboard, settlement report, CSV export, refund flow.
- Admin console: merchant status, fee, token allowlist, audit log, health.
- Docker-based delivery, CI quality/security gates, structured logs, metrics and alerts.

## Out of scope

Mainnet or real funds, fiat on/off-ramps, cards, bank payouts, formal KYC/AML, tax reporting,
regulated custody, cross-chain/bridging, native mobile apps.

## Priority freeze

- **Must (demo-blocking):** all `M` requirements from SRS sections 4-10.
- **Should:** implemented only after every `M` item passes acceptance.
- **Could:** explicitly deferred (native ETH payments, EIP-712 quotes, dark theme, email/Slack
  summaries, mobile WalletConnect QR, indexer re-scan UI, IaC beyond the compose baseline).

## Deliberate MVP decisions

1. **Contracts:** Foundry (SRS permits Foundry or Hardhat). Fuzz and invariant tests are required
   by SC-9/SC-11.
2. **Toolchain:** npm workspaces because pnpm is unavailable in the target environment.
3. **Single network per environment.** The UI displays the configured chain; fallback RPC is a
   backend concern. Runtime multi-chain switching is deferred.
4. **Status machine:** the SRS mentions 13 transitions but its prose implies 12 (three from
   CREATED, two from PENDING, four from CONFIRMING, one from each settled state). This repository
   implements the 12 transitions documented in `packages/shared/src/status-machine.ts` and treats
   EXPIRED, CANCELLED and REFUNDED as final. Resolve with the SRS owner before Phase 2 exit.
5. **Webhook secrets** are encrypted at rest with `WEBHOOK_ENCRYPTION_KEY`; API keys are hashed.
6. **No transaction-signing keys** in web, indexer or worker. Contract deployment is manual.

## Definition of done

Every `M` requirement passes its acceptance scenario on staging; no open high/critical security
finding; the demo script runs three times in a row without manual fixes; README, OpenAPI file and
runbook are present and validated by someone who did not write them.
