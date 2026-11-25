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
  blockNumber?: number;
  actor?: string;
}

export interface OnChainNegativeProof {
  code: string;
  label: string;
  enforcement: "ALTANA_RELAY_PRE_INCLUSION" | "ONCHAIN_REVERT";
  txHash: `0x${string}` | null;
  celoscanUrl: string | null;
}

export interface LiveDcaTickProof {
  id: string;
  blockNumber: number;
  walletAddress: `0x${string}`;
  actor: string;
  amountInUsdc: string;
  amountOutCelo: string;
  attributionCode: string;
  impactBps?: number;
  deviationBps?: number;
  txHash: `0x${string}`;
  celoscanUrl: string;
}

export const CELO_CHAIN_ID = 42220;
export const CAPRAIL_GITHUB_URL = "https://github.com/takaolovely/caprail" as const;
export const CAPRAIL_AGENT_WALLET = "0x3631D44543384253C099f2A09c0D0bE109Eb7944" as const;
export const ALTANA_CELO_KEYSTORE = "0x83b30935f36d6ccf9B1ec3b5E47F2866b97cd27c" as const;
export const CELO_ERC8004_REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" as const;

export const PRIMARY_DCA_SESSION_GRANT_PROOF = {
  blockNumber: 83716167,
  dailyCapUsdc: 4.0,
  durationDays: 14,
  boundedAllowanceUsdc: 56.0,
  approvalBlockNumber: 83716045,
  approvalTxHash:
    "0x1d4d18c51897af8607f3ed755cbaa3ce72ed97e0006eb243812e0ea64fcf60e6" as `0x${string}`,
  approvalCeloscanUrl:
    "https://celoscan.io/tx/0x1d4d18c51897af8607f3ed755cbaa3ce72ed97e0006eb243812e0ea64fcf60e6",
  selector: "0x04e45aaf" as `0x${string}`,
  txHash:
    "0xc9557761ad247e5d6d17d5d2e22184968c5f91fd19d61e60f896b70fd4268a3c" as `0x${string}`,
  celoscanUrl:
    "https://celoscan.io/tx/0xc9557761ad247e5d6d17d5d2e22184968c5f91fd19d61e60f896b70fd4268a3c",
} as const;

export const NAMED_EXTERNAL_USER_PROOF = {
  handle: "@MFauzulAzim",
  walletAddress: "0xfb69ABfADd1A6f1929e988f41D2AAb0d09c48e63" as `0x${string}`,
  walletCeloscanUrl:
    "https://celoscan.io/address/0xfb69ABfADd1A6f1929e988f41D2AAb0d09c48e63",
  blockNumber: 83625775,
  amountInUsdc: "0.50",
  amountOutCelo: "9.009794",
  approvalTxHash:
    "0x44a9b663d21c17887e05b61568a03f18f374ea2b055ef630964cd58a5277c292" as `0x${string}`,
  txHash:
    "0x838a0216daf4bdac3b728f9471539d60bb9532970d7c43e0ac6b65b1040cfcc5" as `0x${string}`,
  celoscanUrl:
    "https://celoscan.io/tx/0x838a0216daf4bdac3b728f9471539d60bb9532970d7c43e0ac6b65b1040cfcc5",
  attributionCode: "celo_0518175d3efe",
} as const;

export const VERIFIED_ERC8004_REGISTRATION = {
  agentId: 10109,
  blockNumber: 83539919,
  txHash:
    "0x043cfd11e5d698932e7a6efb52ee9122b4edfe747f2c0237793b95c98e18a706" as `0x${string}`,
  celoscanUrl:
    "https://celoscan.io/tx/0x043cfd11e5d698932e7a6efb52ee9122b4edfe747f2c0237793b95c98e18a706",
} as const;

