import { getAddress, type Address, type Hex } from "viem";
import { loadEnv } from "../config/env.js";
import {
  CELO_MAINNET_ROUTERS,
  CELO_MAINNET_TOKENS,
  grantAutoDcaSession,
} from "../wallet/index.js";

interface GrantCliOptions {
  dailyCapUsdc: number;
  days: number;
  dryRun: boolean;
}

function parseNumberFlag(
  argv: readonly string[],
  flag: string,
  fallback: number,
): number {
  const idx = argv.indexOf(flag);
  if (idx === -1 || idx + 1 >= argv.length) return fallback;
  const raw = argv[idx + 1];
  if (raw === undefined) return fallback;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid positive numeric value for ${flag}: "${raw}"`);
  }
  return parsed;
}

function parseGrantCliArgs(argv: readonly string[]): GrantCliOptions {
  const dailyCapUsdc = parseNumberFlag(argv, "--daily-cap", 2);
  const daysRaw = parseNumberFlag(argv, "--days", 14);
  if (!Number.isInteger(daysRaw)) {
    throw new Error(`--days must be a positive integer, received "${daysRaw}"`);
  }
  return {
    dailyCapUsdc,
    days: daysRaw,
    dryRun: argv.includes("--dry-run"),
  };
}

async function main(): Promise<void> {
  const opts = parseGrantCliArgs(process.argv.slice(2));
  const env = loadEnv();

  const adminPrivateKey = (env.OWNER_PRIVATE_KEY ??
    env.ALTANA_ADMIN_PRIVATE_KEY) as Hex | undefined;
  if (adminPrivateKey === undefined) {
    throw new Error(
      "Missing OWNER_PRIVATE_KEY (or ALTANA_ADMIN_PRIVATE_KEY) in local .env. Run session:grant strictly on the owner's local machine.",
    );
  }

  const existingSessionKey = env.ALTANA_SESSION_PRIVATE_KEY as Hex | undefined;
  const pinnedWalletAddress: Address | undefined = env.ALTANA_WALLET_ADDRESS
    ? getAddress(env.ALTANA_WALLET_ADDRESS)
    : undefined;

  const result = await grantAutoDcaSession({
    adminPrivateKey,
    sessionPrivateKey: existingSessionKey,
    dailySpendCapUsdc: opts.dailyCapUsdc,
    days: opts.days,
    rpcUrl: env.CELO_RPC_URL,
    existingWalletAddress: pinnedWalletAddress,
    dryRun: opts.dryRun,
  });

  const expiryIso = new Date(result.expiry * 1000).toISOString();

  console.log("====================================================================");
  console.log(
    ` CapRail | Altana Auto-DCA Session Grant (${result.dryRun ? "DRY_RUN PREVIEW" : "CELO MAINNET 42220"})`,
  );
  console.log("====================================================================");
  console.log(`Altana Wallet    : ${result.walletAddress}`);
  console.log(
    `Session Signer   : ${result.sessionAddress} (${result.sessionGenerated ? "newly generated" : "from .env"})`,
  );
  console.log(`Daily USDC Cap   : $${result.dailySpendCapUsdc.toFixed(2)} USDC/day (${result.dailySpendCapUnits.toString()} base units)`);
  console.log(`Duration         : ${result.days} days (expires ${expiryIso})`);
  console.log(`Allowed Router   : ${CELO_MAINNET_ROUTERS.UNISWAP_V3_SWAP_ROUTER_02} (exactInputSingle)`);
  console.log(`Allowed Token    : ${CELO_MAINNET_TOKENS.USDC} (approve)`);

  if (result.dryRun) {
    console.log("--------------------------------------------------------------------");
    console.log("[DRY RUN] No on-chain transaction was signed or broadcast.");
    console.log("Remove --dry-run to authorize this session key on Celo Mainnet.");
    return;
  }

  console.log(`Session Key ID   : ${result.keyId ?? "n/a"}`);
  console.log(`Session Key Hash : ${result.keyHash ?? "n/a"}`);
  console.log(`Grant Tx Hash    : ${result.txHash ?? "(bundled)"}`);
  if (result.txHash !== undefined) {
    console.log(`Celoscan         : https://celoscan.io/tx/${result.txHash}`);
  }
  console.log("====================================================================\n");
  console.log("Copy ONLY these two lines to your VPS / autonomous agent .env:");
  console.log(`ALTANA_WALLET_ADDRESS=${result.walletAddress}`);
  console.log(`ALTANA_SESSION_PRIVATE_KEY=${result.sessionPrivateKey}`);
  console.log(
    "\nSECURITY WARNING: NEVER copy OWNER_PRIVATE_KEY or ALTANA_ADMIN_PRIVATE_KEY to the agent VPS host.",
  );
  console.log(
    "Keep the owner master key strictly on your local machine for session grants and 1-tx emergency revoke.",
  );
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[session:grant FAILED] ${message}\n`);
  process.exitCode = 1;
});
