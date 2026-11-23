import { encodeFunctionData, parseAbi } from "viem";
import {
  computeDeterministicSplits,
  SplitStrategySchema,
  type ComputedSplitPayout,
  type SplitStrategy,
} from "../policy/index.js";
import type {
  AgentWalletAdapter,
  WalletExecutionCall,
  WalletExecutionResult,
  WalletRevokeResult,
} from "../wallet/index.js";
import type { AuditLogger } from "./auditLog.js";

const ERC20_TRANSFER_ABI = parseAbi([
  "function transfer(address to, uint256 value) external returns (bool)",
]);

export interface SplitExecutionRequest {
  totalAmount: bigint;
  nowSec?: number | undefined;
}

export interface SplitExecutionOutcome {
  result: WalletExecutionResult;
  payouts: ComputedSplitPayout[];
}

export class RevenueSplitterEngine {
  private readonly wallet: AgentWalletAdapter;
  private readonly strategy: SplitStrategy;
  private readonly auditLogger: AuditLogger;

  constructor(opts: {
    wallet: AgentWalletAdapter;
    strategy: SplitStrategy;
    auditLogger: AuditLogger;
  }) {
    this.wallet = opts.wallet;
    this.strategy = SplitStrategySchema.parse(opts.strategy);
    this.auditLogger = opts.auditLogger;
  }

  public getStrategy(): SplitStrategy {
    return this.strategy;
  }

  public async executeSplit(
    request: SplitExecutionRequest,
  ): Promise<SplitExecutionOutcome> {
    const nowSec = request.nowSec ?? Math.floor(Date.now() / 1000);
    const payouts = computeDeterministicSplits(
      request.totalAmount,
      this.strategy.recipients,
    );

    const calls: WalletExecutionCall[] = payouts.map((payout) => ({
      policyTarget: payout.address,
      to: this.strategy.token,
      value: 0n,
      data: encodeFunctionData({
        abi: ERC20_TRANSFER_ABI,
        functionName: "transfer",
        args: [payout.address, payout.amount],
      }),
      amount: payout.amount,
      token: this.strategy.token,
      purpose: `RevenueSplit(${this.strategy.strategyId}) -> ${payout.label} (${payout.bps} bps)`,
    }));

    const result = await this.wallet.executeGuardedBatch(calls, nowSec);

    this.auditLogger.record({
      timestamp: result.timestamp,
      mode: result.mode,
      engine: "REVENUE_SPLITTER",
      action: `split:${this.strategy.strategyId}`,
      status: result.status,
      reasonCode: result.reasonCode,
      reason: result.reason,
      walletAddress: this.wallet.getWalletAddress(),
      targets: payouts.map((p) => p.address),
      totalAmount: request.totalAmount.toString(),
      spentTotal: result.spentTotal.toString(),
      remainingCap: result.remainingTotalCap.toString(),
      txHash: result.txHash,
      callsId: result.callsId,
      attributionCode: result.attributionCode,
    });

    return { result, payouts };
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