export const VERIFIED_MAINNET_PROOFS: readonly MainnetProofTx[] = [
  {
    id: "dca-session-grant",
    step: "01",
    title: "Primary DCA Session Grant (0x04e45aaf)",
    detail:
      "$4.00/day USDC cap · 14d TTL · SwapRouter02 exactInputSingle (0x04e45aaf) only · $56 bounded approve",
    txHash: PRIMARY_DCA_SESSION_GRANT_PROOF.txHash,
    celoscanUrl: PRIMARY_DCA_SESSION_GRANT_PROOF.celoscanUrl,
    tag: "DCA GRANT",
    tone: "neutral",
    blockNumber: PRIMARY_DCA_SESSION_GRANT_PROOF.blockNumber,
    actor: CAPRAIL_AGENT_WALLET,
  },
  {
    id: "live-dca-tick-3",
    step: "02",
    title: "Autonomous Session DCA Tick #3",
    detail:
      "0.10 USDC -> 1.897283 CELO via session key · impact 0.2127 bps · dev -235.49 bps · celo_0518175d3efe",
    txHash: "0xa220f30f05d0c0e065340b2716ceb9d5b47b266a756bd784eb2fe23d729da230",
    celoscanUrl:
      "https://celoscan.io/tx/0xa220f30f05d0c0e065340b2716ceb9d5b47b266a756bd784eb2fe23d729da230",
    tag: "SESSION DCA",
    tone: "approved",
    blockNumber: 83716253,
    actor: CAPRAIL_AGENT_WALLET,
  },
  {
    id: "headline-dca-swap",
    step: "03",
    title: "Live Auto-DCA Swap #1 (Primary Wallet)",
    detail:
      "0.10 USDC -> 1.809088 CELO via SwapRouter02 (0x04e45aaf) · ERC-8021 celo_0518175d3efe",
    txHash: "0x0c5d57fcdf7054194309aa3efc6ad868b5209d82b038f471aa5d8daf3f8ea56b",
    celoscanUrl:
      "https://celoscan.io/tx/0x0c5d57fcdf7054194309aa3efc6ad868b5209d82b038f471aa5d8daf3f8ea56b",
    tag: "SWAPPED",
    tone: "approved",
    blockNumber: 83540877,
    actor: CAPRAIL_AGENT_WALLET,
  },
  {
    id: "external-user-dca",
    step: "04",
    title: "Named External User (@MFauzulAzim)",
    detail:
      "0.50 USDC -> 9.009794 CELO from 0xfb69…8e63 via SwapRouter02 · ERC-8021 celo_0518175d3efe",
    txHash: NAMED_EXTERNAL_USER_PROOF.txHash,
    celoscanUrl: NAMED_EXTERNAL_USER_PROOF.celoscanUrl,
    tag: "EXTERNAL USER",
    tone: "approved",
    blockNumber: NAMED_EXTERNAL_USER_PROOF.blockNumber,
    actor: `${NAMED_EXTERNAL_USER_PROOF.handle} (${NAMED_EXTERNAL_USER_PROOF.walletAddress})`,
  },
  {
    id: "smoke-test-grant",
    step: "05",
    title: "live:test Smoke-Test Grant",
    detail:
      "0.15 USDC/tx · 0.30 USDC total · 1h TTL · USDC.transfer allowlist (smoke-test harness)",
    txHash: "0x928012be32adf147c343ab658b26ccef5e4928eafeb48ce2d8849931ae8f954a",
    celoscanUrl:
      "https://celoscan.io/tx/0x928012be32adf147c343ab658b26ccef5e4928eafeb48ce2d8849931ae8f954a",
    tag: "SMOKE GRANT",
    tone: "neutral",
    blockNumber: 83506620,
  },
  {
    id: "revoke",
    step: "06",
    title: "1-Tx Emergency Revoke",
    detail: "Instant KeyStore invalidation: subsequent session calls rejected",
    txHash: "0x1455448cb2fedd67aa7e46591328c09b4f75d3062f254b52dc429b624302d320",
    celoscanUrl:
      "https://celoscan.io/tx/0x1455448cb2fedd67aa7e46591328c09b4f75d3062f254b52dc429b624302d320",
    tag: "REVOKED",
    tone: "revoked",
  },
] as const;

