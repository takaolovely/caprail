import type { Address } from "viem";
import {
  AuditLogger,
  AutoDcaEngine,
  RevenueSplitterEngine,
} from "../engine/index.js";
import type { DcaStrategy, SessionPolicy, SplitStrategy } from "../policy/index.js";
import {
  CAPRAIL_DEFAULT_ATTRIBUTION_CODE,
  LocalSessionSimulator,
} from "../wallet/index.js";

// Celo Mainnet canonical token addresses (used as realistic constants in local simulation)
const CELO_USDC = "0xcebA9300f2b948710d2653dD7B07f33A8B32118C" as Address;
const CELO_TOKEN = "0x471EcE3750Da237f93B8E339c536989b8978a438" as Address;

// Deterministic simulation addresses (explicitly labeled LOCAL_SIMULATION)
const AGENT_WALLET = "0x1111111111111111111111111111111111111111" as Address;
const ALLOWED_ROUTER = "0x2222222222222222222222222222222222222222" as Address;
const RECIPIENT_TREASURY = "0x3333333333333333333333333333333333333333" as Address;
const RECIPIENT_COLLABORATOR = "0x4444444444444444444444444444444444444444" as Address;
const RECIPIENT_RESERVE = "0x5555555555555555555555555555555555555555" as Address;
const FOREIGN_ATTACKER = "0xdead00000000000000000000000000000000beef" as Address;

async function main(): Promise<void> {
  const nowSec = Math.floor(Date.now() / 1000);
  const attributionCode = CAPRAIL_DEFAULT_ATTRIBUTION_CODE;

  // 1 USDC = 1_000_000 (6 decimals)
  const policy: SessionPolicy = {
    sessionId: "sess-dryrun-001",
    spendCapPerTx: 50_000_000n, // 50 USDC per call
    totalSpendCap: 100_000_000n, // 100 USDC total session budget
    allowedTargets: [
      ALLOWED_ROUTER,
      RECIPIENT_TREASURY,
      RECIPIENT_COLLABORATOR,
      RECIPIENT_RESERVE,
    ],
    expiresAt: nowSec + 86_400,
    revoked: false,
    token: CELO_USDC,
  };

  const wallet = new LocalSessionSimulator({
    walletAddress: AGENT_WALLET,
    policy,
    attributionCode,
  });

  const auditLogger = new AuditLogger({ emitToStdout: false });

  const dcaStrategy: DcaStrategy = {
    strategyId: "usdc-to-celo-hourly",
    tokenIn: CELO_USDC,
    tokenOut: CELO_TOKEN,
    amountPerRun: 25_000_000n, // 25 USDC
    intervalSeconds: 3600,
    allowedRouter: ALLOWED_ROUTER,
    maxSlippageBps: 100, // 1.00%
  };

  const splitStrategy: SplitStrategy = {
    strategyId: "protocol-revenue-3way",
    token: CELO_USDC,
    recipients: [
      { label: "Treasury", address: RECIPIENT_TREASURY, bps: 5000 },
      { label: "NamedCollaborator", address: RECIPIENT_COLLABORATOR, bps: 3000 },
      { label: "OpsReserve", address: RECIPIENT_RESERVE, bps: 2000 },
    ],
  };

  const dcaEngine = new AutoDcaEngine({ wallet, strategy: dcaStrategy, auditLogger });
  const splitterEngine = new RevenueSplitterEngine({
    wallet,
    strategy: splitStrategy,
    auditLogger,
  });

  console.log("====================================================================");
  console.log(" CapRail — MODE: LOCAL_SIMULATION (Deterministic Dry-Run — NOT On-Chain)");
  console.log(` Session ID     : ${policy.sessionId}`);
  console.log(` Per-Tx Cap     : 50.00 USDC (${policy.spendCapPerTx.toString()} base units)`);
  console.log(` Total Cap      : 100.00 USDC (${policy.totalSpendCap.toString()} base units)`);
  console.log(` Attribution    : ${attributionCode}`);
  console.log("====================================================================\n");

  // 1) Auto-DCA valid run -> APPROVED
  const res1 = await dcaEngine.executeRun({
    minAmountOut: 1n,
    slippageBps: 50,
    nowSec,
  });
  console.log(
    `[1] Auto-DCA (25 USDC)                => ${res1.status} | remaining=${res1.remainingTotalCap.toString()} | tx=${res1.txHash?.slice(0, 14)}...`,
  );

  // 2) Revenue Split 3-way (50% / 30% / 20% of 40 USDC) -> APPROVED
  const split2 = await splitterEngine.executeSplit({
    totalAmount: 40_000_000n,
    nowSec: nowSec + 10,
  });
  console.log(
    `[2] Revenue Split 3-way (40 USDC)     => ${split2.result.status} | payouts=[${split2.payouts.map((p) => `${p.label}:${p.amount.toString()}`).join(", ")}] | remaining=${split2.result.remainingTotalCap.toString()}`,
  );

  // 3) Over-cap spend attempt (60 USDC > 50 USDC per-tx cap) -> BLOCKED
  const res3 = await dcaEngine.executeRun({
    amountIn: 60_000_000n,
    minAmountOut: 1n,
    slippageBps: 50,
    nowSec: nowSec + 3600,
  });
  console.log(
    `[3] Over-Cap DCA (60 USDC > 50 cap)   => ${res3.status} | code=${res3.reasonCode} | reason=${res3.reason}`,
  );

  // 4) Foreign/un-allowlisted address attempt -> BLOCKED
  const res4 = await dcaEngine.executeRun({
    amountIn: 10_000_000n,
    minAmountOut: 1n,
    slippageBps: 50,
    routerOverride: FOREIGN_ATTACKER,
    nowSec: nowSec + 3605,
  });
  console.log(
    `[4] Foreign Target (${FOREIGN_ATTACKER.slice(0, 10)}...) => ${res4.status} | code=${res4.reasonCode} | reason=${res4.reason}`,
  );

  // 5) Revoke session & attempt execution post-revoke -> BLOCKED
  const revokeRes = await dcaEngine.revokeSession("dry-run operator emergency stop");
  console.log(
    `[5a] Session Revoke                   => revoked=${String(revokeRes.revoked)} | tx=${revokeRes.txHash?.slice(0, 14)}...`,
  );

  const res5 = await splitterEngine.executeSplit({
    totalAmount: 10_000_000n,
    nowSec: nowSec + 3610,
  });
  console.log(
    `[5b] Post-Revoke Split (10 USDC)      => ${res5.result.status} | code=${res5.result.reasonCode} | reason=${res5.result.reason}`,
  );

  console.log("\n--- Structured JSON Audit Log ---");
  console.log(auditLogger.toJsonLines());

  // Assert expected outcomes so CI / scripts detect regressions
  const ok =
    res1.status === "APPROVED" &&
    split2.result.status === "APPROVED" &&
    res3.status === "BLOCKED" &&
    res3.reasonCode === "EXCEEDS_PER_TX_CAP" &&
    res4.status === "BLOCKED" &&
    res4.reasonCode === "TARGET_NOT_ALLOWLISTED" &&
    revokeRes.revoked === true &&
    res5.result.status === "BLOCKED" &&
    res5.result.reasonCode === "SESSION_REVOKED";

  if (!ok) {
    console.error("\n[dry-run FAILED] Unexpected scenario outcome.");
    process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
