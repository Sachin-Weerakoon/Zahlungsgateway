# Contracts (Phase 1)

Foundry project for `PaymentProcessor` and `TestUSDC` (Solidity 0.8.28, Cancun).

- `src/TestUSDC.sol` — 6-decimal mock ERC-20 with a 1,000-token mint cap per call.
- `src/PaymentProcessor.sol` — non-custodial fee split, one payment per invoice reference,
  merchant refunds, token allowlist, fee cap and pause controls.
- `test/` — unit, fuzz and invariant tests (including the zero contract balance invariant).
- `script/Deploy.s.sol` — deploys the token and processor, writes `deployments/<chainId>.json`.
- `lib/forge-std` and `lib/openzeppelin-contracts` — vendored dependencies (git-ignored).

## Install

```powershell
winget install --id Foundry.Foundry
# or: https://book.getfoundry.sh/getting-started/installation

cd contracts
forge install foundry-rs/forge-std@v1.9.7 --no-git
forge install OpenZeppelin/openzeppelin-contracts@v5.6.1 --no-git
```

## Build, test, snapshot

```powershell
forge fmt --check
forge build --sizes
forge test -vv
forge snapshot          # writes .gas-snapshot
```

`pay` is measured at about 137k gas by `test_PayGasUnder150k` (SC-12 target < 150k).

## Design notes

- **Non-custodial:** funds move payer → treasury (fee) and payer → merchant (net) in the same
  transaction. The contract never holds a balance, which the invariant suite asserts.
- **Two-slot payment record:** `merchant + feeBps + refunded` and `payer + gross + tokenIndex`.
  The fee rate is captured at payment time, so later fee changes never alter historical
  payments. Amounts are bounded by `MAX_AMOUNT = type(uint80).max` (about 1.2e24 base units:
  effectively unlimited for 6-decimal stablecoins, ~1.2M tokens for 18-decimal ones).
- **Append-only token registry:** indices are 1-based and never reused, so removing a token from
  the allowlist does not break refunds of earlier payments. Up to 255 tokens are supported.
- **Transient reentrancy guard:** EIP-1153 (`ReentrancyGuardTransient`), available on Base
  Sepolia. Deployment requires a Cancun-capable chain.
- **Fee-on-transfer and rebasing tokens are unsupported.**

## Deploy (Base Sepolia)

```powershell
$env:DEPLOYER_PRIVATE_KEY = "0x..."
$env:TREASURY_ADDRESS = "0x..."
$env:PLATFORM_FEE_BPS = "100"
forge script script/Deploy.s.sol --rpc-url $env:RPC_URL_PRIMARY --broadcast
```

The deploy script writes `deployments/<chainId>.json`; copy the addresses into `.env` and run
`npm run contracts:export-abi` to refresh `packages/shared/src/abi.ts`.

Local smoke test (Anvil account #0, never a real key):

```powershell
anvil --port 8545
$env:DEPLOYER_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
$env:TREASURY_ADDRESS = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
```

This writes `deployments/31337.json`; delete it after the smoke test so a stale local address is
never mistaken for a testnet deployment.
