import {
  CELO,
  createClient,
  erc8004Registry,
  getKey,
  isAltanaError,
  keyHashForSessionOrKey,
  NATIVE_TOKEN,
  signerFromPrivateKey,
  type Call,
  type Client,
  type FeeCurrenciesResult,
  type GrantSessionResult,
  type NetworkConfig,
  type Session,
  type SessionPermissions,
  type Signer,
  type Wallet,
} from "@altananetwork/sdk";
import {
  createPublicClient,
  encodeFunctionData,
  formatUnits,
  getAddress,
  http,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { generatePrivateKey } from "viem/accounts";
import { celo } from "viem/chains";
import {
  evaluateSessionGuardrails,
  SessionPolicySchema,
  type SessionPolicy,
} from "../policy/index.js";
import {
  appendAttributionTag,
  CAPRAIL_DEFAULT_ATTRIBUTION_CODE,
} from "./attribution.js";
import {
  buildExactInputSingleCalldata,
  CELO_MAINNET_ROUTERS,
  CELO_MAINNET_TOKENS,
  computeMinAmountOut,
  DEFAULT_EXECUTION_SLIPPAGE_BPS,
  ERC20_ABI,
  EXACT_INPUT_SINGLE_SELECTOR,
  UNISWAP_V3_SWAP_ROUTER_02_ABI,
  type UniswapV3FeeTier,
} from "./calldata.js";
import type {
  AgentWalletAdapter,
  WalletExecutionCall,
  WalletExecutionResult,
  WalletRevokeResult,
} from "./types.js";

/**
 * Celo Mainnet (42220) NetworkConfig scoped strictly to Celo without cross-chain
 * `provisionAlso: [ETHEREUM]`, preventing unnecessary Ethereum L1 relay provisioning
 * and nonce mismatches for Celo-only agents.
 */
export const CELO_MAINNET_ONLY: NetworkConfig = {
  ...CELO,
  provisionAlso: [],
};

const INVALID_AUTH_NONCE_PATTERN = /invalid auth(orization)? item nonce/i;

export function isInvalidAuthItemNonceError(err: unknown): boolean {
  const parts: string[] = [];
  let cur: unknown = err;
  for (let i = 0; i < 6 && cur !== undefined && cur !== null; i++) {
    if (cur instanceof Error) {
      parts.push(cur.message);
      const anyErr = cur as unknown as Record<string, unknown>;
      if (typeof anyErr.relayMessage === "string") {
        parts.push(anyErr.relayMessage);
      }
      if (typeof anyErr.detail === "string") {
        parts.push(anyErr.detail);
      }
      cur = anyErr.cause;
    } else {
      parts.push(String(cur));
      break;
    }
  }
  return INVALID_AUTH_NONCE_PATTERN.test(parts.join(" | "));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface ResolveOrProvisionWalletOptions {
  client: Pick<Client, "createWallet">;
  adminSigner: Signer;
  publicClient: Pick<PublicClient, "getCode">;
  existingWalletAddress?: Address | undefined;
  maxNonceRetries?: number | undefined;
  retryDelayMs?: number | undefined;
}

export interface ResolvedAltanaWallet {
  wallet: Wallet;
  reused: boolean;
  reason: string;
}

/**
 * Resolves an existing Altana EIP-7702 smart wallet or provisions it once on the relay.
 *
 * Prevents `Invalid auth item nonce, expected N, got M` loops caused by calling
 * `client.createWallet()` repeatedly after the wallet is already upgraded on-chain
 * or configured via `ALTANA_WALLET_ADDRESS`.
 */
export async function resolveOrProvisionAltanaWallet(
  opts: ResolveOrProvisionWalletOptions,
): Promise<ResolvedAltanaWallet> {
  const signerAddress = getAddress(opts.adminSigner.address);
  const targetAddress = opts.existingWalletAddress
    ? getAddress(opts.existingWalletAddress)
    : signerAddress;

  if (
    opts.existingWalletAddress !== undefined &&
    targetAddress.toLowerCase() !== signerAddress.toLowerCase()
  ) {
    throw new Error(
      `ALTANA_WALLET_ADDRESS (${targetAddress}) does not match adminSigner address (${signerAddress}). ` +
        `For EIP-7702 private-key Altana wallets, the wallet address equals the admin EOA address.`,
    );
  }

  // 1. Check on-chain bytecode: if EIP-7702 delegation (0xef0100...) or contract code
  //    already exists at targetAddress, reuse it without re-running createWallet().
  const code = await opts.publicClient.getCode({ address: targetAddress });
  if (code !== undefined && code !== "0x") {
    return {
      wallet: { address: targetAddress },
      reused: true,
      reason: "Wallet already upgraded on-chain (bytecode present on Celo Mainnet)",
    };
  }

  // 2. If ALTANA_WALLET_ADDRESS is explicitly pinned in .env, reuse handle directly
  //    (caller can still fall back to re-provisioning if relay rejects stale nonce).
  if (opts.existingWalletAddress !== undefined) {
    return {
      wallet: { address: targetAddress },
      reused: true,
      reason: "Reusing ALTANA_WALLET_ADDRESS configured in environment",
    };
  }

  // 3. First-time counterfactual provisioning on Altana Relay (with retry on nonce lag).
  const maxRetries = opts.maxNonceRetries ?? 3;
  const retryDelayMs = opts.retryDelayMs ?? 2_000;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const created = await opts.client.createWallet({
        signer: opts.adminSigner,
      });
      return {
        wallet: { address: getAddress(created.address) },
        reused: false,
        reason:
          attempt === 1
            ? "Provisioned Altana wallet on Celo Mainnet relay"
            : `Provisioned Altana wallet on retry attempt ${attempt}`,
      };
    } catch (err) {
      lastError = err;
      if (!isInvalidAuthItemNonceError(err) || attempt === maxRetries) {
        break;
      }
      await sleep(retryDelayMs * attempt);
    }
  }

  if (isInvalidAuthItemNonceError(lastError)) {
    throw new Error(
      `Altana relay rejected EIP-7702 authorization with stale EOA nonce for ${targetAddress}. ` +
        `This occurs when the EOA's on-chain nonce advanced after an earlier failed counterfactual ` +
        `registration. Either set a fresh ALTANA_ADMIN_PRIVATE_KEY in .env (auto-funded from OWNER_PRIVATE_KEY) ` +
        `or wait for relay RPC nonce sync and retry. Underlying error: ${
          lastError instanceof Error ? lastError.message : String(lastError)
        }`,
      { cause: lastError },
    );
  }

  throw lastError;
}

