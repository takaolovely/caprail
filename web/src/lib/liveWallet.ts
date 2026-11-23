import {
  createPublicClient,
  createWalletClient,
  custom,
  formatUnits,
  http,
  type Address,
  type Hex,
} from "viem";
import { celo } from "viem/chains";
import { CELO_MAINNET_TOKENS, ERC20_ABI } from "@caprail/wallet/calldata.js";

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
