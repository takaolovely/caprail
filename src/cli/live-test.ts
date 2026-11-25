import {
  CELO,
  createPrivateKeySigner,
  isAltanaError,
  NATIVE_TOKEN,
  signerFromPrivateKey,
} from "@altananetwork/sdk";
import {
  createPublicClient,
  createWalletClient,
  formatUnits,
  getAddress,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { loadEnv } from "../config/env.js";
import type { SessionPolicy } from "../policy/index.js";
import {
  AltanaLiveAdapter,
  CAPRAIL_DEFAULT_ATTRIBUTION_CODE,
  CELO_MAINNET_TOKENS,
  createAltanaCeloClient,
  encodeAttributedErc20Transfer,
  ERC20_ABI,
  grantSessionWithNonceRecovery,
  resolveOrProvisionAltanaWallet,
} from "../wallet/index.js";

const MICRO_PER_TX_CAP = 150_000n; // 0.15 USDC (6 decimals)
const MICRO_TOTAL_CAP = 300_000n; // 0.30 USDC (6 decimals)
const AUTO_FUND_TARGET_USDC = 350_000n; // 0.35 USDC target balance in Altana Agent Wallet
const AUTO_FUND_TARGET_CELO = 50_000_000_000_000_000n; // 0.05 CELO gas for distinct Altana Agent Wallet
const MICRO_PAYOUT_AMOUNT = 50_000n; // 0.05 USDC
const OVER_PER_TX_AMOUNT = 250_000n; // 0.25 USDC (> 0.15 USDC per-tx cap)
const OVER_ONCHAIN_TOTAL_AMOUNT = 350_000n; // 0.35 USDC (> 0.30 USDC total spend cap)
const SESSION_TTL_SECONDS = 3_600; // 1 hour

function celoscanTxUrl(txHash: Hex | undefined): string {
  return txHash !== undefined
    ? `https://celoscan.io/tx/${txHash}`
    : "(txHash not returned by relay)";
}

function formatUsdc(amount: bigint): string {
  return `${formatUnits(amount, 6)} USDC`;
}

function formatCelo(amount: bigint): string {
  return `${formatUnits(amount, 18)} CELO`;
}

async function main(): Promise<void> {
  const confirmedMainnet = process.argv.includes("--confirm-mainnet");
  const env = loadEnv();
  const attributionCode =
    env.CELO_ATTRIBUTION_CODE ?? CAPRAIL_DEFAULT_ATTRIBUTION_CODE;
  const ownerPrivateKey = (env.OWNER_PRIVATE_KEY ??
    env.ALTANA_ADMIN_PRIVATE_KEY) as Hex | undefined;
  const adminPrivateKey = (env.ALTANA_ADMIN_PRIVATE_KEY ??
    env.OWNER_PRIVATE_KEY) as Hex | undefined;
  const pinnedWalletAddress = env.ALTANA_WALLET_ADDRESS
    ? getAddress(env.ALTANA_WALLET_ADDRESS)
    : undefined;
  const recipientAddress = env.TEST_RECIPIENT_ADDRESS
    ? getAddress(env.TEST_RECIPIENT_ADDRESS)
    : undefined;

  const derivedOwnerAddress: Address | undefined =
    ownerPrivateKey !== undefined
      ? signerFromPrivateKey(ownerPrivateKey).address
      : undefined;
  const derivedAdminAddress: Address | undefined =
    adminPrivateKey !== undefined
      ? signerFromPrivateKey(adminPrivateKey).address
      : undefined;

  console.log("====================================================================");
  console.log(" CapRail | Celo Mainnet (42220) Live Altana Session Key Test Runner");
  console.log("====================================================================");
  console.log(
    `Mode               : ${confirmedMainnet ? "CELO_MAINNET (LIVE EXECUTION)" : "PREVIEW ONLY (no --confirm-mainnet flag)"}`,
  );
  console.log(`RPC URL            : ${env.CELO_RPC_URL}`);
  console.log(`Owner EOA          : ${derivedOwnerAddress ?? "(OWNER_PRIVATE_KEY not set)"}`);
  console.log(
    `Altana Admin EOA   : ${derivedAdminAddress ?? "(same as Owner)"}${pinnedWalletAddress ? ` (pinned ALTANA_WALLET_ADDRESS=${pinnedWalletAddress})` : ""}`,
  );
  console.log(`Test Recipient     : ${recipientAddress ?? "(TEST_RECIPIENT_ADDRESS not set)"}`);
  console.log(`Token (USDC)       : ${CELO_MAINNET_TOKENS.USDC}`);
  console.log(`Allowed Targets    : [${CELO_MAINNET_TOKENS.USDC}]`);
  console.log(`Spend Cap / Tx     : ${formatUsdc(MICRO_PER_TX_CAP)} (${MICRO_PER_TX_CAP.toString()})`);
  console.log(`Total Spend Cap    : ${formatUsdc(MICRO_TOTAL_CAP)} (${MICRO_TOTAL_CAP.toString()})`);
  console.log(`Auto-Fund Target   : ${formatUsdc(AUTO_FUND_TARGET_USDC)} (${AUTO_FUND_TARGET_USDC.toString()})`);
  console.log(`Session TTL        : ${SESSION_TTL_SECONDS}s (1 hour)`);
  console.log(`Verification Tx    : ${formatUsdc(MICRO_PAYOUT_AMOUNT)} -> recipient (ERC-8021 check)`);
  console.log(`ERC-8021 Tag       : ${attributionCode}`);
  console.log(
    `Estimated Cost     : ~0.05 USDC transfer + Celo gas/Altana KeyStore fee (paid in CELO/USDC)`,
  );
  console.log("====================================================================\n");

  if (!confirmedMainnet) {
    console.log(
      "[PREVIEW] No transactions were signed or broadcast. Pass `-- --confirm-mainnet` to execute live on Celo Mainnet (Chain ID 42220):",
    );
    console.log("  npm run live:test -- --confirm-mainnet");
    return;
  }

  // --- Strict pre-execution validation for live Celo Mainnet ---
  if (ownerPrivateKey === undefined || adminPrivateKey === undefined) {
    throw new Error(
      "Missing OWNER_PRIVATE_KEY (or ALTANA_ADMIN_PRIVATE_KEY) in local .env or environment",
    );
  }
  if (recipientAddress === undefined) {
    throw new Error(
      "Missing TEST_RECIPIENT_ADDRESS in local .env or environment",
    );
  }

  const ownerAccount = privateKeyToAccount(ownerPrivateKey);
  const adminSigner = signerFromPrivateKey(adminPrivateKey);
  const publicClient = createPublicClient({
    chain: celo,
    transport: http(env.CELO_RPC_URL),
  });

  // 1) Check Celo Mainnet chain ID + owner balances
  console.log("[Step 1/5] Checking Celo Mainnet chainId & owner balances...");
  const [chainId, ownerCeloBalance, ownerUsdcBalance] = await Promise.all([
    publicClient.getChainId(),
    publicClient.getBalance({ address: ownerAccount.address }),
    publicClient.readContract({
      address: CELO_MAINNET_TOKENS.USDC,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [ownerAccount.address],
    }),
  ]);

  if (chainId !== CELO.chainId) {
    throw new Error(
      `Refusing execution: expected Celo Mainnet (${CELO.chainId}), RPC returned ${chainId}`,
    );
  }

  console.log(`  Owner Address : ${ownerAccount.address}`);
  console.log(`  CELO Balance  : ${formatCelo(ownerCeloBalance)}`);
  console.log(`  USDC Balance  : ${formatUsdc(ownerUsdcBalance)}`);

  if (ownerUsdcBalance < MICRO_TOTAL_CAP) {
    throw new Error(
      `Insufficient owner USDC balance: have ${formatUsdc(ownerUsdcBalance)}, require at least ${formatUsdc(MICRO_TOTAL_CAP)}`,
    );
  }
  if (ownerCeloBalance === 0n) {
    throw new Error(
      "Insufficient native CELO balance (0 CELO): Altana KeyStore registration on Celo Mainnet requires native CELO for registration/gas.",
    );
  }
  if (recipientAddress.toLowerCase() === ownerAccount.address.toLowerCase()) {
    console.log(
      "  [INFO] TEST_RECIPIENT_ADDRESS matches OWNER address (self-recipient smoke-test mode).",
    );
  }

  // 2) Resolve / reuse existing Altana wallet (or provision once) + auto-fund USDC if distinct address
  console.log("\n[Step 2/5] Resolving Altana Agent Wallet, verifying funding & granting scoped session key...");
  const client = createAltanaCeloClient();

  const resolved = await resolveOrProvisionAltanaWallet({
    client,
    adminSigner,
    publicClient,
    existingWalletAddress: pinnedWalletAddress,
  });
  const wallet = resolved.wallet;

  console.log(`  Wallet Address : ${wallet.address}`);
  console.log(`  Wallet Status  : ${resolved.reused ? "REUSED" : "NEWLY PROVISIONED"} (${resolved.reason})`);
  if (pinnedWalletAddress === undefined) {
    console.log(`  Tip            : Save ALTANA_WALLET_ADDRESS=${wallet.address} in .env to reuse across runs.`);
  }

  // Check USDC balance at wallet.address; auto-fund 0.35 USDC from ownerAccount when wallet is distinct
  const [walletCeloBalance, walletUsdcBalance] = await Promise.all([
    publicClient.getBalance({ address: wallet.address }),
    publicClient.readContract({
      address: CELO_MAINNET_TOKENS.USDC,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [wallet.address],
    }),
  ]);

  console.log(`  Wallet CELO    : ${formatCelo(walletCeloBalance)}`);
  console.log(`  Wallet USDC    : ${formatUsdc(walletUsdcBalance)}`);

  if (walletUsdcBalance < AUTO_FUND_TARGET_USDC) {
    if (wallet.address.toLowerCase() === ownerAccount.address.toLowerCase()) {
      console.log(
        `  [FUND CHECK] Wallet is owner's EIP-7702 EOA (${formatUsdc(walletUsdcBalance)} >= ${formatUsdc(MICRO_TOTAL_CAP)}); skipping self-transfer so EOA nonce is not bumped.`,
      );
    } else {
      if (ownerUsdcBalance < AUTO_FUND_TARGET_USDC) {
        throw new Error(
          `Insufficient owner USDC to auto-fund Altana wallet: have ${formatUsdc(ownerUsdcBalance)}, need ${formatUsdc(AUTO_FUND_TARGET_USDC)}`,
        );
      }
      console.log(
        `  [AUTO-FUND] Wallet USDC (${formatUsdc(walletUsdcBalance)}) < ${formatUsdc(AUTO_FUND_TARGET_USDC)}. Sending ${formatUsdc(AUTO_FUND_TARGET_USDC)} from ownerAccount -> ${wallet.address}...`,
      );
      const ownerWalletClient = createWalletClient({
        account: ownerAccount,
        chain: celo,
        transport: http(env.CELO_RPC_URL),
      });
      const fundCall = encodeAttributedErc20Transfer({
        token: CELO_MAINNET_TOKENS.USDC,
        recipient: wallet.address,
        amount: AUTO_FUND_TARGET_USDC,
        attributionCode,
      });
      const fundTxHash = await ownerWalletClient.sendTransaction({
        to: fundCall.to,
        data: fundCall.data,
        value: 0n,
      });
      const fundReceipt = await publicClient.waitForTransactionReceipt({
        hash: fundTxHash,
      });
      if (fundReceipt.status !== "success") {
        throw new Error(`Auto-fund USDC transaction reverted: ${fundTxHash}`);
      }
      console.log(`  [AUTO-FUND] Confirmed in block ${fundReceipt.blockNumber.toString()}: ${celoscanTxUrl(fundTxHash)}`);
    }
  }

  // If using a distinct Altana wallet address that has < 0.05 CELO, top up micro gas from ownerAccount
  if (
    wallet.address.toLowerCase() !== ownerAccount.address.toLowerCase() &&
    walletCeloBalance < AUTO_FUND_TARGET_CELO
  ) {
    if (ownerCeloBalance <= AUTO_FUND_TARGET_CELO) {
      throw new Error(
        `Distinct Altana wallet ${wallet.address} needs CELO for KeyStore gas (${formatCelo(walletCeloBalance)} < ${formatCelo(AUTO_FUND_TARGET_CELO)}), and owner only holds ${formatCelo(ownerCeloBalance)}.`,
      );
    }
    console.log(
      `  [AUTO-FUND] Wallet CELO (${formatCelo(walletCeloBalance)}) < ${formatCelo(AUTO_FUND_TARGET_CELO)}. Sending ${formatCelo(AUTO_FUND_TARGET_CELO)} from ownerAccount -> ${wallet.address}...`,
    );
    const ownerWalletClient = createWalletClient({
      account: ownerAccount,
      chain: celo,
      transport: http(env.CELO_RPC_URL),
    });
    const gasTxHash = await ownerWalletClient.sendTransaction({
      to: wallet.address,
      value: AUTO_FUND_TARGET_CELO,
    });
    const gasReceipt = await publicClient.waitForTransactionReceipt({
      hash: gasTxHash,
    });
    if (gasReceipt.status !== "success") {
      throw new Error(`Auto-fund CELO transaction reverted: ${gasTxHash}`);
    }
    console.log(`  [AUTO-FUND] CELO confirmed in block ${gasReceipt.blockNumber.toString()}: ${celoscanTxUrl(gasTxHash)}`);
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const expiresAt = nowSec + SESSION_TTL_SECONDS;
  const sessionSigner = createPrivateKeySigner();

  const policy: SessionPolicy = {
    sessionId: `caprail-live-${nowSec}`,
    spendCapPerTx: MICRO_PER_TX_CAP,
    totalSpendCap: MICRO_TOTAL_CAP,
    allowedTargets: [CELO_MAINNET_TOKENS.USDC],
    expiresAt,
    revoked: false,
    token: CELO_MAINNET_TOKENS.USDC,
  };

  const feeTokens = [NATIVE_TOKEN, CELO_MAINNET_TOKENS.USDC] as const;

  const grantResult = await grantSessionWithNonceRecovery({
    client,
    wallet,
    adminSigner,
    sessionSigner,
    expiry: expiresAt,
    feeToken: feeTokens,
    permissions: {
      calls: [
        {
          to: CELO_MAINNET_TOKENS.USDC,
          signature: "transfer(address,uint256)",
        },
      ],
      spend: [
        {
          limit: MICRO_TOTAL_CAP,
          period: "day",
          token: CELO_MAINNET_TOKENS.USDC,
        },
      ],
    },
  });

  if (grantResult.status !== "granted") {
    throw new Error(
      `Altana grantSession failed: ${JSON.stringify(grantResult.legs)}`,
    );
  }

  console.log(`  Session keyId  : ${grantResult.keyId}`);
  console.log(`  Session keyHash: ${grantResult.keyHash}`);
  console.log(`  Grant TxHash   : ${grantResult.transactionHash ?? "(bundled)"}`);
  console.log(`  Celoscan       : ${celoscanTxUrl(grantResult.transactionHash)}`);

  const adapter = new AltanaLiveAdapter({
    client,
    wallet,
    policy,
    session: grantResult,
    adminSigner,
    feeToken: feeTokens,
    attributionCode,
  });

  // Wrap Steps 3-4 in try/finally so emergency revoke runs even if a test throws
  try {
    // 3) Positive test: 1x ERC-8021 attribution verification transfer (0.05 USDC -> TEST_RECIPIENT_ADDRESS)
    console.log(
      `\n[Step 3/5] Executing ERC-8021 attribution verification transfer (${formatUsdc(MICRO_PAYOUT_AMOUNT)} -> ${recipientAddress})...`,
    );
    const verifyCall = encodeAttributedErc20Transfer({
      token: CELO_MAINNET_TOKENS.USDC,
      recipient: recipientAddress,
      amount: MICRO_PAYOUT_AMOUNT,
      attributionCode,
    });

    const verifyResult = await adapter.executeGuarded({
      policyTarget: CELO_MAINNET_TOKENS.USDC,
      to: verifyCall.to,
      value: 0n,
      data: verifyCall.data,
      amount: MICRO_PAYOUT_AMOUNT,
      token: CELO_MAINNET_TOKENS.USDC,
      purpose: "CapRail live-test ERC-8021 attribution verification transfer (0.05 USDC)",
    });

    console.log(`  Status         : ${verifyResult.status}`);
    console.log(`  Calls ID       : ${verifyResult.callsId ?? "n/a"}`);
    console.log(`  TxHash         : ${verifyResult.txHash ?? "n/a"}`);
    console.log(`  Celoscan       : ${celoscanTxUrl(verifyResult.txHash)}`);
    console.log(`  ERC-8021 Tag   : ${verifyCall.attributionCode} (verified=${verifyCall.decodedAttribution.codes.includes(attributionCode)})`);
    console.log(`  Remaining Cap  : ${formatUsdc(verifyResult.remainingTotalCap)}`);

    if (verifyResult.status !== "APPROVED") {
      throw new Error(
        `Positive ERC-8021 verification transfer failed: ${verifyResult.reasonCode}: ${verifyResult.reason}`,
      );
    }

    // 4) Negative tests: BOTH pre-flight deterministic policy AND direct on-chain Altana KeyStore/Relay
    console.log("\n[Step 4/5] Running negative tests (pre-flight + on-chain Altana KeyStore/Relay)...");

    // 4a. Pre-flight over-per-tx-cap (0.25 USDC > 0.15 USDC)
    const overCapCall = encodeAttributedErc20Transfer({
      token: CELO_MAINNET_TOKENS.USDC,
      recipient: recipientAddress,
      amount: OVER_PER_TX_AMOUNT,
      attributionCode,
    });
    const preFlightOverCap = await adapter.executeGuarded({
      policyTarget: CELO_MAINNET_TOKENS.USDC,
      to: overCapCall.to,
      value: 0n,
      data: overCapCall.data,
      amount: OVER_PER_TX_AMOUNT,
      token: CELO_MAINNET_TOKENS.USDC,
      purpose: "Negative test: 0.25 USDC > 0.15 USDC per-tx cap",
    });
    console.log(
      `  [4a PRE-FLIGHT OVER-CAP]         status=${preFlightOverCap.status} code=${preFlightOverCap.reasonCode} reason=${preFlightOverCap.reason}`,
    );

    // 4b. Pre-flight un-allowlisted target (USDT instead of USDC)
    const foreignTokenCall = encodeAttributedErc20Transfer({
      token: CELO_MAINNET_TOKENS.USDT,
      recipient: recipientAddress,
      amount: MICRO_PAYOUT_AMOUNT,
      attributionCode,
    });
    const preFlightForeign = await adapter.executeGuarded({
      policyTarget: CELO_MAINNET_TOKENS.USDT,
      to: foreignTokenCall.to,
      value: 0n,
      data: foreignTokenCall.data,
      amount: MICRO_PAYOUT_AMOUNT,
      token: CELO_MAINNET_TOKENS.USDT,
      purpose: "Negative test: un-allowlisted USDT contract",
    });
    console.log(
      `  [4b PRE-FLIGHT FOREIGN TARGET]   status=${preFlightForeign.status} code=${preFlightForeign.reasonCode} reason=${preFlightForeign.reason}`,
    );

    // 4c. On-chain Altana KeyStore/Relay test: bypass TS pre-flight & send un-allowlisted target
    try {
      const relayForeignRes = await client.execute({
        session: grantResult,
        chainId: CELO.chainId,
        feeToken: feeTokens,
        calls: [{ to: foreignTokenCall.to, data: foreignTokenCall.data }],
      });
      console.log(
        `  [4c ON-CHAIN FOREIGN TARGET]     relayStatus=${relayForeignRes.status} callsId=${relayForeignRes.callsId}`,
      );
    } catch (err) {
      const msg = isAltanaError(err)
        ? `[${err.code}] ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
      console.log(`  [4c ON-CHAIN FOREIGN TARGET]     REJECTED BY ALTANA: ${msg}`);
    }

    // 4d. On-chain Altana KeyStore/Relay test: bypass TS pre-flight & exceed 0.30 USDC spend cap
    const overOnChainCall = encodeAttributedErc20Transfer({
      token: CELO_MAINNET_TOKENS.USDC,
      recipient: recipientAddress,
      amount: OVER_ONCHAIN_TOTAL_AMOUNT,
      attributionCode,
    });
    try {
      const relayOverCapRes = await client.execute({
        session: grantResult,
        chainId: CELO.chainId,
        feeToken: feeTokens,
        calls: [{ to: overOnChainCall.to, data: overOnChainCall.data }],
      });
      console.log(
        `  [4d ON-CHAIN OVER SPEND CAP]     relayStatus=${relayOverCapRes.status} callsId=${relayOverCapRes.callsId}`,
      );
    } catch (err) {
      const msg = isAltanaError(err)
        ? `[${err.code}] ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
      console.log(`  [4d ON-CHAIN OVER SPEND CAP]     REJECTED BY ALTANA: ${msg}`);
    }
  } finally {
    // 5) Emergency 1-tx Revoke (always runs so no live session key is left dangling)
    console.log("\n[Step 5/5] Executing 1-tx emergency session revoke on Celo Mainnet...");
    const revokeRes = await adapter.revokeSession(
      "CapRail live-test completed: emergency 1-tx revoke",
    );
    console.log(`  Revoked        : ${String(revokeRes.revoked)}`);
    console.log(`  Key ID         : ${revokeRes.keyId ?? "n/a"}`);
    console.log(`  Revoke TxHash  : ${revokeRes.txHash ?? "n/a"}`);
    console.log(`  Celoscan       : ${celoscanTxUrl(revokeRes.txHash)}`);
    console.log(`  Final Revoked  : ${String(adapter.isRevoked())}`);

    // Verify post-revoke execution is deterministically blocked
    const postRevoke = await adapter.executeGuarded({
      policyTarget: CELO_MAINNET_TOKENS.USDC,
      to: CELO_MAINNET_TOKENS.USDC,
      value: 0n,
      data: encodeAttributedErc20Transfer({
        token: CELO_MAINNET_TOKENS.USDC,
        recipient: recipientAddress,
        amount: MICRO_PAYOUT_AMOUNT,
        attributionCode,
      }).data,
      amount: MICRO_PAYOUT_AMOUNT,
      token: CELO_MAINNET_TOKENS.USDC,
      purpose: "Post-revoke verification check",
    });
    console.log(
      `  [POST-REVOKE CHECK] status=${postRevoke.status} code=${postRevoke.reasonCode}`,
    );
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`\n[live:test FAILED] ${message}`);
  process.exitCode = 1;
});