/**
 * Verified live Auto-DCA swap executions on Celo Mainnet (Chain ID 42220).
 * Append newly settled automated `dca:tick --live` transactions here as they settle.
 */
export const LIVE_DCA_TICK_PROOFS: readonly LiveDcaTickProof[] = [
  {
    id: "dca-mainnet-1",
    blockNumber: 83540877,
    walletAddress: CAPRAIL_AGENT_WALLET,
    actor: "Primary Agent Wallet",
    amountInUsdc: "0.10",
    amountOutCelo: "1.809088",
    attributionCode: "celo_0518175d3efe",
    txHash: "0x0c5d57fcdf7054194309aa3efc6ad868b5209d82b038f471aa5d8daf3f8ea56b",
    celoscanUrl:
      "https://celoscan.io/tx/0x0c5d57fcdf7054194309aa3efc6ad868b5209d82b038f471aa5d8daf3f8ea56b",
  },
  {
    id: "dca-mainnet-external-2",
    blockNumber: NAMED_EXTERNAL_USER_PROOF.blockNumber,
    walletAddress: NAMED_EXTERNAL_USER_PROOF.walletAddress,
    actor: NAMED_EXTERNAL_USER_PROOF.handle,
    amountInUsdc: NAMED_EXTERNAL_USER_PROOF.amountInUsdc,
    amountOutCelo: NAMED_EXTERNAL_USER_PROOF.amountOutCelo,
    attributionCode: NAMED_EXTERNAL_USER_PROOF.attributionCode,
    txHash: NAMED_EXTERNAL_USER_PROOF.txHash,
    celoscanUrl: NAMED_EXTERNAL_USER_PROOF.celoscanUrl,
  },
  {
    id: "dca-mainnet-session-3",
    blockNumber: 83716253,
    walletAddress: CAPRAIL_AGENT_WALLET,
    actor: "Primary Agent Wallet (Session Key)",
    amountInUsdc: "0.10",
    amountOutCelo: "1.897283",
    attributionCode: "celo_0518175d3efe",
    impactBps: 0.2127,
    deviationBps: -235.49,
    txHash: "0xa220f30f05d0c0e065340b2716ceb9d5b47b266a756bd784eb2fe23d729da230",
    celoscanUrl:
      "https://celoscan.io/tx/0xa220f30f05d0c0e065340b2716ceb9d5b47b266a756bd784eb2fe23d729da230",
  },
] as const;

export const ONCHAIN_NEGATIVE_PROOFS: readonly OnChainNegativeProof[] = [
  {
    code: "[call_not_permitted]",
    label:
      "Un-allowlisted USD₮ call rejected pre-inclusion by Altana KeyStore / Relay (no gas wasted on mined revert)",
    enforcement: "ALTANA_RELAY_PRE_INCLUSION",
    txHash: null,
    celoscanUrl: null,
  },
  {
    code: "[spend_limit_exceeded]",
    label:
      "0.35 USDC > 0.30 USDC cap rejected pre-inclusion by Altana KeyStore / Relay (no gas wasted on mined revert)",
    enforcement: "ALTANA_RELAY_PRE_INCLUSION",
    txHash: null,
    celoscanUrl: null,
  },
] as const;

export const CAPRAIL_AGENT_CARD = agentCardData;

export const CAPRAIL_METADATA = {
  repo: CAPRAIL_REPO_SLUG,
  agentWallet: CAPRAIL_AGENT_WALLET,
  attributionCode: CAPRAIL_DEFAULT_ATTRIBUTION_CODE,
  defaultDailyCapUsdc: 4.0,
  usdc: CELO_MAINNET_TOKENS.USDC,
  usdt: CELO_MAINNET_TOKENS.USDT,
  celo: CELO_MAINNET_TOKENS.CELO,
  swapRouter02: CELO_MAINNET_ROUTERS.UNISWAP_V3_SWAP_ROUTER_02,
} as const;