/**
 * Grants a session key and automatically re-provisions once if the relay reports a
 * stale counterfactual EIP-7702 auth item nonce (`Invalid auth item nonce`).
 */
export async function grantSessionWithNonceRecovery(opts: {
  client: Pick<Client, "createWallet" | "grantSession">;
  wallet: Wallet;
  adminSigner: Signer;
  sessionSigner: Signer;
  permissions: SessionPermissions;
  expiry: number;
  feeToken?: Address | readonly Address[] | undefined;
}): Promise<GrantSessionResult> {
  const callGrant = () =>
    opts.client.grantSession({
      wallet: opts.wallet,
      signer: opts.adminSigner,
      chainId: CELO.chainId,
      sessionSigner: opts.sessionSigner,
      permissions: opts.permissions,
      expiry: opts.expiry,
      ...(opts.feeToken !== undefined ? { feeToken: opts.feeToken } : {}),
    });

  try {
    return await callGrant();
  } catch (err) {
    if (!isInvalidAuthItemNonceError(err)) {
      throw err;
    }

    // Relay cached an older EIP-7702 auth item before the EOA nonce moved on.
    // Re-provision at the latest on-chain nonce and retry grantSession once.
    await opts.client.createWallet({ signer: opts.adminSigner });
    return await callGrant();
  }
}

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
    chains: [CELO_MAINNET_ONLY],
    defaultChainId: CELO.chainId,
    agentIdentity: false,
  });
}

/**
 * Creates a live Altana SDK client scoped strictly to Celo Mainnet (42220).
 */
export function createAltanaCeloClient(): Client {
  return createClient({
    chains: [CELO_MAINNET_ONLY],
    defaultChainId: CELO.chainId,
  });
}

/**
 * Translates our deterministic SessionPolicy into native `@altananetwork/sdk`
 * on-chain `SessionPermissions` (enforced by Altana's account contract & KeyStore).
 *
 * Strictly locks calls to SwapRouter02 + raw 4-byte hex selector `0x04e45aaf`
 * (`exactInputSingle`). Never emits `{ to }` catch-all permissions and never
 * grants `USDC.approve` (`0x095ea7b3`) to session keys.
 */
