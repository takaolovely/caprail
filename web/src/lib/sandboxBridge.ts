import type { Address, Hex } from "viem";
import { AuditLogger, type AuditEvent } from "@caprail/engine/auditLog.js";
import { type SessionPolicy } from "@caprail/policy/index.js";
import {
  CAPRAIL_DEFAULT_ATTRIBUTION_CODE,
  decodeAttributionTag,
} from "@caprail/wallet/attribution.js";
import {
  CELO_MAINNET_ROUTERS,
  CELO_MAINNET_TOKENS,
  computeMinAmountOut,
  DEFAULT_MAX_SLIPPAGE_BPS,
  encodeAttributedUniswapV3Swap,
  type AttributedCalldataResult,
} from "@caprail/wallet/calldata.js";
import { LocalSessionSimulator } from "@caprail/wallet/localSimulator.js";
import type { WalletExecutionResult } from "@caprail/wallet/types.js";
import { CAPRAIL_AGENT_WALLET } from "../data/mainnetProof.js";

export const SANDBOX_WALLET_ADDRESS = CAPRAIL_AGENT_WALLET as Address;

export const USDC_DECIMALS = 6;
export const USDC_UNIT = 1_000_000n;

export function usdcNumberToBaseUnits(usdc: number): bigint {
  return BigInt(Math.round(usdc * 1_000_000));
}

export function baseUnitsToUsdcNumber(units: bigint): number {
  return Number(units) / 1_000_000;
}

export function formatUsdcDisplay(units: bigint): string {
  return `$${baseUnitsToUsdcNumber(units).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function shortenAddress(addr: string): string {
  if (addr.length < 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export interface CalldataCallEntry {
  id: string;
  label: string;
  sublabel: string;
  targetContract: Address;
  functionLabel: string;
  selector: Hex;
  rawData: Hex;
  fullData: Hex;
  suffixHex: Hex;
  attributionCode: string;
  decodedVerified: boolean;
}

export interface CalldataPreview {
  targetContract: Address;
  functionLabel: string;
  selector: Hex;
  rawData: Hex;
  fullData: Hex;
  suffixHex: Hex;
  attributionCode: string;
  decodedVerified: boolean;
  calls: CalldataCallEntry[];
}

export function buildCalldataPreview(opts: {
  amountUsdc: number;
  walletAddress: Address;
  tokenOverride?: Address;
}): CalldataPreview {
  const safeAmount = Math.max(0.01, opts.amountUsdc);
  const amountUnits = usdcNumberToBaseUnits(safeAmount);

  // Indicative sandbox CELO quote (~$0.72/CELO) with 1.00% (100 bps) slippage guard
  const indicativeCeloQuoteWei = (amountUnits * 10n ** 18n) / 720_000n;
  const amountOutMinimum = computeMinAmountOut(
    indicativeCeloQuoteWei,
    DEFAULT_MAX_SLIPPAGE_BPS,
  );
  const built: AttributedCalldataResult = encodeAttributedUniswapV3Swap({
    tokenIn: opts.tokenOverride ?? CELO_MAINNET_TOKENS.USDC,
    tokenOut: CELO_MAINNET_TOKENS.CELO,
    fee: 3000,
    recipient: opts.walletAddress,
    amountIn: amountUnits,
    amountOutMinimum,
    router: CELO_MAINNET_ROUTERS.UNISWAP_V3_SWAP_ROUTER_02,
    attributionCode: CAPRAIL_DEFAULT_ATTRIBUTION_CODE,
  });
  const suffixHex = `0x${built.data.slice(built.rawData.length)}` as Hex;
  const decoded = decodeAttributionTag(built.data);
  const decodedVerified =
    decoded !== null && decoded.codes.includes(built.attributionCode);
  const functionLabel = `SwapRouter02.exactInputSingle(${built.selector})`;

  const singleEntry: CalldataCallEntry = {
    id: "dca-swap-0",
    label: `Auto-DCA Swap · ${formatUsdcDisplay(amountUnits)} USDC -> CELO`,
    sublabel: `Router ${shortenAddress(built.to)}`,
    targetContract: built.to,
    functionLabel,
    selector: built.selector,
    rawData: built.rawData,
    fullData: built.data,
    suffixHex,
    attributionCode: built.attributionCode,
    decodedVerified,
  };

  return {
    targetContract: built.to,
    functionLabel,
    selector: built.selector,
    rawData: built.rawData,
    fullData: built.data,
    suffixHex,
    attributionCode: built.attributionCode,
    decodedVerified,
    calls: [singleEntry],
  };
}

export function createSandboxPolicy(opts: {
  perTxCapUsdc: number;
  totalCapUsdc: number;
  revoked?: boolean;
}): SessionPolicy {
  const perTx = usdcNumberToBaseUnits(Math.max(1, opts.perTxCapUsdc));
  const total = usdcNumberToBaseUnits(
    Math.max(opts.perTxCapUsdc, opts.totalCapUsdc),
  );
  const nowSec = Math.floor(Date.now() / 1000);

  return {
    sessionId: "caprail-sandbox-01",
    spendCapPerTx: perTx,
    totalSpendCap: total,
    allowedTargets: [CELO_MAINNET_ROUTERS.UNISWAP_V3_SWAP_ROUTER_02],
    expiresAt: nowSec + 3_600,
    revoked: opts.revoked ?? false,
    token: CELO_MAINNET_TOKENS.USDC,
  };
}

export interface SandboxSessionRuntime {
  simulator: LocalSessionSimulator;
  logger: AuditLogger;
}

export function createSandboxRuntime(policy: SessionPolicy): SandboxSessionRuntime {
  return {
    simulator: new LocalSessionSimulator({
      walletAddress: SANDBOX_WALLET_ADDRESS,
      policy,
      attributionCode: CAPRAIL_DEFAULT_ATTRIBUTION_CODE,
    }),
    logger: new AuditLogger({ emitToStdout: false }),
  };
}

export { type AuditEvent, type SessionPolicy, type WalletExecutionResult };
