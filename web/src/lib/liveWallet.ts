import {
  createPublicClient,
  createWalletClient,
  custom,
  encodeFunctionData,
  formatUnits,
  http,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { celo } from "viem/chains";
import {
  appendAttributionTag,
  CAPRAIL_DEFAULT_ATTRIBUTION_CODE,
} from "@caprail/wallet/attribution.js";
import {
  CELO_MAINNET_ROUTERS,
  CELO_MAINNET_TOKENS,
  computeMinAmountOut,
  DEFAULT_MAX_SLIPPAGE_BPS,
  ERC20_ABI,
  UNISWAP_V3_SWAP_ROUTER_02_ABI,
  type UniswapV3FeeTier,
} from "@caprail/wallet/calldata.js";

const ERC20_ALLOWANCE_APPROVE_ABI = parseAbi([
  "function balanceOf(address account) external view returns (uint256)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function approve(address spender, uint256 value) external returns (bool)",
]);

export class InsufficientUsdcBalanceError extends Error {
  readonly requiredUnits: bigint;
  readonly availableUnits: bigint;

  constructor(requiredUnits: bigint, availableUnits: bigint) {
    const reqStr = Number(formatUnits(requiredUnits, 6)).toFixed(2);
    const availStr = Number(formatUnits(availableUnits, 6)).toFixed(2);
    super(
      `Insufficient Native USDC balance: need $${reqStr} USDC, wallet has $${availStr} USDC.`,
    );
    this.name = "InsufficientUsdcBalanceError";
    this.requiredUnits = requiredUnits;
    this.availableUnits = availableUnits;
  }
}

interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

export interface LiveWalletState {
  connected: boolean;
  address: Address | null;
  chainId: number | null;
  celoBalanceFormatted: string;
  usdcBalanceFormatted: string;
  usdcBalanceRaw: bigint;
  error: string | null;
  isUserRejection?: boolean;
}

const CELO_RPC_URL = "https://forno.celo.org";
const CELO_HEX_CHAIN_ID = "0xa4ec"; // 42220

function getPublicCeloClient() {
  return createPublicClient({
    chain: celo,
    transport: http(CELO_RPC_URL),
  });
}

export function hasInjectedProvider(): boolean {
  return typeof window !== "undefined" && window.ethereum !== undefined;
}

/**
 * Extracts a clean, human-readable message from any EIP-1193 / viem / Rabby / MetaMask / Phantom error.
 * Guarantees we never render `[object Object]`.
 */
export function formatWalletError(err: unknown): {
  message: string;
  isUserRejection: boolean;
} {
  if (err === null || err === undefined) {
    return { message: "Wallet connection cancelled.", isUserRejection: true };
  }

  const record =
    typeof err === "object" ? (err as Record<string, unknown>) : null;
  const nestedError =
    record?.error && typeof record.error === "object"
      ? (record.error as Record<string, unknown>)
      : null;
  const cause =
    record?.cause && typeof record.cause === "object"
      ? (record.cause as Record<string, unknown>)
      : null;

  const code =
    record?.code ?? nestedError?.code ?? cause?.code;

  const rawCandidates = [
    record?.shortMessage,
    record?.details,
    record?.message,
    nestedError?.message,
    cause?.shortMessage,
    cause?.message,
    typeof err === "string" ? err : undefined,
  ].filter((v): v is string => typeof v === "string" && v.trim().length > 0);

  const combined = rawCandidates.join(" ").toLowerCase();

  const isRejection =
    code === 4001 ||
    code === "ACTION_REJECTED" ||
    combined.includes("user rejected") ||
    combined.includes("user denied") ||
    combined.includes("rejected the request") ||
    combined.includes("cancelled");

  if (isRejection) {
    return {
      message:
        "Wallet connection cancelled. You can continue testing in Sandbox mode or reconnect anytime.",
      isUserRejection: true,
    };
  }

  const firstClean = rawCandidates.find(
    (s) => !s.includes("[object Object]") && s.trim().length > 0,
  );
  if (firstClean) {
    return { message: firstClean.trim(), isUserRejection: false };
  }

  return {
    message: "Unable to connect wallet. Please unlock your wallet extension and try again.",
    isUserRejection: false,
  };
}

export async function connectInjectedCeloWallet(): Promise<LiveWalletState> {
  if (!hasInjectedProvider() || window.ethereum === undefined) {
    throw new Error(
      "No injected EVM wallet detected. Install Rabby, MetaMask, or Coinbase Wallet — or stay in zero-gas Sandbox mode.",
    );
  }

  const provider = window.ethereum;
  const accounts = (await provider.request({
    method: "eth_requestAccounts",
  })) as Address[];
  const address = accounts[0];
  if (address === undefined) {
    throw new Error("Wallet returned no account.");
  }

  const currentChainHex = (await provider.request({
    method: "eth_chainId",
  })) as string;
  let chainId = Number.parseInt(currentChainHex, 16);

  if (chainId !== celo.id) {
    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: CELO_HEX_CHAIN_ID }],
      });
      chainId = celo.id;
    } catch (switchErr) {
      const parsed = formatWalletError(switchErr);
      if (parsed.isUserRejection) {
        throw switchErr;
      }
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: CELO_HEX_CHAIN_ID,
            chainName: "Celo Mainnet",
            nativeCurrency: { name: "CELO", symbol: "CELO", decimals: 18 },
            rpcUrls: [CELO_RPC_URL],
            blockExplorerUrls: ["https://celoscan.io"],
          },
        ],
      });
      chainId = celo.id;
    }
  }

  const publicClient = getPublicCeloClient();
  const [celoBal, usdcBal] = await Promise.all([
    publicClient.getBalance({ address }),
    publicClient.readContract({
      address: CELO_MAINNET_TOKENS.USDC,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [address],
    }),
  ]);

  return {
    connected: true,
    address,
    chainId,
    celoBalanceFormatted: Number(formatUnits(celoBal, 18)).toFixed(4),
    usdcBalanceFormatted: Number(formatUnits(usdcBal, 6)).toFixed(2),
    usdcBalanceRaw: usdcBal,
    error: null,
    isUserRejection: false,
  };
}

