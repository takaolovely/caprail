import { CELO } from "@altananetwork/sdk";
import { decodeFunctionData, isAddress, type Address } from "viem";
import { describe, expect, it } from "vitest";
import { AuditLogger, AutoDcaEngine } from "../src/engine/index.js";
import {
  CELO_ERC8004_REGISTRY,
  decodeAgentCardDataUri,
  encodeAgentCardDataUri,
  loadAgentCardTemplate,
  withErc8004Registration,
} from "../src/identity/erc8004.js";
import {
  DcaStrategySchema,
  SessionPolicySchema,
  type DcaStrategy,
  type SessionPolicy,
} from "../src/policy/index.js";
import {
  appendAttributionTag,
  buildAltanaSessionPermissions,
  buildExactInputSingleCalldata,
  CAPRAIL_DEFAULT_ATTRIBUTION_CODE,
  CAPRAIL_REPO_SLUG,
  CELO_MAINNET_ROUTERS,
  CELO_MAINNET_TOKENS,
  computeMinAmountOut,
  createReadOnlyAltanaCeloClient,
  decodeAttributionTag,
  deriveRepoAttributionCode,
  encodeAttributedErc20Transfer,
  encodeAttributedUniswapV3Swap,
  ERC20_ABI,
  ERC20_TRANSFER_SELECTOR,
  isInvalidAuthItemNonceError,
  LocalSessionSimulator,
  resolveOrProvisionAltanaWallet,
  UNISWAP_V3_EXACT_INPUT_SINGLE_SELECTOR,
  UNISWAP_V3_SWAP_ROUTER_02_ABI,
} from "../src/wallet/index.js";

const USDC = CELO_MAINNET_TOKENS.USDC;
const USDT = CELO_MAINNET_TOKENS.USDT;
const CELO_TOKEN = CELO_MAINNET_TOKENS.CELO;
const WALLET = "0x3631D44543384253C099f2A09c0D0bE109Eb7944" as Address;
const ROUTER = CELO_MAINNET_ROUTERS.UNISWAP_V3_SWAP_ROUTER_02;
const VERIFY_TARGET = "0x4444444444444444444444444444444444444444" as Address;
const FOREIGN_ADDR = "0xdead00000000000000000000000000000000beef" as Address;

const BASE_TIME = 1_795_000_000;

