import {
  codeFromRepo,
  fromDataSuffix,
  toDataSuffix,
  withAttribution,
  type DecodedSuffix,
} from "@celo/attribution-tags";
import { concatHex, createWalletClient, http, type Account, type Hex } from "viem";
import { celo } from "viem/chains";

export const CAPRAIL_REPO_SLUG = "takaolovely/caprail";
export const CAPRAIL_DEFAULT_ATTRIBUTION_CODE = codeFromRepo(CAPRAIL_REPO_SLUG);

/**
 * Appends an ERC-8021 Celo attribution suffix to raw calldata for Altana relay calls.
 * Because EVM functions ignore trailing bytes beyond ABI arguments, this preserves
 * call semantics while keeping the attribution tag decodable via `fromDataSuffix`.
 */
export function appendAttributionTag(
  data: Hex | undefined,
  code: string | readonly string[] | undefined,
): Hex {
  const baseData: Hex = data ?? "0x";
  if (code === undefined || (typeof code === "string" && code.trim() === "")) {
    return baseData;
  }

  // Idempotency guard: if the calldata already ends with the requested ERC-8021 code(s),
  // avoid appending a duplicate suffix.
  const existing = baseData.length > 2 ? fromDataSuffix(baseData) : null;
  if (existing !== null) {
    const requested = typeof code === "string" ? [code] : code;
    if (requested.every((c) => existing.codes.includes(c))) {
      return baseData;
    }
  }

  const suffix = toDataSuffix(code);
  return concatHex([baseData, suffix]);
}

export function decodeAttributionTag(data: Hex): DecodedSuffix | null {
  return fromDataSuffix(data);
}

export function deriveRepoAttributionCode(
  repoSlug: string = CAPRAIL_REPO_SLUG,
): string {
  return codeFromRepo(repoSlug);
}

/**
 * Creates a Celo Mainnet (Chain ID 42220) viem WalletClient extended with
 * `@celo/attribution-tags` ERC-8021 `withAttribution(code)`.
 */
export function createAttributedCeloWalletClient(opts: {
  account: Account;
  rpcUrl: string;
  attributionCode: string;
}) {
  return createWalletClient({
    account: opts.account,
    chain: celo,
    transport: http(opts.rpcUrl),
  }).extend(withAttribution(opts.attributionCode));
}
