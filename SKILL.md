---
name: caprail-auto-dca
description: Run guardrailed USDC to CELO Auto-DCA market evaluation ticks (EXECUTE/DEFER) on Celo Mainnet via Uniswap V3 SwapRouter02 and Altana EIP-7702 Session Keys with ERC-8021 attribution (celo_0518175d3efe).
---

# CapRail Agent Skill (`SKILL.md`)

This skill defines the agent-agnostic CLI interface for the **CapRail Agent Execution Plane** on **Celo Mainnet (`Chain ID 42220`)**. Any autonomous agent runner (Hermes, Claude Code, OpenClaw, LangChain, or a cron script) can invoke `npm run dca:tick` to evaluate live pool conditions, record block-anchored decisions in `logs/decisions.jsonl`, and submit bounded `USDC -> CELO` swaps without holding the wallet owner's master private key.

---

## Safety Boundaries (Two-Plane Architecture)

1. **Human Control Plane (`https://caprail.vercel.app` & local `npm run session:grant`):**
   - `OWNER_PRIVATE_KEY` stays strictly on the human owner's local machine and is NEVER copied to an agent host or VPS.
   - The owner runs `npm run session:grant` once locally to authorize a bounded Altana EIP-7702 Session Key (`$2.00/day` default USDC spend cap, 14-day expiry, `SwapRouter02.exactInputSingle` + `USDC.approve` only) and retains exclusive authority to execute **1-tx emergency revoke** at the Altana KeyStore (`0x83b30935f36d6ccf9B1ec3b5E47F2866b97cd27c`).
2. **Agent Execution Plane (VPS / Hermes running `npm run dca:tick`):**
   - Receives **only** `ALTANA_WALLET_ADDRESS` and `ALTANA_SESSION_PRIVATE_KEY`.
   - Operates strictly within the pre-granted Altana EIP-7702 Session Key permissions. If `ALTANA_SESSION_PRIVATE_KEY` or `ALTANA_WALLET_ADDRESS` is missing in `--live` mode, `dca:tick` logs `DEFER` cleanly without requesting `OWNER_PRIVATE_KEY`.
   - Allowed pair: Native `USDC` (`0xcebA9300f2b948710d2653dD7B07f33A8B32118C`) -> `CELO` (`0x471EcE3750Da237f93B8E339c536989b8978a438`) via Uniswap V3 `SwapRouter02` (`0x5615CDAb10dc425a742d643d949a7F474C01abc4`, `0.01%` pool `fee = 100`).
   - Appends ERC-8021 builder attribution tag `celo_0518175d3efe` to every broadcast transaction.
   - Never prints private keys, session keys, or raw `.env` values to `stdout` or `logs/decisions.jsonl`.

---

## Prerequisites

- Node.js `>= 20` and dependencies installed via `npm install`.
- Network access to Celo Mainnet RPC (`CELO_RPC_URL`, defaults to `https://forno.celo.org`).
- For **`--dry-run`**: **zero private keys required**.
- For **one-time owner session provisioning (local machine only)**: `OWNER_PRIVATE_KEY` in local `.env` to run `npm run session:grant`.
- For **autonomous `--live` execution (VPS / agent host)**: ONLY `ALTANA_WALLET_ADDRESS` and `ALTANA_SESSION_PRIVATE_KEY` in the agent `.env`, plus sufficient native `CELO` (`>= 0.002 CELO`) and Native `USDC` in the Altana wallet.

---

## Commands

### 0. One-Time Owner Session Provisioning (Local Owner Machine Only)

Authorizes a scoped Altana EIP-7702 Session Key on Celo Mainnet and prints the exact `ALTANA_WALLET_ADDRESS` and `ALTANA_SESSION_PRIVATE_KEY` lines to copy to the VPS agent `.env`:

```bash
# Preview parameters without broadcasting
npm run session:grant -- --dry-run --daily-cap 2 --days 14

# Grant bounded Auto-DCA session key on Celo Mainnet
npm run session:grant -- --daily-cap 2 --days 14
```

### 1. Dry-Run Evaluation (Default, No Broadcast)

Fetches live Celo Mainnet pool state (`blockNumber`, `sqrtPriceX96`, `liquidity`, `observe([86400, 0])`), evaluates the decision gate, appends one record to `logs/decisions.jsonl`, and prints one JSON object to `stdout`:

```bash
npm run dca:tick -- --dry-run
```

### 2. Live Mainnet Execution (Session-Only on VPS / Hermes)

Runs the same market evaluation gate using ONLY `ALTANA_WALLET_ADDRESS` and `ALTANA_SESSION_PRIVATE_KEY`. If `decision === "EXECUTE"`, checks gas balance (returning `HALTED_NO_GAS` cleanly if below `0.002 CELO`) and submits the swap via the pre-granted Altana Session Key with `25 bps` execution slippage floor and ERC-8021 tag `celo_0518175d3efe`:

