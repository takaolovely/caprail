import type { Address } from "viem";
import { AuditLogger, AutoDcaEngine } from "../engine/index.js";
import type { DcaStrategy, SessionPolicy } from "../policy/index.js";
import {
  CAPRAIL_DEFAULT_ATTRIBUTION_CODE,
  CELO_MAINNET_ROUTERS,
  CELO_MAINNET_TOKENS,
  LocalSessionSimulator,
} from "../wallet/index.js";

// Deterministic simulation addresses (explicitly labeled LOCAL_SIMULATION)
const AGENT_WALLET = "0x3631D44543384253C099f2A09c0D0bE109Eb7944" as Address;
const ALLOWED_ROUTER = CELO_MAINNET_ROUTERS.UNISWAP_V3_SWAP_ROUTER_02;
const FOREIGN_ATTACKER = "0xdead00000000000000000000000000000000beef" as Address;

async function main(): Promise<void> {
  const nowSec = Math.floor(Date.now() / 1000);
  const attributionCode = CAPRAIL_DEFAULT_ATTRIBUTION_CODE;

  // 1 USDC = 1_000_000 (6 decimals)
  const policy: SessionPolicy = {
    sessionId: "sess-dryrun-001",
    spendCapPerTx: 50_000_000n, // 50 USDC per call
    totalSpendCap: 100_000_000n, // 100 USDC total session budget
    allowedTargets: [ALLOWED_ROUTER],
    expiresAt: nowSec + 86_400,
    revoked: false,
    token: CELO_MAINNET_TOKENS.USDC,
  };

  const wallet = new LocalSessionSimulator({
    walletAddress: AGENT_WALLET,
    policy,
    attributionCode,
  });

  const auditLogger = new AuditLogger({ emitToStdout: false });

  const dcaStrategy: DcaStrategy = {
    strategyId: "usdc-to-celo-hourly",
    tokenIn: CELO_MAINNET_TOKENS.USDC,
    tokenOut: CELO_MAINNET_TOKENS.CELO,
    amountPerRun: 25_000_000n, // 25 USDC
    intervalSeconds: 3600,
    allowedRouter: ALLOWED_ROUTER,
    maxSlippageBps: 100, // 1.00%
  };

  const dcaEngine = new AutoDcaEngine({
    wallet,
    strategy: dcaStrategy,
    auditLogger,
  });

  console.log("====================================================================");
  console.log(" CapRail | MODE: LOCAL_SIMULATION (Deterministic Dry-Run, NOT On-Chain)");
  console.log(` Session ID     : ${policy.sessionId}`);
  console.log(` Allowed Router : ${ALLOWED_ROUTER}`);
  console.log(` Per-Tx Cap     : 50.00 USDC (${policy.spendCapPerTx.toString()} base units)`);
  console.log(` Total Cap      : 100.00 USDC (${policy.totalSpendCap.toString()} base units)`);
  console.log(` Attribution    : ${attributionCode}`);
  console.log("====================================================================\n");

  // 1) Auto-DCA valid run #1 -> APPROVED
  const res1 = await dcaEngine.executeRun({
    minAmountOut: 34_000_000_000_000_000_000n,
    slippageBps: 50,
    nowSec,
  });
  console.log(
    `[1] Auto-DCA Run #1 (25 USDC)         => ${res1.status} | remaining=${res1.remainingTotalCap.toString()} | tx=${res1.txHash?.slice(0, 14)}...`,
  );

  // 2) Auto-DCA valid run #2 after interval -> APPROVED
  const res2 = await dcaEngine.executeRun({
    minAmountOut: 34_000_000_000_000_000_000n,
    slippageBps: 50,
    nowSec: nowSec + 3600,
  });
  console.log(
    `[2] Auto-DCA Run #2 (25 USDC)         => ${res2.status} | remaining=${res2.remainingTotalCap.toString()} | tx=${res2.txHash?.slice(0, 14)}...`,
  );

  // 3) Over-cap spend attempt (60 USDC > 50 USDC per-tx cap) -> BLOCKED
  const res3 = await dcaEngine.executeRun({
    amountIn: 60_000_000n,
    minAmountOut: 80_000_000_000_000_000_000n,
    slippageBps: 50,
    nowSec: nowSec + 7200,
  });
  console.log(
    `[3] Over-Cap DCA (60 USDC > 50 cap)   => ${res3.status} | code=${res3.reasonCode} | reason=${res3.reason}`,
  );

  // 4) Foreign/un-allowlisted router attempt -> BLOCKED
  const res4 = await dcaEngine.executeRun({
    amountIn: 10_000_000n,
    minAmountOut: 13_000_000_000_000_000_000n,
    slippageBps: 50,
    routerOverride: FOREIGN_ATTACKER,
    nowSec: nowSec + 7205,
  });
  console.log(
    `[4] Foreign Target (${FOREIGN_ATTACKER.slice(0, 10)}...) => ${res4.status} | code=${res4.reasonCode} | reason=${res4.reason}`,
  );

  // 5) Revoke session & attempt execution post-revoke -> BLOCKED
  const revokeRes = await dcaEngine.revokeSession(
    "dry-run operator emergency stop",
  );
  console.log(
    `[5a] Session Revoke                   => revoked=${String(revokeRes.revoked)} | tx=${revokeRes.txHash?.slice(0, 14)}...`,
  );

  const res5 = await dcaEngine.executeRun({
    amountIn: 10_000_000n,
    minAmountOut: 13_000_000_000_000_000_000n,
    slippageBps: 50,
    nowSec: nowSec + 7210,
  });
  console.log(
    `[5b] Post-Revoke DCA (10 USDC)        => ${res5.status} | code=${res5.reasonCode} | reason=${res5.reason}`,
  );

  console.log("\n--- Structured JSON Audit Log ---");
  console.log(auditLogger.toJsonLines());

  // Assert expected outcomes so CI / scripts detect regressions
  const ok =
    res1.status === "APPROVED" &&
    res2.status === "APPROVED" &&
    res3.status === "BLOCKED" &&
    res3.reasonCode === "EXCEEDS_PER_TX_CAP" &&
    res4.status === "BLOCKED" &&
    res4.reasonCode === "TARGET_NOT_ALLOWLISTED" &&
    revokeRes.revoked === true &&
    res5.status === "BLOCKED" &&
    res5.reasonCode === "SESSION_REVOKED";

  if (!ok) {
    console.error("\n[dry-run FAILED] Unexpected scenario outcome.");
    process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
