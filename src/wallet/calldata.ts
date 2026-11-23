import {
  encodeFunctionData,
  getAddress,
  parseAbi,
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
 * Canonical Celo Mainnet (Chain ID 42220) DEX routers.
 */
export const CELO_MAINNET_ROUTERS = {
  /** Uniswap V3 SwapRouter02 on Celo Mainnet */
  UNISWAP_V3_SWAP_ROUTER_02: getAddress(
    "0x5615CDAb10dc425a742d643d949a7F474C01abc4",
  ) as Address,
} as const;

export const ERC20_TRANSFER_SELECTOR = "0xa9059cbb" as const;
export const UNISWAP_V3_EXACT_INPUT_SINGLE_SELECTOR = "0x04e45aaf" as const;

export const ERC20_ABI = parseAbi([
  "function transfer(address to, uint256 value) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)",
]);

/**
 * Uniswap V3 SwapRouter02 IV3SwapRouter ABI (note: SwapRouter02 omits `deadline`
 * from ExactInputSingleParams, producing selector 0x04e45aaf).
 */
export const UNISWAP_V3_SWAP_ROUTER_02_ABI = parseAbi([
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMin, uint160 sqrtPriceLimitX96) params) external payable returns (uint256 amountOut)",
]);

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
 * Encodes an ERC-20 `transfer(address,uint256)` call for Revenue Splitter payouts
 * and appends + verifies the ERC-8021 Celo attribution suffix (`celo_cbf00f366dda` by default).
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
  amountOutMin: bigint;
  sqrtPriceLimitX96?: bigint | undefined;
  router?: Address | undefined;
  attributionCode?: string | undefined;
}

/**
 * Encodes a Uniswap V3 SwapRouter02 `exactInputSingle` swap for Auto-DCA execution
 * on Celo Mainnet and appends + verifies the ERC-8021 Celo attribution suffix.
 */
export function encodeAttributedUniswapV3Swap(
  input: EncodeUniswapV3SwapInput,
): AttributedCalldataResult {
  if (input.amountIn <= 0n) {
    throw new Error("Swap amountIn must be strictly greater than 0");
  }
  if (input.amountOutMin < 0n) {
    throw new Error("Swap amountOutMin must be non-negative");
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
        amountOutMin: input.amountOutMin,
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
