import { keccak256, toHex, type Address, type Hex } from "viem";
import {
  evaluateSessionGuardrails,
  SessionPolicySchema,
  type SessionPolicy,
} from "../policy/index.js";
import { appendAttributionTag } from "./attribution.js";
import type {
  AgentWalletAdapter,
  WalletExecutionCall,
  WalletExecutionResult,
  WalletRevokeResult,
} from "./types.js";

export interface LocalSimulatorOptions {
  walletAddress: Address;
  policy: SessionPolicy;
  attributionCode?: string | undefined;
}

/**
 * Deterministic local session guardrail simulator for CLI dry-runs and Vitest.
 *
 * HONESTY BOUNDARY:
 * Every result carries `mode: "LOCAL_SIMULATION"`. Rejections here prove
 * application policy logic and negative-test behavior locally; they are NOT
 * on-chain smart-contract reverts on Celo Mainnet.
 */
export class LocalSessionSimulator implements AgentWalletAdapter {
  public readonly mode = "LOCAL_SIMULATION" as const;

  private readonly walletAddress: Address;
  private readonly policy: SessionPolicy;
  private readonly attributionCode: string | undefined;
  private spentTotal = 0n;
  private revoked: boolean;
  private nonce = 0;

  constructor(options: LocalSimulatorOptions) {
    this.walletAddress = options.walletAddress;
    this.policy = SessionPolicySchema.parse(options.policy);
    this.attributionCode = options.attributionCode;
    this.revoked = this.policy.revoked;
  }

  public getWalletAddress(): Address {
    return this.walletAddress;
  }

  public getPolicy(): SessionPolicy {
    return { ...this.policy, revoked: this.revoked };
  }

  public getSpentTotal(): bigint {
    return this.spentTotal;
  }

  public getRemainingTotalCap(): bigint {
    const remaining = this.policy.totalSpendCap - this.spentTotal;
    return remaining > 0n ? remaining : 0n;
  }

  public isRevoked(): boolean {
    return this.revoked;
  }

  public async executeGuarded(
    call: WalletExecutionCall,
    nowSec: number = Math.floor(Date.now() / 1000),
  ): Promise<WalletExecutionResult> {
    return this.executeGuardedBatch([call], nowSec);
  }

  public async executeGuardedBatch(
    calls: readonly WalletExecutionCall[],
    nowSec: number = Math.floor(Date.now() / 1000),
  ): Promise<WalletExecutionResult> {
    const timestamp = new Date(nowSec * 1000).toISOString();

    if (calls.length === 0) {
      return {
        mode: this.mode,
        status: "BLOCKED",
        reasonCode: "INVALID_AMOUNT",
        reason: "Batch must contain at least one call",
        spentTotal: this.spentTotal,
        remainingTotalCap: this.getRemainingTotalCap(),
        timestamp,
      };
    }

    // Validate atomically before mutating simulated spend state
    let runningSpent = this.spentTotal;
    for (const call of calls) {
      const verdict = evaluateSessionGuardrails(
        this.policy,
        { spentTotal: runningSpent, revoked: this.revoked },
        {
          target: call.policyTarget,
          amount: call.amount,
          token: call.token,
        },
        nowSec,
      );

      if (!verdict.allowed) {
        return {
          mode: this.mode,
          status: "BLOCKED",
          reasonCode: verdict.code,
          reason: `[LOCAL_SIMULATION] ${verdict.reason}`,
          spentTotal: this.spentTotal,
          remainingTotalCap: this.getRemainingTotalCap(),
          timestamp,
        };
      }

      runningSpent += call.amount;
    }

    // Apply attribution suffix to simulated calldata to verify tag encoding path
    const taggedPayloads = calls.map((c) =>
      appendAttributionTag(c.data, this.attributionCode),
    );

    this.spentTotal = runningSpent;
    this.nonce += 1;

    const fingerprint = JSON.stringify({
      mode: this.mode,
      wallet: this.walletAddress,
      sessionId: this.policy.sessionId,
      nonce: this.nonce,
      targets: calls.map((c) => c.policyTarget),
      amounts: calls.map((c) => c.amount.toString()),
      taggedPayloads,
    });
    const simulatedHash: Hex = keccak256(toHex(fingerprint));

    return {
      mode: this.mode,
      status: "APPROVED",
      txHash: simulatedHash,
      attributionCode: this.attributionCode,
      spentTotal: this.spentTotal,
      remainingTotalCap: this.getRemainingTotalCap(),
      timestamp,
    };
  }

  public async revokeSession(reason?: string): Promise<WalletRevokeResult> {
    this.revoked = true;
    const timestamp = new Date().toISOString();
    const revokeHash: Hex = keccak256(
      toHex(
        JSON.stringify({
          mode: this.mode,
          action: "REVOKE_SESSION",
          sessionId: this.policy.sessionId,
          wallet: this.walletAddress,
          reason: reason ?? "operator_revoke",
        }),
      ),
    );

    return {
      mode: this.mode,
      revoked: true,
      txHash: revokeHash,
      reason: reason ?? "[LOCAL_SIMULATION] Session revoked locally",
      timestamp,
    };
  }
}
