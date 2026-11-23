import { loadEnv } from "../config/env.js";
import {
  appendAttributionTag,
  CAPRAIL_DEFAULT_ATTRIBUTION_CODE,
  CAPRAIL_REPO_SLUG,
  decodeAttributionTag,
  probeCeloMainnetAndAltana,
} from "../wallet/index.js";

async function main(): Promise<void> {
  const env = loadEnv();
  const attributionCode =
    env.CELO_ATTRIBUTION_CODE ?? CAPRAIL_DEFAULT_ATTRIBUTION_CODE;

  console.log("=== CapRail — Celo Mainnet & Altana SDK Read-Only Network Check ===");
  console.log(`Repository         : ${CAPRAIL_REPO_SLUG}`);
  console.log(`RPC URL            : ${env.CELO_RPC_URL}`);

  const probe = await probeCeloMainnetAndAltana(env.CELO_RPC_URL);

  console.log(`RPC Chain ID       : ${probe.rpcChainId} (Celo Mainnet verified)`);
  console.log(`Latest Block       : ${probe.latestBlockNumber.toString()}`);
  console.log(`Altana Chain ID    : ${probe.altanaChainId}`);
  console.log(`Altana KeyStore    : ${probe.altanaKeyStore}`);
  console.log(`Altana Controller  : ${probe.altanaKeyStoreController}`);
  console.log(`Altana Relay URL   : ${probe.altanaRelayUrl ?? "none"}`);
  console.log(`ERC-8004 Registry  : ${probe.erc8004IdentityRegistry}`);

  if (probe.relayFeeCurrencies !== null) {
    const tokens = probe.relayFeeCurrencies.currencies
      .map((c) => `${c.symbol} (${c.address})`)
      .join(", ");
    console.log(
      `Relay Fee Tokens   : ${tokens || "(empty list returned by relay)"}`,
    );
  } else {
    console.log(
      `Relay Fee Tokens   : unavailable (${probe.relayProbeError ?? "unknown error"})`,
    );
  }

  // Offline ERC-8021 attribution-tags round-trip sanity check
  const sampleCalldata = appendAttributionTag("0xa9059cbb", attributionCode);
  const decoded = decodeAttributionTag(sampleCalldata);
  console.log(
    `Attribution Tag    : ${attributionCode} (ERC-8021 decode verified=${decoded?.codes.includes(attributionCode) === true})`,
  );
  console.log("=== Check Complete (Zero Private Keys Used) ===");
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[check:network FAILED] ${message}`);
  process.exitCode = 1;
});
