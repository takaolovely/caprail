<p align="left">
  <img src="./assets/logo.png" alt="CapRail logo" width="56" height="56" />
</p>

# CapRail: Guardrailed Auto-DCA (USDC -> CELO) on Celo Mainnet

**Live Control Plane:** https://caprail.vercel.app · **Launch App:** https://caprail.vercel.app/#app · **Judge & Proof Console:** https://caprail.vercel.app/#verify  
**Repository:** `https://github.com/takaolovely/caprail`  
**Target Network:** Celo Mainnet (`Chain ID 42220`)  
**Primary Agent Wallet (Celo Mainnet):** [`0x3631D44543384253C099f2A09c0D0bE109Eb7944`](https://celoscan.io/address/0x3631D44543384253C099f2A09c0D0bE109Eb7944)  
**ERC-8021 Builder Attribution Tag:** `celo_0518175d3efe` (official Loops House attribution tag encoded via `@celo/attribution-tags`)  
**ERC-8004 Identity Registry (Celo Mainnet):** `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`

CapRail is a non-custodial **Guardrailed Auto-DCA (`USDC -> CELO`)** system built for the **Celo "Agents Open for Business" Hackathon** (**Altana Agent Wallet** track). It lets wallet owners delegate recurring Uniswap V3 `SwapRouter02` swaps to autonomous agents using scoped **Altana EIP-7702 Session Keys** (`spendCap`, strict `SwapRouter02` allowlist, slippage floor, expiry, and `1-tx revoke`) without exposing the owner's master private key.

---

## Two-Plane Architecture

CapRail separates owner control from automated agent execution across two explicit planes:

1. **Human Control Plane (`https://caprail.vercel.app`):** Non-custodial web interface for wallet owners to configure per-trade and cumulative USDC spend caps, inspect raw ERC-8021 tagged calldata and audit telemetry, run zero-gas local simulations or live Celo Mainnet swaps, and trigger a **1-tx emergency revoke**.
2. **Agent Execution Plane (Agent-agnostic CLI + [`SKILL.md`](./SKILL.md)):** Designed so any autonomous agent (with our self-hosted VPS agent **Hermes** as the live reference runner) can run `npm run dca:tick` to evaluate live pool conditions (`EXECUTE` / `DEFER`), write block-anchored audit records (`blockNumber` + raw `sqrtPriceX96`) to `logs/decisions.jsonl`, and execute bounded `USDC -> CELO` swaps without holding the owner's master private key.

---

## Agent Decision Gate (`dca:tick`) & Verifiable Audit Log

The Agent Execution Plane (`src/cli/dca-tick.ts`, documented in [`SKILL.md`](./SKILL.md)) evaluates live Celo Mainnet Uniswap V3 `USDC/CELO` (`0.01%`, `fee = 100`) pool state before every 4-hour `$0.50` USDC tick (bounded by the `$2.00/day` Altana on-chain spend cap):

* **Dual Slippage Guardrail:**
  * **Pre-flight (`5 bps` / `0.05%` default):** Estimates single-tick price impact from live `liquidity()` and `sqrtPriceX96`. Orders exceeding `5 bps` return `DEFER` (`POOL_IMPACT_EXCEEDED`).
  * **Execution (`25 bps` / `0.25%` default):** Applies a `25 bps` buffer to `SwapRouter02.exactInputSingle` `amountOutMinimum` so valid swaps do not revert from intra-block price movement.
* **Asymmetric 24h TWAP Gate (`+50 bps`):** Computes `deviationBps = ((spot - twap24h) / twap24h) * 10000` using `pool.observe([86400, 0])` (falling back to rolling 24h `logs/decisions.jsonl` average, then spot on cold start). Upside spikes above `+50 bps` return `DEFER`; dips (`< 0 bps`) and moves `<= +50 bps` return `EXECUTE`.
* **Weekly Ceiling Circuit Breaker (`+15%`):** Returns `DEFER` if spot exceeds `+15%` above the 7-day session anchor price.
* **Block-Anchored Audit Trail (`logs/decisions.jsonl`):** Every tick appends a JSON line recording `blockNumber`, `poolAddress`, raw `sqrtPriceX96`, `spotPriceUsdcPerCelo`, `twap24hUsdcPerCelo`, `deviationBps`, `estimatedPoolImpactBps`, `decision` (`EXECUTE` / `DEFER` / `HALTED_NO_GAS`), `reason`, and `txHash`.

---

## Honesty Boundary

### 1. Execution Mode: `LOCAL_SIMULATION` vs `CELO_MAINNET`
* `npm run dry-run`, `npm test`, and the web **Sandbox** mode run against `LocalSessionSimulator` (`MODE: LOCAL_SIMULATION`). They deterministically verify Zod schemas, spend-cap accounting, slippage bounds, audit logging, and negative-test rejection paths without spending gas or holding keys. **Local simulation rejections are NOT on-chain smart-contract reverts.**
* Live Celo Mainnet (`Chain ID 42220`) execution runs through `AltanaLiveAdapter` backed by `@altananetwork/sdk` (`v1.1.0`), Altana's Celo KeyStore (`0x83b30935f36d6ccf9B1ec3b5E47F2866b97cd27c`), `viem`, and `@celo/attribution-tags` (`v0.5.0`, ERC-8021).

### 2. Enforcement Layer: On-Chain vs Off-Chain
* **On-chain enforcement (Altana EIP-7702 Session Key):** Cumulative USDC `spendCap`, contract target allowlist (`SwapRouter02`), permitted selector (`exactInputSingle`), recipient locked to owner address, session expiry, and permanent **1-tx revoke** at the Altana KeyStore level. Even if an agent prompt is compromised, Altana rejects unauthorized calls on-chain (`[call_not_permitted]`, `[spend_limit_exceeded]`).
* **Off-chain agent policy (TypeScript / Zod pre-flight):** Per-transaction cap check (`spendCapPerTx`), minimum interval cadence (`intervalSeconds`), on-chain `simulateContract` quote check for `maxSlippageBps` (`1.00%` default), and structured JSON audit logging.

---

## Celo Mainnet Liquidity Reality (Verified On-Chain, Nov 23, 2026)

CapRail intentionally restricts its active allowlist to a single verified pair: **`USDC -> CELO`** on Uniswap V3 `SwapRouter02` (`0x5615CDAb10dc425a742d643d949a7F474C01abc4`, `0.01%` fee tier).

| Pair (Celo Mainnet) | Uniswap V3 Fee Tiers Checked | Verified On-Chain State (Nov 23, 2026) | Policy Status |
| :--- | :--- | :--- | :--- |
| **`USDC / CELO`** | `0.01%`, `0.05%`, `0.30%`, `1.00%` | `0.01%` pool holds ~6,239 USDC + 110,378 CELO (~$12.4k TVL). Higher fee tiers hold negligible liquidity. | **Allowlisted (Active)** |
| **`USDC / WETH`** | `0.01%`, `0.30%` | Pools exist on-chain, but active liquidity `L = 0` (zero executable depth). | **Blocked** |
| **`USDC / WBTC`** | All tiers | No canonical WBTC token contract and zero Uniswap V3 pools on Celo Mainnet. | **Blocked** |

Thin DEX liquidity on Celo Mainnet is the practical engineering reason autonomous agents require hard spend caps and on-chain slippage floors (`amountOutMinimum`). Any future asset addition is strictly liquidity-gated.

---

## Verified Celo Mainnet Proof (Chain ID `42220`)

Executed live on **Celo Mainnet (`42220`)** using `@altananetwork/sdk@1.1.0` EIP-7702 session keys, Uniswap V3 `SwapRouter02`, and `@celo/attribution-tags@0.5.0` (active runtime configured with official Loops House tag `celo_0518175d3efe`):

| Step | Action | Verification / Celoscan Proof |
| :--- | :--- | :--- |
| **1. Session Grant** | Scoped 1h Altana EIP-7702 Session Key (`0.15 USDC` per-tx, `0.30 USDC` total, allowlisted target) | [0x928012be...ae8f954a](https://celoscan.io/tx/0x928012be32adf147c343ab658b26ccef5e4928eafeb48ce2d8849931ae8f954a) |
| **2. Live Auto-DCA Swap** | Guardrailed `USDC -> CELO` swap via Uniswap V3 `SwapRouter02` with slippage floor | `0x0c5d57fc...` (live Celo Mainnet execution; full Celoscan link tracked with deployment log) |
| **3. ERC-8021 Attribution Verification Transfer** | Historical live `0.05 USDC` transfer verifying ERC-8021 calldata suffix decoding on Celo Mainnet *(executed prior to upgrading default runtime tag to `celo_0518175d3efe`)* | [0xcb30c996...dbf1c27](https://celoscan.io/tx/0xcb30c9969a2816bbffee446c17eaf840ccd57548656f97f845013e6c1dbf1c27) |
| **4. Negative Tests (On-Chain)** | Direct Altana Relay / KeyStore calls bypassing TypeScript pre-flight: un-allowlisted USD₮ call and `0.35 USDC > 0.30 USDC` over-cap spend | Rejected on-chain by Altana: `[call_not_permitted]` and `[spend_limit_exceeded]` |
| **5. 1-Tx Emergency Revoke** | Instant KeyStore session key revocation (`revokeSession`) | [0x1455448c...4302d320](https://celoscan.io/tx/0x1455448cb2fedd67aa7e46591328c09b4f75d3062f254b52dc429b624302d320) |

**External User Testing:** External user mainnet onboarding is in progress and will be linked with verified Celoscan receipts in a subsequent update.

---

## Mainnet Engineering Log (What Broke & Fixes)

1. **Uniswap V3 `'STF'` revert on unconfirmed approval:** Broadcasting `exactInputSingle` before the ERC-20 `USDC.approve(SwapRouter02, amountIn)` transaction mined caused `TransferHelper.safeTransferFrom` to revert with `'STF'`. Fixed in `web/src/lib/liveWallet.ts` by checking `balanceOf` + `allowance` first and strictly awaiting `publicClient.waitForTransactionReceipt({ hash: approveHash })` before submitting the swap.
2. **Wallet 100% slippage warning on minimal `amountOutMinimum`:** Encoding a placeholder `1n` floor triggered Rabby Wallet's 100.00% slippage alert. Fixed in `src/wallet/calldata.ts` (`computeMinAmountOut` + required `amountOutMinimum` / `quotedAmountOut`) and `web/src/lib/liveWallet.ts` (`publicClient.simulateContract` live on-chain quote before signing).
3. **Altana EIP-7702 stale auth nonce loop:** Re-calling `createWallet()` on an already upgraded EOA threw `Invalid auth item nonce`. Fixed in `src/wallet/altanaLive.ts` via on-chain `getCode` inspection and `resolveOrProvisionAltanaWallet` reuse.
4. **ERC-8021 builder attribution upgrade:** Upgraded default attribution encoding across `src/`, `web/`, and `tests/` to the official Loops House tag `celo_0518175d3efe`.

---

## Security & Failure-Mode FAQ

1. **What happens if the session key leaks?**  
   Blast radius is strictly bounded by the remaining Altana on-chain `totalSpendCap`. The key can only call `SwapRouter02.exactInputSingle` with swap output returning to the owner address, cannot transfer funds to attacker addresses, and is permanently invalidated in 1 revoke transaction from the owner's admin key.
2. **Why EIP-7702 (`authorizationList`) instead of a smart contract wallet?**  
   The owner keeps their existing EOA address and balances without migrating assets into a separate proxy smart account, and the EIP-7702 delegation remains revocable by the EOA owner.
3. **What permanently breaks CapRail?**  
   Liquidity being withdrawn from the Celo Mainnet `USDC/CELO` `0.01%` Uniswap V3 pool, Altana discontinuing Celo Mainnet relay/KeyStore support, or Uniswap deprecating `SwapRouter02` (`0x5615CDAb10dc425a742d643d949a7F474C01abc4`) on Celo.

---

## Verified Installed SDKs

| Package | Version | Role |
| :--- | :--- | :--- |
| `@altananetwork/sdk` | `1.1.0` | Non-custodial Altana Agent Wallet (`createClient({ chains: [CELO_MAINNET_ONLY] })`), on-chain EIP-7702 session keys (`grantSession`, `execute`, 1-tx `revokeSession`), Celo ERC-8004 helpers |
| `@celo/attribution-tags` | `0.5.0` | ERC-8021 builder attribution tags (`toDataSuffix`, `fromDataSuffix`, `withAttribution`) |
| `viem` | `2.58.4` | Celo Mainnet (`42220`) RPC client, `simulateContract` quoting, and ABI calldata encoding |
| `zod` | `4.6.7` | Strict deterministic schema validation for `SessionPolicy` and `DcaStrategy` |

## Project Structure

```text
.
├── src/
│   ├── config/env.ts                  # Allowlisted env loader (no raw process.env forwarding)
│   ├── policy/                        # Zod schemas (SessionPolicy, DcaStrategy) + guardrail evaluator
│   ├── wallet/
│   │   ├── attribution.ts             # @celo/attribution-tags (ERC-8021) Loops House tag (celo_0518175d3efe)
│   │   ├── calldata.ts                # SwapRouter02 exactInputSingle + slippage floor + ERC-8021 suffix
│   │   ├── localSimulator.ts          # Deterministic LOCAL_SIMULATION adapter
│   │   └── altanaLive.ts              # Live CELO_MAINNET adapter (@altananetwork/sdk + nonce recovery)
│   ├── engine/
│   │   ├── auditLog.ts                # Structured JSON audit telemetry
│   │   ├── autoDcaEngine.ts           # AutoDcaEngine (cadence, slippage, spend cap guardrails)
│   │   ├── decisionGate.ts            # Pure EXECUTE/DEFER market gate + Uniswap V3 pool reader
│   │   └── decisionLog.ts             # Block-anchored JSONL logger (logs/decisions.jsonl)
│   ├── identity/
│   │   ├── erc8004.ts                 # Celo Mainnet ERC-8004 registration helpers
│   │   └── agent-card.json            # ERC-8004 Agent Identity Card template
│   └── cli/
│       ├── check-network.ts           # Read-only Celo Mainnet (42220) + Altana SDK probe
│       ├── dry-run.ts                 # Local simulation runner (positive + negative Auto-DCA tests)
│       ├── grant-session.ts           # Owner-only one-time Altana session provisioning CLI
│       ├── dca-tick.ts                # Session-only agent CLI runner (--dry-run / --live)
│       └── live-test.ts               # Live Celo Mainnet session grant, verification tx, negative tests, 1-tx revoke
├── web/                               # Human Control Plane (React 19 + Vite + Tailwind + viem)
├── tests/
│   ├── guardrails.test.ts             # Policy, Auto-DCA, slippage, Altana, ERC-8021, ERC-8004 tests
│   └── decisionGate.test.ts           # Decision gate (TWAP, dual slippage, weekly ceiling, JSONL log) tests
├── SKILL.md                           # Agent-agnostic runner interface specification
├── .env.example                       # Placeholder env template (zero secrets)
└── SECURITY.md                        # Guardrail model & secrets hygiene policy
```

## Quick Start (Zero Keys Required for Local Verification)

```bash
npm install
npm run typecheck
npm test
npm run dry-run
npm run dca:tick -- --dry-run
npm run check:network
npm run web:build
```

Live Celo Mainnet session-key smoke test (explicitly gated by `--confirm-mainnet` and local `.env`):

```bash
npm run live:test -- --confirm-mainnet
```
