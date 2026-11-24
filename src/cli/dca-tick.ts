import { createPublicClient, getAddress, http, type Address, type Hex } from "viem";
import { celo } from "viem/chains";
import { pathToFileURL } from "node:url";
import { loadEnv, type AppEnv } from "../config/env.js";
import {
  appendDecisionLog,
  computeRolling24hTwapFromLogs,
  evaluateDcaTick,
  getWeeklyAnchorPriceFromLogs,
  readDecisionLogs,
  readUniswapV3PoolSnapshot,
  type DecisionLogEntry,
} from "../engine/index.js";
import {
  DcaDecisionPolicySchema,
  type DcaDecisionPolicy,
} from "../policy/index.js";
import {
  CAPRAIL_DEFAULT_ATTRIBUTION_CODE,
  executeAutoDcaWithSession,
  type UniswapV3FeeTier,
} from "../wallet/index.js";

export const MISSING_LIVE_SESSION_CREDENTIALS_REASON =
  "LIVE mode requested without ALTANA_SESSION_PRIVATE_KEY and ALTANA_WALLET_ADDRESS configured";

export interface CliOptions {
  live: boolean;
  orderSizeUsdc?: number | undefined;
  maxImpactBps?: number | undefined;
  maxDeviationBps?: number | undefined;
  execSlippageBps?: number | undefined;
  maxCeilingPct?: number | undefined;
  feeTier?: UniswapV3FeeTier | undefined;
}

export interface LiveSessionCredentials {
  walletAddress: Address;
  sessionPrivateKey: Hex;
}

/**
 * Validates that ONLY session-plane credentials (`ALTANA_SESSION_PRIVATE_KEY` and
 * `ALTANA_WALLET_ADDRESS`) are used for autonomous `--live` execution.
 * Intentionally ignores `OWNER_PRIVATE_KEY` and `ALTANA_ADMIN_PRIVATE_KEY`.
 */
export function resolveLiveSessionCredentials(
  env: Pick<AppEnv, "ALTANA_SESSION_PRIVATE_KEY" | "ALTANA_WALLET_ADDRESS">,
): LiveSessionCredentials | null {
  if (
    env.ALTANA_SESSION_PRIVATE_KEY === undefined ||
    env.ALTANA_WALLET_ADDRESS === undefined
  ) {
    return null;
  }
  return {
    walletAddress: getAddress(env.ALTANA_WALLET_ADDRESS),
    sessionPrivateKey: env.ALTANA_SESSION_PRIVATE_KEY as Hex,
  };
}

