import { z } from "zod";

const HexKeySchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, "Expected 32-byte 0x-prefixed hex private key");

const EvmAddressEnvSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "Expected 20-byte 0x-prefixed EVM address");

const OptionalNonEmpty = z
  .string()
  .trim()
  .transform((v) => (v === "" ? undefined : v))
  .optional();

const EnvSchema = z.object({
  EXECUTION_MODE: z
    .enum(["LOCAL_SIMULATION", "CELO_MAINNET"])
    .default("LOCAL_SIMULATION"),
  CELO_RPC_URL: z.string().url().default("https://forno.celo.org"),
  CELO_ATTRIBUTION_CODE: OptionalNonEmpty,
  ALTANA_ADMIN_PRIVATE_KEY: OptionalNonEmpty.pipe(HexKeySchema.optional()),
  ALTANA_SESSION_PRIVATE_KEY: OptionalNonEmpty.pipe(HexKeySchema.optional()),
  ALTANA_WALLET_ADDRESS: OptionalNonEmpty.pipe(EvmAddressEnvSchema.optional()),
  ERC8004_AGENT_CARD_URI: OptionalNonEmpty.pipe(z.string().url().optional()),
});

export type AppEnv = z.infer<typeof EnvSchema>;

/**
 * Explicit allowlist environment loader.
 * Never reads or forwards arbitrary keys from process.env.
 */
export function loadEnv(
  source: Record<string, string | undefined> = process.env,
): AppEnv {
  const allowlisted = {
    EXECUTION_MODE: source.EXECUTION_MODE || undefined,
    CELO_RPC_URL: source.CELO_RPC_URL || undefined,
    CELO_ATTRIBUTION_CODE: source.CELO_ATTRIBUTION_CODE,
    ALTANA_ADMIN_PRIVATE_KEY: source.ALTANA_ADMIN_PRIVATE_KEY,
    ALTANA_SESSION_PRIVATE_KEY: source.ALTANA_SESSION_PRIVATE_KEY,
    ALTANA_WALLET_ADDRESS: source.ALTANA_WALLET_ADDRESS,
    ERC8004_AGENT_CARD_URI: source.ERC8004_AGENT_CARD_URI,
  };

  return EnvSchema.parse(allowlisted);
}
