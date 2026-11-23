<p align="left">
  <img src="./assets/logo.png" alt="CapRail logo" width="56" height="56" />
</p>

# CapRail — Guardrailed Auto-DCA & Revenue Splitter (Altana Agent Wallet)

**Live Demo:** https://caprail.vercel.app ·   **Judge & Proof Console:** https://caprail.vercel.app/#verify  
**Repository:** `https://github.com/takaolovely/caprail`  
**Target Network:** Celo Mainnet (`Chain ID 42220`)  
**Primary Agent Wallet (Celo Mainnet):** [`0x3631D44543384253C099f2A09c0D0bE109Eb7944`](https://celoscan.io/address/0x3631D44543384253C099f2A09c0D0bE109Eb7944)  
**ERC-8021 Builder Attribution Tag:** `celo_0518175d3efe` (official Loops House attribution tag encoded via `@celo/attribution-tags`)  
**ERC-8004 Identity Registry (Celo Mainnet):** `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`

**CapRail** is a non-custodial autonomous treasury agent (**Auto-DCA** + **Multi-Party Revenue Splitter**) built for the **Celo "Agents Open for Business" Hackathon** (**Altana Agent Wallet** track). It replaces raw-private-key bots and manual recurring signing with scoped on-chain **Altana Session Keys** (`spendCap`, strict `allowedTargets`, `expiry`, and `1-tx revoke`) backed by deterministic pre-flight policy validation.

> **Honesty Boundary (`LOCAL_SIMULATION` vs. `CELO_MAINNET`):**
> * `npm run dry-run` and `npm test` execute against `LocalSessionSimulator` (`MODE: LOCAL_SIMULATION`). They deterministically verify policy validation, 10000-bps split math, structured audit logging, and negative-test rejection logic without spending gas or holding keys. **Local simulation results are NOT on-chain smart-contract reverts.**
> * Live Celo Mainnet (`42220`) enforcement runs through `AltanaLiveAdapter` backed by `@altananetwork/sdk` (`v1.1.0`) non-custodial session keys, Altana's Celo KeyStore (`0x83b30935f36d6ccf9B1ec3b5E47F2866b97cd27c`), `viem`, and `@celo/attribution-tags` (`v0.5.0`, ERC-8021).

## Verified Celo Mainnet Proof (Chain ID `42220`)

Executed live on **Celo Mainnet (`42220`)** via `npx tsx src/cli/live-test.ts --confirm-mainnet` using `@altananetwork/sdk@1.1.0` EIP-7702 session keys and `@celo/attribution-tags@0.5.0` (active runtime configured with official Loops House tag `celo_0518175d3efe`):

| Step | Action | Verification / Celoscan Proof |
| :--- | :--- | :--- |
| **1. Session Grant** | Scoped 1h Altana Session Key (`0.15 USDC` per-tx, `0.30 USDC` total, `USDC.transfer` allowlist) | [0x928012be...ae8f954a](https://celoscan.io/tx/0x928012be32adf147c343ab658b26ccef5e4928eafeb48ce2d8849931ae8f954a) |
| **2. Attributed Split** | Historical live `0.05 USDC` payout with ERC-8021 suffix on Celo Mainnet *(executed prior to upgrading default runtime tag to Loops House `celo_0518175d3efe`)* | [0xcb30c996...dbf1c27](https://celoscan.io/tx/0xcb30c9969a2816bbffee446c17eaf840ccd57548656f97f845013e6c1dbf1c27) |
| **3. Negative Tests (On-Chain)** | Direct Altana Relay / KeyStore calls bypassing TS pre-flight: un-allowlisted USD₮ call & `0.35 USDC > 0.30 USDC` over-cap spend | Rejected on-chain by Altana: `[call_not_permitted]` & `[spend_limit_exceeded]` |
| **4. 1-Tx Emergency Revoke** | Instant KeyStore session key revocation (`revokeSession`) | [0x1455448c...4302d320](https://celoscan.io/tx/0x1455448cb2fedd67aa7e46591328c09b4f75d3062f254b52dc429b624302d320) |

## Verified Installed SDKs

| Package | Version | Role |
| :--- | :--- | :--- |
| `@altananetwork/sdk` | `1.1.0` | Non-custodial Altana Agent Wallet (`createClient({ chains: [CELO] })`), on-chain session keys (`grantSession`, `execute`, 1-tx `revokeSession`), built-in Celo ERC-8004 helpers |
| `@celo/attribution-tags` | `0.5.0` | ERC-8021 builder attribution tags (`toDataSuffix`, `fromDataSuffix`, `codeFromRepo`, `withAttribution`) |
| `viem` | `2.58.4` | Celo Mainnet (`42220`) RPC client & ABI calldata encoding |
| `zod` | `4.6.7` | Strict deterministic schema validation for `SessionPolicy`, `DcaStrategy`, `SplitStrategy` |

## Project Structure

```text
.
├── src/
│   ├── config/env.ts                  # Explicit allowlist env loader (zero wildcard env forwarding)
│   ├── policy/                        # Zod schemas (SessionPolicy, DcaStrategy, 10000-bps SplitStrategy) + evaluator
│   ├── wallet/
│   │   ├── types.ts                   # Uniform AgentWalletAdapter interface
│   │   ├── attribution.ts             # @celo/attribution-tags (ERC-8021) Loops House tag (celo_0518175d3efe)
│   │   ├── calldata.ts                # Celo Mainnet ERC-20 transfer & Uniswap V3 SwapRouter02 calldata builders + tag verification
│   │   ├── localSimulator.ts          # LocalSessionSimulator (MODE: LOCAL_SIMULATION)
│   │   └── altanaLive.ts              # AltanaLiveAdapter (@altananetwork/sdk + Celo Mainnet 42220)
│   ├── engine/
│   │   ├── auditLog.ts                # Structured JSON audit log (APPROVED / BLOCKED / REVOKED)
│   │   ├── autoDcaEngine.ts           # AutoDcaEngine (cadence, slippage, router & spend-cap guardrails)
│   │   └── revenueSplitterEngine.ts   # RevenueSplitterEngine (exact 10000-bps atomic batch payouts)
│   ├── identity/
│   │   ├── agent-card.json            # ERC-8004 registration-v1 metadata template
│   │   └── erc8004.ts                 # Celo Mainnet ERC-8004 helper (0x8004A169FB4a3325136EB29fA0ceB6D2e539a432)
│   └── cli/
│       ├── check-network.ts           # Read-only Celo Mainnet RPC + Altana SDK probe (zero keys)
│       ├── dry-run.ts                 # End-to-end CLI simulation (positive + negative + revoke)
│       └── live-test.ts               # Guarded Celo Mainnet micro test runner (requires --confirm-mainnet)
└── tests/
    └── guardrails.test.ts             # Vitest suite covering policies, guardrails, attribution & ERC-8004
```

## Quick Start (Zero Private Keys Required)

```bash
npm install
npm run typecheck
npm test
npm run check:network
npm run dry-run
npm run live:test               # Safe preview only (zero tx sent)
npm run live:test -- --confirm-mainnet  # Live Celo Mainnet micro test (requires OWNER_PRIVATE_KEY & TEST_RECIPIENT_ADDRESS in .env)
npm run web:dev                 # Start CapRail Interactive Web UI (Vite dev server)
npm run web:build               # Production build of web/ UI
```

## Security

See [SECURITY.md](./SECURITY.md) for threat model, secrets handling, and guardrail enforcement details.
