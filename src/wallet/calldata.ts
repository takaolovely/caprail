import {
  encodeFunctionData,
  getAddress,
  parseAbi,
  toFunctionSelector,
  type Address,
  type Hex,
} from "viem";
import type { DecodedSuffix } from "@celo/attribution-tags";
import {
  appendAttributionTag,
  CAPRAIL_DEFAULT_ATTRIBUTION_CODE,
  decodeAttributionTag,
} from "./attribution.js";

/**
 * Canonical Celo Mainnet (Chain ID 42220) token contract addresses.
 */
export const CELO_MAINNET_TOKENS = {
  /** Native Circle USDC on Celo Mainnet (6 decimals) */
  USDC: getAddress("0xcebA9300f2b948710d2653dD7B07f33A8B32118C") as Address,
  /** Tether USD₮ on Celo Mainnet (6 decimals) */
  USDT: getAddress("0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e") as Address,
  /** Mento cUSD on Celo Mainnet (18 decimals) */
  cUSD: getAddress("0x765DE816845861e75A25fCA122bb6898B8B1282a") as Address,
  /** Native CELO ERC-20 wrapper on Celo Mainnet (18 decimals) */
  CELO: getAddress("0x471EcE3750Da237f93B8E339c536989b8978a438") as Address,
} as const;

/**
 * Canonical Celo Mainnet (Chain ID 42220) DEX routers and factories.
 */
export const CELO_MAINNET_ROUTERS = {
  /** Uniswap V3 SwapRouter02 on Celo Mainnet */
  UNISWAP_V3_SWAP_ROUTER_02: getAddress(
    "0x5615CDAb10dc425a742d643d949a7F474C01abc4",
  ) as Address,
  /** Uniswap V3 Factory on Celo Mainnet */
  UNISWAP_V3_FACTORY: getAddress(
    "0xAfE208a311B21f13EF87E33A90049fC17A7acDEc",
  ) as Address,
} as const;

export const ERC20_TRANSFER_SELECTOR = "0xa9059cbb" as const;

export const ERC20_ABI = parseAbi([
  "function transfer(address to, uint256 value) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function approve(address spender, uint256 value) external returns (bool)",
]);

export const UNISWAP_V3_FACTORY_ABI = parseAbi([
  "function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)",
]);

export const UNISWAP_V3_POOL_ABI = parseAbi([
  "function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function liquidity() external view returns (uint128)",
  "function observe(uint32[] secondsAgos) external view returns (int56[] tickCumulatives, uint160[] secondsPerLiquidityCumulativeX128s)",
  "function token0() external view returns (address)",
  "function token1() external view returns (address)",
  "function fee() external view returns (uint24)",
]);

/**
 * Uniswap V3 SwapRouter02 IV3SwapRouter ABI (note: SwapRouter02 omits `deadline`
 * from ExactInputSingleParams, producing selector 0x04e45aaf).
 */
export const UNISWAP_V3_SWAP_ROUTER_02_ABI = parseAbi([
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) external payable returns (uint256 amountOut)",
]);

/**
 * Single-source-of-truth 4-byte hex selector derived programmatically via viem
 * from the exact 7-field SwapRouter02 `exactInputSingle` ABI (no `deadline` field).
 * Strictly equals "0x04e45aaf" (NOT SwapRouter V1's 8-field "0x414bf389").
 */
export const EXACT_INPUT_SINGLE_SELECTOR: Hex = toFunctionSelector(
  UNISWAP_V3_SWAP_ROUTER_02_ABI[0],
);

export const UNISWAP_V3_EXACT_INPUT_SINGLE_SELECTOR =
  EXACT_INPUT_SINGLE_SELECTOR;

export const DEFAULT_MAX_SLIPPAGE_BPS = 100;
export const DEFAULT_EXECUTION_SLIPPAGE_BPS = 25;
const BPS_DENOMINATOR = 10_000n;

/**
 * Computes `amountOutMinimum` from an on-chain/indicative `quotedAmountOut` and
 * policy `maxSlippageBps` (default 100 bps = 1.00%).
 */
export function computeMinAmountOut(
  quotedAmountOut: bigint,
  maxSlippageBps: number = DEFAULT_MAX_SLIPPAGE_BPS,
): bigint {
  if (quotedAmountOut < 0n) {
    throw new Error("quotedAmountOut must be non-negative");
  }
  if (
    !Number.isInteger(maxSlippageBps) ||
    maxSlippageBps < 0 ||
    maxSlippageBps > 10_000
  ) {
    throw new Error("maxSlippageBps must be an integer between 0 and 10000");
  }
  return (quotedAmountOut * BigInt(10_000 - maxSlippageBps)) / BPS_DENOMINATOR;
}

export type UniswapV3FeeTier = 100 | 500 | 3000 | 10000;

export interface AttributedCalldataResult {
  to: Address;
  rawData: Hex;
  data: Hex;
  selector: Hex;
  attributionCode: string;
  decodedAttribution: DecodedSuffix;
}

