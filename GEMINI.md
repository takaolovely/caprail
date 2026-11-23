# Workspace Context & Build Rules (`Celo "Agents Open for Business" Hackathon`)

This file is the persistent operating manual for **Antigravity IDE** when building the submission for the **Celo "Agents Open for Business" Hackathon**.

## 1. Collaboration & Engineering Discipline

* **Direct, Evidence-Based Communication:** Be a critical, pragmatic senior engineer. Never use filler or self-congratulatory phrases. Report concrete evidence only: file paths, line numbers, transaction hashes on Celoscan, test outputs, and exact `git rev-parse HEAD` SHAs.
* **Three Brutal Product Filters (Audit Every Feature Against These):**
  1. **Do not add steps:** Replace slow or risky workflows; never insert middleman steps that solve nothing.
  2. **Zero consumer wallet onboarding:** Never build flows that force non-crypto users to install wallets, back up seed phrases, or learn new tools. Target developers, operators, or autonomous agents directly.
  3. **No 2-click toys:** If a human can accomplish the task manually in 2 clicks, it is not an agent problem.
* **Pre-PR & Code Security Rules (Mandatory Gate):**
  * **Git SHAs:** Never construct or edit commit SHAs by hand; always retrieve via `git rev-parse HEAD` and verify.
  * **Path Confinement:** Enforce `relative_to()` containment checks inside dedicated workspace directories; never expose arbitrary filesystem paths in tool schemas or forward unfiltered `**kwargs`.
  * **Subprocess Environment Isolation:** Never pass `env={**os.environ}` to child processes; always pass an explicit allowlist of required environment keys.
  * **Secrets Handling:** Never hardcode, commit, or log private keys, session keys, or API tokens.
  * **Claims vs. Code Honesty:** Every security or guardrail claim in `README.md`, UI, or demo videos must match actual smart-contract/code enforcement line-for-line.

## 2. Hackathon Timeline & Track Strategy

* **Final Submission Deadline:** Monday, December 7, 2026 at 16:00 WIB.
* **Automated Repo Reviews (AskBots):** Scheduled on **November 24, 2026** and **December 4, 2026** — ensure the repository has clean structure, working tests, and verified security hygiene prior to both checkpoints.
* **Track Selection:**
  * **PRIMARY TARGET — Altana Agent Wallets (`$750` 1st / `$250` 2nd + `35,000 XP`):** Zero KYC/passport requirement, developer/agent-native, built around non-custodial session keys.
  * **DROPPED — Stablecoin Corridors (IDRX / Textile FX):** Rejected because USD₮ $\leftrightarrow$ IDRX adds unnecessary hops over direct USD₮ $\rightarrow$ local exchange off-ramps and requires corporate KYB for mint/redeem APIs.
  * **DROPPED — Agent Vault:** Rejected due to Web2 browser checkout/CAPTCHA demo fragility.
  * **OPTIONAL COMBO — Self Agent ID (`$700` 1st / `$300` 2nd):** Only activate if a real external collaborator with an active **biometric e-Passport (NFC chip)** is confirmed (Celo Mainnet rejects mock passports).

## 3. Mandatory Technical & Judging Requirements

1. **Celo Mainnet (`Chain ID 42220`) Only:** All demos, agent registrations, and payouts must execute on Celo Mainnet (testnet activity is disqualified).
2. **Day-1 Identity & Attribution:**
   * Register the agent under **ERC-8004** on Celo Mainnet.
   * Append **`celo-org/attribution-tags`** to every on-chain transaction submitted by the agent.
3. **Altana Non-Custodial Session Keys:**
   * Enforce on-chain `spendCap`, strict `contract allowlist`, and `expiry`.
   * Demonstrate **`1-tx revoke`** and live **negative tests** in the demo (transactions exceeding `spendCap` or targeting un-allowlisted addresses must revert at the smart-contract level).
4. **Judging Criteria (25% Weight Each):**
   * Execution quality, clear value proposition, tagged on-chain traction, and **"a named user with a real job done"** (must involve a real named external collaborator completing a genuine scoped deliverable—no self-only loops).

## 4. Architecture & Build Plan

### Final Product Direction: CapRail (`takaolovely/caprail`) — Guardrailed Auto-DCA & Revenue Splitter (Altana Agent Wallet)
* **Problem Solved:** Autonomous treasury operations (recurring Auto-DCA swaps and multi-party revenue splits) usually require either handing an agent a full private key (catastrophic blast radius on prompt injection or bug) or manually signing every recurring run (slow, error-prone).
* **Architecture:** Delegate bounded execution to an **Altana Non-Custodial Agent Wallet** via scoped **on-chain Session Keys** paired with deterministic pre-flight policy checks (`zod`):
  * **Auto-DCA Engine (`AutoDcaEngine`):** Executes scheduled token swaps (`tokenIn -> tokenOut`) strictly constrained by `amountPerRun`, `intervalSeconds`, `allowedRouter`, `maxSlippageBps`, and session `spendCapPerTx` / `totalSpendCap` / `expiresAt`.
  * **Revenue Splitter Engine (`RevenueSplitterEngine`):** Splits incoming or allocated revenue across an explicit allowlisted recipient set whose basis points deterministically sum to exactly `10000 bps` (100.00%). Any target outside `allowedTargets[]`, amount over cap, expired session, or revoked session is deterministically blocked.
  * **Strict Honesty (`LOCAL_SIMULATION` vs. `CELO_MAINNET`):** Local dry-run and unit tests run against `LocalSessionSimulator` (explicitly tagged `MODE: LOCAL_SIMULATION` — never mislabeled as on-chain revert). Live Celo Mainnet (`Chain ID 42220`) execution uses `AltanaLiveAdapter` (`@altananetwork/sdk` + `viem` + `@celo/attribution-tags`).

### Step-by-Step Execution Checklist
1. **Before Nov 24 AskBots Review (CLI & Core Backend Foundation — No Web UI yet):**
   * Clean repo layout (`src/policy/`, `src/wallet/`, `src/engine/`, `src/identity/`, `src/cli/`, `tests/`), `.gitignore`, `.env.example`, `README.md`, `SECURITY.md`.
   * Verify real installed `@altananetwork/sdk` & `@celo/attribution-tags` TypeScript APIs (zero hallucinated methods).
   * Implement deterministic policy schemas, `LocalSessionSimulator`, `AltanaLiveAdapter`, `AutoDcaEngine`, `RevenueSplitterEngine`, ERC-8004 helper, CLI (`check:network`, `dry-run`), and passing `vitest` guardrail test suite.
2. **Mainnet Execution & Named Collaborator (Before Dec 7):**
   * Register the agent under **ERC-8004** on Celo Mainnet (`0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`).
   * Confirm **1 real named external collaborator** to receive a real mainnet revenue-split payout / co-operated treasury run (no self-only loops).
   * Record Celo Mainnet demo covering: normal attributed Auto-DCA & Revenue Split tx on Celoscan, contract-level rejection on over-cap / un-allowlisted target, and `1-tx revoke`.