export function buildAltanaSessionPermissions(
  policy: SessionPolicy,
  period: "minute" | "hour" | "day" | "week" | "month" | "year" = "day",
): SessionPermissions {
  const validated = SessionPolicySchema.parse(policy);
  return {
    calls: [
      {
        to: CELO_MAINNET_ROUTERS.UNISWAP_V3_SWAP_ROUTER_02,
        signature: EXACT_INPUT_SINGLE_SELECTOR, // "0x04e45aaf"
      },
    ],
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
  input: ProvisionAltanaSessionInput & {
    rpcUrl?: string | undefined;
    existingWalletAddress?: Address | undefined;
  },
): Promise<{
  client: Client;
  wallet: Wallet;
  adminSigner: Signer;
  grantResult: GrantSessionResult;
}> {
  const client = createAltanaCeloClient();
  const publicClient = createPublicClient({
    chain: celo,
    transport: http(input.rpcUrl ?? CELO.publicRpcUrl),
  });
  const adminSigner = signerFromPrivateKey(input.adminPrivateKey);
  const sessionSigner = signerFromPrivateKey(input.sessionPrivateKey);

  const { wallet } = await resolveOrProvisionAltanaWallet({
    client,
    adminSigner,
    publicClient,
    existingWalletAddress: input.existingWalletAddress,
  });

  const permissions = buildAltanaSessionPermissions(
    input.policy,
    input.spendPeriod ?? "day",
  );

  const grantResult = await grantSessionWithNonceRecovery({
    client,
    wallet,
    adminSigner,
    sessionSigner,
    permissions,
    expiry: input.policy.expiresAt,
    feeToken: input.feeToken,
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

export const DEFAULT_AUTO_DCA_DAILY_CAP_USDC = 4;
export const DEFAULT_AUTO_DCA_SESSION_DAYS = 14;
export const DEFAULT_AUTO_DCA_DAILY_GAS_CAP_WEI = 1_000_000_000_000_000_000n; // 1.0 CELO/day relay fee cap
export const DEFAULT_MIN_GAS_CELO_WEI = 2_000_000_000_000_000n; // 0.002 CELO minimum balance
export const INSUFFICIENT_USDC_ALLOWANCE_REASON =
  "Insufficient USDC allowance for SwapRouter02 (owner must run session:grant to top up bounded approval)";

/**
 * Builds restricted on-chain Altana SessionPermissions for bounded USDC -> CELO Auto-DCA.
 * Permits ONLY Uniswap V3 SwapRouter02 raw selector `0x04e45aaf` (`exactInputSingle`)
 * under a strict daily Native USDC spend cap.
 *
 * Explicitly excludes `USDC.approve` (`0x095ea7b3`), `multicall` (`0xac9650d8`),
 * `sweepToken` (`0xdf2ab5bb`), `unwrapWETH9`, and `refundETH` from session permissions.
 */
export function buildAutoDcaSessionPermissions(
  dailySpendCapUnits: bigint,
  opts?: {
    dailyGasCapWei?: bigint | undefined;
  },
): SessionPermissions {
  if (dailySpendCapUnits <= 0n) {
    throw new Error("dailySpendCapUnits must be strictly greater than 0");
  }
  const dailyGasCapWei =
    opts?.dailyGasCapWei ?? DEFAULT_AUTO_DCA_DAILY_GAS_CAP_WEI;

  return {
    calls: [
      {
        to: CELO_MAINNET_ROUTERS.UNISWAP_V3_SWAP_ROUTER_02,
        signature: EXACT_INPUT_SINGLE_SELECTOR, // "0x04e45aaf"
      },
    ],
    spend: [
      {
        limit: dailySpendCapUnits,
        period: "day",
        token: CELO_MAINNET_TOKENS.USDC,
      },
      {
        limit: dailyGasCapWei,
        period: "day",
        token: NATIVE_TOKEN,
      },
    ],
  };
}

export interface GrantAutoDcaSessionOptions {
  adminPrivateKey: Hex;
  sessionPrivateKey?: Hex | undefined;
  dailySpendCapUsdc?: number | undefined;
  days?: number | undefined;
  rpcUrl?: string | undefined;
  existingWalletAddress?: Address | undefined;
  attributionCode?: string | undefined;
  dryRun?: boolean | undefined;
  /** Optional dependency injection hooks for deterministic unit testing */
  client?: Pick<Client, "createWallet" | "grantSession" | "execute"> | undefined;
  publicClient?: Pick<
    PublicClient,
    "getCode" | "readContract" | "waitForTransactionReceipt"
  > | undefined;
}

export interface GrantAutoDcaSessionResult {
  dryRun: boolean;
  walletAddress: Address;
  walletReused: boolean;
  sessionPrivateKey: Hex;
  sessionGenerated: boolean;
  sessionAddress: Address;
  sessionPublicKey: Hex;
  dailySpendCapUsdc: number;
  dailySpendCapUnits: bigint;
  days: number;
  expiry: number;
  permissions: SessionPermissions;
  currentAllowanceUnits: bigint;
  requiredAllowanceUnits: bigint;
  approvedAllowanceUnits: bigint;
  approvalSkipped: boolean;
  approvalTxHash: Hex | null;
  keyId?: Hex | undefined;
  keyHash?: Hex | undefined;
  txHash?: Hex | undefined;
}

/**
 * Human Control Plane provisioning helper (run once locally by the owner).
 * Uses `OWNER_PRIVATE_KEY` (or `ALTANA_ADMIN_PRIVATE_KEY`) to:
 * 1) Provision a bounded owner-side `USDC.approve(SwapRouter02, dailyCap * days)`
 *    allowance when existing allowance is lower than the session window total (never `maxUint256`).
 * 2) Authorize a selector-locked Altana EIP-7702 session key (`SwapRouter02` + `0x04e45aaf` only)
 *    with a daily Native USDC spend cap and expiry timestamp.
 */
export async function grantAutoDcaSession(
  opts: GrantAutoDcaSessionOptions,
): Promise<GrantAutoDcaSessionResult> {
  const dailySpendCapUsdc =
    opts.dailySpendCapUsdc ?? DEFAULT_AUTO_DCA_DAILY_CAP_USDC;
  const days = opts.days ?? DEFAULT_AUTO_DCA_SESSION_DAYS;
  if (!Number.isFinite(dailySpendCapUsdc) || dailySpendCapUsdc <= 0) {
    throw new Error("dailySpendCapUsdc must be strictly positive");
  }
  if (!Number.isInteger(days) || days <= 0) {
    throw new Error("days must be a positive integer");
  }

  const adminSigner = signerFromPrivateKey(opts.adminPrivateKey);
  const sessionGenerated = opts.sessionPrivateKey === undefined;
  const sessionPrivateKey: Hex = opts.sessionPrivateKey ?? generatePrivateKey();
  const sessionSigner = signerFromPrivateKey(sessionPrivateKey);

  const dailySpendCapUnits = BigInt(Math.round(dailySpendCapUsdc * 1_000_000));
  const requiredAllowanceUnits = dailySpendCapUnits * BigInt(days);
  const nowSec = Math.floor(Date.now() / 1000);
  const expiry = nowSec + days * 86_400;
  const permissions = buildAutoDcaSessionPermissions(dailySpendCapUnits);
  const attributionCode =
    opts.attributionCode ?? CAPRAIL_DEFAULT_ATTRIBUTION_CODE;

  const targetWalletAddress = opts.existingWalletAddress
    ? getAddress(opts.existingWalletAddress)
    : getAddress(adminSigner.address);

  const publicClient =
    opts.publicClient ??
    createPublicClient({
      chain: celo,
      transport: http(opts.rpcUrl ?? CELO.publicRpcUrl),
    });

  if (opts.dryRun) {
    const currentAllowanceUnits = await publicClient.readContract({
      address: CELO_MAINNET_TOKENS.USDC,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [targetWalletAddress, CELO_MAINNET_ROUTERS.UNISWAP_V3_SWAP_ROUTER_02],
    });
    const approvalSkipped = currentAllowanceUnits >= requiredAllowanceUnits;
    return {
      dryRun: true,
      walletAddress: targetWalletAddress,
      walletReused: opts.existingWalletAddress !== undefined,
      sessionPrivateKey,
      sessionGenerated,
      sessionAddress: getAddress(sessionSigner.address),
      sessionPublicKey: sessionSigner.publicKey,
      dailySpendCapUsdc,
      dailySpendCapUnits,
      days,
      expiry,
      permissions,
      currentAllowanceUnits,
      requiredAllowanceUnits,
      approvedAllowanceUnits: currentAllowanceUnits,
      approvalSkipped,
      approvalTxHash: null,
    };
  }

  const client = opts.client ?? createAltanaCeloClient();
  const resolved = await resolveOrProvisionAltanaWallet({
    client,
    adminSigner,
    publicClient,
    existingWalletAddress: opts.existingWalletAddress,
  });

  const walletAddress = getAddress(resolved.wallet.address);
  const currentAllowanceUnits = await publicClient.readContract({
    address: CELO_MAINNET_TOKENS.USDC,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [walletAddress, CELO_MAINNET_ROUTERS.UNISWAP_V3_SWAP_ROUTER_02],
  });

  const feeTokens = [NATIVE_TOKEN, CELO_MAINNET_TOKENS.USDC] as const;
  let approvalTxHash: Hex | null = null;
  let approvedAllowanceUnits = currentAllowanceUnits;
  let approvalSkipped = true;

  // Bounded owner-side USDC approval for SwapRouter02 (dailyCap * days, never maxUint256)
  if (currentAllowanceUnits < requiredAllowanceUnits) {
    approvalSkipped = false;
    const rawApprove = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: "approve",
      args: [
        CELO_MAINNET_ROUTERS.UNISWAP_V3_SWAP_ROUTER_02,
        requiredAllowanceUnits,
      ],
    });
    const approveData = appendAttributionTag(rawApprove, attributionCode);

    const approveExec = await client.execute({
      wallet: resolved.wallet,
      signer: adminSigner,
      chainId: CELO.chainId,
      feeToken: feeTokens,
      calls: [{ to: CELO_MAINNET_TOKENS.USDC, data: approveData }],
    });

    if (approveExec.status === "FAILED") {
      throw new Error(
        `Owner bounded USDC.approve failed (callsId=${approveExec.callsId})`,
      );
    }

    if (approveExec.transactionHash !== undefined) {
      approvalTxHash = approveExec.transactionHash;
      await publicClient.waitForTransactionReceipt({
        hash: approveExec.transactionHash,
      });
    }
    approvedAllowanceUnits = requiredAllowanceUnits;
  }

  const grantResult = await grantSessionWithNonceRecovery({
    client,
    wallet: resolved.wallet,
    adminSigner,
    sessionSigner,
    permissions,
    expiry,
    feeToken: feeTokens,
  });

  if (grantResult.status !== "granted") {
    throw new Error(
      `Altana grantSession failed: ${JSON.stringify(grantResult.legs)}`,
    );
  }

  return {
    dryRun: false,
    walletAddress,
    walletReused: resolved.reused,
    sessionPrivateKey,
    sessionGenerated,
    sessionAddress: getAddress(sessionSigner.address),
    sessionPublicKey: sessionSigner.publicKey,
    dailySpendCapUsdc,
    dailySpendCapUnits,
    days,
    expiry,
    permissions,
    currentAllowanceUnits,
    requiredAllowanceUnits,
    approvedAllowanceUnits,
    approvalSkipped,
    approvalTxHash,
    keyId: grantResult.keyId,
    keyHash: grantResult.keyHash,
    txHash: grantResult.transactionHash,
  };
}

export interface ExecuteAutoDcaWithSessionOptions {
  walletAddress: Address;
  sessionPrivateKey: Hex;
  amountInBaseUnits: bigint;
  dailySpendCapBaseUnits: bigint;
  feeTier?: UniswapV3FeeTier | undefined;
  executionSlippageBps?: number | undefined;
  spotPriceUsdcPerCelo?: number | undefined;
  attributionCode?: string | undefined;
  rpcUrl?: string | undefined;
  minGasCeloWei?: bigint | undefined;
  /** Optional dependency injection hooks for deterministic unit testing */
  client?: Client | undefined;
  publicClient?: Pick<
    PublicClient,
    "getBalance" | "readContract" | "simulateContract" | "waitForTransactionReceipt"
  > | undefined;
  readOnChainKey?: ((
    walletAddress: Address,
    keyHash: Hex,
  ) => Promise<{ expiry: number } | null>) | undefined;
}

export interface ExecuteAutoDcaWithSessionResult {
  decision: "EXECUTE" | "DEFER" | "HALTED_NO_GAS";
  reason: string;
  txHash: Hex | null;
  callsId?: Hex | undefined;
  amountOutMinimum?: bigint | undefined;
}

function estimateCeloOutFallback(
  amountInBaseUnits: bigint,
  spotPriceUsdcPerCelo: number,
  feeTier: UniswapV3FeeTier,
): bigint {
  if (amountInBaseUnits <= 0n || spotPriceUsdcPerCelo <= 0) {
    return 0n;
  }
  const usdcHuman = Number(amountInBaseUnits) / 1_000_000;
  const netUsdc = usdcHuman * (1 - feeTier / 1_000_000);
  return BigInt(Math.floor((netUsdc / spotPriceUsdcPerCelo) * 1e18));
}

/**
 * Agent Execution Plane swap helper (VPS / Hermes).
 * Uses ONLY `ALTANA_SESSION_PRIVATE_KEY` and `ALTANA_WALLET_ADDRESS` to sign and
 * broadcast a bounded `USDC -> CELO` SwapRouter02 swap with `25 bps` execution
 * slippage and ERC-8021 builder attribution (`celo_0518175d3efe`).
 * Never requires `OWNER_PRIVATE_KEY` or `ALTANA_ADMIN_PRIVATE_KEY`.
 */
export async function executeAutoDcaWithSession(
  opts: ExecuteAutoDcaWithSessionOptions,
): Promise<ExecuteAutoDcaWithSessionResult> {
  const walletAddress = getAddress(opts.walletAddress);
  const feeTier: UniswapV3FeeTier = opts.feeTier ?? 100;
  const executionSlippageBps =
    opts.executionSlippageBps ?? DEFAULT_EXECUTION_SLIPPAGE_BPS;
  const attributionCode =
    opts.attributionCode ?? CAPRAIL_DEFAULT_ATTRIBUTION_CODE;
  const minGasCeloWei = opts.minGasCeloWei ?? DEFAULT_MIN_GAS_CELO_WEI;

  const publicClient =
    opts.publicClient ??
    createPublicClient({
      chain: celo,
      transport: http(opts.rpcUrl ?? CELO.publicRpcUrl),
    });

  // 1) Check native CELO gas balance and Native USDC balance before signing
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

  if (celoBalanceWei < minGasCeloWei) {
    return {
      decision: "HALTED_NO_GAS",
      reason: `Insufficient native CELO gas balance: have ${formatUnits(celoBalanceWei, 18)} CELO, require at least ${formatUnits(minGasCeloWei, 18)} CELO`,
      txHash: null,
    };
  }

  if (usdcBalanceUnits < opts.amountInBaseUnits) {
    return {
      decision: "DEFER",
      reason: `Insufficient Native USDC balance: have ${formatUnits(usdcBalanceUnits, 6)} USDC, need ${formatUnits(opts.amountInBaseUnits, 6)} USDC`,
      txHash: null,
    };
  }

  // Session keys never hold USDC.approve permissions; defer cleanly if owner allowance is insufficient
  if (usdcAllowance < opts.amountInBaseUnits) {
    return {
      decision: "DEFER",
      reason: INSUFFICIENT_USDC_ALLOWANCE_REASON,
      txHash: null,
    };
  }

  // 2) Reconstruct live Session using ONLY sessionPrivateKey + on-chain account key lookup
  const sessionSigner = signerFromPrivateKey(opts.sessionPrivateKey);
  const keyHash = keyHashForSessionOrKey(sessionSigner.publicKey);

  let onChainExpiry: number;
  try {
    const keyRecord = opts.readOnChainKey
      ? await opts.readOnChainKey(walletAddress, keyHash)
      : await getKey(
          publicClient as Parameters<typeof getKey>[0],
          walletAddress,
          keyHash,
        );
    if (keyRecord === null) {
      return {
        decision: "DEFER",
        reason: `Session key ${sessionSigner.address} is not authorized on Altana wallet ${walletAddress} (revoked or not yet granted via session:grant)`,
        txHash: null,
      };
    }
    onChainExpiry = Number(keyRecord.expiry);
  } catch {
    return {
      decision: "DEFER",
      reason: `Session key ${sessionSigner.address} is not authorized on Altana wallet ${walletAddress} (revoked or not yet granted via session:grant)`,
      txHash: null,
    };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (onChainExpiry > 0 && nowSec >= onChainExpiry) {
    return {
      decision: "DEFER",
      reason: `Session key ${sessionSigner.address} expired at ${new Date(onChainExpiry * 1000).toISOString()}. Run npm run session:grant from the owner machine to renew.`,
      txHash: null,
    };
  }

  const effectiveDailyCap =
    opts.dailySpendCapBaseUnits >= opts.amountInBaseUnits
      ? opts.dailySpendCapBaseUnits
      : opts.amountInBaseUnits;

  const permissions = buildAutoDcaSessionPermissions(effectiveDailyCap);

  const session: Session = {
    walletAddress,
    signer: sessionSigner,
    publicKey: sessionSigner.publicKey,
    expiry: onChainExpiry,
    permissions,
  };

  const client = opts.client ?? createAltanaCeloClient();
  const feeTokens = [NATIVE_TOKEN, CELO_MAINNET_TOKENS.USDC] as const;

  // 3) Quote live CELO output via simulateContract (fallback to spot estimate) and apply 25 bps slippage buffer
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
          fee: feeTier,
          recipient: walletAddress,
          amountIn: opts.amountInBaseUnits,
          amountOutMinimum: 0n,
          sqrtPriceLimitX96: 0n,
        },
      ],
    });
    quotedAmountOut = result;
  } catch {
    quotedAmountOut = estimateCeloOutFallback(
      opts.amountInBaseUnits,
      opts.spotPriceUsdcPerCelo ?? 0.0565,
      feeTier,
    );
  }

  const amountOutMinimum = computeMinAmountOut(
    quotedAmountOut,
    executionSlippageBps,
  );

  const swapCall = buildExactInputSingleCalldata({
    tokenIn: CELO_MAINNET_TOKENS.USDC,
    tokenOut: CELO_MAINNET_TOKENS.CELO,
    fee: feeTier,
    recipient: walletAddress,
    amountIn: opts.amountInBaseUnits,
    amountOutMinimum,
    router: CELO_MAINNET_ROUTERS.UNISWAP_V3_SWAP_ROUTER_02,
    attributionCode,
  });

  // 4) Submit swap through session-only AltanaLiveAdapter (no adminSigner)
  const localPolicy: SessionPolicy = {
    sessionId: `caprail-session-${keyHash.slice(0, 10)}`,
    spendCapPerTx: opts.amountInBaseUnits,
    totalSpendCap: effectiveDailyCap,
    allowedTargets: [CELO_MAINNET_ROUTERS.UNISWAP_V3_SWAP_ROUTER_02],
    expiresAt: onChainExpiry > 0 ? onChainExpiry : nowSec + 3_600,
    revoked: false,
    token: CELO_MAINNET_TOKENS.USDC,
  };

  const adapter = new AltanaLiveAdapter({
    client,
    wallet: { address: walletAddress },
    policy: localPolicy,
    session,
    feeToken: feeTokens,
    attributionCode,
  });

  const swapExec = await adapter.executeGuarded(
    {
      policyTarget: CELO_MAINNET_ROUTERS.UNISWAP_V3_SWAP_ROUTER_02,
      to: swapCall.to,
      value: 0n,
      data: swapCall.data,
      amount: opts.amountInBaseUnits,
      token: CELO_MAINNET_TOKENS.USDC,
      purpose: `Auto-DCA ${formatUnits(opts.amountInBaseUnits, 6)} USDC -> CELO (fee=${feeTier}, slippage=${executionSlippageBps} bps)`,
    },
    nowSec,
  );

  if (swapExec.status !== "APPROVED") {
    return {
      decision: "DEFER",
      reason: swapExec.reason ?? "Altana session swap execution blocked",
      txHash: swapExec.txHash ?? null,
      callsId: swapExec.callsId,
      amountOutMinimum,
    };
  }

  return {
    decision: "EXECUTE",
    reason: `Executed live Auto-DCA via session key (${formatUnits(opts.amountInBaseUnits, 6)} USDC -> CELO, slippage=${executionSlippageBps} bps, tag=${attributionCode})`,
    txHash: swapExec.txHash ?? null,
    callsId: swapExec.callsId,
    amountOutMinimum,
  };
}
