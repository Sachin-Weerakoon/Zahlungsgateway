# CryptoPay Gateway

Non-custodial stablecoin payment gateway for merchants, built for **public testnets only**.
Customers pay from their own wallet through a smart contract; the platform never holds funds
and the chain is the source of truth for payments.

> Test tokens have no monetary value. No mainnet keys or real funds belong in this repository.

## Stack

| Layer              | Technology                                               |
| ------------------ | -------------------------------------------------------- |
| Web app + REST API | Next.js (App Router), React, TypeScript                  |
| Contracts          | Solidity, Foundry, OpenZeppelin                          |
| Indexer / worker   | Node.js, viem, BullMQ                                    |
| Data               | PostgreSQL (Prisma), Redis                               |
| Tooling            | npm workspaces, ESLint, Prettier, Vitest, GitHub Actions |

## Repository layout

```
apps/web            Next.js dashboard, checkout and API route handlers
services/indexer    Chain event indexer (polling, confirmations, reorgs)
services/worker     Webhook delivery + scheduled jobs
packages/shared     Domain types, status machine, money + validation helpers
packages/db         Prisma schema and client
contracts           Foundry project (Phase 1)
docs                Scope, architecture, runbook, demo script, phase plan
```

## Prerequisites

- Node.js 24+ and npm 10+
- Docker Desktop (PostgreSQL, Redis, local Anvil)
- Foundry (contracts, Phase 1): `winget install --id Foundry.Foundry`

## Quick start

```bash
cp .env.example .env
npm install
npm run db:generate
docker compose up -d postgres redis anvil
npm run db:migrate
npm run dev
```

Web app: http://localhost:3000 · Health: http://localhost:3000/api/health

## Scripts

| Command                                               | Purpose                  |
| ----------------------------------------------------- | ------------------------ |
| `npm run dev`                                         | Start the web app        |
| `npm run dev:indexer`                                 | Start the indexer        |
| `npm run dev:worker`                                  | Start the webhook worker |
| `npm run lint` / `npm run typecheck` / `npm run test` | Quality gates            |
| `npm run build`                                       | Build every workspace    |
| `npm run db:generate` / `db:migrate` / `db:studio`    | Prisma workflows         |
| `npm run format`                                      | Prettier                 |

## Documentation

- `docs/00-scope.md` — scope summary, priorities and freeze decisions
- `docs/01-architecture.md` — components, payment lifecycle, status machine
- `docs/02-adr/` — architecture decision records
- `docs/03-runbook.md` — operations and incident procedures
- `docs/04-demo-script.md` — repeatable end-to-end demo
- `docs/05-api-conventions.md` — REST conventions
- `docs/06-phase-plan.md` — phased delivery checklist
