import { getAddress, zeroAddress, type Address, type PublicClient } from "viem";
import {
  DcaDecisionPolicySchema,
  type DcaDecisionPolicy,
} from "../policy/index.js";
import {
  CELO_MAINNET_ROUTERS,
  CELO_MAINNET_TOKENS,
  UNISWAP_V3_FACTORY_ABI,
  UNISWAP_V3_POOL_ABI,
  type UniswapV3FeeTier,
} from "../wallet/index.js";

const Q96 = 2 ** 96;
const USDC_DECIMALS = 6;
const CELO_DECIMALS = 18;
const TWAP_WINDOW_SECONDS = 86_400;

export type DecisionGateVerdict = "EXECUTE" | "DEFER";

export type DecisionGateReasonCode =
  | "MARKET_CONDITIONS_OK"
  | "POOL_IMPACT_EXCEEDED"
  | "PRICE_ABOVE_TWAP_THRESHOLD"
  | "WEEKLY_CEILING_EXCEEDED"
  | "INVALID_MARKET_DATA";

export interface DcaTickEvaluationInput {
  spotPriceUsdcPerCelo: number;
  twap24hUsdcPerCelo: number;
  anchorPriceUsdcPerCelo?: number | undefined;
  orderSizeUsdc?: number | undefined;
  /** Optional raw pool state used to estimate pool price impact when estimatedPoolImpactBps is omitted. */
  sqrtPriceX96?: bigint | undefined;
  poolLiquidity?: bigint | undefined;
  token0IsCelo?: boolean | undefined;
  /** Optional pre-computed pool impact in bps (takes precedence over raw liquidity formula). */
  estimatedPoolImpactBps?: number | undefined;
  policy?: Partial<DcaDecisionPolicy> | undefined;
}

export interface DcaTickEvaluationResult {
  decision: DecisionGateVerdict;
  reasonCode: DecisionGateReasonCode;
  reason: string;
  spotPriceUsdcPerCelo: number;
  twap24hUsdcPerCelo: number;
  deviationBps: number;
  estimatedPoolImpactBps: number;
  executionSlippageBps: number;
  ceilingPriceUsdcPerCelo: number | null;
  policy: DcaDecisionPolicy;
}

