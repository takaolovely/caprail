import {
  CELO,
  createClient,
  erc8004Registry,
  isAltanaError,
  signerFromPrivateKey,
  type Call,
  type Client,
  type FeeCurrenciesResult,
  type GrantSessionResult,
  type Session,
  type SessionPermissions,
  type Signer,
  type Wallet,
} from "@altananetwork/sdk";
import { createPublicClient, http, type Address, type Hex } from "viem";
import { celo } from "viem/chains";
import {
  evaluateSessionGuardrails,
  SessionPolicySchema,
  type SessionPolicy,
} from "../policy/index.js";
import { appendAttributionTag } from "./attribution.js";
import type {
  AgentWalletAdapter,
  WalletExecutionCall,
  WalletExecutionResult,
  WalletRevokeResult,
} from "./types.js";

export interface AltanaLiveAdapterOptions {
  wallet: Wallet;
  policy: SessionPolicy;
  session: Session;
  adminSigner?: Signer | undefined;
  client?: Client | undefined;
  feeToken?: Address | readonly Address[] | undefined;
  attributionCode?: string | undefined;
}

export interface ProvisionAltanaSessionInput {
  adminPrivateKey: Hex;
  sessionPrivateKey: Hex;
  policy: SessionPolicy;
  feeToken?: Address | readonly Address[] | undefined;
  spendPeriod?: "minute" | "hour" | "day" | "week" | "month" | "year" | undefined;
}

/**
 * Creates a read-only Altana SDK client pinned to Celo Mainnet (Chain ID 42220).
 * Does not require any private keys.
 */
export function createReadOnlyAltanaCeloClient(): Client {
  return createClient({
    chains: [CELO],
    defaultChainId: CELO.chainId,
    agentIdentity: false,
  });
}

/**
 * Translates our deterministic SessionPolicy into native `@altananetwork/sdk`
 * on-chain `SessionPermissions` (enforced by Altana's account contract & KeyStore).
 */
export function buildAltanaSessionPermissions(
  policy: SessionPolicy,
  period: "minute" | "hour" | "day" | "week" | "month" | "year" = "day",
): SessionPermissions {
  const validated = SessionPolicySchema.parse(policy);
  return {
    calls: validated.allowedTargets.map((to) => ({ to })),
    spend: [
      {
        limit: validated.totalSpendCap,
        period,
        ...(validated.token !== undefined ? { token: validated.token } : {}),
      },
    ],
  };
}

/**
 * Provisions an Altana smart wallet + on-chain scoped session key on Celo Mainnet (42220).
 */
export async function provisionAltanaCeloSession(
  input: ProvisionAltanaSessionInput,
): Promise<{
  client: Client;
  wallet: Wallet;
  adminSigner: Signer;
  grantResult: GrantSessionResult;
}> {
  const client = createClient({
    chains: [CELO],
    defaultChainId: CELO.chainId,
  });
  const adminSigner = signerFromPrivateKey(input.adminPrivateKey);
  const sessionSigner = signerFromPrivateKey(input.sessionPrivateKey);
  const created = await client.createWallet({ signer: adminSigner });
  const wallet: Wallet = { address: created.address };

  const permissions = buildAltanaSessionPermissions(
    input.policy,
    input.spendPeriod ?? "day",
  );

  const grantResult = await client.grantSession({
    wallet,
    signer: adminSigner,
    chainId: CELO.chainId,
    permissions,
    expiry: input.policy.expiresAt,
    sessionSigner,
    ...(input.feeToken !== undefined ? { feeToken: input.feeToken } : {}),
  });

  return { client, wallet, adminSigner, grantResult };
}

export interface CeloNetworkProbeResult {
  rpcUrl: string;
  rpcChainId: number;
  latestBlockNumber: bigint;
  altanaChainId: number;
  altanaKeyStore: Address;
  altanaKeyStoreController: Address;
  altanaRelayUrl: string | undefined;
  erc8004IdentityRegistry: Address;
  relayFeeCurrencies: FeeCurrenciesResult | null;
  relayProbeError?: string | undefined;
}

