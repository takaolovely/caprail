import type { Address, Hex } from "viem";
import type { GuardrailDenialCode, SessionPolicy } from "../policy/index.js";

export type ExecutionMode = "LOCAL_SIMULATION" | "CELO_MAINNET";

export interface WalletExecutionCall {
  /** Logical recipient or router address validated against policy.allowedTargets */
  policyTarget: Address;
  /** On-chain call destination (e.g., ERC-20 token contract or DEX router) */
  to: Address;
  /** Value in native wei (default 0n) */
  value?: bigint | undefined;
  /** ABI-encoded calldata */
  data?: Hex | undefined;
  /** Economic spend amount counted against session spend caps */
  amount: bigint;
  /** Optional ERC-20 token address being spent */
  token?: Address | undefined;
  /** Human-readable audit description */
  purpose: string;
}

export interface WalletExecutionResult {
  mode: ExecutionMode;
  status: "APPROVED" | "BLOCKED";
  reasonCode?: GuardrailDenialCode | "RELAY_REVERT" | undefined;
  reason?: string | undefined;
  txHash?: Hex | undefined;
  callsId?: Hex | undefined;
  attributionCode?: string | undefined;
  spentTotal: bigint;
  remainingTotalCap: bigint;
  timestamp: string;
}

export interface WalletRevokeResult {
  mode: ExecutionMode;
  revoked: boolean;
  keyId?: Hex | undefined;
  txHash?: Hex | undefined;
  reason?: string | undefined;
  timestamp: string;
}

export interface AgentWalletAdapter {
  readonly mode: ExecutionMode;
  getWalletAddress(): Address;
  getPolicy(): SessionPolicy;
  getSpentTotal(): bigint;
  getRemainingTotalCap(): bigint;
  isRevoked(): boolean;
  executeGuarded(
    call: WalletExecutionCall,
    nowSec?: number,
  ): Promise<WalletExecutionResult>;
  executeGuardedBatch(
    calls: readonly WalletExecutionCall[],
    nowSec?: number,
  ): Promise<WalletExecutionResult>;
  revokeSession(reason?: string): Promise<WalletRevokeResult>;
}
