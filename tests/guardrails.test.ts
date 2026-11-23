import { CELO } from "@altananetwork/sdk";
import { decodeFunctionData, isAddress, type Address } from "viem";
import { describe, expect, it } from "vitest";
import {
  AuditLogger,
  AutoDcaEngine,
  RevenueSplitterEngine,
} from "../src/engine/index.js";
import {
  CELO_ERC8004_REGISTRY,
  decodeAgentCardDataUri,
  encodeAgentCardDataUri,
  loadAgentCardTemplate,
  withErc8004Registration,
} from "../src/identity/erc8004.js";
import {
  computeDeterministicSplits,
  DcaStrategySchema,
  SessionPolicySchema,
  SplitStrategySchema,
  type DcaStrategy,
  type SessionPolicy,
  type SplitStrategy,
} from "../src/policy/index.js";
import {
  appendAttributionTag,
  buildAltanaSessionPermissions,
  CAPRAIL_DEFAULT_ATTRIBUTION_CODE,
  CAPRAIL_REPO_SLUG,
  CELO_MAINNET_ROUTERS,
  CELO_MAINNET_TOKENS,
  createReadOnlyAltanaCeloClient,
  decodeAttributionTag,
  deriveRepoAttributionCode,
  encodeAttributedErc20Transfer,
  encodeAttributedUniswapV3Swap,
  ERC20_ABI,
  ERC20_TRANSFER_SELECTOR,
  LocalSessionSimulator,
  UNISWAP_V3_EXACT_INPUT_SINGLE_SELECTOR,
  UNISWAP_V3_SWAP_ROUTER_02_ABI,
} from "../src/wallet/index.js";

const USDC = "0xcebA9300f2b948710d2653dD7B07f33A8B32118C" as Address;
const CELO_TOKEN = "0x471EcE3750Da237f93B8E339c536989b8978a438" as Address;
const WALLET = "0x1111111111111111111111111111111111111111" as Address;
const ROUTER = "0x2222222222222222222222222222222222222222" as Address;
const RECIPIENT_A = "0x3333333333333333333333333333333333333333" as Address;
const RECIPIENT_B = "0x4444444444444444444444444444444444444444" as Address;
const RECIPIENT_C = "0x5555555555555555555555555555555555555555" as Address;
const FOREIGN_ADDR = "0xdead00000000000000000000000000000000beef" as Address;

const BASE_TIME = 1_795_000_000;

function makePolicy(overrides?: Partial<SessionPolicy>): SessionPolicy {
  return {
    sessionId: "test-session-1",
    spendCapPerTx: 50_000_000n,
    totalSpendCap: 100_000_000n,
    allowedTargets: [ROUTER, RECIPIENT_A, RECIPIENT_B, RECIPIENT_C],
    expiresAt: BASE_TIME + 86_400,
    revoked: false,
    token: USDC,
    ...overrides,
  };
}

function makeDcaStrategy(overrides?: Partial<DcaStrategy>): DcaStrategy {
  return {
    strategyId: "dca-usdc-celo",
    tokenIn: USDC,
    tokenOut: CELO_TOKEN,
    amountPerRun: 25_000_000n,
    intervalSeconds: 3600,
    allowedRouter: ROUTER,
    maxSlippageBps: 100,
    ...overrides,
  };
}

function makeSplitStrategy(overrides?: Partial<SplitStrategy>): SplitStrategy {
  return {
    strategyId: "split-3way",
    token: USDC,
    recipients: [
      { label: "Treasury", address: RECIPIENT_A, bps: 5000 },
      { label: "Collaborator", address: RECIPIENT_B, bps: 3000 },
      { label: "Reserve", address: RECIPIENT_C, bps: 2000 },
    ],
    ...overrides,
  };
}

