import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { decodeFunctionData, type Address, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import {
  MISSING_LIVE_SESSION_CREDENTIALS_REASON,
  resolveLiveSessionCredentials,
} from "../src/cli/dca-tick.js";
import {
  appendDecisionLog,
  computeDeviationBps,
  computeRolling24hTwapFromLogs,
  evaluateDcaTick,
  formatDecisionLogLine,
  getWeeklyAnchorPriceFromLogs,
  readDecisionLogs,
  type DecisionLogEntry,
} from "../src/engine/index.js";
import {
  AUTO_DCA_ERC20_APPROVE_SIGNATURE,
  AUTO_DCA_EXACT_INPUT_SINGLE_SIGNATURE,
  buildAutoDcaSessionPermissions,
  buildExactInputSingleCalldata,
  CELO_MAINNET_ROUTERS,
  CELO_MAINNET_TOKENS,
  computeMinAmountOut,
  executeAutoDcaWithSession,
  UNISWAP_V3_SWAP_ROUTER_02_ABI,
} from "../src/wallet/index.js";

const AGENT_WALLET = "0x3631D44543384253C099f2A09c0D0bE109Eb7944" as Address;
const MOCK_POOL = "0x7777777777777777777777777777777777777777" as Address;

describe("Auto-DCA Market Decision Gate (evaluateDcaTick)", () => {
  it("enforces asymmetric 24h TWAP deviation gate (+55 bps DEFER, -150 bps EXECUTE, +35 bps EXECUTE)", () => {
    const twap = 0.1;

    // 1) +55 bps above 24h TWAP -> DEFER (PRICE_ABOVE_TWAP_THRESHOLD)
    const spike = evaluateDcaTick({
      spotPriceUsdcPerCelo: 0.10055,
      twap24hUsdcPerCelo: twap,
      estimatedPoolImpactBps: 2.0,
    });
    expect(spike.deviationBps).toBe(55);
    expect(spike.decision).toBe("DEFER");
    expect(spike.reasonCode).toBe("PRICE_ABOVE_TWAP_THRESHOLD");

    // 2) -150 bps below 24h TWAP (price dip) -> EXECUTE
    const dip = evaluateDcaTick({
      spotPriceUsdcPerCelo: 0.0985,
      twap24hUsdcPerCelo: twap,
      estimatedPoolImpactBps: 2.0,
    });
    expect(dip.deviationBps).toBe(-150);
    expect(dip.decision).toBe("EXECUTE");
    expect(dip.reasonCode).toBe("MARKET_CONDITIONS_OK");

    // 3) +35 bps above 24h TWAP (within +50 bps allowance) -> EXECUTE
    const mildUp = evaluateDcaTick({
      spotPriceUsdcPerCelo: 0.10035,
      twap24hUsdcPerCelo: twap,
      estimatedPoolImpactBps: 2.0,
    });
    expect(mildUp.deviationBps).toBe(35);
    expect(mildUp.decision).toBe("EXECUTE");
    expect(mildUp.reasonCode).toBe("MARKET_CONDITIONS_OK");
  });

  it("enforces dual slippage: 6.2 bps impact DEFERs, 3.2 bps impact EXECUTEs with 25 bps calldata buffer", () => {
    const highImpact = evaluateDcaTick({
      spotPriceUsdcPerCelo: 0.0565,
      twap24hUsdcPerCelo: 0.0565,
      estimatedPoolImpactBps: 6.2,
    });
    expect(highImpact.decision).toBe("DEFER");
    expect(highImpact.reasonCode).toBe("POOL_IMPACT_EXCEEDED");
    expect(highImpact.estimatedPoolImpactBps).toBe(6.2);

    const lowImpact = evaluateDcaTick({
      spotPriceUsdcPerCelo: 0.0565,
      twap24hUsdcPerCelo: 0.0565,
      estimatedPoolImpactBps: 3.2,
    });
    expect(lowImpact.decision).toBe("EXECUTE");
    expect(lowImpact.reasonCode).toBe("MARKET_CONDITIONS_OK");
    expect(lowImpact.executionSlippageBps).toBe(25);

    // Verify SwapRouter02 calldata uses the 25 bps executionSlippageBps buffer
    const quotedCeloWei = 10_000_000_000_000_000_000n; // 10 CELO quote
    const expectedMinOut = computeMinAmountOut(
      quotedCeloWei,
      lowImpact.executionSlippageBps,
    );
    expect(expectedMinOut).toBe(9_975_000_000_000_000_000n); // 99.75% of quote (25 bps buffer)

    const built = buildExactInputSingleCalldata({
      tokenIn: CELO_MAINNET_TOKENS.USDC,
      tokenOut: CELO_MAINNET_TOKENS.CELO,
      fee: 100,
      recipient: AGENT_WALLET,
      amountIn: 500_000n,
      quotedAmountOut: quotedCeloWei,
      maxSlippageBps: lowImpact.executionSlippageBps,
    });

    const decoded = decodeFunctionData({
      abi: UNISWAP_V3_SWAP_ROUTER_02_ABI,
      data: built.rawData,
    });
    expect(decoded.functionName).toBe("exactInputSingle");
    expect(decoded.args[0].amountOutMinimum).toBe(expectedMinOut);
    expect(built.attributionCode).toBe("celo_0518175d3efe");
  });

  it("triggers weekly ceiling circuit breaker when spot exceeds +15% above anchor price", () => {
    const anchor = 0.06;
    // +16% above anchor -> DEFER (WEEKLY_CEILING_EXCEEDED)
    const aboveCeiling = evaluateDcaTick({
      spotPriceUsdcPerCelo: 0.0696,
      twap24hUsdcPerCelo: 0.0695,
      anchorPriceUsdcPerCelo: anchor,
      estimatedPoolImpactBps: 1.5,
    });
    expect(aboveCeiling.decision).toBe("DEFER");
    expect(aboveCeiling.reasonCode).toBe("WEEKLY_CEILING_EXCEEDED");
    expect(aboveCeiling.ceilingPriceUsdcPerCelo).toBeCloseTo(0.069, 6);

    // +10% above anchor (below 15% ceiling) -> EXECUTE
    const belowCeiling = evaluateDcaTick({
      spotPriceUsdcPerCelo: 0.066,
      twap24hUsdcPerCelo: 0.066,
      anchorPriceUsdcPerCelo: anchor,
      estimatedPoolImpactBps: 1.5,
    });
    expect(belowCeiling.decision).toBe("EXECUTE");
  });

  it("preserves exact blockNumber and raw uint160 sqrtPriceX96 in JSONL decision log entries", () => {
    const rawSqrtPriceX96 = "18834912345678901234567890123456";
    const entry: DecisionLogEntry = {
      timestamp: "2026-11-24T06:00:00.000Z",
      mode: "DRY_RUN",
      blockNumber: 35_123_456,
      poolAddress: MOCK_POOL,
      sqrtPriceX96: rawSqrtPriceX96,
      spotPriceUsdcPerCelo: 0.0565,
      twap24hUsdcPerCelo: 0.0564,
      deviationBps: computeDeviationBps(0.0565, 0.0564),
      estimatedPoolImpactBps: 0.42,
      decision: "EXECUTE",
      reason: "Approved: within pool impact and TWAP thresholds",
      txHash: null,
    };

    const jsonLine = formatDecisionLogLine(entry);
    const parsed = JSON.parse(jsonLine) as DecisionLogEntry;
    expect(parsed.blockNumber).toBe(35_123_456);
    expect(parsed.sqrtPriceX96).toBe(rawSqrtPriceX96);
    expect(typeof parsed.sqrtPriceX96).toBe("string");
    expect(parsed.poolAddress).toBe(MOCK_POOL);
    expect(parsed.txHash).toBeNull();

    // Verify confined append & read round-trip + rolling 24h TWAP & weekly anchor helpers
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), "caprail-decision-log-"));
    try {
      appendDecisionLog(entry, { workspaceDir: tmpDir });
      const loaded = readDecisionLogs({ workspaceDir: tmpDir });
      expect(loaded).toHaveLength(1);
      expect(loaded[0]?.blockNumber).toBe(35_123_456);
      expect(loaded[0]?.sqrtPriceX96).toBe(rawSqrtPriceX96);

      const nowMs = Date.parse("2026-11-24T07:00:00.000Z");
      expect(computeRolling24hTwapFromLogs(loaded, nowMs)).toBe(0.0565);
      expect(getWeeklyAnchorPriceFromLogs(loaded, nowMs)).toBe(0.0565);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("Session-Only Agent Execution Decoupling (Human Control vs Agent Plane)", () => {
  const TEST_SESSION_KEY =
    "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" as Hex;

  it("rejects --live execution when session credentials are missing without asking for OWNER_PRIVATE_KEY", () => {
    expect(
      resolveLiveSessionCredentials({
        ALTANA_SESSION_PRIVATE_KEY: undefined,
        ALTANA_WALLET_ADDRESS: undefined,
      }),
    ).toBeNull();

    // Missing ALTANA_WALLET_ADDRESS must still fail
    expect(
      resolveLiveSessionCredentials({
        ALTANA_SESSION_PRIVATE_KEY: TEST_SESSION_KEY,
        ALTANA_WALLET_ADDRESS: undefined,
      }),
    ).toBeNull();

    // Missing ALTANA_SESSION_PRIVATE_KEY must still fail
    expect(
      resolveLiveSessionCredentials({
        ALTANA_SESSION_PRIVATE_KEY: undefined,
        ALTANA_WALLET_ADDRESS: AGENT_WALLET,
      }),
    ).toBeNull();

    // Both present -> succeeds cleanly with checksummed wallet address
    const valid = resolveLiveSessionCredentials({
      ALTANA_SESSION_PRIVATE_KEY: TEST_SESSION_KEY,
      ALTANA_WALLET_ADDRESS: AGENT_WALLET.toLowerCase(),
    });
    expect(valid).not.toBeNull();
    expect(valid?.walletAddress).toBe(AGENT_WALLET);
    expect(valid?.sessionPrivateKey).toBe(TEST_SESSION_KEY);
    expect(MISSING_LIVE_SESSION_CREDENTIALS_REASON).toBe(
      "LIVE mode requested without ALTANA_SESSION_PRIVATE_KEY and ALTANA_WALLET_ADDRESS configured",
    );
  });

  it("builds restricted Auto-DCA SessionPermissions scoped only to SwapRouter02 and USDC", () => {
    const perms = buildAutoDcaSessionPermissions(2_000_000n); // $2.00/day USDC
    expect(perms.calls).toHaveLength(2);
    expect(perms.calls?.[0]).toEqual({
      to: CELO_MAINNET_TOKENS.USDC,
      signature: AUTO_DCA_ERC20_APPROVE_SIGNATURE,
    });
    expect(perms.calls?.[1]).toEqual({
      to: CELO_MAINNET_ROUTERS.UNISWAP_V3_SWAP_ROUTER_02,
      signature: AUTO_DCA_EXACT_INPUT_SINGLE_SIGNATURE,
    });
    const usdcSpend = perms.spend?.find(
      (s) => s.token?.toLowerCase() === CELO_MAINNET_TOKENS.USDC.toLowerCase(),
    );
    expect(usdcSpend?.limit).toBe(2_000_000n);
    expect(usdcSpend?.period).toBe("day");
  });

  it("halts cleanly with HALTED_NO_GAS or DEFER for revoked/missing session key without OWNER_PRIVATE_KEY", async () => {
    // Case 1: Insufficient native CELO gas -> HALTED_NO_GAS
    const noGas = await executeAutoDcaWithSession({
      walletAddress: AGENT_WALLET,
      sessionPrivateKey: TEST_SESSION_KEY,
      amountInBaseUnits: 500_000n,
      dailySpendCapBaseUnits: 2_000_000n,
      publicClient: {
        getBalance: async () => 100_000_000_000_000n, // 0.0001 CELO < 0.002 CELO
        readContract: (async () => 1_000_000n) as never,
        simulateContract: (async () => ({ result: 1n })) as never,
        waitForTransactionReceipt: (async () => ({ status: "success" })) as never,
      },
    });
    expect(noGas.decision).toBe("HALTED_NO_GAS");
    expect(noGas.txHash).toBeNull();

    // Case 2: Session key not authorized on-chain (revoked or ungranted) -> DEFER
    const revokedKey = await executeAutoDcaWithSession({
      walletAddress: AGENT_WALLET,
      sessionPrivateKey: TEST_SESSION_KEY,
      amountInBaseUnits: 500_000n,
      dailySpendCapBaseUnits: 2_000_000n,
      publicClient: {
        getBalance: async () => 50_000_000_000_000_000n, // 0.05 CELO
        readContract: (async () => 2_000_000n) as never,
        simulateContract: (async () => ({ result: 1n })) as never,
        waitForTransactionReceipt: (async () => ({ status: "success" })) as never,
      },
      readOnChainKey: async () => null,
    });
    expect(revokedKey.decision).toBe("DEFER");
    expect(revokedKey.reason).toContain("not authorized on Altana wallet");
    expect(revokedKey.txHash).toBeNull();
  });
});
