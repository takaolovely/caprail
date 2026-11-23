import { getAddress, isAddress, type Address, type Hex } from "viem";
import { z } from "zod";

export const TOTAL_SPLIT_BPS = 10_000;

export const EvmAddressSchema = z
  .string()
  .refine((v) => isAddress(v, { strict: false }), "Invalid EVM address")
  .transform((v) => getAddress(v.toLowerCase()) as Address);

export const HexDataSchema = z
  .string()
  .regex(/^0x([0-9a-fA-F]{2})*$/, "Invalid even-length hex data")
  .transform((v) => v as Hex);

export const PositiveBigIntSchema = z
  .bigint()
  .refine((v) => v > 0n, "Amount must be strictly greater than 0");

export function normalizeAddress(address: Address): string {
  return address.toLowerCase();
}

export const SessionPolicySchema = z
  .object({
    sessionId: z.string().min(1),
    spendCapPerTx: PositiveBigIntSchema,
    totalSpendCap: PositiveBigIntSchema,
    allowedTargets: z.array(EvmAddressSchema).min(1, "At least one allowlisted target is required"),
    expiresAt: z.number().int().positive("expiresAt must be a positive Unix timestamp in seconds"),
    revoked: z.boolean().default(false),
    token: EvmAddressSchema.optional(),
  })
  .superRefine((policy, ctx) => {
    if (policy.totalSpendCap < policy.spendCapPerTx) {
      ctx.addIssue({
        code: "custom",
        path: ["totalSpendCap"],
        message: "totalSpendCap must be greater than or equal to spendCapPerTx",
      });
    }

    const seen = new Set<string>();
    for (const [idx, target] of policy.allowedTargets.entries()) {
      const normalized = normalizeAddress(target);
      if (seen.has(normalized)) {
        ctx.addIssue({
          code: "custom",
          path: ["allowedTargets", idx],
          message: `Duplicate target address in allowedTargets: ${target}`,
        });
      }
      seen.add(normalized);
    }
  });

export type SessionPolicy = z.infer<typeof SessionPolicySchema>;

export const DcaStrategySchema = z
  .object({
    strategyId: z.string().min(1),
    tokenIn: EvmAddressSchema,
    tokenOut: EvmAddressSchema,
    amountPerRun: PositiveBigIntSchema,
    intervalSeconds: z.number().int().min(60, "intervalSeconds must be at least 60 seconds"),
    allowedRouter: EvmAddressSchema,
    maxSlippageBps: z
      .number()
      .int()
      .min(1, "maxSlippageBps must be at least 1 bps (0.01%)")
      .max(5_000, "maxSlippageBps must not exceed 5000 bps (50%)"),
  })
  .superRefine((strategy, ctx) => {
    if (normalizeAddress(strategy.tokenIn) === normalizeAddress(strategy.tokenOut)) {
      ctx.addIssue({
        code: "custom",
        path: ["tokenOut"],
        message: "tokenOut must differ from tokenIn",
      });
    }
  });

export type DcaStrategy = z.infer<typeof DcaStrategySchema>;

export const SplitRecipientSchema = z.object({
  label: z.string().min(1),
  address: EvmAddressSchema,
  bps: z
    .number()
    .int()
    .min(1, "Recipient bps must be >= 1")
    .max(TOTAL_SPLIT_BPS, "Recipient bps must be <= 10000"),
});

export type SplitRecipient = z.infer<typeof SplitRecipientSchema>;

export const SplitStrategySchema = z
  .object({
    strategyId: z.string().min(1),
    token: EvmAddressSchema,
    recipients: z.array(SplitRecipientSchema).min(1, "At least one recipient is required"),
  })
  .superRefine((strategy, ctx) => {
    const sumBps = strategy.recipients.reduce((acc, r) => acc + r.bps, 0);
    if (sumBps !== TOTAL_SPLIT_BPS) {
      ctx.addIssue({
        code: "custom",
        path: ["recipients"],
        message: `Recipient basis points must sum to exactly ${TOTAL_SPLIT_BPS} (100.00%), received ${sumBps}`,
      });
    }

    const seen = new Set<string>();
    for (const [idx, recipient] of strategy.recipients.entries()) {
      const normalized = normalizeAddress(recipient.address);
      if (seen.has(normalized)) {
        ctx.addIssue({
          code: "custom",
          path: ["recipients", idx, "address"],
          message: `Duplicate recipient address: ${recipient.address}`,
        });
      }
      seen.add(normalized);
    }
  });

export type SplitStrategy = z.infer<typeof SplitStrategySchema>;
