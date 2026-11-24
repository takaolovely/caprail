# Security Policy & Guardrail Model

## Scope

This repository (**CapRail**, `https://github.com/takaolovely/caprail`) implements a **Guardrailed Auto-DCA (`USDC -> CELO`)** agent targeting **Celo Mainnet (`Chain ID 42220`)** via Uniswap V3 `SwapRouter02` with **Altana Non-Custodial Agent Wallets (EIP-7702 Session Keys)**.

## Explicit Trust Boundary: Local Simulation vs. On-Chain Enforcement

Every execution log and adapter output explicitly tags its execution mode:

| Mode | Adapter | Enforcement Layer | What It Proves |
| :--- | :--- | :--- | :--- |
| `LOCAL_SIMULATION` | `LocalSessionSimulator` | Deterministic TypeScript policy evaluator | Validates application pre-flight logic, slippage bounds, audit logging, and negative test paths without spending gas or holding keys. **Does NOT constitute an on-chain smart-contract revert.** |
| `CELO_MAINNET` | `AltanaLiveAdapter` | Pre-flight policy check + Altana on-chain KeyStore session key (`spendCap`, `allowedTargets`, `expiry`, `1-tx revoke`) | On-chain enforcement at the Altana smart wallet / KeyStore level on Celo Mainnet (`42220`). |

## Guardrails Enforced

1. **Per-Transaction & Cumulative Spend Caps:** `amount > spendCapPerTx` or `spentTotal + amount > totalSpendCap` is deterministically blocked before signing (and enforced on-chain by Altana session spend permissions in `CELO_MAINNET` mode).
2. **Strict Target Allowlist:** Only the allowlisted Uniswap V3 `SwapRouter02` (`0x5615CDAb10dc425a742d643d949a7F474C01abc4`) and `exactInputSingle` call are permitted for DCA swaps. Any unknown contract or unlisted token is rejected.
3. **Slippage Floor & Cadence Checks:** `DcaStrategy` enforces `maxSlippageBps` (`1.00%` default derived from on-chain `simulateContract` quotes) and `intervalSeconds` before submitting a swap.
4. **Time-Bounded Sessions & 1-Tx Revocation:** Expired sessions (`now >= expiresAt`) and revoked sessions (`revoked === true`) are rejected immediately.
5. **Attribution Integrity:** Live Celo Mainnet transactions append and verify the ERC-8021 builder attribution suffix (`celo_0518175d3efe`) via `@celo/attribution-tags`.

## Secrets & Environment Hygiene

* `.gitignore` blocks `.env`, `.env.*` (except `.env.example`), `*.key`, `*.pem`, `*private*`, `*secret*`, `*mnemonic*`, and `*keystore*.json`.
* Private keys, session keys, and raw environment dumps are **never** printed to stdout, stderr, or structured audit logs.
* Configuration loading reads only an explicit allowlist of environment keys (`src/config/env.ts`) and never forwards unfiltered `process.env` into child processes.
* Read-only CLI commands (`npm run check:network`, `npm run dry-run`, `npm test`) require **zero** private keys.

## Reporting Security Issues

Do not open public issues with live private keys or exploitable mainnet session keys. Revoke compromised Altana session keys immediately via `revokeSession()` (1-tx KeyStore revocation) before rotating keys.
