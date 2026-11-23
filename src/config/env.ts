import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
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

const ALLOWLISTED_ENV_KEYS = [
  "EXECUTION_MODE",
  "CELO_RPC_URL",
  "CELO_ATTRIBUTION_CODE",
  "OWNER_PRIVATE_KEY",
  "ALTANA_ADMIN_PRIVATE_KEY",
  "ALTANA_SESSION_PRIVATE_KEY",
  "ALTANA_WALLET_ADDRESS",
  "TEST_RECIPIENT_ADDRESS",
  "ERC8004_AGENT_CARD_URI",
] as const;

const ALLOWLISTED_KEY_SET = new Set<string>(ALLOWLISTED_ENV_KEYS);

const EnvSchema = z.object({
  EXECUTION_MODE: z
    .enum(["LOCAL_SIMULATION", "CELO_MAINNET"])
    .default("LOCAL_SIMULATION"),
  CELO_RPC_URL: z.string().url().default("https://forno.celo.org"),
  CELO_ATTRIBUTION_CODE: OptionalNonEmpty,
  OWNER_PRIVATE_KEY: OptionalNonEmpty.pipe(HexKeySchema.optional()),
  ALTANA_ADMIN_PRIVATE_KEY: OptionalNonEmpty.pipe(HexKeySchema.optional()),
  ALTANA_SESSION_PRIVATE_KEY: OptionalNonEmpty.pipe(HexKeySchema.optional()),
  ALTANA_WALLET_ADDRESS: OptionalNonEmpty.pipe(EvmAddressEnvSchema.optional()),
  TEST_RECIPIENT_ADDRESS: OptionalNonEmpty.pipe(EvmAddressEnvSchema.optional()),
  ERC8004_AGENT_CARD_URI: OptionalNonEmpty.pipe(z.string().url().optional()),
});

export type AppEnv = z.infer<typeof EnvSchema>;

/**
 * Safely reads allowlisted keys from a workspace-confined `.env` file.
 * Enforces `path.relative()` containment so paths outside `workspaceDir` are rejected.
 */
function readConfinedDotEnv(workspaceDir: string): Record<string, string> {
  const root = path.resolve(workspaceDir);
  const envFile = path.resolve(root, ".env");
  const rel = path.relative(root, envFile);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Path confinement violation while reading .env");
  }
  if (!existsSync(envFile)) {
    return {};
  }

  const parsed: Record<string, string> = {};
  const lines = readFileSync(envFile, "utf8").split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eqIndex = line.indexOf("=");
    if (eqIndex <= 0) continue;
    const key = line.slice(0, eqIndex).trim();
    if (!ALLOWLISTED_KEY_SET.has(key)) continue;
    let value = line.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }

  return parsed;
}

/**
 * Explicit allowlist environment loader.
 * Reads workspace `.env` (if present) overlaid with explicitly allowlisted `source` vars.
 * Never reads or forwards arbitrary keys from process.env.
 */
export function loadEnv(
  source?: Record<string, string | undefined>,
  workspaceDir: string = process.cwd(),
): AppEnv {
  const effectiveSource = source ?? process.env;
  const fromDotEnv = source === undefined ? readConfinedDotEnv(workspaceDir) : {};
  const get = (key: (typeof ALLOWLISTED_ENV_KEYS)[number]): string | undefined =>
    effectiveSource[key] ?? fromDotEnv[key];

  const allowlisted = {
    EXECUTION_MODE: get("EXECUTION_MODE") || undefined,
    CELO_RPC_URL: get("CELO_RPC_URL") || undefined,
    CELO_ATTRIBUTION_CODE: get("CELO_ATTRIBUTION_CODE"),
    OWNER_PRIVATE_KEY: get("OWNER_PRIVATE_KEY"),
    ALTANA_ADMIN_PRIVATE_KEY: get("ALTANA_ADMIN_PRIVATE_KEY"),
    ALTANA_SESSION_PRIVATE_KEY: get("ALTANA_SESSION_PRIVATE_KEY"),
    ALTANA_WALLET_ADDRESS: get("ALTANA_WALLET_ADDRESS"),
    TEST_RECIPIENT_ADDRESS: get("TEST_RECIPIENT_ADDRESS"),
    ERC8004_AGENT_CARD_URI: get("ERC8004_AGENT_CARD_URI"),
  };

  return EnvSchema.parse(allowlisted);
}
