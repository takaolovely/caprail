import type { Address, Hex } from "viem";
import { AuditLogger, type AuditEvent } from "@caprail/engine/auditLog.js";
import {
  computeDeterministicSplits,
  TOTAL_SPLIT_BPS,
  type ComputedSplitPayout,
  type SessionPolicy,
  type SplitRecipient,
} from "@caprail/policy/index.js";
import {
  CAPRAIL_DEFAULT_ATTRIBUTION_CODE,
  decodeAttributionTag,
} from "@caprail/wallet/attribution.js";
import {
  CELO_MAINNET_ROUTERS,
  CELO_MAINNET_TOKENS,
  computeMinAmountOut,
  DEFAULT_MAX_SLIPPAGE_BPS,
  encodeAttributedErc20Transfer,
  encodeAttributedUniswapV3Swap,
  type AttributedCalldataResult,
} from "@caprail/wallet/calldata.js";
import { LocalSessionSimulator } from "@caprail/wallet/localSimulator.js";
import type { WalletExecutionResult } from "@caprail/wallet/types.js";
import { CAPRAIL_AGENT_WALLET } from "../data/mainnetProof.js";

export const SANDBOX_WALLET_ADDRESS = CAPRAIL_AGENT_WALLET as Address;

export const DEFAULT_SPLIT_RECIPIENTS: readonly SplitRecipient[] = [
  {
    label: "Protocol Treasury",
    address: "0x3333333333333333333333333333333333333333" as Address,
    bps: 5000,
  },
  {
    label: "Named Collaborator",
    address: "0x4444444444444444444444444444444444444444" as Address,
    bps: 3000,
  },
  {
    label: "Ops Reserve",
    address: "0x5555555555555555555555555555555555555555" as Address,
    bps: 2000,
  },
];

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

export function isValidEvmAddress(addr: string): addr is Address {
  return /^0x[0-9a-fA-F]{40}$/.test(addr.trim());
}

export function isPlaceholderAddress(addr: string): boolean {
  const normalized = addr.trim().toLowerCase();
  return /^0x([0-9a-f])\1{39}$/.test(normalized);
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
  mode: "AUTO_DCA" | "REVENUE_SPLIT";
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
  mode: "AUTO_DCA" | "REVENUE_SPLIT";
  amountUsdc: number;
  recipients: readonly SplitRecipient[];
  walletAddress: Address;
  tokenOverride?: Address;
}): CalldataPreview {
  const safeAmount = Math.max(0.01, opts.amountUsdc);
  const amountUnits = usdcNumberToBaseUnits(safeAmount);

  if (opts.mode === "AUTO_DCA") {
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
      label: `Auto-DCA Swap · ${formatUsdcDisplay(amountUnits)} USDC → CELO`,
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
      mode: "AUTO_DCA",
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

  const payouts = computeDeterministicSplits(amountUnits, opts.recipients);
  const calls: CalldataCallEntry[] = payouts.map((payout, idx) => {
    const built = encodeAttributedErc20Transfer({
      token: opts.tokenOverride ?? CELO_MAINNET_TOKENS.USDC,
      recipient: payout.address,
      amount: payout.amount,
      attributionCode: CAPRAIL_DEFAULT_ATTRIBUTION_CODE,
    });
    const suffixHex = `0x${built.data.slice(built.rawData.length)}` as Hex;
    const decoded = decodeAttributionTag(built.data);
    const decodedVerified =
      decoded !== null && decoded.codes.includes(built.attributionCode);

    return {
      id: `split-call-${idx}`,
      label: `${idx + 1}/${payouts.length} · ${payout.label} (${(payout.bps / 100).toFixed(0)}%)`,
      sublabel: `${formatUsdcDisplay(payout.amount)} → ${shortenAddress(payout.address)}`,
      targetContract: built.to,
      functionLabel: `USDC.transfer(${built.selector})`,
      selector: built.selector,
      rawData: built.rawData,
      fullData: built.data,
      suffixHex,
      attributionCode: built.attributionCode,
      decodedVerified,
    };
  });

  const primary = calls[0]!;
  return {
    mode: "REVENUE_SPLIT",
    targetContract: primary.targetContract,
    functionLabel: `${calls.length}-Way USDC.transfer(${primary.selector})`,
    selector: primary.selector,
    rawData: primary.rawData,
    fullData: primary.fullData,
    suffixHex: primary.suffixHex,
    attributionCode: primary.attributionCode,
    decodedVerified: calls.every((c) => c.decodedVerified),
    calls,
  };
}

export function createSandboxPolicy(opts: {
  perTxCapUsdc: number;
  totalCapUsdc: number;
  recipients: readonly SplitRecipient[];
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
    allowedTargets: [
      CELO_MAINNET_ROUTERS.UNISWAP_V3_SWAP_ROUTER_02,
      ...opts.recipients.map((r) => r.address),
    ],
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

export {
  computeDeterministicSplits,
  TOTAL_SPLIT_BPS,
  type AuditEvent,
  type ComputedSplitPayout,
  type SessionPolicy,
  type SplitRecipient,
  type WalletExecutionResult,
};