/**
 * Read-only network & SDK probe for `npm run check:network`.
 * Verifies Celo Mainnet (42220) RPC reachability and `@altananetwork/sdk` client initialization
 * without requiring any private keys.
 */
export async function probeCeloMainnetAndAltana(
  rpcUrl: string = CELO.publicRpcUrl,
): Promise<CeloNetworkProbeResult> {
  const publicClient = createPublicClient({
    chain: celo,
    transport: http(rpcUrl),
  });

  const [rpcChainId, latestBlockNumber] = await Promise.all([
    publicClient.getChainId(),
    publicClient.getBlockNumber(),
  ]);

  if (rpcChainId !== CELO.chainId) {
    throw new Error(
      `Expected Celo Mainnet chainId ${CELO.chainId}, received ${rpcChainId} from ${rpcUrl}`,
    );
  }

  const altanaClient = createReadOnlyAltanaCeloClient();
  let relayFeeCurrencies: FeeCurrenciesResult | null = null;
  let relayProbeError: string | undefined;

  try {
    relayFeeCurrencies = await altanaClient.feeCurrencies({
      chainId: CELO.chainId,
    });
  } catch (err) {
    relayProbeError = err instanceof Error ? err.message : String(err);
  }

  return {
    rpcUrl,
    rpcChainId,
    latestBlockNumber,
    altanaChainId: CELO.chainId,
    altanaKeyStore: CELO.keyStore,
    altanaKeyStoreController: CELO.keyStoreController,
    altanaRelayUrl: CELO.relayUrl,
    erc8004IdentityRegistry: erc8004Registry(CELO.chainId),
    relayFeeCurrencies,
    ...(relayProbeError !== undefined ? { relayProbeError } : {}),
  };
}

/**
 * Live Celo Mainnet (42220) adapter backed by `@altananetwork/sdk` session keys
 * and `@celo/attribution-tags` ERC-8021 calldata tagging.
 */
export class AltanaLiveAdapter implements AgentWalletAdapter {
  public readonly mode = "CELO_MAINNET" as const;

  private readonly client: Client;
  private readonly wallet: Wallet;
  private readonly policy: SessionPolicy;
  private readonly session: Session;
  private readonly adminSigner: Signer | undefined;
  private readonly feeToken: Address | readonly Address[] | undefined;
  private readonly attributionCode: string | undefined;
  private spentTotal = 0n;
  private revoked: boolean;

  constructor(options: AltanaLiveAdapterOptions) {
    this.client = options.client ?? createReadOnlyAltanaCeloClient();
    this.wallet = options.wallet;
    this.policy = SessionPolicySchema.parse(options.policy);
    this.session = options.session;
    this.adminSigner = options.adminSigner;
    this.feeToken = options.feeToken;
    this.attributionCode = options.attributionCode;
    this.revoked = this.policy.revoked;
  }

  public getWalletAddress(): Address {
    return this.wallet.address;
  }

  public getPolicy(): SessionPolicy {
    return { ...this.policy, revoked: this.revoked };
  }

  public getSpentTotal(): bigint {
    return this.spentTotal;
  }

  public getRemainingTotalCap(): bigint {
    const remaining = this.policy.totalSpendCap - this.spentTotal;
    return remaining > 0n ? remaining : 0n;
  }

  public isRevoked(): boolean {
    return this.revoked;
  }

  public async executeGuarded(
    call: WalletExecutionCall,
    nowSec: number = Math.floor(Date.now() / 1000),
  ): Promise<WalletExecutionResult> {
    return this.executeGuardedBatch([call], nowSec);
  }

