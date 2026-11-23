# Security Policy & Guardrail Model

## Scope

This repository (**CapRail**, `https://github.com/takaolovely/caprail`) implements a **Guardrailed Auto-DCA & Revenue Splitter** agent targeting **Celo Mainnet (`Chain ID 42220`)** with **Altana Non-Custodial Agent Wallets (Session Keys)**.

## Explicit Trust Boundary: Local Simulation vs. On-Chain Enforcement

Every execution log and adapter output explicitly tags its execution mode:

| Mode | Adapter | Enforcement Layer | What It Proves |
| :--- | :--- | :--- | :--- |
| `LOCAL_SIMULATION` | `LocalSessionSimulator` | Deterministic TypeScript policy evaluator | Validates application pre-flight logic, basis-point math, audit logging, and negative test paths without spending gas or holding keys. **Does NOT constitute an on-chain smart-contract revert.** |
| `CELO_MAINNET` | `AltanaLiveAdapter` | Pre-flight policy check + Altana on-chain KeyStore session key (`spendCap`, `allowedTargets`, `expiry`, `1-tx revoke`) | On-chain enforcement at the Altana smart wallet / KeyStore level on Celo Mainnet (`42220`). |

## Guardrails Enforced

1. **Per-Transaction & Cumulative Spend Caps:** `amount > spendCapPerTx` or `spentTotal + amount > totalSpendCap` is deterministically blocked before signing (and enforced on-chain by Altana session spend permissions in `CELO_MAINNET` mode).
2. **Strict Target Allowlist:** Only explicitly allowlisted routers (for Auto-DCA) and recipients (for Revenue Split) may be called. Any unknown address is rejected.
3. **Deterministic Split Accounting:** `SplitStrategy` requires recipient shares to be strictly positive integers summing to **exactly `10000` basis points (100.00%)**, with no duplicate recipient addresses.
4. **Time-Bounded Sessions & 1-Tx Revocation:** Expired sessions (`now >= expiresAt`) and revoked sessions (`revoked === true`) are rejected immediately.
5. **Attribution Integrity:** Live Celo Mainnet wallet clients wrap transactions with `@celo/attribution-tags` (ERC-8021) when an attribution code is configured.

## Secrets & Environment Hygiene

* `.gitignore` blocks `.env`, `.env.*` (except `.env.example`), `*.key`, `*.pem`, `*private*`, `*secret*`, `*mnemonic*`, and `*keystore*.json`.
* Private keys, session keys, and raw environment dumps are **never** printed to stdout, stderr, or structured audit logs.
* Configuration loading reads only an explicit allowlist of environment keys (`src/config/env.ts`) and never forwards unfiltered `process.env` into child processes.
* Read-only CLI commands (`npm run check:network`, `npm run dry-run`, `npm test`) require **zero** private keys.

## Reporting Security Issues

Do not open public issues with live private keys or exploitable mainnet session keys. Revoke compromised Altana session keys immediately via `revokeSession()` (1-tx KeyStore revocation) before rotating keys.
