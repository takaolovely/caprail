import { encodeFunctionData, parseAbi, type Address } from "viem";
import {
  DcaStrategySchema,
  normalizeAddress,
  type DcaStrategy,
} from "../policy/index.js";
import type {
  AgentWalletAdapter,
  WalletExecutionResult,
  WalletRevokeResult,
} from "../wallet/index.js";
import type { AuditLogger } from "./auditLog.js";

const SWAP_ROUTER_ABI = parseAbi([
  "function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) external returns (uint256[] amounts)",
]);

export interface DcaRunRequest {
  amountIn?: bigint | undefined;
  minAmountOut: bigint;
  slippageBps: number;
  routerOverride?: Address | undefined;
  nowSec?: number | undefined;
}

export class AutoDcaEngine {
  private readonly wallet: AgentWalletAdapter;
  private readonly strategy: DcaStrategy;
  private readonly auditLogger: AuditLogger;
  private lastRunAtSec: number | undefined;

  constructor(opts: {
    wallet: AgentWalletAdapter;
    strategy: DcaStrategy;
    auditLogger: AuditLogger;
  }) {
    this.wallet = opts.wallet;
    this.strategy = DcaStrategySchema.parse(opts.strategy);
    this.auditLogger = opts.auditLogger;
  }

  public getStrategy(): DcaStrategy {
    return this.strategy;
  }

  public getLastRunAtSec(): number | undefined {
    return this.lastRunAtSec;
  }

  public async executeRun(request: DcaRunRequest): Promise<WalletExecutionResult> {
    const nowSec = request.nowSec ?? Math.floor(Date.now() / 1000);
    const timestamp = new Date(nowSec * 1000).toISOString();
    const amountIn = request.amountIn ?? this.strategy.amountPerRun;
    const router = request.routerOverride ?? this.strategy.allowedRouter;

    // 1. Cadence guardrail
    if (
      this.lastRunAtSec !== undefined &&
      nowSec - this.lastRunAtSec < this.strategy.intervalSeconds
    ) {
      const waitSec = this.strategy.intervalSeconds - (nowSec - this.lastRunAtSec);
      const reason = `DCA interval not elapsed (${waitSec}s remaining of ${this.strategy.intervalSeconds}s)`;
      this.auditLogger.record({
        timestamp,
        mode: this.wallet.mode,
        engine: "AUTO_DCA",
        action: `dca:${this.strategy.strategyId}`,
        status: "BLOCKED",
        reasonCode: "INTERVAL_NOT_ELAPSED",
        reason,
        walletAddress: this.wallet.getWalletAddress(),
        targets: [router],
        totalAmount: amountIn.toString(),
        spentTotal: this.wallet.getSpentTotal().toString(),
        remainingCap: this.wallet.getRemainingTotalCap().toString(),
      });

      return {
        mode: this.wallet.mode,
        status: "BLOCKED",
        reasonCode: "INVALID_AMOUNT",
        reason,
        spentTotal: this.wallet.getSpentTotal(),
        remainingTotalCap: this.wallet.getRemainingTotalCap(),
        timestamp,
      };
    }

    // 2. Slippage guardrail
    if (request.slippageBps > this.strategy.maxSlippageBps) {
      const reason = `Requested slippage ${request.slippageBps} bps exceeds maxSlippageBps ${this.strategy.maxSlippageBps} bps`;
      this.auditLogger.record({
        timestamp,
        mode: this.wallet.mode,
        engine: "AUTO_DCA",
        action: `dca:${this.strategy.strategyId}`,
        status: "BLOCKED",
        reasonCode: "SLIPPAGE_EXCEEDED",
        reason,
        walletAddress: this.wallet.getWalletAddress(),
        targets: [router],
        totalAmount: amountIn.toString(),
        spentTotal: this.wallet.getSpentTotal().toString(),
        remainingCap: this.wallet.getRemainingTotalCap().toString(),
      });

      return {
        mode: this.wallet.mode,
        status: "BLOCKED",
        reasonCode: "INVALID_AMOUNT",
        reason,
        spentTotal: this.wallet.getSpentTotal(),
        remainingTotalCap: this.wallet.getRemainingTotalCap(),
        timestamp,
      };
    }

    // 3. Router match check (still delegates unknown addresses to wallet session check if mismatched)
    const calldata = encodeFunctionData({
      abi: SWAP_ROUTER_ABI,
      functionName: "swapExactTokensForTokens",
      args: [
        amountIn,
        request.minAmountOut,
        [this.strategy.tokenIn, this.strategy.tokenOut],
        this.wallet.getWalletAddress(),
        BigInt(nowSec + 300),
      ],
    });

    const result = await this.wallet.executeGuarded(
      {
        policyTarget: router,
        to: router,
        value: 0n,
        data: calldata,
        amount: amountIn,
        token: this.strategy.tokenIn,
        purpose: `Auto-DCA ${this.strategy.strategyId}`,
      },
      nowSec,
    );

    if (
      result.status === "APPROVED" &&
      normalizeAddress(router) !== normalizeAddress(this.strategy.allowedRouter)
    ) {
      throw new Error("Invariant violation: non-strategy router was approved");
    }

    if (result.status === "APPROVED") {
      this.lastRunAtSec = nowSec;
    }

    this.auditLogger.record({
      timestamp: result.timestamp,
      mode: result.mode,
      engine: "AUTO_DCA",
      action: `dca:${this.strategy.strategyId}`,
      status: result.status,
      reasonCode: result.reasonCode,
      reason: result.reason,
      walletAddress: this.wallet.getWalletAddress(),
      targets: [router],
      totalAmount: amountIn.toString(),
      spentTotal: result.spentTotal.toString(),
      remainingCap: result.remainingTotalCap.toString(),
      txHash: result.txHash,
      callsId: result.callsId,
      attributionCode: result.attributionCode,
    });

    return result;
  }

  public async revokeSession(reason?: string): Promise<WalletRevokeResult> {
    const res = await this.wallet.revokeSession(reason);
    this.auditLogger.record({
      timestamp: res.timestamp,
      mode: res.mode,
      engine: "SESSION_CONTROL",
      action: `revoke:${this.strategy.strategyId}`,
      status: "REVOKED",
      reason: res.reason,
      walletAddress: this.wallet.getWalletAddress(),
      targets: [],
      totalAmount: "0",
      spentTotal: this.wallet.getSpentTotal().toString(),
      remainingCap: this.wallet.getRemainingTotalCap().toString(),
      txHash: res.txHash,
    });
    return res;
  }
}