```bash
npm run dca:tick -- --live
```

### Optional CLI Overrides

| Flag | Default | Description |
| :--- | :--- | :--- |
| `--dry-run` | `true` (default) | Evaluate live pool state and log decision without broadcasting a transaction |
| `--live` | `false` | Broadcast swap via Altana Session Key when `decision === "EXECUTE"` |
| `--amount <usdc>` | `0.5` | Order size in Native USDC (e.g., `--amount 0.5`) |
| `--max-impact-bps <n>` | `5` | Pre-flight pool impact ceiling in bps (`5` bps = `0.05%`) |
| `--max-deviation-bps <n>` | `50` | Asymmetric max upside deviation above 24h TWAP (`50` bps = `0.50%`) |
| `--exec-slippage-bps <n>` | `25` | Execution slippage buffer passed into `amountOutMinimum` (`25` bps = `0.25%`) |
| `--max-ceiling-pct <n>` | `15` | Weekly ceiling circuit breaker percentage above initial anchor price |

Example with overrides:

```bash
npm run dca:tick -- --dry-run --amount 0.5 --max-impact-bps 5 --max-deviation-bps 50 --exec-slippage-bps 25
```

---

## Decision Gate Rules

1. **Weekly Ceiling Circuit Breaker:** If `spotPriceUsdcPerCelo > anchorPrice * (1 + maxCeilingPct / 100)`, return `DEFER`.
2. **Dual Slippage Guardrail:**
   - Pre-flight: estimate single-tick price impact from live `liquidity()` and `sqrtPriceX96`. If `estimatedPoolImpactBps > maxPoolImpactBps` (`5` bps default), return `DEFER`.
   - Execution: compute `amountOutMinimum` with `executionSlippageBps` (`25` bps default) buffer so valid swaps do not revert from intra-block noise.
3. **Asymmetric 24h TWAP Gate:**
   - `deviationBps = ((spotPrice - twap24h) / twap24h) * 10000`.
   - If `deviationBps > 50` (upside spike > `0.50%` above 24h TWAP), return `DEFER`.
   - If `deviationBps <= 50` (including negative dips below 24h TWAP), return `EXECUTE`.
   - 24h TWAP source order: on-chain `pool.observe([86400, 0])` -> rolling 24h average from `logs/decisions.jsonl` -> current spot price on cold start.

---

## JSON Output Schema (`stdout` and `logs/decisions.jsonl`)

Every invocation prints a single-line JSON object to `stdout` and appends the identical JSON line to `logs/decisions.jsonl`:

```json
{
  "timestamp": "2026-11-24T06:00:00.000Z",
  "mode": "DRY_RUN",
  "blockNumber": 34567890,
  "poolAddress": "0x...",
  "sqrtPriceX96": "18830000000000000000000",
  "spotPriceUsdcPerCelo": 0.0565,
  "twap24hUsdcPerCelo": 0.0564,
  "deviationBps": 17.73,
  "estimatedPoolImpactBps": 0.42,
  "decision": "EXECUTE",
  "reason": "Approved: impact 0.42 bps <= 5 bps, deviation +17.73 bps <= +50 bps (execution slippage buffer: 25 bps)",
  "txHash": null
}
```

| Field | Type | Description |
| :--- | :--- | :--- |
| `timestamp` | `string` | ISO-8601 UTC timestamp of the evaluation tick |
| `mode` | `"DRY_RUN" \| "LIVE"` | Whether execution was simulated or authorized for mainnet broadcast |
| `blockNumber` | `number` | Exact Celo Mainnet block number read alongside `slot0()` |
| `poolAddress` | `string` | Resolved Uniswap V3 pool address from `UniswapV3Factory.getPool` |
| `sqrtPriceX96` | `string` | Exact raw `uint160` string from `slot0()` for independent on-chain verification |
| `spotPriceUsdcPerCelo` | `number` | Spot price derived from `sqrtPriceX96` (USDC per 1 CELO) |
| `twap24hUsdcPerCelo` | `number` | 24h TWAP reference price (USDC per 1 CELO) |
| `deviationBps` | `number` | Signed basis-point deviation of spot vs 24h TWAP |
| `estimatedPoolImpactBps` | `number` | Pre-flight pool impact estimate in basis points |
| `decision` | `"EXECUTE" \| "DEFER" \| "HALTED_NO_GAS"` | Gate verdict or clean gas halt status |
| `reason` | `string` | Deterministic explanation of the decision |
| `txHash` | `string \| null` | Celo Mainnet transaction hash when broadcast in `LIVE` mode, else `null` |

---

## Exit Codes

- `0`: Tick completed cleanly (`EXECUTE`, `DEFER`, or `HALTED_NO_GAS` logged to `logs/decisions.jsonl` and printed to `stdout`).
- `1`: Fatal configuration error, invalid CLI flag, or unreachable Celo RPC (`{"error": "..."}` printed to `stderr`).
