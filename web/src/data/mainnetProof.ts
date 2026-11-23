import agentCardData from "@caprail/identity/agent-card.json";
import { CAPRAIL_DEFAULT_ATTRIBUTION_CODE, CAPRAIL_REPO_SLUG } from "@caprail/wallet/attribution.js";
import { CELO_MAINNET_ROUTERS, CELO_MAINNET_TOKENS } from "@caprail/wallet/calldata.js";

export interface MainnetProofTx {
  id: string;
  step: string;
  title: string;
  detail: string;
  txHash: `0x${string}`;
  celoscanUrl: string;
  tag: string;
  tone: "approved" | "revoked" | "neutral";
}

export const CELO_CHAIN_ID = 42220;
export const CAPRAIL_GITHUB_URL = "https://github.com/takaolovely/caprail" as const;
export const ALTANA_CELO_KEYSTORE = "0x83b30935f36d6ccf9B1ec3b5E47F2866b97cd27c" as const;
export const CELO_ERC8004_REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" as const;

export const VERIFIED_MAINNET_PROOFS: readonly MainnetProofTx[] = [
  {
    id: "grant",
    step: "01",
    title: "Grant Scoped Session Key",
    detail: "0.15 USDC/tx · 0.30 USDC total · 1h TTL · USDC.transfer allowlist",
    txHash: "0x928012be32adf147c343ab658b26ccef5e4928eafeb48ce2d8849931ae8f954a",
    celoscanUrl:
      "https://celoscan.io/tx/0x928012be32adf147c343ab658b26ccef5e4928eafeb48ce2d8849931ae8f954a",
    tag: "GRANTED",
    tone: "neutral",
  },
  {
    id: "split",
    step: "02",
    title: "Attributed Revenue Split",
    detail: "0.05 USDC live payout · ERC-8021 tag celo_cbf00f366dda verified",
    txHash: "0xcb30c9969a2816bbffee446c17eaf840ccd57548656f97f845013e6c1dbf1c27",
    celoscanUrl:
      "https://celoscan.io/tx/0xcb30c9969a2816bbffee446c17eaf840ccd57548656f97f845013e6c1dbf1c27",
    tag: "APPROVED",
    tone: "approved",
  },
  {
    id: "revoke",
    step: "03",
    title: "1-Tx Emergency Revoke",
    detail: "Instant KeyStore invalidation — subsequent session calls rejected",
    txHash: "0x1455448cb2fedd67aa7e46591328c09b4f75d3062f254b52dc429b624302d320",
    celoscanUrl:
      "https://celoscan.io/tx/0x1455448cb2fedd67aa7e46591328c09b4f75d3062f254b52dc429b624302d320",
    tag: "REVOKED",
    tone: "revoked",
  },
] as const;

export const ONCHAIN_NEGATIVE_PROOFS = [
  {
    code: "[call_not_permitted]",
    label: "Un-allowlisted USD₮ call rejected directly by Altana KeyStore / Relay",
  },
  {
    code: "[spend_limit_exceeded]",
    label: "0.35 USDC > 0.30 USDC cap rejected directly by Altana KeyStore / Relay",
  },
] as const;

export const CAPRAIL_AGENT_CARD = agentCardData;

export const CAPRAIL_METADATA = {
  repo: CAPRAIL_REPO_SLUG,
  attributionCode: CAPRAIL_DEFAULT_ATTRIBUTION_CODE,
  usdc: CELO_MAINNET_TOKENS.USDC,
  usdt: CELO_MAINNET_TOKENS.USDT,
  celo: CELO_MAINNET_TOKENS.CELO,
  swapRouter02: CELO_MAINNET_ROUTERS.UNISWAP_V3_SWAP_ROUTER_02,
} as const;
