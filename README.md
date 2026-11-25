<p align="left">
  <img src="./assets/logo.png" alt="CapRail logo" width="56" height="56" />
</p>

# CapRail: Guardrailed Auto-DCA (USDC -> CELO) on Celo Mainnet

**Live Control Plane:** https://caprail.vercel.app · **Launch App:** https://caprail.vercel.app/#app · **Judge & Proof Console:** https://caprail.vercel.app/#verify  
**Repository:** `https://github.com/takaolovely/caprail`  
**Target Network:** Celo Mainnet (`Chain ID 42220`)  
**Primary Agent Wallet (Celo Mainnet):** [`0x3631D44543384253C099f2A09c0D0bE109Eb7944`](https://celoscan.io/address/0x3631D44543384253C099f2A09c0D0bE109Eb7944)  
**ERC-8021 Builder Attribution Tag:** `celo_0518175d3efe` (official Loops House attribution tag encoded via `@celo/attribution-tags`)  
**ERC-8004 Identity Registry (Celo Mainnet):** `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` (Agent ID `#10109`, tx [`0x043cfd11...e18a706`](https://celoscan.io/tx/0x043cfd11e5d698932e7a6efb52ee9122b4edfe747f2c0237793b95c98e18a706))

CapRail is a non-custodial **Guardrailed Auto-DCA (`USDC -> CELO`)** system built for the **Celo "Agents Open for Business" Hackathon** (**Altana Agent Wallet** track). It lets wallet owners delegate recurring Uniswap V3 `SwapRouter02` swaps to autonomous agents using scoped **Altana EIP-7702 Session Keys** (`spendCap`, strict `SwapRouter02` selector `0x04e45aaf` lock, slippage floor, expiry, and `1-tx revoke`) without exposing the owner's master private key.

---

## Two-Plane Architecture

CapRail separates owner control from automated agent execution across two explicit planes:

1. **Human Control Plane (`https://caprail.vercel.app` & local `npm run session:grant`):** Non-custodial owner interface to set daily USDC spend caps, provision bounded owner-side `USDC.approve(SwapRouter02, dailyCap * days)`, inspect raw ERC-8021 tagged calldata and audit telemetry, run zero-gas local simulations or live Celo Mainnet swaps, and trigger a **1-tx emergency revoke**.
2. **Agent Execution Plane (Agent-agnostic CLI + [`SKILL.md`](./SKILL.md)):** Designed so any autonomous agent (with our self-hosted VPS agent **Hermes** as the live reference runner) can run `npm run dca:tick` to evaluate live pool conditions (`EXECUTE` / `DEFER`), write block-anchored audit records (`blockNumber` + raw `sqrtPriceX96`) to `logs/decisions.jsonl`, and execute bounded `USDC -> CELO` swaps without holding the owner's master private key.

---

## Named External User & Mainnet Proof (`@MFauzulAzim`)

An independent external collaborator (`@MFauzulAzim`) completed a live guardrailed `USDC -> CELO` Auto-DCA execution on Celo Mainnet (`Chain ID 42220`) through CapRail's live swap flow with full ERC-8021 `celo_0518175d3efe` builder attribution:

| Field | Verified Celo Mainnet Value |
| :--- | :--- |
| **External User** | `@MFauzulAzim` |
| **Wallet Address** | [`0xfb69ABfADd1A6f1929e988f41D2AAb0d09c48e63`](https://celoscan.io/address/0xfb69ABfADd1A6f1929e988f41D2AAb0d09c48e63) |
| **Action** | Guardrailed Auto-DCA swap (`0.50 USDC -> 9.009794 CELO`) via Uniswap V3 `SwapRouter02.exactInputSingle` (`0x04e45aaf`) |
| **Mainnet Swap Tx** | [`0x838a0216daf4bdac3b728f9471539d60bb9532970d7c43e0ac6b65b1040cfcc5`](https://celoscan.io/tx/0x838a0216daf4bdac3b728f9471539d60bb9532970d7c43e0ac6b65b1040cfcc5) (Block `#83625775`, confirmed) |
| **Prior Bounded USDC Approve** | [`0x44a9b663d21c17887e05b61568a03f18f374ea2b055ef630964cd58a5277c292`](https://celoscan.io/tx/0x44a9b663d21c17887e05b61568a03f18f374ea2b055ef630964cd58a5277c292) |
| **ERC-8021 Attribution Suffix** | `celo_0518175d3efe` (verified in on-chain calldata suffix `63656c6f5f30353138313735643365666511008021...`) |

---

## Verified Celo Mainnet Proof (Chain ID `42220`)

Executed live on **Celo Mainnet (`42220`)** using `@altananetwork/sdk@1.1.0` EIP-7702 session keys, Uniswap V3 `SwapRouter02`, ERC-8004 Identity Registry, and `@celo/attribution-tags@0.5.0` (official Loops House tag `celo_0518175d3efe`):

| Step | Action | Verification / Celoscan Proof |
| :--- | :--- | :--- |
| **0. ERC-8004 Agent Identity** | On-chain registration (`Agent ID #10109`, `agent-card.json` metadata URI) for `0x3631...7944` | [`0x043cfd11e5d698932e7a6efb52ee9122b4edfe747f2c0237793b95c98e18a706`](https://celoscan.io/tx/0x043cfd11e5d698932e7a6efb52ee9122b4edfe747f2c0237793b95c98e18a706) (Block `#83539919`) |
| **1. Session Grant** | Scoped 1h Altana EIP-7702 Session Key (`0.15 USDC` per-tx, `0.30 USDC` total, allowlisted target) | [`0x928012be32adf147c343ab658b26ccef5e4928eafeb48ce2d8849931ae8f954a`](https://celoscan.io/tx/0x928012be32adf147c343ab658b26ccef5e4928eafeb48ce2d8849931ae8f954a) (Block `#83506620`) |
| **2. Live Auto-DCA Swap (Primary Wallet)** | Guardrailed `0.10 USDC -> 1.809088 CELO` swap via `SwapRouter02` (`0x04e45aaf`) with slippage floor & ERC-8021 `celo_0518175d3efe` (after bounded approve [`0x252e9dc5...`](https://celoscan.io/tx/0x252e9dc51e4055c49d45fe110de02cf09e0cd0110476225aaa12e9c23515af1b)) | [`0x0c5d57fcdf7054194309aa3efc6ad868b5209d82b038f471aa5d8daf3f8ea56b`](https://celoscan.io/tx/0x0c5d57fcdf7054194309aa3efc6ad868b5209d82b038f471aa5d8daf3f8ea56b) (Block `#83540877`) |
| **3. Named External User Auto-DCA (`@MFauzulAzim`)** | External collaborator `0xfb69ABfADd1A6f1929e988f41D2AAb0d09c48e63`: `0.50 USDC -> 9.009794 CELO` via `SwapRouter02` (`0x04e45aaf`) with ERC-8021 `celo_0518175d3efe` | [`0x838a0216daf4bdac3b728f9471539d60bb9532970d7c43e0ac6b65b1040cfcc5`](https://celoscan.io/tx/0x838a0216daf4bdac3b728f9471539d60bb9532970d7c43e0ac6b65b1040cfcc5) (Block `#83625775`) |
| **4. ERC-8021 Attribution Verification Transfer** | Historical live `0.05 USDC` transfer verifying ERC-8021 calldata suffix decoding on Celo Mainnet *(executed prior to upgrading default runtime tag to `celo_0518175d3efe`)* | [`0xcb30c9969a2816bbffee446c17eaf840ccd57548656f97f845013e6c1dbf1c27`](https://celoscan.io/tx/0xcb30c9969a2816bbffee446c17eaf840ccd57548656f97f845013e6c1dbf1c27) |
| **5. Negative Tests (Altana KeyStore / Relay)** | Direct Altana Relay / KeyStore calls bypassing TypeScript pre-flight: un-allowlisted USD₮ call and `0.35 USDC > 0.30 USDC` over-cap spend | Rejected pre-inclusion by Altana Relay / KeyStore: `[call_not_permitted]` and `[spend_limit_exceeded]` (no gas burned on mined revert; reproducible via `npm run live:test -- --confirm-mainnet` Steps 4c/4d) |
| **6. 1-Tx Emergency Revoke** | Instant KeyStore session key revocation (`revokeSession`) | [`0x1455448cb2fedd67aa7e46591328c09b4f75d3062f254b52dc429b624302d320`](https://celoscan.io/tx/0x1455448cb2fedd67aa7e46591328c09b4f75d3062f254b52dc429b624302d320) |

**Repeat-Use & Decision Log Status:** Two distinct mainnet `USDC -> CELO` Auto-DCA executions are settled on Celo Mainnet (Blocks `#83540877` and `#83625775`), and [`logs/decisions.jsonl`](./logs/decisions.jsonl) records live block-anchored `DRY_RUN` evaluations (Blocks `#83600911` `DEFER` at `+104.91 bps` above 24h TWAP and `#83632631` `EXECUTE` at `-216.18 bps` dip). Additional recurring `dca:tick --live` transactions are tracked in `LIVE_DCA_TICK_PROOFS` (`web/src/data/mainnetProof.ts`) as they settle.

---

## Agent Decision Gate (`dca:tick`) & Verifiable Audit Log

The Agent Execution Plane (`src/cli/dca-tick.ts`, documented in [`SKILL.md`](./SKILL.md)) evaluates live Celo Mainnet Uniswap V3 `USDC/CELO` (`0.01%`, `fee = 100`) pool state before every 4-hour tick (recommended `$1.00` order size under a `$4.00/day` Altana on-chain spend cap):

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
* **On-chain enforcement (Altana EIP-7702 Session Key):** Daily Native USDC `spendCap`, strict contract + raw 4-byte selector lock (`SwapRouter02` `0x5615CDAb10dc425a742d643d949a7F474C01abc4` + `0x04e45aaf` `exactInputSingle` only), bounded owner-side `USDC.approve(SwapRouter02, dailyCap * days)` provisioned during `session:grant` (never `maxUint256`; `USDC.approve` `0x095ea7b3`, `sweepToken` `0xdf2ab5bb`, and `multicall` `0xac9650d8` are blocked from session keys), hard expiry, and permanent **1-tx revoke** at the Altana KeyStore level. Unauthorized contracts or over-cap spends revert on-chain (`[call_not_permitted]`, `[spend_limit_exceeded]`).
* **Off-chain agent policy (TypeScript / Zod pre-flight):** ABI parameter constraints (`recipient == walletAddress`, `tokenOut == CELO`, `fee == 100`), on-chain `simulateContract` quote check for `amountOutMinimum` (`25 bps` execution slippage in `dca:tick`, `100 bps` default in web UI), `+50 bps` asymmetric 24h TWAP gate, `5 bps` pool impact ceiling, `+15%` weekly ceiling, and block-anchored JSONL audit logging. See [`SECURITY.md`](./SECURITY.md) for the explicit threat model and bounded worst-case loss formula (`min(wallet_USDC_balance, dailyCap * remainingDays) + wallet_CELO_gas_balance`).

---

## Celo Mainnet Liquidity Reality (Verified On-Chain, Celo Mainnet Blocks `#83540877` - `#83600911`)

CapRail intentionally restricts its active allowlist to a single verified pair: **`USDC -> CELO`** on Uniswap V3 `SwapRouter02` (`0x5615CDAb10dc425a742d643d949a7F474C01abc4`, `0.01%` fee tier, pool `0xA1777e082fA1746eB78DD9C1fbB515419CF6e538`).

| Pair (Celo Mainnet) | Uniswap V3 Fee Tiers Checked | Verified On-Chain State (Chain ID `42220`) | Policy Status |
| :--- | :--- | :--- | :--- |
| **`USDC / CELO`** | `0.01%`, `0.05%`, `0.30%`, `1.00%` | `0.01%` pool holds ~6,239 USDC + 110,378 CELO (~$12.4k TVL). Higher fee tiers hold negligible liquidity. | **Allowlisted (Active)** |
| **`USDC / WETH`** | `0.01%`, `0.30%` | Pools exist on-chain, but active liquidity `L = 0` (zero executable depth). | **Blocked** |
| **`USDC / WBTC`** | All tiers | No canonical WBTC token contract and zero Uniswap V3 pools on Celo Mainnet. | **Blocked** |

Thin DEX liquidity on Celo Mainnet is the practical engineering reason autonomous agents require hard spend caps and on-chain slippage floors (`amountOutMinimum`). Any future asset addition is strictly liquidity-gated.

---

## Mainnet Engineering Log (What Broke & Fixes)

1. **Uniswap V3 `'STF'` revert on unconfirmed approval:** Broadcasting `exactInputSingle` before the ERC-20 `USDC.approve(SwapRouter02, amountIn)` transaction mined caused `TransferHelper.safeTransferFrom` to revert with `'STF'` (observed live at [`0x312a95d9...c1b3978`](https://celoscan.io/tx/0x312a95d95bc535fb5cf57986668ced9e2e857f05d2cfa1e5401174c9dc1b3978)). Fixed in `web/src/lib/liveWallet.ts` by checking `balanceOf` + `allowance` first and strictly awaiting `publicClient.waitForTransactionReceipt({ hash: approveHash })`, and in `src/wallet/altanaLive.ts` by moving bounded `USDC.approve(SwapRouter02, dailyCap * days)` to owner provisioning (`session:grant`) with pre-flight allowance checks in `dca:tick`.
2. **Wallet 100% slippage warning on minimal `amountOutMinimum`:** Encoding a placeholder `1n` floor triggered Rabby Wallet's 100.00% slippage alert. Fixed in `src/wallet/calldata.ts` (`computeMinAmountOut` + required `amountOutMinimum` / `quotedAmountOut`) and `web/src/lib/liveWallet.ts` (`publicClient.simulateContract` live on-chain quote before signing).
3. **Altana EIP-7702 stale auth nonce loop:** Re-calling `createWallet()` on an already upgraded EOA threw `Invalid auth item nonce`. Fixed in `src/wallet/altanaLive.ts` via on-chain `getCode` inspection and `resolveOrProvisionAltanaWallet` reuse.
4. **ERC-8021 builder attribution upgrade:** Upgraded default attribution encoding across `src/`, `web/`, and `tests/` to the official Loops House tag `celo_0518175d3efe`.

---

## Security & Failure-Mode FAQ

1. **What happens if the session key leaks?**  
   The compromised session key cannot call `USDC.approve`, `USDC.transfer`, `sweepToken`, or `multicall`, and cannot exceed the daily USDC spend cap. Because Altana `{ to, signature }` locks contract + selector (`SwapRouter02` + `0x04e45aaf`) rather than ABI calldata fields, worst-case loss before 1-tx owner revocation is explicitly bounded by `min(wallet_USDC_balance, dailyCap * remainingDays) + wallet_CELO_gas_balance`. See [`SECURITY.md`](./SECURITY.md) for full details and the immutable DCA adapter hardening path.
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
│   │   ├── calldata.ts                # SwapRouter02 exactInputSingle (0x04e45aaf) + slippage floor + ERC-8021 suffix
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
└── SECURITY.md                        # Explicit threat model & secrets hygiene policy
```

---

## Quick Start (Keyless Local Verification)

Zero private keys are required to verify schemas, guardrails, live Celo RPC pool reads, and the web build:

```bash
npm install
npm run typecheck
npm test
npm run dry-run
npm run dca:tick -- --dry-run
npm run check:network
npm run web:build
```

## Live Celo Mainnet Quickstart (`session:grant` -> `dca:tick --live` -> `revoke`)

Follow these three steps to run CapRail end-to-end on Celo Mainnet (`Chain ID 42220`) with strict separation between owner keys and agent session keys:

### 1. Provision Bounded Approval & Scoped Session Key (Owner Local Machine Only)

Set `OWNER_PRIVATE_KEY` (and optional `ALTANA_WALLET_ADDRESS`) in your local `.env` (never on a VPS), then preview and grant the session key:

```bash
# Preview bounded USDC.approve (dailyCap * days) and 0x04e45aaf selector lock
npm run session:grant -- --dry-run --daily-cap 4 --days 14

# Broadcast bounded owner USDC.approve (if needed) + Altana EIP-7702 session grant
npm run session:grant -- --daily-cap 4 --days 14
```

* **Expected output:** Confirmed Altana KeyStore grant transaction (verified mainnet example: [`0x928012be32adf147c343ab658b26ccef5e4928eafeb48ce2d8849931ae8f954a`](https://celoscan.io/tx/0x928012be32adf147c343ab658b26ccef5e4928eafeb48ce2d8849931ae8f954a)) plus the two session-only `.env` lines to copy to your agent host.

### 2. Run Autonomous Guardrailed Swap Tick (Session-Only Agent Host / VPS)

Configure **only** the session-plane environment variables on the agent runner (never `OWNER_PRIVATE_KEY` or `ALTANA_ADMIN_PRIVATE_KEY`):

```bash
ALTANA_WALLET_ADDRESS=0x3631D44543384253C099f2A09c0D0bE109Eb7944
ALTANA_SESSION_PRIVATE_KEY=0x<session_key_printed_in_step_1>
CELO_RPC_URL=https://forno.celo.org
CELO_ATTRIBUTION_CODE=celo_0518175d3efe
```

Execute a live market-gated tick:

```bash
npm run dca:tick -- --live --amount 1
```

* **Expected output:** Single-line block-anchored JSON appended to `logs/decisions.jsonl` and printed to `stdout`. When pool impact `<= 5 bps` and spot is `<= +50 bps` above 24h TWAP, `dca:tick` broadcasts `SwapRouter02.exactInputSingle` (`0x04e45aaf`) with `25 bps` slippage protection and ERC-8021 tag `celo_0518175d3efe` (verified mainnet examples: primary wallet [`0x0c5d57fcdf7054194309aa3efc6ad868b5209d82b038f471aa5d8daf3f8ea56b`](https://celoscan.io/tx/0x0c5d57fcdf7054194309aa3efc6ad868b5209d82b038f471aa5d8daf3f8ea56b) and external collaborator `@MFauzulAzim` [`0x838a0216daf4bdac3b728f9471539d60bb9532970d7c43e0ac6b65b1040cfcc5`](https://celoscan.io/tx/0x838a0216daf4bdac3b728f9471539d60bb9532970d7c43e0ac6b65b1040cfcc5)).

### 3. Verify Negative Guardrails & 1-Tx Emergency Revoke (Owner Local Machine)

Run the end-to-end Celo Mainnet smoke test (explicitly gated by `--confirm-mainnet`), which executes a scoped grant, ERC-8021 attribution check, live Altana negative tests (`[call_not_permitted]`, `[spend_limit_exceeded]`), and immediate **1-tx KeyStore revoke**:

```bash
npm run live:test -- --confirm-mainnet
```

* **Expected output:** Confirmed 1-tx KeyStore revocation transaction (verified mainnet example: [`0x1455448cb2fedd67aa7e46591328c09b4f75d3062f254b52dc429b624302d320`](https://celoscan.io/tx/0x1455448cb2fedd67aa7e46591328c09b4f75d3062f254b52dc429b624302d320)), after which any subsequent session call returns `SESSION_REVOKED` / `[key_not_found]`.