function makePolicy(overrides?: Partial<SessionPolicy>): SessionPolicy {
  return {
    sessionId: "test-session-1",
    spendCapPerTx: 50_000_000n,
    totalSpendCap: 100_000_000n,
    allowedTargets: [ROUTER],
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

describe("Policy Schemas (SessionPolicy & DcaStrategy)", () => {
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

  it("rejects duplicate addresses (case-insensitive) in SessionPolicy.allowedTargets", () => {
    const parsed = SessionPolicySchema.safeParse(
      makePolicy({
        allowedTargets: [
          ROUTER.toLowerCase() as Address,
          ROUTER.toUpperCase().replace("0X", "0x") as Address,
        ],
      }),
    );
    expect(parsed.success).toBe(false);
  });
});

describe("AutoDcaEngine Guardrails (LOCAL_SIMULATION)", () => {
  it("approves bounded Auto-DCA runs within caps and logs structured audit events", async () => {
    const wallet = new LocalSessionSimulator({
      walletAddress: WALLET,
      policy: makePolicy(),
      attributionCode: CAPRAIL_DEFAULT_ATTRIBUTION_CODE,
    });
    const auditLogger = new AuditLogger();
    const dca = new AutoDcaEngine({
      wallet,
      strategy: makeDcaStrategy(),
      auditLogger,
    });

    const dcaRes1 = await dca.executeRun({
      minAmountOut: 34_000_000_000_000_000_000n,
      slippageBps: 50,
      nowSec: BASE_TIME,
    });
    expect(dcaRes1.mode).toBe("LOCAL_SIMULATION");
    expect(dcaRes1.status).toBe("APPROVED");
    expect(dcaRes1.spentTotal).toBe(25_000_000n);
    expect(dcaRes1.remainingTotalCap).toBe(75_000_000n);

    const dcaRes2 = await dca.executeRun({
      amountIn: 40_000_000n,
      minAmountOut: 54_000_000_000_000_000_000n,
      slippageBps: 75,
      nowSec: BASE_TIME + 3600,
    });
    expect(dcaRes2.mode).toBe("LOCAL_SIMULATION");
    expect(dcaRes2.status).toBe("APPROVED");
    expect(dcaRes2.spentTotal).toBe(65_000_000n);
    expect(dcaRes2.remainingTotalCap).toBe(35_000_000n);

    expect(auditLogger.getEvents()).toHaveLength(2);
    expect(auditLogger.getEvents().every((e) => e.status === "APPROVED")).toBe(true);
    expect(auditLogger.getEvents().every((e) => e.engine === "AUTO_DCA")).toBe(true);
  });

  it("blocks over-per-tx-cap, cumulative over-total-cap, foreign targets, and unlisted tokens deterministically", async () => {
    const wallet = new LocalSessionSimulator({
      walletAddress: WALLET,
      policy: makePolicy({ spendCapPerTx: 50_000_000n, totalSpendCap: 60_000_000n }),
    });
    const auditLogger = new AuditLogger();
    const dca = new AutoDcaEngine({
      wallet,
      strategy: makeDcaStrategy(),
      auditLogger,
    });

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

    // Unlisted token mismatch (USDT instead of USDC)
    const unlistedToken = await wallet.executeGuarded(
      {
        policyTarget: ROUTER,
        to: USDT,
        value: 0n,
        data: "0xa9059cbb",
        amount: 10_000_000n,
        token: USDT,
        purpose: "unlisted token attack",
      },
      BASE_TIME,
    );
    expect(unlistedToken.status).toBe("BLOCKED");
    expect(unlistedToken.reasonCode).toBe("TOKEN_MISMATCH");
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

  it("blocks DCA runs violating intervalSeconds or maxSlippageBps", async () => {
    const wallet = new LocalSessionSimulator({
      walletAddress: WALLET,
      policy: makePolicy(),
    });
    const auditLogger = new AuditLogger();
    const dca = new AutoDcaEngine({
      wallet,
      strategy: makeDcaStrategy(),
      auditLogger,
    });

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
    const dca = new AutoDcaEngine({
      wallet,
      strategy: makeDcaStrategy(),
      auditLogger,
    });

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
    expect(CAPRAIL_DEFAULT_ATTRIBUTION_CODE).toBe("celo_0518175d3efe");
    const derived = deriveRepoAttributionCode(CAPRAIL_REPO_SLUG);
    expect(derived.startsWith("celo_")).toBe(true);
    const tagged = appendAttributionTag(
      "0xa9059cbb00000001",
      CAPRAIL_DEFAULT_ATTRIBUTION_CODE,
    );
    const decoded = decodeAttributionTag(tagged);
    expect(decoded).not.toBeNull();
    expect(decoded?.codes).toContain("celo_0518175d3efe");
  });

  it("initializes @altananetwork/sdk client for Celo Mainnet (42220) and maps SessionPermissions", () => {
    const client = createReadOnlyAltanaCeloClient();
    expect(client.defaultChainId).toBe(42220);
    expect(CELO.chainId).toBe(42220);

    const perms = buildAltanaSessionPermissions(makePolicy(), "day");
    expect(perms.calls).toHaveLength(1);
    const firstCall = perms.calls?.[0];
    expect(firstCall && "to" in firstCall ? firstCall.to : undefined).toBe(ROUTER);
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

  it("encodes ERC-20 transfer calldata with valid selector 0xa9059cbb and decodable celo_0518175d3efe tag", () => {
    const built = encodeAttributedErc20Transfer({
      token: CELO_MAINNET_TOKENS.USDC,
      recipient: VERIFY_TARGET,
      amount: 50_000n,
    });

    expect(built.to).toBe(CELO_MAINNET_TOKENS.USDC);
    expect(built.selector).toBe(ERC20_TRANSFER_SELECTOR);
    expect(built.data.startsWith(ERC20_TRANSFER_SELECTOR)).toBe(true);
    expect(built.attributionCode).toBe("celo_0518175d3efe");

    const decodedCall = decodeFunctionData({
      abi: ERC20_ABI,
      data: built.rawData,
    });
    expect(decodedCall.functionName).toBe("transfer");
    expect(decodedCall.args).toEqual([VERIFY_TARGET, 50_000n]);

    const decodedTag = decodeAttributionTag(built.data);
    expect(decodedTag).not.toBeNull();
    expect(decodedTag?.codes).toContain("celo_0518175d3efe");

    const reTagged = appendAttributionTag(built.data, "celo_0518175d3efe");
    expect(reTagged).toBe(built.data);
  });

  it("encodes Uniswap V3 SwapRouter02 exactInputSingle calldata with selector 0x04e45aaf, slippage amountOutMinimum, and celo_0518175d3efe tag", () => {
    const quotedAmountOut = 100_000_000_000_000_000n; // 0.1 CELO quote
    const expectedMinOut = computeMinAmountOut(quotedAmountOut, 100); // 1.00% slippage
    expect(expectedMinOut).toBe(99_000_000_000_000_000n);

    const built = buildExactInputSingleCalldata({
      tokenIn: CELO_MAINNET_TOKENS.USDC,
      tokenOut: CELO_MAINNET_TOKENS.CELO,
      fee: 3000,
      recipient: WALLET,
      amountIn: 100_000n,
      quotedAmountOut,
      maxSlippageBps: 100,
    });

    expect(built.to).toBe(CELO_MAINNET_ROUTERS.UNISWAP_V3_SWAP_ROUTER_02);
    expect(built.selector).toBe(UNISWAP_V3_EXACT_INPUT_SINGLE_SELECTOR);
    expect(built.data.startsWith(UNISWAP_V3_EXACT_INPUT_SINGLE_SELECTOR)).toBe(true);
    expect(built.attributionCode).toBe("celo_0518175d3efe");

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
      amountOutMinimum: expectedMinOut,
      sqrtPriceLimitX96: 0n,
    });

    const explicit = encodeAttributedUniswapV3Swap({
      tokenIn: CELO_MAINNET_TOKENS.USDC,
      tokenOut: CELO_MAINNET_TOKENS.CELO,
      fee: 3000,
      recipient: WALLET,
      amountIn: 100_000n,
      amountOutMinimum: 98_500_000_000_000_000n,
    });
    const decodedExplicit = decodeFunctionData({
      abi: UNISWAP_V3_SWAP_ROUTER_02_ABI,
      data: explicit.rawData,
    });
    expect(decodedExplicit.args[0].amountOutMinimum).toBe(98_500_000_000_000_000n);

    const decodedTag = decodeAttributionTag(built.data);
    expect(decodedTag).not.toBeNull();
    expect(decodedTag?.codes).toContain("celo_0518175d3efe");
  });

  it("rejects zero amounts, missing slippage floor, or identical tokenIn/tokenOut in calldata builders", () => {
    expect(() =>
      encodeAttributedErc20Transfer({
        token: CELO_MAINNET_TOKENS.USDC,
        recipient: VERIFY_TARGET,
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
        amountOutMinimum: 9_900n,
      }),
    ).toThrow();

    expect(() =>
      encodeAttributedUniswapV3Swap({
        tokenIn: CELO_MAINNET_TOKENS.USDC,
        tokenOut: CELO_MAINNET_TOKENS.CELO,
        fee: 3000,
        recipient: WALLET,
        amountIn: 10_000n,
      }),
    ).toThrow();
  });

  it("reuses upgraded or pinned Altana wallet without re-calling createWallet and detects nonce errors", async () => {
    expect(
      isInvalidAuthItemNonceError(
        new Error("Invalid auth item nonce, expected 2, got 1."),
      ),
    ).toBe(true);

    const fakeSigner = {
      type: "privateKey" as const,
      address: WALLET,
      publicKey: "0x04" as `0x${string}`,
      signDigest: async () => "0x" as `0x${string}`,
    };

    let createCalls = 0;
    const fakeClient = {
      createWallet: async () => {
        createCalls += 1;
        return { address: WALLET, signer: fakeSigner };
      },
    };

    const reusedOnChain = await resolveOrProvisionAltanaWallet({
      client: fakeClient,
      adminSigner: fakeSigner,
      publicClient: { getCode: async () => "0xef01001234" as `0x${string}` },
    });
    expect(reusedOnChain.reused).toBe(true);
    expect(createCalls).toBe(0);

    const reusedPinned = await resolveOrProvisionAltanaWallet({
      client: fakeClient,
      adminSigner: fakeSigner,
      publicClient: { getCode: async () => undefined },
      existingWalletAddress: WALLET,
    });
    expect(reusedPinned.reused).toBe(true);
    expect(createCalls).toBe(0);

    let transientAttempt = 0;
    const retryClient = {
      createWallet: async () => {
        transientAttempt += 1;
        if (transientAttempt === 1) {
          throw new Error("Invalid auth item nonce, expected 2, got 1");
        }
        return { address: WALLET, signer: fakeSigner };
      },
    };
    const provisioned = await resolveOrProvisionAltanaWallet({
      client: retryClient,
      adminSigner: fakeSigner,
      publicClient: { getCode: async () => undefined },
      retryDelayMs: 1,
    });
    expect(provisioned.reused).toBe(false);
    expect(transientAttempt).toBe(2);
  });
});
