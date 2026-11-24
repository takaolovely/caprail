import {
  CELO,
  createPrivateKeySigner,
  NATIVE_TOKEN,
  signerFromPrivateKey,
} from "@altananetwork/sdk";
import {
  createPublicClient,
  encodeFunctionData,
  formatUnits,
  getAddress,
  http,
  type Address,
  type Hex,
} from "viem";
import { celo } from "viem/chains";
import { loadEnv } from "../config/env.js";
import {
  appendDecisionLog,
  computeRolling24hTwapFromLogs,
  estimateCeloOutWeiFromSpot,
  evaluateDcaTick,
  getWeeklyAnchorPriceFromLogs,
  readDecisionLogs,
  readUniswapV3PoolSnapshot,
  type DecisionLogEntry,
} from "../engine/index.js";
import {
  DcaDecisionPolicySchema,
  type DcaDecisionPolicy,
  type SessionPolicy,
} from "../policy/index.js";
import {
  AltanaLiveAdapter,
  appendAttributionTag,
  buildExactInputSingleCalldata,
  CAPRAIL_DEFAULT_ATTRIBUTION_CODE,
  CELO_MAINNET_ROUTERS,
  CELO_MAINNET_TOKENS,
  computeMinAmountOut,
  createAltanaCeloClient,
  ERC20_ABI,
  grantSessionWithNonceRecovery,
  resolveOrProvisionAltanaWallet,
  UNISWAP_V3_SWAP_ROUTER_02_ABI,
  type UniswapV3FeeTier,
} from "../wallet/index.js";

const MIN_GAS_CELO_WEI = 2_000_000_000_000_000n; // 0.002 CELO minimum gas buffer
const SESSION_TTL_SECONDS = 3_600;

interface CliOptions {
  live: boolean;
  orderSizeUsdc?: number | undefined;
  maxImpactBps?: number | undefined;
  maxDeviationBps?: number | undefined;
  execSlippageBps?: number | undefined;
  maxCeilingPct?: number | undefined;
  feeTier?: UniswapV3FeeTier | undefined;
}

