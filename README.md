# CapRail — Guardrailed Auto-DCA & Revenue Splitter (Altana Agent Wallet)

**Repository:** `https://github.com/takaolovely/caprail`  
**Target Network:** Celo Mainnet (`Chain ID 42220`)  
**ERC-8021 Builder Attribution Tag:** `celo_cbf00f366dda` (derived deterministically from `takaolovely/caprail` via `@celo/attribution-tags`)  
**ERC-8004 Identity Registry (Celo Mainnet):** `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`

**CapRail** is a non-custodial autonomous treasury agent (**Auto-DCA** + **Multi-Party Revenue Splitter**) built for the **Celo "Agents Open for Business" Hackathon** (**Altana Agent Wallet** track). It replaces raw-private-key bots and manual recurring signing with scoped on-chain **Altana Session Keys** (`spendCap`, strict `allowedTargets`, `expiry`, and `1-tx revoke`) backed by deterministic pre-flight policy validation.

> **Honesty Boundary (`LOCAL_SIMULATION` vs. `CELO_MAINNET`):**
> * `npm run dry-run` and `npm test` execute against `LocalSessionSimulator` (`MODE: LOCAL_SIMULATION`). They deterministically verify policy validation, 10000-bps split math, structured audit logging, and negative-test rejection logic without spending gas or holding keys. **Local simulation results are NOT on-chain smart-contract reverts.**
> * Live Celo Mainnet (`42220`) enforcement runs through `AltanaLiveAdapter` backed by `@altananetwork/sdk` (`v1.1.0`) non-custodial session keys, Altana's Celo KeyStore (`0x83b30935f36d6ccf9B1ec3b5E47F2866b97cd27c`), `viem`, and `@celo/attribution-tags` (`v0.5.0`, ERC-8021).

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
│   │   ├── attribution.ts             # @celo/attribution-tags (ERC-8021) for takaolovely/caprail (celo_cbf00f366dda)
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
```

## Security

See [SECURITY.md](./SECURITY.md) for threat model, secrets handling, and guardrail enforcement details.