function parseNumberFlag(argv: readonly string[], flag: string): number | undefined {
  const idx = argv.indexOf(flag);
  if (idx === -1 || idx + 1 >= argv.length) return undefined;
  const raw = argv[idx + 1];
  if (raw === undefined) return undefined;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric value for ${flag}: "${raw}"`);
  }
  return parsed;
}

export function parseCliArgs(argv: readonly string[]): CliOptions {
  const live = argv.includes("--live") && !argv.includes("--dry-run");
  const feeRaw = parseNumberFlag(argv, "--fee-tier");
  let feeTier: UniswapV3FeeTier | undefined;
  if (feeRaw !== undefined) {
    if (feeRaw !== 100 && feeRaw !== 500 && feeRaw !== 3000 && feeRaw !== 10000) {
      throw new Error(
        `Invalid --fee-tier "${feeRaw}". Expected one of 100, 500, 3000, 10000.`,
      );
    }
    feeTier = feeRaw;
  }

  return {
    live,
    orderSizeUsdc: parseNumberFlag(argv, "--amount"),
    maxImpactBps: parseNumberFlag(argv, "--max-impact-bps"),
    maxDeviationBps: parseNumberFlag(argv, "--max-deviation-bps"),
    execSlippageBps: parseNumberFlag(argv, "--exec-slippage-bps"),
    maxCeilingPct: parseNumberFlag(argv, "--max-ceiling-pct"),
    feeTier,
  };
}

function emitAndLog(entry: DecisionLogEntry): void {
  appendDecisionLog(entry);
  process.stdout.write(`${JSON.stringify(entry)}\n`);
}

export async function runDcaTick(argv: readonly string[] = process.argv.slice(2)): Promise<DecisionLogEntry> {
  const opts = parseCliArgs(argv);
  const env = loadEnv();
  const attributionCode =
    env.CELO_ATTRIBUTION_CODE ?? CAPRAIL_DEFAULT_ATTRIBUTION_CODE;

  const policy: DcaDecisionPolicy = DcaDecisionPolicySchema.parse({
    ...(opts.orderSizeUsdc !== undefined
      ? { orderSizeUsdc: opts.orderSizeUsdc }
      : {}),
    ...(opts.maxImpactBps !== undefined
      ? { maxPoolImpactBps: opts.maxImpactBps }
      : {}),
    ...(opts.maxDeviationBps !== undefined
      ? { maxDeviationAboveTwapBps: opts.maxDeviationBps }
      : {}),
    ...(opts.execSlippageBps !== undefined
      ? { executionSlippageBps: opts.execSlippageBps }
      : {}),
    ...(opts.maxCeilingPct !== undefined
      ? { maxCeilingPct: opts.maxCeilingPct }
      : {}),
    ...(opts.feeTier !== undefined ? { poolFeeTier: opts.feeTier } : {}),
  });

  const publicClient = createPublicClient({
    chain: celo,
    transport: http(env.CELO_RPC_URL),
  });

  // 1) Fetch live Celo Mainnet Uniswap V3 pool state (USDC/CELO 0.01% by default)
  const snapshot = await readUniswapV3PoolSnapshot({
    publicClient,
    feeTier: policy.poolFeeTier,
  });

  const nowMs = Date.now();
  const timestamp = new Date(nowMs).toISOString();
  const priorLogs = readDecisionLogs();

  // 2) Resolve 24h TWAP: on-chain observe([86400, 0]) -> rolling 24h log avg -> cold-start spot
  const twap24hUsdcPerCelo =
    snapshot.onChainTwap24hUsdcPerCelo ??
    computeRolling24hTwapFromLogs(priorLogs, nowMs) ??
    snapshot.spotPriceUsdcPerCelo;

  const anchorPriceUsdcPerCelo =
    getWeeklyAnchorPriceFromLogs(priorLogs, nowMs) ??
    snapshot.spotPriceUsdcPerCelo;

  // 3) Evaluate pure deterministic decision gate
  const evalResult = evaluateDcaTick({
    spotPriceUsdcPerCelo: snapshot.spotPriceUsdcPerCelo,
    twap24hUsdcPerCelo,
    anchorPriceUsdcPerCelo,
    sqrtPriceX96: snapshot.sqrtPriceX96,
    poolLiquidity: snapshot.liquidity,
    token0IsCelo: snapshot.token0IsCelo,
    policy,
  });

  const mode = opts.live ? "LIVE" : "DRY_RUN";

  // 4) DRY_RUN or DEFER: log block-anchored decision without broadcasting
  if (!opts.live || evalResult.decision === "DEFER") {
    const entry: DecisionLogEntry = {
      timestamp,
      mode,
      blockNumber: snapshot.blockNumber,
      poolAddress: snapshot.poolAddress,
      sqrtPriceX96: snapshot.sqrtPriceX96.toString(),
      spotPriceUsdcPerCelo: evalResult.spotPriceUsdcPerCelo,
      twap24hUsdcPerCelo: evalResult.twap24hUsdcPerCelo,
      deviationBps: evalResult.deviationBps,
      estimatedPoolImpactBps: evalResult.estimatedPoolImpactBps,
      decision: evalResult.decision,
      reason: evalResult.reason,
      txHash: null,
    };
    emitAndLog(entry);
    return entry;
  }

  // 5) LIVE EXECUTION PATH: strictly session-only (never uses OWNER_PRIVATE_KEY)
  const credentials = resolveLiveSessionCredentials(env);
  if (credentials === null) {
    const entry: DecisionLogEntry = {
      timestamp,
      mode: "LIVE",
      blockNumber: snapshot.blockNumber,
      poolAddress: snapshot.poolAddress,
      sqrtPriceX96: snapshot.sqrtPriceX96.toString(),
      spotPriceUsdcPerCelo: evalResult.spotPriceUsdcPerCelo,
      twap24hUsdcPerCelo: evalResult.twap24hUsdcPerCelo,
      deviationBps: evalResult.deviationBps,
      estimatedPoolImpactBps: evalResult.estimatedPoolImpactBps,
      decision: "DEFER",
      reason: MISSING_LIVE_SESSION_CREDENTIALS_REASON,
      txHash: null,
    };
    emitAndLog(entry);
    return entry;
  }

  const amountInBaseUnits = BigInt(Math.round(policy.orderSizeUsdc * 1_000_000));
  const dailySpendCapBaseUnits = BigInt(
    Math.round(policy.dailySpendCapUsdc * 1_000_000),
  );

  const execResult = await executeAutoDcaWithSession({
    walletAddress: credentials.walletAddress,
    sessionPrivateKey: credentials.sessionPrivateKey,
    amountInBaseUnits,
    dailySpendCapBaseUnits,
    feeTier: policy.poolFeeTier,
    executionSlippageBps: policy.executionSlippageBps,
    spotPriceUsdcPerCelo: evalResult.spotPriceUsdcPerCelo,
    attributionCode,
    rpcUrl: env.CELO_RPC_URL,
  });

  const entry: DecisionLogEntry = {
    timestamp,
    mode: "LIVE",
    blockNumber: snapshot.blockNumber,
    poolAddress: snapshot.poolAddress,
    sqrtPriceX96: snapshot.sqrtPriceX96.toString(),
    spotPriceUsdcPerCelo: evalResult.spotPriceUsdcPerCelo,
    twap24hUsdcPerCelo: evalResult.twap24hUsdcPerCelo,
    deviationBps: evalResult.deviationBps,
    estimatedPoolImpactBps: evalResult.estimatedPoolImpactBps,
    decision: execResult.decision,
    reason: execResult.reason,
    txHash: execResult.txHash,
  };
  emitAndLog(entry);
  return entry;
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
  runDcaTick().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${JSON.stringify({ error: message })}\n`);
    process.exitCode = 1;
  });
}
