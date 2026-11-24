# Security Policy & Explicit Threat Model

## Scope

This repository (**CapRail**, `https://github.com/takaolovely/caprail`) implements a non-custodial **Guardrailed Auto-DCA (`USDC -> CELO`)** system targeting **Celo Mainnet (`Chain ID 42220`)** via Uniswap V3 `SwapRouter02` (`0x5615CDAb10dc425a742d643d949a7F474C01abc4`) and **Altana EIP-7702 Session Keys** (`@altananetwork/sdk@1.1.0`).

---

## Two-Plane Architecture

CapRail strictly separates owner authority from autonomous agent execution:

| Plane | Credentials Allowed | Permitted Operations | Deployment Boundary |
| :--- | :--- | :--- | :--- |
| **Human Control Plane** | `OWNER_PRIVATE_KEY` (or `ALTANA_ADMIN_PRIVATE_KEY`) | `npm run session:grant` (bounded owner `USDC.approve` + Altana session key grant), 1-tx emergency `revokeSession`, web control plane (`https://caprail.vercel.app`) | Owner local machine only. Never copied to a VPS or agent host. |
| **Agent Execution Plane** | `ALTANA_SESSION_PRIVATE_KEY` + `ALTANA_WALLET_ADDRESS` | `npm run dca:tick` (`--dry-run` or `--live`) invoking `SwapRouter02.exactInputSingle` (`0x04e45aaf`) only | Autonomous runner host (VPS / Hermes / cron). Has zero access to owner keys. |

---

## Explicit Trust Boundary: `LOCAL_SIMULATION` vs `CELO_MAINNET`

Every adapter and log record explicitly labels its execution mode (Altana KeyStore on Celo Mainnet `42220`: `0x83b30935f36d6ccf9B1ec3b5E47F2866b97cd27c`):

| Mode & Adapter | Enforcement Layer | What It Proves |
| :--- | :--- | :--- |
| **`LOCAL_SIMULATION`**<br>`LocalSessionSimulator` | Deterministic TypeScript policy evaluator (`src/policy/evaluator.ts`) | Verifies Zod schemas, spend-cap accounting, slippage math, audit logging, and negative test paths with zero gas and zero keys. **Does NOT constitute an on-chain smart-contract revert.** |
| **`CELO_MAINNET`**<br>`AltanaLiveAdapter` | Off-chain pre-flight policy gate + Altana EIP-7702 on-chain session permissions & KeyStore | Enforces contract + 4-byte selector lock (`0x04e45aaf`), daily spend cap, expiry, and 1-tx revoke on Celo Mainnet (`42220`). |
---

## What Is Enforced On-Chain (Altana EIP-7702)

When the owner runs `npm run session:grant` (`src/wallet/altanaLive.ts`), the following controls are enforced on-chain by the Altana EIP-7702 smart account and KeyStore:

1. **Contract + Raw 4-Byte Selector Lock:**
   - Session `calls` contains exactly one entry:
     - `to`: `0x5615CDAb10dc425a742d643d949a7F474C01abc4` (Uniswap V3 `SwapRouter02`)
     - `signature`: `0x04e45aaf` (`exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))`, derived programmatically via `viem`'s `toFunctionSelector` from `UNISWAP_V3_SWAP_ROUTER_02_ABI[0]`)
   - There are **zero `{ to }`-only catch-all grants** in the codebase.
   - Blocked at the contract level for the session key:
     - `USDC.approve` (`0x095ea7b3`) is excluded completely. Altana spend caps meter ERC-20 transfer outflows, not allowance mutations; granting `USDC.approve` to a session key would allow `approve(attacker, maxUint256)` for `$0` metered spend.
     - `SwapRouter02.sweepToken` (`0xdf2ab5bb`), `multicall` (`0xac9650d8`), `unwrapWETH9`, and `refundETH` are blocked.
     - Arbitrary ERC-20 `transfer` calls and calls to any unlisted contract are blocked (`[call_not_permitted]`).
2. **Daily Native USDC Spend Cap:**
   - Enforced on-chain by Altana `spend` permission (`limit = dailyCap`, `period = "day"`, `token = 0xcebA9300f2b948710d2653dD7B07f33A8B32118C`). Any call exceeding the daily allowance reverts (`[spend_limit_exceeded]`).
3. **Bounded Owner-Side USDC Approval:**
   - During `npm run session:grant`, the owner sets `USDC.approve(SwapRouter02, dailyCap * days)` only when current allowance is below that bound (for example, `$4/day * 14 days = $56.00 USDC`). CapRail never requests `maxUint256` approval.
   - If the bounded allowance is exhausted, `executeAutoDcaWithSession` checks `USDC.allowance` pre-flight and defers cleanly without broadcasting a reverting `'STF'` transaction.
4. **Hard Session Expiry:**
   - Session key expires automatically at `expiry = now + days * 86400`.
5. **1-Tx Owner Emergency Revoke:**
   - The owner can permanently invalidate the session key in a single transaction via Altana KeyStore `revokeSession`.

---

## Known Architectural Limitations (Explicit Threat Model)

Altana EIP-7702 session permissions (`{ to, signature }`) enforce the **target contract address** and **4-byte function selector** only. They do **NOT** inspect ABI-encoded calldata parameters inside `exactInputSingle(...)`.

The following constraints are enforced **off-chain** in TypeScript (`src/engine/decisionGate.ts`, `src/wallet/calldata.ts`, `src/wallet/altanaLive.ts`) and are **NOT** enforced by the on-chain Altana session verifier:

- `params.recipient == walletAddress`
- `params.tokenOut == CELO (0x471EcE3750Da237f93B8E339c536989b8978a438)`
- `params.fee == 100` (`0.01%` pool)
- `params.amountOutMinimum > 0` (`25 bps` execution slippage floor from `simulateContract` quote)
- `+50 bps` asymmetric 24h TWAP upside gate, `5 bps` pre-flight pool impact ceiling, and `+15%` weekly ceiling circuit breaker

### Residual Attack Vectors if `ALTANA_SESSION_PRIVATE_KEY` Is Compromised

If an attacker gains full control of the VPS host and steals `ALTANA_SESSION_PRIVATE_KEY` (without stealing `OWNER_PRIVATE_KEY`), the attacker **cannot** approve unlimited USDC, call `USDC.transfer`, sweep funds via `sweepToken`, or exceed the daily spend cap. However, within the active session window, the attacker can still invoke `SwapRouter02.exactInputSingle` (`0x04e45aaf`) with malicious ABI parameters:

1. **`recipient` Hijacking:** Submit `exactInputSingle` with `recipient = attackerAddress`, redirecting swap output up to `dailyCap * remainingDays`.
2. **Toxic `tokenOut` / Attacker-Controlled Pool Drain:** Submit `exactInputSingle` swapping `USDC` into a worthless token on an attacker-seeded Uniswap V3 pool, extracting `USDC` up to `dailyCap * remainingDays`.
3. **Zero Slippage (`amountOutMinimum = 0`) Sandwich Attack:** Submit `exactInputSingle` with `amountOutMinimum = 0` and sandwich the swap on-chain, extracting value up to `dailyCap * remainingDays`.
4. **Native `CELO` Gas Griefing:** Submit repeated dust or reverting `exactInputSingle` calls to drain the wallet's native `CELO` gas balance (bounded by the session's daily gas cap and the wallet's `CELO` balance).

### Bounded Worst-Case Loss Formula

Under a total compromise of `ALTANA_SESSION_PRIVATE_KEY` (with `OWNER_PRIVATE_KEY` uncompromised), the maximum possible loss before owner revocation is strictly bounded by:

```text
max_loss = min(wallet_USDC_balance, dailyCap * remainingDays) + wallet_CELO_gas_balance
```

### Operational Mitigations

1. **Minimal Gas Balance:** Keep only a small native `CELO` gas float in the Altana wallet (for example, `0.02` to `0.05 CELO`) to cap gas griefing exposure.
2. **Tightly Sized Cap and Window:** Size `dailyCap` and `days` to match actual cadence (recommended `$4.00/day` for `14` days = `$56.00` bounded approval).
3. **Monitoring and 1-Tx Revoke:** Monitor on-chain wallet transfers and `logs/decisions.jsonl`. On any unexpected `exactInputSingle` transaction, execute a 1-tx owner `revokeSession` immediately from the local machine.

---

## Future Hardening Path

To eliminate all four calldata-parameter attack vectors on-chain without changing the Altana EIP-7702 architecture:

- Deploy a minimal, immutable on-chain **CapRail DCA Adapter** contract that:
  1. Hardcodes `recipient = ownerWallet`, `tokenIn = USDC`, `tokenOut = CELO`, and `fee = 100`.
  2. Verifies an on-chain Uniswap V3 `USDC/CELO` TWAP oracle (`pool.observe`) to enforce a minimum output floor on-chain.
  3. Exposes a single entrypoint `executeDca(uint256 amountIn)` that forwards the validated swap to `SwapRouter02`.
- Point the Altana session grant exclusively at `(CapRailDcaAdapter, executeDca.selector)` so ABI parameter tampering becomes impossible even under full session-key compromise.

---

## Secrets & Environment Hygiene

- `.gitignore` excludes `.env`, `.env.*` (except `.env.example`), `*.key`, `*.pem`, `*private*`, `*secret*`, `*mnemonic*`, and `*keystore*.json`.
- `src/config/env.ts` reads an explicit allowlist of environment keys and never forwards unfiltered `process.env` to child processes.
- Private keys, session keys, and raw `.env` values are never logged to `stdout`, `stderr`, or `logs/decisions.jsonl` (except the explicit local setup instructions printed by `session:grant` on the owner's terminal).
- Read-only commands (`npm run check:network`, `npm run dry-run`, `npm run dca:tick -- --dry-run`, `npm test`) require zero private keys.
- File writes (`logs/decisions.jsonl`) enforce `path.relative()` workspace confinement (`src/engine/decisionLog.ts`).

## Reporting Security Issues

Do not open public GitHub issues containing live private keys or active mainnet session keys. Revoke any compromised session key immediately via Altana KeyStore 1-tx `revokeSession` before rotating credentials.
