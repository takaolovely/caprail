import type { Address } from "viem";
import { normalizeAddress, type SessionPolicy } from "./schemas.js";

export type GuardrailDenialCode =
  | "SESSION_REVOKED"
  | "SESSION_EXPIRED"
  | "TARGET_NOT_ALLOWLISTED"
  | "EXCEEDS_PER_TX_CAP"
  | "EXCEEDS_TOTAL_CAP"
  | "TOKEN_MISMATCH"
  | "INVALID_AMOUNT";

export type GuardrailEvaluation =
  | { allowed: true }
  | { allowed: false; code: GuardrailDenialCode; reason: string };

export interface GuardrailCheckInput {
  target: Address;
  amount: bigint;
  token?: Address | undefined;
}

export interface SessionRuntimeState {
  spentTotal: bigint;
  revoked: boolean;
}

/**
 * Deterministic pre-flight guardrail evaluator shared by both LocalSessionSimulator
 * and AltanaLiveAdapter before any call is signed or submitted.
 */
export function evaluateSessionGuardrails(
  policy: SessionPolicy,
  state: SessionRuntimeState,
  input: GuardrailCheckInput,
  nowSec: number = Math.floor(Date.now() / 1000),
): GuardrailEvaluation {
  if (policy.revoked || state.revoked) {
    return {
      allowed: false,
      code: "SESSION_REVOKED",
      reason: `Session ${policy.sessionId} has been revoked`,
    };
  }

  if (nowSec >= policy.expiresAt) {
    return {
      allowed: false,
      code: "SESSION_EXPIRED",
      reason: `Session ${policy.sessionId} expired at ${policy.expiresAt} (now=${nowSec})`,
    };
  }

  if (input.amount <= 0n) {
    return {
      allowed: false,
      code: "INVALID_AMOUNT",
      reason: `Execution amount must be positive, received ${input.amount.toString()}`,
    };
  }

  if (
    policy.token !== undefined &&
    input.token !== undefined &&
    normalizeAddress(policy.token) !== normalizeAddress(input.token)
  ) {
    return {
      allowed: false,
      code: "TOKEN_MISMATCH",
      reason: `Token ${input.token} does not match session token ${policy.token}`,
    };
  }

  const allowlist = new Set(policy.allowedTargets.map(normalizeAddress));
  if (!allowlist.has(normalizeAddress(input.target))) {
    return {
      allowed: false,
      code: "TARGET_NOT_ALLOWLISTED",
      reason: `Target ${input.target} is not in session allowedTargets`,
    };
  }

  if (input.amount > policy.spendCapPerTx) {
    return {
      allowed: false,
      code: "EXCEEDS_PER_TX_CAP",
      reason: `Amount ${input.amount.toString()} exceeds spendCapPerTx ${policy.spendCapPerTx.toString()}`,
    };
  }

  const projectedTotal = state.spentTotal + input.amount;
  if (projectedTotal > policy.totalSpendCap) {
    return {
      allowed: false,
      code: "EXCEEDS_TOTAL_CAP",
      reason: `Projected total ${projectedTotal.toString()} exceeds totalSpendCap ${policy.totalSpendCap.toString()} (already spent ${state.spentTotal.toString()})`,
    };
  }

  return { allowed: true };
}