export interface UniswapV3PoolSnapshot {
  blockNumber: number;
  poolAddress: Address;
  token0: Address;
  token1: Address;
  token0IsCelo: boolean;
  feeTier: UniswapV3FeeTier;
  sqrtPriceX96: bigint;
  tick: number;
  liquidity: bigint;
  spotPriceUsdcPerCelo: number;
  onChainTwap24hUsdcPerCelo: number | null;
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Converts Uniswap V3 `sqrtPriceX96` into human-readable USDC per 1 CELO.
 */
export function sqrtPriceX96ToUsdcPerCelo(
  sqrtPriceX96: bigint,
  token0IsCelo: boolean,
): number {
  if (sqrtPriceX96 <= 0n) {
    throw new Error("sqrtPriceX96 must be strictly positive");
  }
  const sqrtRatio = Number(sqrtPriceX96) / Q96;
  const rawPriceToken1PerToken0 = sqrtRatio * sqrtRatio;

  if (token0IsCelo) {
    // token0 = CELO (18), token1 = USDC (6) -> raw * 10^(18 - 6) = USDC per CELO
    return rawPriceToken1PerToken0 * 10 ** (CELO_DECIMALS - USDC_DECIMALS);
  }
  // token0 = USDC (6), token1 = CELO (18) -> raw * 10^(6 - 18) = CELO per USDC
  const celoPerUsdc =
    rawPriceToken1PerToken0 * 10 ** (USDC_DECIMALS - CELO_DECIMALS);
  return 1 / celoPerUsdc;
}

/**
 * Converts an average Uniswap V3 tick into human-readable USDC per 1 CELO.
 */
export function tickToUsdcPerCelo(tick: number, token0IsCelo: boolean): number {
  const rawPriceToken1PerToken0 = Math.pow(1.0001, tick);
  if (token0IsCelo) {
    return rawPriceToken1PerToken0 * 10 ** (CELO_DECIMALS - USDC_DECIMALS);
  }
  const celoPerUsdc =
    rawPriceToken1PerToken0 * 10 ** (USDC_DECIMALS - CELO_DECIMALS);
  return 1 / celoPerUsdc;
}

/**
 * Estimates single-tick Uniswap V3 execution price impact in basis points for a
 * `USDC -> CELO` swap against active pool liquidity `L` and `sqrtPriceX96`.
 */
export function estimatePoolImpactBps(opts: {
  amountInUsdcBaseUnits: bigint;
  sqrtPriceX96: bigint;
  liquidity: bigint;
  feeTier: UniswapV3FeeTier;
  token0IsCelo: boolean;
}): number {
  if (opts.amountInUsdcBaseUnits <= 0n) {
    return 0;
  }
  if (opts.liquidity <= 0n || opts.sqrtPriceX96 <= 0n) {
    return 10_000;
  }

  const feeFactor = 1 - opts.feeTier / 1_000_000;
  const amountInNet = Number(opts.amountInUsdcBaseUnits) * feeFactor;
  const L = Number(opts.liquidity);
  const sqrtP = Number(opts.sqrtPriceX96) / Q96;

  // For exact-input swap inside active tick:
  // - Selling token1 (USDC) when token0=CELO: delta(sqrtP)/sqrtP = amountInNet / (L * sqrtP)
  // - Selling token0 (USDC) when token0=USDC: delta(1/sqrtP)/(1/sqrtP) = (amountInNet * sqrtP) / L
  const fractionalImpact = opts.token0IsCelo
    ? amountInNet / (L * sqrtP)
    : (amountInNet * sqrtP) / L;

  if (!Number.isFinite(fractionalImpact) || fractionalImpact < 0) {
    return 10_000;
  }

  return roundTo(fractionalImpact * 10_000, 4);
}

/**
 * Computes signed price deviation in basis points:
 * `((spotPrice - twap24h) / twap24h) * 10000`.
 * Positive values mean spot is above 24h TWAP; negative values mean a dip below TWAP.
 */
export function computeDeviationBps(
  spotPriceUsdcPerCelo: number,
  twap24hUsdcPerCelo: number,
): number {
  if (twap24hUsdcPerCelo <= 0) {
    throw new Error("twap24hUsdcPerCelo must be strictly positive");
  }
  return roundTo(
    ((spotPriceUsdcPerCelo - twap24hUsdcPerCelo) / twap24hUsdcPerCelo) * 10_000,
    2,
  );
}

/**
 * Estimates expected CELO output in wei from spot price and pool fee tier.
 * Used as a fallback quote if on-chain simulation cannot run (e.g., unit tests or dry-run).
 */
export function estimateCeloOutWeiFromSpot(
  amountInUsdcBaseUnits: bigint,
  spotPriceUsdcPerCelo: number,
  feeTier: UniswapV3FeeTier = 100,
): bigint {
  if (amountInUsdcBaseUnits <= 0n || spotPriceUsdcPerCelo <= 0) {
    return 0n;
  }
  const usdcHuman = Number(amountInUsdcBaseUnits) / 10 ** USDC_DECIMALS;
  const netUsdc = usdcHuman * (1 - feeTier / 1_000_000);
  const celoHuman = netUsdc / spotPriceUsdcPerCelo;
  return BigInt(Math.floor(celoHuman * 10 ** CELO_DECIMALS));
}

/**
 * Pure, deterministic market decision gate for a single Auto-DCA evaluation tick.
 *
 * Guardrail precedence:
 * 1. Valid positive price inputs
 * 2. Weekly price ceiling circuit breaker (default +15% above anchor)
 * 3. Pre-flight pool impact check (default max 5 bps)
 * 4. Asymmetric 24h TWAP deviation check (defer only if spot > +50 bps above TWAP; dips execute)
 */
export function evaluateDcaTick(
  input: DcaTickEvaluationInput,
): DcaTickEvaluationResult {
  const policy = DcaDecisionPolicySchema.parse({
    ...input.policy,
    ...(input.orderSizeUsdc !== undefined
      ? { orderSizeUsdc: input.orderSizeUsdc }
      : {}),
  });

  const spot = input.spotPriceUsdcPerCelo;
  const twap = input.twap24hUsdcPerCelo;

  if (!Number.isFinite(spot) || spot <= 0 || !Number.isFinite(twap) || twap <= 0) {
    return {
      decision: "DEFER",
      reasonCode: "INVALID_MARKET_DATA",
      reason: "Invalid spot or 24h TWAP price from pool state",
      spotPriceUsdcPerCelo: spot,
      twap24hUsdcPerCelo: twap,
      deviationBps: 0,
      estimatedPoolImpactBps: 10_000,
      executionSlippageBps: policy.executionSlippageBps,
      ceilingPriceUsdcPerCelo: null,
      policy,
    };
  }

  const deviationBps = computeDeviationBps(spot, twap);

  let estimatedImpactBps: number;
  if (input.estimatedPoolImpactBps !== undefined) {
    estimatedImpactBps = roundTo(input.estimatedPoolImpactBps, 4);
  } else if (
    input.sqrtPriceX96 !== undefined &&
    input.poolLiquidity !== undefined
  ) {
    const amountInBaseUnits = BigInt(
      Math.round(policy.orderSizeUsdc * 10 ** USDC_DECIMALS),
    );
    estimatedImpactBps = estimatePoolImpactBps({
      amountInUsdcBaseUnits: amountInBaseUnits,
      sqrtPriceX96: input.sqrtPriceX96,
      liquidity: input.poolLiquidity,
      feeTier: policy.poolFeeTier,
      token0IsCelo: input.token0IsCelo ?? true,
    });
  } else {
    estimatedImpactBps = 0;
  }

  const ceilingPrice =
    input.anchorPriceUsdcPerCelo !== undefined && input.anchorPriceUsdcPerCelo > 0
      ? roundTo(
          input.anchorPriceUsdcPerCelo * (1 + policy.maxCeilingPct / 100),
          6,
        )
      : null;

  // 1) Weekly ceiling circuit breaker
  if (ceilingPrice !== null && spot > ceilingPrice) {
    return {
      decision: "DEFER",
      reasonCode: "WEEKLY_CEILING_EXCEEDED",
      reason: `Spot price ${spot.toFixed(6)} USDC/CELO exceeds weekly ceiling ${ceilingPrice.toFixed(6)} (+${policy.maxCeilingPct}% above anchor ${input.anchorPriceUsdcPerCelo!.toFixed(6)})`,
      spotPriceUsdcPerCelo: spot,
      twap24hUsdcPerCelo: twap,
      deviationBps,
      estimatedPoolImpactBps: estimatedImpactBps,
      executionSlippageBps: policy.executionSlippageBps,
      ceilingPriceUsdcPerCelo: ceilingPrice,
      policy,
    };
  }

  // 2) Dual slippage pre-flight pool impact check (default 5 bps)
  if (estimatedImpactBps > policy.maxPoolImpactBps) {
    return {
      decision: "DEFER",
      reasonCode: "POOL_IMPACT_EXCEEDED",
      reason: `Estimated pool impact ${estimatedImpactBps} bps exceeds pre-flight cap ${policy.maxPoolImpactBps} bps`,
      spotPriceUsdcPerCelo: spot,
      twap24hUsdcPerCelo: twap,
      deviationBps,
      estimatedPoolImpactBps: estimatedImpactBps,
      executionSlippageBps: policy.executionSlippageBps,
      ceilingPriceUsdcPerCelo: ceilingPrice,
      policy,
    };
  }

  // 3) Asymmetric 24h TWAP deviation gate: defer only on upside spikes (> +50 bps).
  //    Negative deviations (dips) and small moves (<= +50 bps) are permitted to EXECUTE.
  if (deviationBps > policy.maxDeviationAboveTwapBps) {
    return {
      decision: "DEFER",
      reasonCode: "PRICE_ABOVE_TWAP_THRESHOLD",
      reason: `Spot price is +${deviationBps} bps above 24h TWAP (threshold: +${policy.maxDeviationAboveTwapBps} bps)`,
      spotPriceUsdcPerCelo: spot,
      twap24hUsdcPerCelo: twap,
      deviationBps,
      estimatedPoolImpactBps: estimatedImpactBps,
      executionSlippageBps: policy.executionSlippageBps,
      ceilingPriceUsdcPerCelo: ceilingPrice,
      policy,
    };
  }

  return {
    decision: "EXECUTE",
    reasonCode: "MARKET_CONDITIONS_OK",
    reason: `Approved: impact ${estimatedImpactBps} bps <= ${policy.maxPoolImpactBps} bps, deviation ${deviationBps >= 0 ? "+" : ""}${deviationBps} bps <= +${policy.maxDeviationAboveTwapBps} bps (execution slippage buffer: ${policy.executionSlippageBps} bps)`,
    spotPriceUsdcPerCelo: spot,
    twap24hUsdcPerCelo: twap,
    deviationBps,
    estimatedPoolImpactBps: estimatedImpactBps,
    executionSlippageBps: policy.executionSlippageBps,
    ceilingPriceUsdcPerCelo: ceilingPrice,
    policy,
  };
}

/**
 * Resolves the Uniswap V3 pool on Celo Mainnet via `UniswapV3Factory.getPool`
 * and reads live `blockNumber`, `slot0()`, `liquidity()`, and optional `observe([86400, 0])`.
 */
export async function readUniswapV3PoolSnapshot(opts: {
  publicClient: Pick<PublicClient, "getBlockNumber" | "readContract">;
  feeTier?: UniswapV3FeeTier | undefined;
  factoryAddress?: Address | undefined;
  usdcAddress?: Address | undefined;
  celoAddress?: Address | undefined;
}): Promise<UniswapV3PoolSnapshot> {
  const feeTier = opts.feeTier ?? 100;
  const factoryAddress =
    opts.factoryAddress ?? CELO_MAINNET_ROUTERS.UNISWAP_V3_FACTORY;
  const usdcAddress = getAddress(opts.usdcAddress ?? CELO_MAINNET_TOKENS.USDC);
  const celoAddress = getAddress(opts.celoAddress ?? CELO_MAINNET_TOKENS.CELO);

  const poolAddress = await opts.publicClient.readContract({
    address: factoryAddress,
    abi: UNISWAP_V3_FACTORY_ABI,
    functionName: "getPool",
    args: [usdcAddress, celoAddress, feeTier],
  });

  if (poolAddress.toLowerCase() === zeroAddress) {
    throw new Error(
      `Uniswap V3 pool does not exist on Celo Mainnet for USDC/CELO fee tier ${feeTier}`,
    );
  }

  const [blockNumberBigInt, slot0, liquidity, token0, token1] =
    await Promise.all([
      opts.publicClient.getBlockNumber(),
      opts.publicClient.readContract({
        address: poolAddress,
        abi: UNISWAP_V3_POOL_ABI,
        functionName: "slot0",
      }),
      opts.publicClient.readContract({
        address: poolAddress,
        abi: UNISWAP_V3_POOL_ABI,
        functionName: "liquidity",
      }),
      opts.publicClient.readContract({
        address: poolAddress,
        abi: UNISWAP_V3_POOL_ABI,
        functionName: "token0",
      }),
      opts.publicClient.readContract({
        address: poolAddress,
        abi: UNISWAP_V3_POOL_ABI,
        functionName: "token1",
      }),
    ]);

  const sqrtPriceX96 = slot0[0];
  const tick = Number(slot0[1]);
  const token0IsCelo = token0.toLowerCase() === celoAddress.toLowerCase();
  const spotPriceUsdcPerCelo = roundTo(
    sqrtPriceX96ToUsdcPerCelo(sqrtPriceX96, token0IsCelo),
    6,
  );

  // Attempt on-chain 24h TWAP via observe([86400, 0]).
  // Pools with low observationCardinality may revert with "OLD"; caller falls back cleanly.
  let onChainTwap24hUsdcPerCelo: number | null = null;
  try {
    const [tickCumulatives] = await opts.publicClient.readContract({
      address: poolAddress,
      abi: UNISWAP_V3_POOL_ABI,
      functionName: "observe",
      args: [[TWAP_WINDOW_SECONDS, 0]],
    });
    const oldest = tickCumulatives[0];
    const newest = tickCumulatives[1];
    if (oldest !== undefined && newest !== undefined) {
      const avgTick = Number(newest - oldest) / TWAP_WINDOW_SECONDS;
      onChainTwap24hUsdcPerCelo = roundTo(
        tickToUsdcPerCelo(avgTick, token0IsCelo),
        6,
      );
    }
  } catch {
    onChainTwap24hUsdcPerCelo = null;
  }

  return {
    blockNumber: Number(blockNumberBigInt),
    poolAddress: getAddress(poolAddress),
    token0: getAddress(token0),
    token1: getAddress(token1),
    token0IsCelo,
    feeTier,
    sqrtPriceX96,
    tick,
    liquidity,
    spotPriceUsdcPerCelo,
    onChainTwap24hUsdcPerCelo,
  };
}
