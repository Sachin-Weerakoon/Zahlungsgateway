# ADR 0001 — Monorepo and toolchain

**Status:** accepted · **Date:** 2026-11-11 · **Phase:** 0

## Context

The SRS requires a monorepo with packages for web, indexer, contracts and shared types, strict
TypeScript, CI enforcement, and a stack that starts with one command. The target machine has
Node.js 24 and npm 11; pnpm, Docker and Foundry are not installed yet.

## Decision

1. **npm workspaces** for the monorepo. pnpm is unavailable and adding a second package manager
   increases setup friction without a functional benefit for this size.
2. **Foundry** for Solidity (SRS allows Foundry or Hardhat). Fuzz and invariant tests are mandatory
   (SC-9, SC-11), and Foundry is the stronger tool for them.
3. **Prisma** as the ORM with a single PostgreSQL schema in `packages/db`.
4. **Vitest** for unit/integration tests and **Playwright** later for end-to-end tests.
5. **Compiled shared package.** `@cryptopay/shared` builds to `dist` with `tsc` because Turbopack
   does not resolve NodeNext `.js` specifiers to TypeScript sources. Root `build`, `typecheck` and
   `test` scripts build it first. Services and the web app consume the compiled package.
6. **No wallet libraries in Phase 0.** wagmi/viem/RainbowKit are added in Phase 3 with the
   checkout, keeping the foundation build fast and stable.

## Consequences

- One `npm install` at the root installs every workspace.
- CI runs lint, typecheck, tests, build and security gates on every pull request.
- Docker Compose supplies PostgreSQL, Redis and a local Anvil chain.
- Foundry must be installed before Phase 1; the deployment workflow is manual and reviewed.
