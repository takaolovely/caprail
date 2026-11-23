import type { Address } from "viem";
import {
  normalizeAddress,
  TOTAL_SPLIT_BPS,
  type SessionPolicy,
  type SplitRecipient,
} from "./schemas.js";

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

export interface ComputedSplitPayout {
  label: string;
  address: Address;
  bps: number;
  amount: bigint;
}

/**
 * Deterministically distributes `totalAmount` across recipients whose bps sum to 10000.
 * Remainder dust (at most recipients.length - 1 base units) is assigned deterministically
 * to the first recipient so sum(payouts) === totalAmount with zero floating-point drift.
 */
export function computeDeterministicSplits(
  totalAmount: bigint,
  recipients: readonly SplitRecipient[],
): ComputedSplitPayout[] {
  if (totalAmount <= 0n) {
    throw new Error("totalAmount must be strictly greater than 0");
  }
  if (recipients.length === 0) {
    throw new Error("recipients must not be empty");
  }

  const bpsSum = recipients.reduce((acc, r) => acc + r.bps, 0);
  if (bpsSum !== TOTAL_SPLIT_BPS) {
    throw new Error(
      `Recipient bps must sum to ${TOTAL_SPLIT_BPS}, received ${bpsSum}`,
    );
  }

  const payouts: ComputedSplitPayout[] = recipients.map((r) => ({
    label: r.label,
    address: r.address,
    bps: r.bps,
    amount: (totalAmount * BigInt(r.bps)) / BigInt(TOTAL_SPLIT_BPS),
  }));

  const allocated = payouts.reduce((acc, p) => acc + p.amount, 0n);
  const dust = totalAmount - allocated;
  const first = payouts[0];
  if (dust > 0n && first !== undefined) {
    first.amount += dust;
  }

  return payouts;
}
