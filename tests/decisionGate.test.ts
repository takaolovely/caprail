import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { decodeFunctionData, type Address, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import {
  MISSING_LIVE_SESSION_CREDENTIALS_REASON,
  parseCliArgs,
  resolveLiveSessionCredentials,
} from "../src/cli/dca-tick.js";
import { DcaDecisionPolicySchema } from "../src/policy/index.js";
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
  buildAutoDcaSessionPermissions,
  buildExactInputSingleCalldata,
  CELO_MAINNET_ROUTERS,
  CELO_MAINNET_TOKENS,
  computeMinAmountOut,
  ERC20_ABI,
  EXACT_INPUT_SINGLE_SELECTOR,
  executeAutoDcaWithSession,
  grantAutoDcaSession,
  INSUFFICIENT_USDC_ALLOWANCE_REASON,
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

  it("defaults dailySpendCapUsdc to 4.0 (supporting up to 10 USDC/day) and parses --daily-cap in dca:tick CLI", () => {
    const defaultPolicy = DcaDecisionPolicySchema.parse({});
    expect(defaultPolicy.dailySpendCapUsdc).toBe(4.0);

    const maxPolicy = DcaDecisionPolicySchema.parse({ dailySpendCapUsdc: 10 });
    expect(maxPolicy.dailySpendCapUsdc).toBe(10);

    expect(
      DcaDecisionPolicySchema.safeParse({ dailySpendCapUsdc: 10.01 }).success,
    ).toBe(false);

    const parsedArgs = parseCliArgs([
      "--live",
      "--amount",
      "0.1",
      "--daily-cap",
      "6.5",
    ]);
    expect(parsedArgs.live).toBe(true);
    expect(parsedArgs.orderSizeUsdc).toBe(0.1);
    expect(parsedArgs.dailySpendCapUsdc).toBe(6.5);
  });

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

  it("locks Auto-DCA SessionPermissions strictly to SwapRouter02 raw selector 0x04e45aaf (excludes USDC.approve)", () => {
    expect(EXACT_INPUT_SINGLE_SELECTOR).toBe("0x04e45aaf");
    expect(EXACT_INPUT_SINGLE_SELECTOR).not.toBe("0x414bf389");

    const perms = buildAutoDcaSessionPermissions(4_000_000n); // $4.00/day USDC
    expect(perms.calls).toHaveLength(1);
    expect(perms.calls?.[0]).toEqual({
      to: CELO_MAINNET_ROUTERS.UNISWAP_V3_SWAP_ROUTER_02,
      signature: "0x04e45aaf",
    });

    // Verify zero { to }-only catch-all entries and zero USDC / 0x095ea7b3 permissions
    for (const entry of perms.calls ?? []) {
      expect("signature" in entry && typeof entry.signature === "string").toBe(true);
      if ("signature" in entry && typeof entry.signature === "string") {
        expect(entry.signature).toMatch(/^0x[0-9a-f]{8}$/);
        expect(entry.signature.toLowerCase()).not.toBe("0x095ea7b3");
      }
      if ("to" in entry && typeof entry.to === "string") {
        expect(entry.to.toLowerCase()).not.toBe(
          CELO_MAINNET_TOKENS.USDC.toLowerCase(),
        );
      }
    }

    const usdcSpend = perms.spend?.find(
      (s) => s.token?.toLowerCase() === CELO_MAINNET_TOKENS.USDC.toLowerCase(),
    );
    expect(usdcSpend?.limit).toBe(4_000_000n);
    expect(usdcSpend?.period).toBe("day");
  });

  it("computes bounded owner allowance (dailyCap * days) in grantAutoDcaSession and skips approve when sufficient", async () => {
    const OWNER_TEST_KEY =
      "0x1111111111111111111111111111111111111111111111111111111111111111" as Hex;
    const expectedRequiredAllowance = 56_000_000n; // $4/day * 14 days = $56 USDC (never maxUint256)

    // Case 1: Current allowance < requiredAllowance -> owner executes bounded USDC.approve(SwapRouter02, 56_000_000n)
    const executedApproveCalls: Array<{ to: Address; data?: Hex | undefined }> = [];
    const grantedPermissions: unknown[] = [];

    const grantedWithApprove = await grantAutoDcaSession({
      adminPrivateKey: OWNER_TEST_KEY,
      sessionPrivateKey: TEST_SESSION_KEY,
      dailySpendCapUsdc: 4,
      days: 14,
      publicClient: {
        getCode: async () => "0xef01001234" as Hex,
        readContract: (async () => 0n) as never,
        waitForTransactionReceipt: (async () => ({ status: "success" })) as never,
      },
      client: {
        createWallet: (async () => {
          throw new Error("should reuse upgraded wallet");
        }) as never,
        execute: (async (opts: { calls: Array<{ to: Address; data?: Hex }> }) => {
          executedApproveCalls.push(...opts.calls);
          return {
            status: "CONFIRMED",
            callsId: "0xaaaa" as Hex,
            transactionHash:
              "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Hex,
          };
        }) as never,
        grantSession: (async (opts: { permissions: unknown }) => {
          grantedPermissions.push(opts.permissions);
          return {
            status: "granted",
            keyId: "0x11" as Hex,
            keyHash: "0x22" as Hex,
            transactionHash:
              "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Hex,
            legs: [],
          };
        }) as never,
      },
    });

    expect(grantedWithApprove.requiredAllowanceUnits).toBe(expectedRequiredAllowance);
    expect(grantedWithApprove.approvalSkipped).toBe(false);
    expect(grantedWithApprove.approvedAllowanceUnits).toBe(expectedRequiredAllowance);
    expect(grantedWithApprove.approvalTxHash).toBe(
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    expect(executedApproveCalls).toHaveLength(1);
    expect(executedApproveCalls[0]?.to).toBe(CELO_MAINNET_TOKENS.USDC);
    const decodedApprove = decodeFunctionData({
      abi: ERC20_ABI,
      data: executedApproveCalls[0]?.data?.slice(0, 138) as Hex,
    });
    expect(decodedApprove.functionName).toBe("approve");
    expect(decodedApprove.args).toEqual([
      CELO_MAINNET_ROUTERS.UNISWAP_V3_SWAP_ROUTER_02,
      expectedRequiredAllowance,
    ]);
    expect(grantedPermissions).toHaveLength(1);

    // Case 2: Existing allowance >= dailyCap * days -> skips USDC.approve completely (0 execute calls)
    let executeCallCount = 0;
    const grantedSkipApprove = await grantAutoDcaSession({
      adminPrivateKey: OWNER_TEST_KEY,
      sessionPrivateKey: TEST_SESSION_KEY,
      dailySpendCapUsdc: 4,
      days: 14,
      publicClient: {
        getCode: async () => "0xef01001234" as Hex,
        readContract: (async () => expectedRequiredAllowance) as never,
        waitForTransactionReceipt: (async () => ({ status: "success" })) as never,
      },
      client: {
        createWallet: (async () => {
          throw new Error("should reuse upgraded wallet");
        }) as never,
        execute: (async () => {
          executeCallCount += 1;
          throw new Error("execute must not be called when allowance is sufficient");
        }) as never,
        grantSession: (async () => ({
          status: "granted",
          keyId: "0x11" as Hex,
          keyHash: "0x22" as Hex,
          transactionHash:
            "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" as Hex,
          legs: [],
        })) as never,
      },
    });

    expect(executeCallCount).toBe(0);
    expect(grantedSkipApprove.approvalSkipped).toBe(true);
    expect(grantedSkipApprove.approvalTxHash).toBeNull();
    expect(grantedSkipApprove.requiredAllowanceUnits).toBe(expectedRequiredAllowance);
    expect(grantedSkipApprove.approvedAllowanceUnits).toBe(expectedRequiredAllowance);
  });

  it("defers cleanly without broadcasting when USDC allowance < amountIn, or on low gas / revoked session", async () => {
    // Case 1: Insufficient native CELO gas -> HALTED_NO_GAS
    const noGas = await executeAutoDcaWithSession({
      walletAddress: AGENT_WALLET,
      sessionPrivateKey: TEST_SESSION_KEY,
      amountInBaseUnits: 1_000_000n,
      dailySpendCapBaseUnits: 4_000_000n,
      publicClient: {
        getBalance: async () => 100_000_000_000_000n, // 0.0001 CELO < 0.002 CELO
        readContract: (async () => 2_000_000n) as never,
        simulateContract: (async () => ({ result: 1n })) as never,
        waitForTransactionReceipt: (async () => ({ status: "success" })) as never,
      },
    });
    expect(noGas.decision).toBe("HALTED_NO_GAS");
    expect(noGas.txHash).toBeNull();

    // Case 2: Insufficient USDC allowance for SwapRouter02 -> DEFER cleanly without calling client.execute
    let broadcastCalls = 0;
    const lowAllowance = await executeAutoDcaWithSession({
      walletAddress: AGENT_WALLET,
      sessionPrivateKey: TEST_SESSION_KEY,
      amountInBaseUnits: 1_000_000n, // $1.00 USDC
      dailySpendCapBaseUnits: 4_000_000n,
      publicClient: {
        getBalance: async () => 50_000_000_000_000_000n, // 0.05 CELO
        readContract: (async (args: { functionName: string }) => {
          if (args.functionName === "balanceOf") return 10_000_000n; // $10 USDC
          if (args.functionName === "allowance") return 500_000n; // $0.50 < $1.00
          return 0n;
        }) as never,
        simulateContract: (async () => ({ result: 1n })) as never,
        waitForTransactionReceipt: (async () => ({ status: "success" })) as never,
      },
      client: {
        execute: (async () => {
          broadcastCalls += 1;
          throw new Error("must not broadcast when allowance < amountIn");
        }) as never,
      } as never,
    });
    expect(broadcastCalls).toBe(0);
    expect(lowAllowance.decision).toBe("DEFER");
    expect(lowAllowance.reason).toBe(INSUFFICIENT_USDC_ALLOWANCE_REASON);
    expect(lowAllowance.reason).toBe(
      "Insufficient USDC allowance for SwapRouter02 (owner must run session:grant to top up bounded approval)",
    );
    expect(lowAllowance.txHash).toBeNull();

    // Case 3: Session key not authorized on-chain (revoked or ungranted) -> DEFER
    const revokedKey = await executeAutoDcaWithSession({
      walletAddress: AGENT_WALLET,
      sessionPrivateKey: TEST_SESSION_KEY,
      amountInBaseUnits: 1_000_000n,
      dailySpendCapBaseUnits: 4_000_000n,
      publicClient: {
        getBalance: async () => 50_000_000_000_000_000n, // 0.05 CELO
        readContract: (async () => 10_000_000n) as never,
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