function attachAndVerifyAttribution(
  rawData: Hex,
  attributionCode: string,
): { data: Hex; decodedAttribution: DecodedSuffix } {
  const data = appendAttributionTag(rawData, attributionCode);
  const decodedAttribution = decodeAttributionTag(data);
  if (
    decodedAttribution === null ||
    !decodedAttribution.codes.includes(attributionCode)
  ) {
    throw new Error(
      `ERC-8021 attribution verification failed for code "${attributionCode}"`,
    );
  }
  return { data, decodedAttribution };
}

export interface EncodeErc20TransferInput {
  token: Address;
  recipient: Address;
  amount: bigint;
  attributionCode?: string | undefined;
}

/**
 * Encodes an ERC-20 `transfer(address,uint256)` call for ERC-8021 attribution
 * verification transfers and negative target tests, appending + verifying the
 * ERC-8021 Celo attribution suffix (`celo_0518175d3efe` by default).
 */
export function encodeAttributedErc20Transfer(
  input: EncodeErc20TransferInput,
): AttributedCalldataResult {
  if (input.amount <= 0n) {
    throw new Error("ERC-20 transfer amount must be strictly greater than 0");
  }

  const token = getAddress(input.token);
  const recipient = getAddress(input.recipient);
  const attributionCode =
    input.attributionCode ?? CAPRAIL_DEFAULT_ATTRIBUTION_CODE;

  const rawData = encodeFunctionData({
    abi: ERC20_ABI,
    functionName: "transfer",
    args: [recipient, input.amount],
  });

  const { data, decodedAttribution } = attachAndVerifyAttribution(
    rawData,
    attributionCode,
  );

  return {
    to: token,
    rawData,
    data,
    selector: rawData.slice(0, 10) as Hex,
    attributionCode,
    decodedAttribution,
  };
}

export interface EncodeUniswapV3SwapInput {
  tokenIn: Address;
  tokenOut: Address;
  fee: UniswapV3FeeTier;
  recipient: Address;
  amountIn: bigint;
  /** Explicit minimum output amount (takes precedence over quotedAmountOut). */
  amountOutMinimum?: bigint | undefined;
  /** Quoted output amount used to derive amountOutMinimum via maxSlippageBps when amountOutMinimum is omitted. */
  quotedAmountOut?: bigint | undefined;
  /** Maximum allowed slippage in basis points (default: 100 bps = 1.00%). */
  maxSlippageBps?: number | undefined;
  sqrtPriceLimitX96?: bigint | undefined;
  router?: Address | undefined;
  attributionCode?: string | undefined;
}

/**
 * Encodes a Uniswap V3 SwapRouter02 `exactInputSingle` swap for Auto-DCA execution
 * on Celo Mainnet with explicit or quote-derived slippage protection (`amountOutMinimum`),
 * and appends + verifies the ERC-8021 Celo attribution suffix (`celo_0518175d3efe` by default).
 */
export function encodeAttributedUniswapV3Swap(
  input: EncodeUniswapV3SwapInput,
): AttributedCalldataResult {
  if (input.amountIn <= 0n) {
    throw new Error("Swap amountIn must be strictly greater than 0");
  }

  let resolvedAmountOutMinimum: bigint;
  if (input.amountOutMinimum !== undefined) {
    resolvedAmountOutMinimum = input.amountOutMinimum;
  } else if (input.quotedAmountOut !== undefined) {
    resolvedAmountOutMinimum = computeMinAmountOut(
      input.quotedAmountOut,
      input.maxSlippageBps ?? DEFAULT_MAX_SLIPPAGE_BPS,
    );
  } else {
    throw new Error(
      "Swap requires explicit amountOutMinimum or quotedAmountOut for slippage protection",
    );
  }

  if (resolvedAmountOutMinimum < 0n) {
    throw new Error("Swap amountOutMinimum must be non-negative");
  }

  const tokenIn = getAddress(input.tokenIn);
  const tokenOut = getAddress(input.tokenOut);
  if (tokenIn.toLowerCase() === tokenOut.toLowerCase()) {
    throw new Error("Swap tokenIn and tokenOut must differ");
  }

  const recipient = getAddress(input.recipient);
  const router = getAddress(
    input.router ?? CELO_MAINNET_ROUTERS.UNISWAP_V3_SWAP_ROUTER_02,
  );
  const attributionCode =
    input.attributionCode ?? CAPRAIL_DEFAULT_ATTRIBUTION_CODE;

  const rawData = encodeFunctionData({
    abi: UNISWAP_V3_SWAP_ROUTER_02_ABI,
    functionName: "exactInputSingle",
    args: [
      {
        tokenIn,
        tokenOut,
        fee: input.fee,
        recipient,
        amountIn: input.amountIn,
        amountOutMinimum: resolvedAmountOutMinimum,
        sqrtPriceLimitX96: input.sqrtPriceLimitX96 ?? 0n,
      },
    ],
  });

  const { data, decodedAttribution } = attachAndVerifyAttribution(
    rawData,
    attributionCode,
  );

  return {
    to: router,
    rawData,
    data,
    selector: rawData.slice(0, 10) as Hex,
    attributionCode,
    decodedAttribution,
  };
}

export const buildExactInputSingleCalldata = encodeAttributedUniswapV3Swap;
