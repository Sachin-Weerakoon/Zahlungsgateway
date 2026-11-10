# Contracts (Phase 1)

This directory holds the Foundry project for `PaymentProcessor` and `TestUSDC`.

Phase 0 only scaffolds the project configuration. Phase 1 adds:

- `src/TestUSDC.sol` — 6-decimal mock ERC-20 with a 1,000-token mint cap per call.
- `src/PaymentProcessor.sol` — fee split, one payment per invoice reference, refunds,
  token allowlist, fee cap and pause controls.
- `test/` — unit, fuzz and invariant tests (including zero contract balance).
- `script/` — deploy and verify scripts writing `deployments/<chainId>.json`.
- `lib/forge-std` and `lib/openzeppelin-contracts` git submodules.

Foundry is not installed on this machine yet. Install it with:

```powershell
winget install --id Foundry.Foundry
```

or follow https://book.getfoundry.sh/getting-started/installation.