  public async executeGuardedBatch(
    calls: readonly WalletExecutionCall[],
    nowSec: number = Math.floor(Date.now() / 1000),
  ): Promise<WalletExecutionResult> {
    const timestamp = new Date(nowSec * 1000).toISOString();

    if (calls.length === 0) {
      return {
        mode: this.mode,
        status: "BLOCKED",
        reasonCode: "INVALID_AMOUNT",
        reason: "Batch must contain at least one call",
        spentTotal: this.spentTotal,
        remainingTotalCap: this.getRemainingTotalCap(),
        timestamp,
      };
    }

    // 1. Pre-flight deterministic policy gate
    let runningSpent = this.spentTotal;
    for (const call of calls) {
      const verdict = evaluateSessionGuardrails(
        this.policy,
        { spentTotal: runningSpent, revoked: this.revoked },
        {
          target: call.policyTarget,
          amount: call.amount,
          token: call.token,
        },
        nowSec,
      );

      if (!verdict.allowed) {
        return {
          mode: this.mode,
          status: "BLOCKED",
          reasonCode: verdict.code,
          reason: `[CELO_MAINNET pre-flight] ${verdict.reason}`,
          spentTotal: this.spentTotal,
          remainingTotalCap: this.getRemainingTotalCap(),
          timestamp,
        };
      }
      runningSpent += call.amount;
    }

    // 2. Encode calls with ERC-8021 Celo attribution suffix
    const sdkCalls: Call[] = calls.map((call) => ({
      to: call.to,
      ...(call.value !== undefined ? { value: call.value } : {}),
      data: appendAttributionTag(call.data, this.attributionCode),
    }));

    // 3. Submit via Altana session key on Celo Mainnet (42220)
    try {
      const execResult = await this.client.execute({
        session: this.session,
        calls: sdkCalls,
        chainId: CELO.chainId,
        ...(this.feeToken !== undefined ? { feeToken: this.feeToken } : {}),
      });

      if (execResult.status === "FAILED") {
        return {
          mode: this.mode,
          status: "BLOCKED",
          reasonCode: "RELAY_REVERT",
          reason: `[CELO_MAINNET on-chain] Altana relay execution failed (callsId=${execResult.callsId})`,
          callsId: execResult.callsId,
          txHash: execResult.transactionHash,
          spentTotal: this.spentTotal,
          remainingTotalCap: this.getRemainingTotalCap(),
          timestamp,
        };
      }

      this.spentTotal = runningSpent;

      return {
        mode: this.mode,
        status: "APPROVED",
        callsId: execResult.callsId,
        txHash: execResult.transactionHash,
        attributionCode: this.attributionCode,
        spentTotal: this.spentTotal,
        remainingTotalCap: this.getRemainingTotalCap(),
        timestamp,
      };
    } catch (err) {
      const message = isAltanaError(err)
        ? `[${err.code}] ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);

      return {
        mode: this.mode,
        status: "BLOCKED",
        reasonCode: "RELAY_REVERT",
        reason: `[CELO_MAINNET on-chain] ${message}`,
        spentTotal: this.spentTotal,
        remainingTotalCap: this.getRemainingTotalCap(),
        timestamp,
      };
    }
  }

  /**
   * 1-tx on-chain session revocation via Altana KeyStore (`client.revokeSession`).
   * Requires the wallet's `adminSigner` (session keys cannot revoke themselves).
   */
  public async revokeSession(reason?: string): Promise<WalletRevokeResult> {
    const timestamp = new Date().toISOString();
    if (this.adminSigner === undefined) {
      throw new Error(
        "adminSigner is required to execute on-chain revokeSession() on Celo Mainnet",
      );
    }

    const result = await this.client.revokeSession({
      wallet: this.wallet,
      signer: this.adminSigner,
      session: this.session,
      ...(this.feeToken !== undefined ? { feeToken: this.feeToken } : {}),
    });

    if (result.status === "revoked") {
      this.revoked = true;
    }

    return {
      mode: this.mode,
      revoked: result.status === "revoked",
      keyId: result.keyId,
      txHash: result.transactionHash,
      reason: reason ?? `Altana KeyStore revoke status: ${result.status}`,
      timestamp,
    };
  }
}