export async function ensureUsdcBalanceAndAllowanceForSwap(opts: {
  account: Address;
  spender: Address;
  amountIn: bigint;
  attributionCode?: string;
}): Promise<{
  balance: bigint;
  allowanceBefore: bigint;
  approvalTxHash?: Hex;
}> {
  if (!hasInjectedProvider() || window.ethereum === undefined) {
    throw new Error("Injected EVM wallet is not available.");
  }

  const publicClient = getPublicCeloClient();
  const [balance, allowance] = await Promise.all([
    publicClient.readContract({
      address: CELO_MAINNET_TOKENS.USDC,
      abi: ERC20_ALLOWANCE_APPROVE_ABI,
      functionName: "balanceOf",
      args: [opts.account],
    }),
    publicClient.readContract({
      address: CELO_MAINNET_TOKENS.USDC,
      abi: ERC20_ALLOWANCE_APPROVE_ABI,
      functionName: "allowance",
      args: [opts.account, opts.spender],
    }),
  ]);

  if (balance < opts.amountIn) {
    throw new InsufficientUsdcBalanceError(opts.amountIn, balance);
  }

  if (allowance < opts.amountIn) {
    const rawApproveData = encodeFunctionData({
      abi: ERC20_ALLOWANCE_APPROVE_ABI,
      functionName: "approve",
      args: [opts.spender, opts.amountIn],
    });
    const attributedApproveData = appendAttributionTag(
      rawApproveData,
      opts.attributionCode ?? CAPRAIL_DEFAULT_ATTRIBUTION_CODE,
    );

    const walletClient = createWalletClient({
      account: opts.account,
      chain: celo,
      transport: custom(window.ethereum),
    });

    const approveHash = await walletClient.sendTransaction({
      account: opts.account,
      chain: celo,
      to: CELO_MAINNET_TOKENS.USDC,
      data: attributedApproveData,
      value: 0n,
    });

    const receipt = await publicClient.waitForTransactionReceipt({
      hash: approveHash,
    });

    if (receipt.status !== "success") {
      throw new Error(
        `Native USDC approval transaction reverted on Celo Mainnet (${approveHash}).`,
      );
    }

    return {
      balance,
      allowanceBefore: allowance,
      approvalTxHash: approveHash,
    };
  }

  return {
    balance,
    allowanceBefore: allowance,
  };
}

/**
 * Simulates Uniswap V3 SwapRouter02 `exactInputSingle` on-chain via `simulateContract`
 * (with `amountOutMinimum: 0n` and `account: userAddress`) to obtain a live `quotedAmountOut`,
 * then computes `amountOutMinimum = (quotedAmountOut * BigInt(10_000 - maxSlippageBps)) / 10_000n`.
 * Must be called after `ensureUsdcBalanceAndAllowanceForSwap` so transferFrom succeeds in simulation.
 */
export async function quoteUniswapV3ExactInputSingle(opts: {
  account: Address;
  tokenIn: Address;
  tokenOut: Address;
  fee: UniswapV3FeeTier;
  recipient: Address;
  amountIn: bigint;
  maxSlippageBps?: number;
  router?: Address;
}): Promise<{
  quotedAmountOut: bigint;
  amountOutMinimum: bigint;
  maxSlippageBps: number;
}> {
  const maxSlippageBps = opts.maxSlippageBps ?? DEFAULT_MAX_SLIPPAGE_BPS;
  const router = opts.router ?? CELO_MAINNET_ROUTERS.UNISWAP_V3_SWAP_ROUTER_02;
  const publicClient = getPublicCeloClient();

  const { result: quotedAmountOut } = await publicClient.simulateContract({
    address: router,
    abi: UNISWAP_V3_SWAP_ROUTER_02_ABI,
    functionName: "exactInputSingle",
    account: opts.account,
    args: [
      {
        tokenIn: opts.tokenIn,
        tokenOut: opts.tokenOut,
        fee: opts.fee,
        recipient: opts.recipient,
        amountIn: opts.amountIn,
        amountOutMinimum: 0n,
        sqrtPriceLimitX96: 0n,
      },
    ],
  });

  if (quotedAmountOut <= 0n) {
    throw new Error(
      "Uniswap V3 simulation returned 0 output amount. Pool liquidity may be insufficient.",
    );
  }

  const amountOutMinimum = computeMinAmountOut(quotedAmountOut, maxSlippageBps);
  return {
    quotedAmountOut,
    amountOutMinimum,
    maxSlippageBps,
  };
}

export async function sendLiveAttributedTx(opts: {
  account: Address;
  to: Address;
  data: Hex;
  value?: bigint;
}): Promise<Hex> {
  if (!hasInjectedProvider() || window.ethereum === undefined) {
    throw new Error("Injected EVM wallet is not available.");
  }
  const walletClient = createWalletClient({
    account: opts.account,
    chain: celo,
    transport: custom(window.ethereum),
  });
  return walletClient.sendTransaction({
    account: opts.account,
    chain: celo,
    to: opts.to,
    data: opts.data,
    value: opts.value ?? 0n,
  });
}