function parseNumberFlag(argv: readonly string[], flag: string): number | undefined {
  const idx = argv.indexOf(flag);
  if (idx === -1 || idx + 1 >= argv.length) return undefined;
  const raw = argv[idx + 1];
  if (raw === undefined) return undefined;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric value for ${flag}: "${raw}"`);
  }
  return parsed;
}

function parseCliArgs(argv: readonly string[]): CliOptions {
  const live = argv.includes("--live") && !argv.includes("--dry-run");
  const feeRaw = parseNumberFlag(argv, "--fee-tier");
  let feeTier: UniswapV3FeeTier | undefined;
  if (feeRaw !== undefined) {
    if (feeRaw !== 100 && feeRaw !== 500 && feeRaw !== 3000 && feeRaw !== 10000) {
      throw new Error(
        `Invalid --fee-tier "${feeRaw}". Expected one of 100, 500, 3000, 10000.`,
      );
    }
    feeTier = feeRaw;
  }

  return {
    live,
    orderSizeUsdc: parseNumberFlag(argv, "--amount"),
    maxImpactBps: parseNumberFlag(argv, "--max-impact-bps"),
    maxDeviationBps: parseNumberFlag(argv, "--max-deviation-bps"),
    execSlippageBps: parseNumberFlag(argv, "--exec-slippage-bps"),
    maxCeilingPct: parseNumberFlag(argv, "--max-ceiling-pct"),
    feeTier,
  };
}

function emitAndLog(entry: DecisionLogEntry): void {
  appendDecisionLog(entry);
  process.stdout.write(`${JSON.stringify(entry)}\n`);
}

async function main(): Promise<void> {
  const opts = parseCliArgs(process.argv.slice(2));
  const env = loadEnv();
  const attributionCode =
    env.CELO_ATTRIBUTION_CODE ?? CAPRAIL_DEFAULT_ATTRIBUTION_CODE;

  const policy: DcaDecisionPolicy = DcaDecisionPolicySchema.parse({
    ...(opts.orderSizeUsdc !== undefined
      ? { orderSizeUsdc: opts.orderSizeUsdc }
      : {}),
    ...(opts.maxImpactBps !== undefined
      ? { maxPoolImpactBps: opts.maxImpactBps }
      : {}),
    ...(opts.maxDeviationBps !== undefined
      ? { maxDeviationAboveTwapBps: opts.maxDeviationBps }
      : {}),
    ...(opts.execSlippageBps !== undefined
      ? { executionSlippageBps: opts.execSlippageBps }
      : {}),
    ...(opts.maxCeilingPct !== undefined
      ? { maxCeilingPct: opts.maxCeilingPct }
      : {}),
    ...(opts.feeTier !== undefined ? { poolFeeTier: opts.feeTier } : {}),
  });

  const publicClient = createPublicClient({
    chain: celo,
    transport: http(env.CELO_RPC_URL),
  });

  // 1) Fetch live Celo Mainnet Uniswap V3 pool state (USDC/CELO 0.01% by default)
  const snapshot = await readUniswapV3PoolSnapshot({
    publicClient,
    feeTier: policy.poolFeeTier,
  });

  const nowMs = Date.now();
  const timestamp = new Date(nowMs).toISOString();
  const priorLogs = readDecisionLogs();

  // 2) Resolve 24h TWAP: on-chain observe([86400, 0]) -> rolling 24h log avg -> cold-start spot
  const twap24hUsdcPerCelo =
    snapshot.onChainTwap24hUsdcPerCelo ??
    computeRolling24hTwapFromLogs(priorLogs, nowMs) ??
    snapshot.spotPriceUsdcPerCelo;

  const anchorPriceUsdcPerCelo =
    getWeeklyAnchorPriceFromLogs(priorLogs, nowMs) ??
    snapshot.spotPriceUsdcPerCelo;

  // 3) Evaluate pure deterministic decision gate
  const evalResult = evaluateDcaTick({
    spotPriceUsdcPerCelo: snapshot.spotPriceUsdcPerCelo,
    twap24hUsdcPerCelo,
    anchorPriceUsdcPerCelo,
    sqrtPriceX96: snapshot.sqrtPriceX96,
    poolLiquidity: snapshot.liquidity,
    token0IsCelo: snapshot.token0IsCelo,
    policy,
  });

  const mode = opts.live ? "LIVE" : "DRY_RUN";

  // 4) DRY_RUN or DEFER: log block-anchored decision without broadcasting
  if (!opts.live || evalResult.decision === "DEFER") {
    emitAndLog({
      timestamp,
      mode,
      blockNumber: snapshot.blockNumber,
      poolAddress: snapshot.poolAddress,
      sqrtPriceX96: snapshot.sqrtPriceX96.toString(),
      spotPriceUsdcPerCelo: evalResult.spotPriceUsdcPerCelo,
      twap24hUsdcPerCelo: evalResult.twap24hUsdcPerCelo,
      deviationBps: evalResult.deviationBps,
      estimatedPoolImpactBps: evalResult.estimatedPoolImpactBps,
      decision: evalResult.decision,
      reason: evalResult.reason,
      txHash: null,
    });
    return;
  }

  // 5) LIVE EXECUTION PATH (Altana Session Key + SwapRouter02 + 25 bps slippage + ERC-8021)
  const adminPrivateKey = (env.ALTANA_ADMIN_PRIVATE_KEY ??
    env.OWNER_PRIVATE_KEY) as Hex | undefined;
  if (adminPrivateKey === undefined) {
    emitAndLog({
      timestamp,
      mode: "LIVE",
      blockNumber: snapshot.blockNumber,
      poolAddress: snapshot.poolAddress,
      sqrtPriceX96: snapshot.sqrtPriceX96.toString(),
      spotPriceUsdcPerCelo: evalResult.spotPriceUsdcPerCelo,
      twap24hUsdcPerCelo: evalResult.twap24hUsdcPerCelo,
      deviationBps: evalResult.deviationBps,
      estimatedPoolImpactBps: evalResult.estimatedPoolImpactBps,
      decision: "DEFER",
      reason:
        "LIVE mode requested without OWNER_PRIVATE_KEY or ALTANA_ADMIN_PRIVATE_KEY configured in environment",
      txHash: null,
    });
    return;
  }

  const adminSigner = signerFromPrivateKey(adminPrivateKey);
  const pinnedWalletAddress: Address | undefined = env.ALTANA_WALLET_ADDRESS
    ? getAddress(env.ALTANA_WALLET_ADDRESS)
    : undefined;
  const walletAddress = pinnedWalletAddress ?? getAddress(adminSigner.address);
  const amountInBaseUnits = BigInt(Math.round(policy.orderSizeUsdc * 1_000_000));
  const dailySpendCapBaseUnits = BigInt(
    Math.round(policy.dailySpendCapUsdc * 1_000_000),
  );

  // Check native CELO gas balance and Native USDC balance cleanly before broadcasting
  const [celoBalanceWei, usdcBalanceUnits, usdcAllowance] = await Promise.all([
    publicClient.getBalance({ address: walletAddress }),
    publicClient.readContract({
      address: CELO_MAINNET_TOKENS.USDC,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [walletAddress],
    }),
    publicClient.readContract({
      address: CELO_MAINNET_TOKENS.USDC,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [walletAddress, CELO_MAINNET_ROUTERS.UNISWAP_V3_SWAP_ROUTER_02],
    }),
  ]);

  if (celoBalanceWei < MIN_GAS_CELO_WEI) {
    emitAndLog({
      timestamp,
      mode: "LIVE",
      blockNumber: snapshot.blockNumber,
      poolAddress: snapshot.poolAddress,
      sqrtPriceX96: snapshot.sqrtPriceX96.toString(),
      spotPriceUsdcPerCelo: evalResult.spotPriceUsdcPerCelo,
      twap24hUsdcPerCelo: evalResult.twap24hUsdcPerCelo,
      deviationBps: evalResult.deviationBps,
      estimatedPoolImpactBps: evalResult.estimatedPoolImpactBps,
      decision: "HALTED_NO_GAS",
      reason: `Insufficient native CELO gas balance: have ${formatUnits(celoBalanceWei, 18)} CELO, require at least ${formatUnits(MIN_GAS_CELO_WEI, 18)} CELO`,
      txHash: null,
    });
    return;
  }

  if (usdcBalanceUnits < amountInBaseUnits) {
    emitAndLog({
      timestamp,
      mode: "LIVE",
      blockNumber: snapshot.blockNumber,
      poolAddress: snapshot.poolAddress,
      sqrtPriceX96: snapshot.sqrtPriceX96.toString(),
      spotPriceUsdcPerCelo: evalResult.spotPriceUsdcPerCelo,
      twap24hUsdcPerCelo: evalResult.twap24hUsdcPerCelo,
      deviationBps: evalResult.deviationBps,
      estimatedPoolImpactBps: evalResult.estimatedPoolImpactBps,
      decision: "DEFER",
      reason: `Insufficient Native USDC balance: have ${formatUnits(usdcBalanceUnits, 6)} USDC, need ${formatUnits(amountInBaseUnits, 6)} USDC`,
      txHash: null,
    });
    return;
  }

  // Quote expected CELO output via on-chain simulateContract when allowance allows, else spot math
  let quotedAmountOut: bigint;
  try {
    const { result } = await publicClient.simulateContract({
      address: CELO_MAINNET_ROUTERS.UNISWAP_V3_SWAP_ROUTER_02,
      abi: UNISWAP_V3_SWAP_ROUTER_02_ABI,
      functionName: "exactInputSingle",
      account: walletAddress,
      args: [
        {
          tokenIn: CELO_MAINNET_TOKENS.USDC,
          tokenOut: CELO_MAINNET_TOKENS.CELO,
          fee: policy.poolFeeTier,
          recipient: walletAddress,
          amountIn: amountInBaseUnits,
          amountOutMinimum: 0n,
          sqrtPriceLimitX96: 0n,
        },
      ],
    });
    quotedAmountOut = result;
  } catch {
    quotedAmountOut = estimateCeloOutWeiFromSpot(
      amountInBaseUnits,
      snapshot.spotPriceUsdcPerCelo,
      policy.poolFeeTier,
    );
  }

  const amountOutMinimum = computeMinAmountOut(
    quotedAmountOut,
    policy.executionSlippageBps,
  );

  const swapCall = buildExactInputSingleCalldata({
    tokenIn: CELO_MAINNET_TOKENS.USDC,
    tokenOut: CELO_MAINNET_TOKENS.CELO,
    fee: policy.poolFeeTier,
    recipient: walletAddress,
    amountIn: amountInBaseUnits,
    amountOutMinimum,
    router: CELO_MAINNET_ROUTERS.UNISWAP_V3_SWAP_ROUTER_02,
    attributionCode,
  });

  // Resolve Altana wallet + grant bounded session key scoped to SwapRouter02 (+ USDC approve if needed)
  const client = createAltanaCeloClient();
  const resolved = await resolveOrProvisionAltanaWallet({
    client,
    adminSigner,
    publicClient,
    existingWalletAddress: pinnedWalletAddress,
  });

  const sessionSigner = env.ALTANA_SESSION_PRIVATE_KEY
    ? signerFromPrivateKey(env.ALTANA_SESSION_PRIVATE_KEY as Hex)
    : createPrivateKeySigner();

  const nowSec = Math.floor(nowMs / 1000);
  const expiresAt = nowSec + SESSION_TTL_SECONDS;
  const feeTokens = [NATIVE_TOKEN, CELO_MAINNET_TOKENS.USDC] as const;

  const needsApprove = usdcAllowance < amountInBaseUnits;
  const allowedTargets: Address[] = needsApprove
    ? [CELO_MAINNET_TOKENS.USDC, CELO_MAINNET_ROUTERS.UNISWAP_V3_SWAP_ROUTER_02]
    : [CELO_MAINNET_ROUTERS.UNISWAP_V3_SWAP_ROUTER_02];

  const sessionPolicy: SessionPolicy = {
    sessionId: `caprail-dca-tick-${nowSec}`,
    spendCapPerTx: amountInBaseUnits,
    totalSpendCap:
      dailySpendCapBaseUnits >= amountInBaseUnits
        ? dailySpendCapBaseUnits
        : amountInBaseUnits,
    allowedTargets,
    expiresAt,
    revoked: false,
    token: CELO_MAINNET_TOKENS.USDC,
  };

  const grantResult = await grantSessionWithNonceRecovery({
    client,
    wallet: resolved.wallet,
    adminSigner,
    sessionSigner,
    expiry: expiresAt,
    feeToken: feeTokens,
    permissions: {
      calls: [
        ...(needsApprove
          ? [
              {
                to: CELO_MAINNET_TOKENS.USDC,
                signature: "approve(address,uint256)",
              },
            ]
          : []),
        {
          to: CELO_MAINNET_ROUTERS.UNISWAP_V3_SWAP_ROUTER_02,
          signature:
            "exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))",
        },
      ],
      spend: [
        {
          limit: sessionPolicy.totalSpendCap,
          period: "day",
          token: CELO_MAINNET_TOKENS.USDC,
        },
      ],
    },
  });

  const adapter = new AltanaLiveAdapter({
    client,
    wallet: resolved.wallet,
    policy: sessionPolicy,
    session: grantResult,
    adminSigner,
    feeToken: feeTokens,
    attributionCode,
  });

  const callsToExecute = [];
  if (needsApprove) {
    const rawApprove = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: "approve",
      args: [CELO_MAINNET_ROUTERS.UNISWAP_V3_SWAP_ROUTER_02, amountInBaseUnits],
    });
    callsToExecute.push({
      policyTarget: CELO_MAINNET_TOKENS.USDC,
      to: CELO_MAINNET_TOKENS.USDC,
      value: 0n,
      data: appendAttributionTag(rawApprove, attributionCode),
      amount: 0n,
      token: CELO_MAINNET_TOKENS.USDC,
      purpose: "Approve Native USDC for Uniswap V3 SwapRouter02",
    });
  }

  callsToExecute.push({
    policyTarget: CELO_MAINNET_ROUTERS.UNISWAP_V3_SWAP_ROUTER_02,
    to: swapCall.to,
    value: 0n,
    data: swapCall.data,
    amount: amountInBaseUnits,
    token: CELO_MAINNET_TOKENS.USDC,
    purpose: `Auto-DCA ${policy.orderSizeUsdc} USDC -> CELO (fee=${policy.poolFeeTier}, slippage=${policy.executionSlippageBps} bps)`,
  });

  // Note: approve call carries amount=0n in session guardrails only if executed separately;
  // execute approve first via client if needed, then executeGuarded for the swap.
  if (needsApprove) {
    const approveCall = callsToExecute[0]!;
    const approveExec = await client.execute({
      session: grantResult,
      chainId: CELO.chainId,
      feeToken: feeTokens,
      calls: [{ to: approveCall.to, data: approveCall.data }],
    });
    if (approveExec.status === "FAILED") {
      emitAndLog({
        timestamp,
        mode: "LIVE",
        blockNumber: snapshot.blockNumber,
        poolAddress: snapshot.poolAddress,
        sqrtPriceX96: snapshot.sqrtPriceX96.toString(),
        spotPriceUsdcPerCelo: evalResult.spotPriceUsdcPerCelo,
        twap24hUsdcPerCelo: evalResult.twap24hUsdcPerCelo,
        deviationBps: evalResult.deviationBps,
        estimatedPoolImpactBps: evalResult.estimatedPoolImpactBps,
        decision: "DEFER",
        reason: `USDC approval via Altana relay failed (callsId=${approveExec.callsId})`,
        txHash: approveExec.transactionHash ?? null,
      });
      return;
    }
    if (approveExec.transactionHash !== undefined) {
      await publicClient.waitForTransactionReceipt({
        hash: approveExec.transactionHash,
      });
    }
  }

  const swapExec = await adapter.executeGuarded(
    callsToExecute[callsToExecute.length - 1]!,
    nowSec,
  );

  emitAndLog({
    timestamp,
    mode: "LIVE",
    blockNumber: snapshot.blockNumber,
    poolAddress: snapshot.poolAddress,
    sqrtPriceX96: snapshot.sqrtPriceX96.toString(),
    spotPriceUsdcPerCelo: evalResult.spotPriceUsdcPerCelo,
    twap24hUsdcPerCelo: evalResult.twap24hUsdcPerCelo,
    deviationBps: evalResult.deviationBps,
    estimatedPoolImpactBps: evalResult.estimatedPoolImpactBps,
    decision: swapExec.status === "APPROVED" ? "EXECUTE" : "DEFER",
    reason:
      swapExec.status === "APPROVED"
        ? evalResult.reason
        : (swapExec.reason ?? "Altana session execution blocked"),
    txHash: swapExec.txHash ?? null,
  });
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${JSON.stringify({ error: message })}\n`);
  process.exitCode = 1;
});