describe("Policy Schemas & Deterministic Split Math", () => {
  it("rejects SplitStrategy whose recipient bps do not sum to 10000", () => {
    const parsed = SplitStrategySchema.safeParse({
      ...makeSplitStrategy(),
      recipients: [
        { label: "A", address: RECIPIENT_A, bps: 5000 },
        { label: "B", address: RECIPIENT_B, bps: 4999 },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects duplicate recipients (case-insensitive) in SplitStrategy", () => {
    const parsed = SplitStrategySchema.safeParse({
      ...makeSplitStrategy(),
      recipients: [
        { label: "A", address: RECIPIENT_A.toLowerCase(), bps: 5000 },
        { label: "A2", address: RECIPIENT_A.toUpperCase().replace("0X", "0x"), bps: 5000 },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects DcaStrategy where tokenIn equals tokenOut", () => {
    const parsed = DcaStrategySchema.safeParse(
      makeDcaStrategy({ tokenIn: USDC, tokenOut: USDC }),
    );
    expect(parsed.success).toBe(false);
  });

  it("rejects SessionPolicy where totalSpendCap < spendCapPerTx", () => {
    const parsed = SessionPolicySchema.safeParse(
      makePolicy({ spendCapPerTx: 100n, totalSpendCap: 50n }),
    );
    expect(parsed.success).toBe(false);
  });

  it("distributes indivisible amounts deterministically with zero dust loss", () => {
    const payouts = computeDeterministicSplits(100n, [
      { label: "A", address: RECIPIENT_A, bps: 3334 },
      { label: "B", address: RECIPIENT_B, bps: 3333 },
      { label: "C", address: RECIPIENT_C, bps: 3333 },
    ]);
    const total = payouts.reduce((acc, p) => acc + p.amount, 0n);
    expect(total).toBe(100n);
    expect(payouts.map((p) => p.amount)).toEqual([34n, 33n, 33n]);
  });
});

describe("AutoDcaEngine & RevenueSplitterEngine Guardrails (LOCAL_SIMULATION)", () => {
  it("approves valid Auto-DCA and 3-way Revenue Split within caps and logs structured audit events", async () => {
    const wallet = new LocalSessionSimulator({
      walletAddress: WALLET,
      policy: makePolicy(),
      attributionCode: "celo_test1234",
    });
    const auditLogger = new AuditLogger();
    const dca = new AutoDcaEngine({ wallet, strategy: makeDcaStrategy(), auditLogger });
    const splitter = new RevenueSplitterEngine({
      wallet,
      strategy: makeSplitStrategy(),
      auditLogger,
    });

    const dcaRes = await dca.executeRun({
      minAmountOut: 1n,
      slippageBps: 50,
      nowSec: BASE_TIME,
    });
    expect(dcaRes.mode).toBe("LOCAL_SIMULATION");
    expect(dcaRes.status).toBe("APPROVED");
    expect(dcaRes.spentTotal).toBe(25_000_000n);
    expect(dcaRes.remainingTotalCap).toBe(75_000_000n);

    const splitOut = await splitter.executeSplit({
      totalAmount: 40_000_000n,
      nowSec: BASE_TIME + 10,
    });
    expect(splitOut.result.mode).toBe("LOCAL_SIMULATION");
    expect(splitOut.result.status).toBe("APPROVED");
    expect(splitOut.payouts.map((p) => p.amount)).toEqual([
      20_000_000n,
      12_000_000n,
      8_000_000n,
    ]);
    expect(splitOut.result.spentTotal).toBe(65_000_000n);
    expect(splitOut.result.remainingTotalCap).toBe(35_000_000n);

    expect(auditLogger.getEvents()).toHaveLength(2);
    expect(auditLogger.getEvents().every((e) => e.status === "APPROVED")).toBe(true);
  });

  it("blocks over-per-tx-cap, cumulative over-total-cap, and foreign targets deterministically", async () => {
    const wallet = new LocalSessionSimulator({
      walletAddress: WALLET,
      policy: makePolicy({ spendCapPerTx: 50_000_000n, totalSpendCap: 60_000_000n }),
    });
    const auditLogger = new AuditLogger();
    const dca = new AutoDcaEngine({ wallet, strategy: makeDcaStrategy(), auditLogger });

    // Over per-tx cap (51 > 50)
    const overPerTx = await dca.executeRun({
      amountIn: 51_000_000n,
      minAmountOut: 1n,
      slippageBps: 50,
      nowSec: BASE_TIME,
    });
    expect(overPerTx.status).toBe("BLOCKED");
    expect(overPerTx.reasonCode).toBe("EXCEEDS_PER_TX_CAP");
    expect(wallet.getSpentTotal()).toBe(0n);

    // Unauthorized foreign target
    const foreign = await dca.executeRun({
      amountIn: 10_000_000n,
      minAmountOut: 1n,
      slippageBps: 50,
      routerOverride: FOREIGN_ADDR,
      nowSec: BASE_TIME,
    });
    expect(foreign.status).toBe("BLOCKED");
    expect(foreign.reasonCode).toBe("TARGET_NOT_ALLOWLISTED");
    expect(wallet.getSpentTotal()).toBe(0n);

    // Spend 40 valid, then try 30 (40 + 30 > 60 totalSpendCap)
    const okRun = await dca.executeRun({
      amountIn: 40_000_000n,
      minAmountOut: 1n,
      slippageBps: 50,
      nowSec: BASE_TIME,
    });
    expect(okRun.status).toBe("APPROVED");

    const overTotal = await dca.executeRun({
      amountIn: 30_000_000n,
      minAmountOut: 1n,
      slippageBps: 50,
      nowSec: BASE_TIME + 3600,
    });
    expect(overTotal.status).toBe("BLOCKED");
    expect(overTotal.reasonCode).toBe("EXCEEDS_TOTAL_CAP");
    expect(wallet.getSpentTotal()).toBe(40_000_000n);
  });

  it("blocks Revenue Split atomically if any recipient is outside session allowedTargets", async () => {
    const wallet = new LocalSessionSimulator({
      walletAddress: WALLET,
      policy: makePolicy({ allowedTargets: [RECIPIENT_A, RECIPIENT_B] }), // RECIPIENT_C omitted!
    });
    const auditLogger = new AuditLogger();
    const splitter = new RevenueSplitterEngine({
      wallet,
      strategy: makeSplitStrategy(),
      auditLogger,
    });

    const outcome = await splitter.executeSplit({
      totalAmount: 30_000_000n,
      nowSec: BASE_TIME,
    });
    expect(outcome.result.status).toBe("BLOCKED");
    expect(outcome.result.reasonCode).toBe("TARGET_NOT_ALLOWLISTED");
    // Atomic guarantee: 0 spent even though RECIPIENT_A and RECIPIENT_B were valid
    expect(wallet.getSpentTotal()).toBe(0n);
  });

  it("blocks DCA runs violating intervalSeconds or maxSlippageBps", async () => {
    const wallet = new LocalSessionSimulator({
      walletAddress: WALLET,
      policy: makePolicy(),
    });
    const auditLogger = new AuditLogger();
    const dca = new AutoDcaEngine({ wallet, strategy: makeDcaStrategy(), auditLogger });

    const badSlippage = await dca.executeRun({
      minAmountOut: 1n,
      slippageBps: 250, // > 100 maxSlippageBps
      nowSec: BASE_TIME,
    });
    expect(badSlippage.status).toBe("BLOCKED");

    const firstOk = await dca.executeRun({
      minAmountOut: 1n,
      slippageBps: 50,
      nowSec: BASE_TIME,
    });
    expect(firstOk.status).toBe("APPROVED");

    const tooSoon = await dca.executeRun({
      minAmountOut: 1n,
      slippageBps: 50,
      nowSec: BASE_TIME + 120, // < 3600 intervalSeconds
    });
    expect(tooSoon.status).toBe("BLOCKED");
  });

  it("blocks execution when session is expired or revoked", async () => {
    const wallet = new LocalSessionSimulator({
      walletAddress: WALLET,
      policy: makePolicy({ expiresAt: BASE_TIME + 100 }),
    });
    const auditLogger = new AuditLogger();
    const dca = new AutoDcaEngine({ wallet, strategy: makeDcaStrategy(), auditLogger });

    // Expired
    const expired = await dca.executeRun({
      minAmountOut: 1n,
      slippageBps: 50,
      nowSec: BASE_TIME + 100,
    });
    expect(expired.status).toBe("BLOCKED");
    expect(expired.reasonCode).toBe("SESSION_EXPIRED");

    // Revoked (even at valid timestamp)
    const rev = await dca.revokeSession("compromised key test");
    expect(rev.revoked).toBe(true);
    expect(wallet.isRevoked()).toBe(true);

    const postRevoke = await dca.executeRun({
      minAmountOut: 1n,
      slippageBps: 50,
      nowSec: BASE_TIME,
    });
    expect(postRevoke.status).toBe("BLOCKED");
    expect(postRevoke.reasonCode).toBe("SESSION_REVOKED");
  });
});

describe("Real SDK Integration Helpers (Altana, ERC-8021 Attribution, ERC-8004)", () => {
  it("encodes and decodes ERC-8021 attribution tags via @celo/attribution-tags", () => {
    const code = deriveRepoAttributionCode(CAPRAIL_REPO_SLUG);
    expect(code).toBe(CAPRAIL_DEFAULT_ATTRIBUTION_CODE);
    const tagged = appendAttributionTag("0xa9059cbb00000001", code);
    const decoded = decodeAttributionTag(tagged);
    expect(decoded).not.toBeNull();
    expect(decoded?.codes).toContain(code);
  });

  it("initializes @altananetwork/sdk client for Celo Mainnet (42220) and maps SessionPermissions", () => {
    const client = createReadOnlyAltanaCeloClient();
    expect(client.defaultChainId).toBe(42220);
    expect(CELO.chainId).toBe(42220);

    const perms = buildAltanaSessionPermissions(makePolicy(), "day");
    expect(perms.calls).toHaveLength(4);
    expect(perms.spend?.[0]?.limit).toBe(100_000_000n);
    expect(perms.spend?.[0]?.token).toBe(USDC);
  });

  it("loads and round-trips ERC-8004 agent card against Celo Mainnet registry", async () => {
    expect(CELO_ERC8004_REGISTRY.toLowerCase()).toBe(
      "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432",
    );
    const card = await loadAgentCardTemplate();
    const patched = withErc8004Registration(card, 42n, CELO.chainId);
    const uri = encodeAgentCardDataUri(patched);
    const decoded = decodeAgentCardDataUri(uri);
    expect(decoded.name).toBe(card.name);
    expect(decoded.registrations[0]?.agentId).toBe(42);
    expect(decoded.registrations[0]?.agentRegistry).toContain("eip155:42220:");
  });
});

describe("Celo Mainnet Calldata Builders & ERC-8021 Attribution (calldata.ts)", () => {
  it("exposes valid checksummed Celo Mainnet token and Uniswap V3 SwapRouter02 addresses", () => {
    expect(isAddress(CELO_MAINNET_TOKENS.USDC)).toBe(true);
    expect(isAddress(CELO_MAINNET_TOKENS.USDT)).toBe(true);
    expect(isAddress(CELO_MAINNET_TOKENS.cUSD)).toBe(true);
    expect(isAddress(CELO_MAINNET_TOKENS.CELO)).toBe(true);
    expect(isAddress(CELO_MAINNET_ROUTERS.UNISWAP_V3_SWAP_ROUTER_02)).toBe(true);
  });

  it("encodes ERC-20 transfer calldata with valid selector 0xa9059cbb and decodable celo_cbf00f366dda tag", () => {
    const built = encodeAttributedErc20Transfer({
      token: CELO_MAINNET_TOKENS.USDC,
      recipient: RECIPIENT_B,
      amount: 50_000n,
    });

    expect(built.to).toBe(CELO_MAINNET_TOKENS.USDC);
    expect(built.selector).toBe(ERC20_TRANSFER_SELECTOR);
    expect(built.data.startsWith(ERC20_TRANSFER_SELECTOR)).toBe(true);
    expect(built.attributionCode).toBe("celo_cbf00f366dda");

    // Verify raw ABI arguments decode cleanly
    const decodedCall = decodeFunctionData({
      abi: ERC20_ABI,
      data: built.rawData,
    });
    expect(decodedCall.functionName).toBe("transfer");
    expect(decodedCall.args).toEqual([RECIPIENT_B, 50_000n]);

    // Verify ERC-8021 suffix decodes via @celo/attribution-tags fromDataSuffix
    const decodedTag = decodeAttributionTag(built.data);
    expect(decodedTag).not.toBeNull();
    expect(decodedTag?.codes).toContain("celo_cbf00f366dda");

    // Verify idempotency: re-applying appendAttributionTag does not duplicate suffix
    const reTagged = appendAttributionTag(built.data, "celo_cbf00f366dda");
    expect(reTagged).toBe(built.data);
  });

  it("encodes Uniswap V3 SwapRouter02 exactInputSingle calldata with selector 0x04e45aaf and celo_cbf00f366dda tag", () => {
    const built = encodeAttributedUniswapV3Swap({
      tokenIn: CELO_MAINNET_TOKENS.USDC,
      tokenOut: CELO_MAINNET_TOKENS.CELO,
      fee: 3000,
      recipient: WALLET,
      amountIn: 100_000n,
      amountOutMin: 1n,
    });

    expect(built.to).toBe(CELO_MAINNET_ROUTERS.UNISWAP_V3_SWAP_ROUTER_02);
    expect(built.selector).toBe(UNISWAP_V3_EXACT_INPUT_SINGLE_SELECTOR);
    expect(built.data.startsWith(UNISWAP_V3_EXACT_INPUT_SINGLE_SELECTOR)).toBe(true);
    expect(built.attributionCode).toBe("celo_cbf00f366dda");

    const decodedCall = decodeFunctionData({
      abi: UNISWAP_V3_SWAP_ROUTER_02_ABI,
      data: built.rawData,
    });
    expect(decodedCall.functionName).toBe("exactInputSingle");
    expect(decodedCall.args[0]).toEqual({
      tokenIn: CELO_MAINNET_TOKENS.USDC,
      tokenOut: CELO_MAINNET_TOKENS.CELO,
      fee: 3000,
      recipient: WALLET,
      amountIn: 100_000n,
      amountOutMin: 1n,
      sqrtPriceLimitX96: 0n,
    });

    const decodedTag = decodeAttributionTag(built.data);
    expect(decodedTag).not.toBeNull();
    expect(decodedTag?.codes).toContain("celo_cbf00f366dda");
  });

  it("rejects zero amounts or identical tokenIn/tokenOut in calldata builders", () => {
    expect(() =>
      encodeAttributedErc20Transfer({
        token: CELO_MAINNET_TOKENS.USDC,
        recipient: RECIPIENT_A,
        amount: 0n,
      }),
    ).toThrow();

    expect(() =>
      encodeAttributedUniswapV3Swap({
        tokenIn: CELO_MAINNET_TOKENS.USDC,
        tokenOut: CELO_MAINNET_TOKENS.USDC,
        fee: 500,
        recipient: WALLET,
        amountIn: 10_000n,
        amountOutMin: 0n,
      }),
    ).toThrow();
  });
});
