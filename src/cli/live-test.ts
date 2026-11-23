import {
  CELO,
  createClient,
  createPrivateKeySigner,
  isAltanaError,
  NATIVE_TOKEN,
  signerFromPrivateKey,
  type Wallet,
} from "@altananetwork/sdk";
import {
  createPublicClient,
  formatUnits,
  getAddress,
  http,
  type Address,
  type Hex,
} from "viem";
import { celo } from "viem/chains";
import { loadEnv } from "../config/env.js";
import type { SessionPolicy } from "../policy/index.js";
import {
  AltanaLiveAdapter,
  CAPRAIL_DEFAULT_ATTRIBUTION_CODE,
  CELO_MAINNET_TOKENS,
  encodeAttributedErc20Transfer,
  ERC20_ABI,
} from "../wallet/index.js";

const MICRO_PER_TX_CAP = 150_000n; // 0.15 USDC (6 decimals)
const MICRO_TOTAL_CAP = 300_000n; // 0.30 USDC (6 decimals)
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
  const recipientAddress = env.TEST_RECIPIENT_ADDRESS
    ? getAddress(env.TEST_RECIPIENT_ADDRESS)
    : undefined;

  const derivedOwnerAddress: Address | undefined =
    ownerPrivateKey !== undefined
      ? signerFromPrivateKey(ownerPrivateKey).address
      : undefined;

  console.log("====================================================================");
  console.log(" CapRail — Celo Mainnet (42220) Live Altana Session Key Test Runner");
  console.log("====================================================================");
  console.log(
    `Mode               : ${confirmedMainnet ? "CELO_MAINNET (LIVE EXECUTION)" : "PREVIEW ONLY (no --confirm-mainnet flag)"}`,
  );
  console.log(`RPC URL            : ${env.CELO_RPC_URL}`);
  console.log(`Owner Wallet       : ${derivedOwnerAddress ?? "(OWNER_PRIVATE_KEY not set)"}`);
  console.log(`Test Recipient     : ${recipientAddress ?? "(TEST_RECIPIENT_ADDRESS not set)"}`);
  console.log(`Token (USDC)       : ${CELO_MAINNET_TOKENS.USDC}`);
  console.log(`Allowed Targets    : [${CELO_MAINNET_TOKENS.USDC}]`);
  console.log(`Spend Cap / Tx     : ${formatUsdc(MICRO_PER_TX_CAP)} (${MICRO_PER_TX_CAP.toString()})`);
  console.log(`Total Spend Cap    : ${formatUsdc(MICRO_TOTAL_CAP)} (${MICRO_TOTAL_CAP.toString()})`);
  console.log(`Session TTL        : ${SESSION_TTL_SECONDS}s (1 hour)`);
  console.log(`Micro Split Payout : ${formatUsdc(MICRO_PAYOUT_AMOUNT)} -> recipient`);
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
  if (ownerPrivateKey === undefined) {
    throw new Error(
      "Missing OWNER_PRIVATE_KEY (or ALTANA_ADMIN_PRIVATE_KEY) in local .env or environment",
    );
  }
  if (recipientAddress === undefined) {
    throw new Error(
      "Missing TEST_RECIPIENT_ADDRESS in local .env or environment",
    );
  }

  const ownerSigner = signerFromPrivateKey(ownerPrivateKey);
  const publicClient = createPublicClient({
    chain: celo,
    transport: http(env.CELO_RPC_URL),
  });

  // 1) Check Celo Mainnet chain ID + owner balances
  console.log("[Step 1/5] Checking Celo Mainnet chainId & owner balances...");
  const [chainId, celoBalance, usdcBalance] = await Promise.all([
    publicClient.getChainId(),
    publicClient.getBalance({ address: ownerSigner.address }),
    publicClient.readContract({
      address: CELO_MAINNET_TOKENS.USDC,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [ownerSigner.address],
    }),
  ]);

  if (chainId !== CELO.chainId) {
    throw new Error(
      `Refusing execution: expected Celo Mainnet (${CELO.chainId}), RPC returned ${chainId}`,
    );
  }

  console.log(`  Owner Address : ${ownerSigner.address}`);
  console.log(`  CELO Balance  : ${formatCelo(celoBalance)}`);
  console.log(`  USDC Balance  : ${formatUsdc(usdcBalance)}`);

  if (usdcBalance < MICRO_TOTAL_CAP) {
    throw new Error(
      `Insufficient USDC balance: have ${formatUsdc(usdcBalance)}, require at least ${formatUsdc(MICRO_TOTAL_CAP)}`,
    );
  }
  if (celoBalance === 0n) {
    throw new Error(
      "Insufficient native CELO balance (0 CELO): Altana KeyStore registration on Celo Mainnet requires native CELO for registration/gas.",
    );
  }
  if (recipientAddress.toLowerCase() === ownerSigner.address.toLowerCase()) {
    console.warn(
      "  [WARN] TEST_RECIPIENT_ADDRESS matches OWNER address (fine for smoke test, but final hackathon demo requires a named external collaborator).",
    );
  }

  // 2) Provision Altana Agent Wallet + scoped 1-hour Session Key
  console.log("\n[Step 2/5] Creating Altana Agent Wallet & granting scoped session key...");
  const client = createClient({
    chains: [CELO],
    defaultChainId: CELO.chainId,
  });

  const createdWallet = await client.createWallet({ signer: ownerSigner });
  const wallet: Wallet = { address: createdWallet.address };
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

  const grantResult = await client.grantSession({
    wallet,
    signer: ownerSigner,
    chainId: CELO.chainId,
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

  console.log(`  Wallet Address : ${wallet.address}`);
  console.log(`  Session keyId  : ${grantResult.keyId}`);
  console.log(`  Session keyHash: ${grantResult.keyHash}`);
  console.log(`  Grant TxHash   : ${grantResult.transactionHash ?? "(bundled)"}`);
  console.log(`  Celoscan       : ${celoscanTxUrl(grantResult.transactionHash)}`);

  const adapter = new AltanaLiveAdapter({
    client,
    wallet,
    policy,
    session: grantResult,
    adminSigner: ownerSigner,
    feeToken: feeTokens,
    attributionCode,
  });

  // Wrap Steps 3-4 in try/finally so emergency revoke runs even if a test throws
  try {
    // 3) Positive test: 1x Micro Revenue Split (0.05 USDC -> TEST_RECIPIENT_ADDRESS)
    console.log(
      `\n[Step 3/5] Executing micro Revenue Split (${formatUsdc(MICRO_PAYOUT_AMOUNT)} -> ${recipientAddress})...`,
    );
    const splitCall = encodeAttributedErc20Transfer({
      token: CELO_MAINNET_TOKENS.USDC,
      recipient: recipientAddress,
      amount: MICRO_PAYOUT_AMOUNT,
      attributionCode,
    });

    const splitResult = await adapter.executeGuarded({
      policyTarget: CELO_MAINNET_TOKENS.USDC,
      to: splitCall.to,
      value: 0n,
      data: splitCall.data,
      amount: MICRO_PAYOUT_AMOUNT,
      token: CELO_MAINNET_TOKENS.USDC,
      purpose: "CapRail live-test micro revenue split (0.05 USDC)",
    });

    console.log(`  Status         : ${splitResult.status}`);
    console.log(`  Calls ID       : ${splitResult.callsId ?? "n/a"}`);
    console.log(`  TxHash         : ${splitResult.txHash ?? "n/a"}`);
    console.log(`  Celoscan       : ${celoscanTxUrl(splitResult.txHash)}`);
    console.log(`  ERC-8021 Tag   : ${splitCall.attributionCode} (verified=${splitCall.decodedAttribution.codes.includes(attributionCode)})`);
    console.log(`  Remaining Cap  : ${formatUsdc(splitResult.remainingTotalCap)}`);

    if (splitResult.status !== "APPROVED") {
      throw new Error(
        `Positive micro split failed: ${splitResult.reasonCode} — ${splitResult.reason}`,
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
      "CapRail live-test completed — emergency 1-tx revoke",
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
