import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { X } from "lucide-react";
import {
  CELO_MAINNET_ROUTERS,
  CELO_MAINNET_TOKENS,
  computeMinAmountOut,
  DEFAULT_MAX_SLIPPAGE_BPS,
  encodeAttributedErc20Transfer,
  encodeAttributedUniswapV3Swap,
} from "@caprail/wallet/calldata.js";
import { CAPRAIL_DEFAULT_ATTRIBUTION_CODE } from "@caprail/wallet/attribution.js";
import { AgentCardModal } from "./components/AgentCardModal.js";
import type { ActiveDcaPosition, DcaFrequency } from "./components/DcaPositionPanel.js";
import { GitHubIcon } from "./components/GitHubIcon.js";
import { JudgeConsolePage } from "./components/JudgeConsolePage.js";
import { LandingPage } from "./components/LandingPage.js";
import { TopBar, type AppRoute, type AppRunMode } from "./components/TopBar.js";
import { UserAppPage } from "./components/UserAppPage.js";
import { CAPRAIL_GITHUB_URL } from "./data/mainnetProof.js";
import {
  connectInjectedCeloWallet,
  ensureUsdcBalanceAndAllowanceForSwap,
  formatWalletError,
  InsufficientUsdcBalanceError,
  quoteUniswapV3ExactInputSingle,
  sendLiveAttributedTx,
  type LiveWalletState,
} from "./lib/liveWallet.js";
import {
  buildCalldataPreview,
  createSandboxPolicy,
  createSandboxRuntime,
  formatUsdcDisplay,
  SANDBOX_WALLET_ADDRESS,
  usdcNumberToBaseUnits,
  type AuditEvent,
  type WalletExecutionResult,
} from "./lib/sandboxBridge.js";

const EASE_OUT_EXPO = [0.22, 1, 0.36, 1] as const;
const DEFAULT_PER_TX_CAP_USDC = 50;
const DEFAULT_TOTAL_CAP_USDC = 100;

type FeedbackSurface = "APP" | "VERIFY" | "BOTH";

interface PageFeedbackState {
  result: WalletExecutionResult;
  summary: string;
}

// Deterministic realistic ±2% CELO market price sequence for Sandbox DCA fills
const SANDBOX_CELO_FILL_PRICES = [
  0.72, 0.708, 0.731, 0.714, 0.727, 0.705, 0.734, 0.718, 0.729, 0.712,
] as const;

const INITIAL_LIVE_WALLET: LiveWalletState = {
  connected: false,
  address: null,
  chainId: null,
  celoBalanceFormatted: "0.0000",
  usdcBalanceFormatted: "0.00",
  usdcBalanceRaw: 0n,
  error: null,
  isUserRejection: false,
};

function parseRouteFromHash(hash: string): AppRoute {
  const normalized = hash.replace(/^#\/?/, "").trim().toLowerCase();
  if (normalized === "app") return "APP";
  if (normalized === "verify") return "VERIFY";
  return "OVERVIEW";
}

function hashForRoute(route: AppRoute): string {
  if (route === "APP") return "#app";
  if (route === "VERIFY") return "#verify";
  return "";
}

export function App() {
  const [route, setRoute] = useState<AppRoute>(() =>
    typeof window !== "undefined"
      ? parseRouteFromHash(window.location.hash)
      : "OVERVIEW",
  );
  const [runMode, setRunMode] = useState<AppRunMode>("SANDBOX");
  const [perTxCapUsdc, setPerTxCapUsdc] = useState<number>(DEFAULT_PER_TX_CAP_USDC);
  const [totalCapUsdc, setTotalCapUsdc] = useState<number>(DEFAULT_TOTAL_CAP_USDC);
  const [dcaAmountUsdc, setDcaAmountUsdc] = useState<number>(25);
  const [revoked, setRevoked] = useState<boolean>(false);
  const [spentUnits, setSpentUnits] = useState<bigint>(0n);
  const [shakeNonce, setShakeNonce] = useState<number>(0);
  const [appFeedback, setAppFeedback] = useState<PageFeedbackState | null>(null);
  const [judgeFeedback, setJudgeFeedback] = useState<PageFeedbackState | null>(null);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [dcaPosition, setDcaPosition] = useState<ActiveDcaPosition | null>(null);
  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [agentCardOpen, setAgentCardOpen] = useState<boolean>(false);
  const [liveWallet, setLiveWallet] = useState<LiveWalletState>(INITIAL_LIVE_WALLET);
  const [isConnecting, setIsConnecting] = useState<boolean>(false);

  const runtimeRef = useRef(
    createSandboxRuntime(
      createSandboxPolicy({
        perTxCapUsdc: DEFAULT_PER_TX_CAP_USDC,
        totalCapUsdc: DEFAULT_TOTAL_CAP_USDC,
      }),
    ),
  );

  useEffect(() => {
    function onHashChange() {
      setRoute(parseRouteFromHash(window.location.hash));
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  function handleNavigate(next: AppRoute) {
    setRoute(next);
    const targetHash = hashForRoute(next);
    if (targetHash === "") {
      window.history.pushState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
    } else if (window.location.hash !== targetHash) {
      window.location.hash = targetHash;
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function rebuildSimulator(
    nextPerTx: number,
    nextTotal: number,
    resetSpent = false,
  ) {
    const policy = createSandboxPolicy({
      perTxCapUsdc: nextPerTx,
      totalCapUsdc: nextTotal,
      revoked: resetSpent ? false : revoked,
    });
    runtimeRef.current = createSandboxRuntime(policy);
    if (resetSpent) {
      setSpentUnits(0n);
      setRevoked(false);
      setAppFeedback(null);
      setJudgeFeedback(null);
      setDcaPosition(null);
    }
  }

  function handlePerTxCapChange(val: number) {
    const nextTotal = Math.max(totalCapUsdc, val);
    setPerTxCapUsdc(val);
    if (nextTotal !== totalCapUsdc) setTotalCapUsdc(nextTotal);
    rebuildSimulator(val, nextTotal, true);
  }

  function handleTotalCapChange(val: number) {
    const clamped = Math.max(val, perTxCapUsdc);
    setTotalCapUsdc(clamped);
    rebuildSimulator(perTxCapUsdc, clamped, true);
  }

  function handleApplyCustomCaps(nextPerTx: number, nextTotal: number) {
    const safePerTx = Math.max(1, nextPerTx);
    const safeTotal = Math.max(safePerTx, nextTotal);
    setPerTxCapUsdc(safePerTx);
    setTotalCapUsdc(safeTotal);
    rebuildSimulator(safePerTx, safeTotal, true);
  }

  const totalCapUnits = usdcNumberToBaseUnits(totalCapUsdc);
  const remainingUnits =
    totalCapUnits > spentUnits ? totalCapUnits - spentUnits : 0n;

  const activeWalletAddress =
    runMode === "LIVE_WALLET" && liveWallet.address
      ? liveWallet.address
      : SANDBOX_WALLET_ADDRESS;

  const calldataPreview = useMemo(
    () =>
      buildCalldataPreview({
        amountUsdc: dcaAmountUsdc,
        walletAddress: activeWalletAddress,
      }),
    [dcaAmountUsdc, activeWalletAddress],
  );

  async function handleConnectWallet() {
    setIsConnecting(true);
    setLiveWallet((prev) => ({ ...prev, error: null }));
    try {
      const state = await connectInjectedCeloWallet();
      setLiveWallet(state);
    } catch (err) {
      const formatted = formatWalletError(err);
      setLiveWallet({
        ...INITIAL_LIVE_WALLET,
        error: formatted.message,
        isUserRejection: formatted.isUserRejection,
      });
      if (formatted.isUserRejection) {
        setRunMode("SANDBOX");
      }
    } finally {
      setIsConnecting(false);
    }
  }

  function dismissWalletError() {
    setLiveWallet((prev) => ({ ...prev, error: null }));
  }

  function handleDisconnectWallet() {
    setLiveWallet(INITIAL_LIVE_WALLET);
    setRunMode("SANDBOX");
  }

  function recordAuditAndVerdict(
    result: WalletExecutionResult,
    meta: {
      engine: AuditEvent["engine"];
      action: string;
      targets: `0x${string}`[];
      amountUnits: bigint;
      summary: string;
      surface: FeedbackSurface;
    },
  ) {
    const nextFeedback: PageFeedbackState = { result, summary: meta.summary };
    if (meta.surface === "APP" || meta.surface === "BOTH") {
      setAppFeedback(nextFeedback);
    }
    if (meta.surface === "VERIFY" || meta.surface === "BOTH") {
      setJudgeFeedback(nextFeedback);
    }
    setSpentUnits(result.spentTotal);

    if (result.status === "BLOCKED") {
      setShakeNonce((n) => n + 1);
    }

    const ev: AuditEvent = {
      timestamp: result.timestamp,
      mode: result.mode,
      engine: meta.engine,
      action: meta.action,
      status: result.status,
      reasonCode: result.reasonCode,
      reason: result.reason,
      walletAddress: activeWalletAddress,
      targets: meta.targets,
      totalAmount: meta.amountUnits.toString(),
      spentTotal: result.spentTotal.toString(),
      remainingCap: result.remainingTotalCap.toString(),
      txHash: result.txHash,
      attributionCode: result.attributionCode,
    };
    setAuditEvents((prev) => [...prev, ev]);
  }

  async function executeDca(
    amountUsdc: number,
    label: string,
    surface: FeedbackSurface,
    customSummary?: string,
  ): Promise<WalletExecutionResult> {
    setIsExecuting(true);
    setDcaAmountUsdc(amountUsdc);
    try {
      const amountUnits = usdcNumberToBaseUnits(amountUsdc);
      // Indicative sandbox CELO quote (~$0.72/CELO) with 1.00% (100 bps) slippage guard
      const indicativeCeloQuoteWei = (amountUnits * 10n ** 18n) / 720_000n;
      const sandboxAmountOutMin = computeMinAmountOut(
        indicativeCeloQuoteWei,
        DEFAULT_MAX_SLIPPAGE_BPS,
      );
      const swapCall = encodeAttributedUniswapV3Swap({
        tokenIn: CELO_MAINNET_TOKENS.USDC,
        tokenOut: CELO_MAINNET_TOKENS.CELO,
        fee: 3000,
        recipient: activeWalletAddress,
        amountIn: amountUnits,
        amountOutMinimum: sandboxAmountOutMin,
        router: CELO_MAINNET_ROUTERS.UNISWAP_V3_SWAP_ROUTER_02,
        attributionCode: CAPRAIL_DEFAULT_ATTRIBUTION_CODE,
      });

      const simResult = await runtimeRef.current.simulator.executeGuarded({
        policyTarget: CELO_MAINNET_ROUTERS.UNISWAP_V3_SWAP_ROUTER_02,
        to: swapCall.to,
        value: 0n,
        data: swapCall.data,
        amount: amountUnits,
        token: CELO_MAINNET_TOKENS.USDC,
        purpose: label,
      });

      if (
        runMode === "LIVE_WALLET" &&
        simResult.status === "APPROVED" &&
        liveWallet.connected &&
        liveWallet.address
      ) {
        try {
          const prep = await ensureUsdcBalanceAndAllowanceForSwap({
            account: liveWallet.address,
            spender: CELO_MAINNET_ROUTERS.UNISWAP_V3_SWAP_ROUTER_02,
            amountIn: amountUnits,
            attributionCode: CAPRAIL_DEFAULT_ATTRIBUTION_CODE,
          });
          const liveQuote = await quoteUniswapV3ExactInputSingle({
            account: liveWallet.address,
            tokenIn: CELO_MAINNET_TOKENS.USDC,
            tokenOut: CELO_MAINNET_TOKENS.CELO,
            fee: 3000,
            recipient: liveWallet.address,
            amountIn: amountUnits,
            maxSlippageBps: DEFAULT_MAX_SLIPPAGE_BPS,
            router: CELO_MAINNET_ROUTERS.UNISWAP_V3_SWAP_ROUTER_02,
          });
          const liveSwapCall = encodeAttributedUniswapV3Swap({
            tokenIn: CELO_MAINNET_TOKENS.USDC,
            tokenOut: CELO_MAINNET_TOKENS.CELO,
            fee: 3000,
            recipient: liveWallet.address,
            amountIn: amountUnits,
            amountOutMinimum: liveQuote.amountOutMinimum,
            router: CELO_MAINNET_ROUTERS.UNISWAP_V3_SWAP_ROUTER_02,
            attributionCode: CAPRAIL_DEFAULT_ATTRIBUTION_CODE,
          });
          const liveHash = await sendLiveAttributedTx({
            account: liveWallet.address,
            to: liveSwapCall.to,
            data: liveSwapCall.data,
            value: 0n,
          });
          const liveResult: WalletExecutionResult = {
            ...simResult,
            mode: "CELO_MAINNET",
            txHash: liveHash,
          };
          recordAuditAndVerdict(liveResult, {
            engine: "AUTO_DCA",
            action: label,
            targets: [liveSwapCall.to],
            amountUnits,
            surface,
            summary: prep.approvalTxHash
              ? `Live Celo Mainnet Auto-DCA broadcast (${formatUsdcDisplay(amountUnits)} USDC -> CELO · 1.00% slippage guard · USDC approval confirmed).`
              : `Live Celo Mainnet Auto-DCA broadcast (${formatUsdcDisplay(amountUnits)} USDC -> CELO · 1.00% slippage guard).`,
          });
          return liveResult;
        } catch (err) {
          const isInsufficient = err instanceof InsufficientUsdcBalanceError;
          const formatted = formatWalletError(err);
          const blockedLive: WalletExecutionResult = {
            ...simResult,
            mode: "CELO_MAINNET",
            status: "BLOCKED",
            reasonCode: "RELAY_REVERT",
            reason: isInsufficient ? err.message : formatted.message,
            spentTotal: spentUnits,
            remainingTotalCap: remainingUnits,
          };
          recordAuditAndVerdict(blockedLive, {
            engine: "AUTO_DCA",
            action: label,
            targets: [swapCall.to],
            amountUnits,
            surface,
            summary: isInsufficient
              ? "Insufficient Native USDC balance"
              : "Live wallet transaction cancelled or reverted.",
          });
          return blockedLive;
        }
      }

      recordAuditAndVerdict(simResult, {
        engine: "AUTO_DCA",
        action: label,
        targets: [CELO_MAINNET_ROUTERS.UNISWAP_V3_SWAP_ROUTER_02],
        amountUnits,
        surface,
        summary:
          simResult.status === "APPROVED"
            ? customSummary ??
              `Auto-DCA swap ${formatUsdcDisplay(amountUnits)} USDC -> CELO approved within session cap.`
            : `Auto-DCA swap ${formatUsdcDisplay(amountUnits)} USDC blocked by deterministic guardrail.`,
      });
      return simResult;
    } finally {
      setIsExecuting(false);
    }
  }

  async function handleStartAutoDca(opts: {
    totalAllocateUsdc: number;
    perOrderUsdc: number;
    ordersCount: number;
    frequency: DcaFrequency;
  }) {
    const { totalAllocateUsdc, perOrderUsdc, ordersCount, frequency } = opts;
    const result = await executeDca(
      perOrderUsdc,
      `dca:${frequency.toLowerCase()}-order-1-of-${ordersCount}`,
      "APP",
      `Auto-DCA started (${frequency}, ${ordersCount} orders of $${perOrderUsdc.toFixed(2)} from $${totalAllocateUsdc.toFixed(2)} budget). Order #1 executed.`,
    );

    if (result.status === "APPROVED") {
      const priceUsd = SANDBOX_CELO_FILL_PRICES[0];
      const celoReceived = perOrderUsdc / priceUsd;
      setDcaPosition({
        frequency,
        totalOrders: ordersCount,
        perOrderUsdc,
        totalBudgetUsdc: totalAllocateUsdc,
        spotPriceUsd: priceUsd,
        fills: [
          {
            orderNumber: 1,
            amountUsdc: perOrderUsdc,
            celoReceived,
            executionPriceUsd: priceUsd,
            timestamp: result.timestamp,
            mode: result.mode,
            txHash: result.txHash,
          },
        ],
      });
    }
  }

  async function handleSimulateNextDcaFill() {
    if (!dcaPosition) return;
    if (dcaPosition.fills.length >= dcaPosition.totalOrders) return;

    const nextOrderNumber = dcaPosition.fills.length + 1;
    const priceUsd =
      SANDBOX_CELO_FILL_PRICES[
        (nextOrderNumber - 1) % SANDBOX_CELO_FILL_PRICES.length
      ] ?? 0.72;
    const celoReceived = dcaPosition.perOrderUsdc / priceUsd;

    const result = await executeDca(
      dcaPosition.perOrderUsdc,
      `dca:${dcaPosition.frequency.toLowerCase()}-order-${nextOrderNumber}-of-${dcaPosition.totalOrders}`,
      "APP",
      `DCA Order #${nextOrderNumber}/${dcaPosition.totalOrders} filled: $${dcaPosition.perOrderUsdc.toFixed(2)} USDC -> ${celoReceived.toFixed(2)} CELO @ $${priceUsd.toFixed(3)}.`,
    );

    if (result.status === "APPROVED") {
      setDcaPosition((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          spotPriceUsd: priceUsd,
          fills: [
            ...prev.fills,
            {
              orderNumber: nextOrderNumber,
              amountUsdc: prev.perOrderUsdc,
              celoReceived,
              executionPriceUsd: priceUsd,
              timestamp: result.timestamp,
              mode: result.mode,
              txHash: result.txHash,
            },
          ],
        };
      });
    }
  }

  async function executeUnlistedTokenAttack() {
    setIsExecuting(true);
    try {
      const amountUnits = usdcNumberToBaseUnits(10);
      const foreignCall = encodeAttributedErc20Transfer({
        token: CELO_MAINNET_TOKENS.USDT,
        recipient: activeWalletAddress,
        amount: amountUnits,
        attributionCode: CAPRAIL_DEFAULT_ATTRIBUTION_CODE,
      });

      const simResult = await runtimeRef.current.simulator.executeGuarded({
        policyTarget: CELO_MAINNET_TOKENS.USDT,
        to: foreignCall.to,
        value: 0n,
        data: foreignCall.data,
        amount: amountUnits,
        token: CELO_MAINNET_TOKENS.USDT,
        purpose: "Attack Simulation: Unlisted USD₮ transfer",
      });

      recordAuditAndVerdict(simResult, {
        engine: "AUTO_DCA",
        action: "attack:unlisted-usdt-token",
        targets: [CELO_MAINNET_TOKENS.USDT],
        amountUnits,
        surface: "VERIFY",
        summary: `Blocked unauthorized USD₮ contract call (${CELO_MAINNET_TOKENS.USDT.slice(0, 10)}…).`,
      });
    } finally {
      setIsExecuting(false);
    }
  }

  async function handleRevokeSession(surface: FeedbackSurface) {
    const res = await runtimeRef.current.simulator.revokeSession(
      "Operator triggered 1-tx emergency kill-switch",
    );
    setRevoked(true);
    const ev: AuditEvent = {
      timestamp: res.timestamp,
      mode: res.mode,
      engine: "SESSION_CONTROL",
      action: "revoke:emergency-kill-switch",
      status: "REVOKED",
      reason: res.reason,
      walletAddress: activeWalletAddress,
      targets: [],
      totalAmount: "0",
      spentTotal: spentUnits.toString(),
      remainingCap: remainingUnits.toString(),
      txHash: res.txHash,
    };
    setAuditEvents((prev) => [...prev, ev]);

    const revokeFeedback: PageFeedbackState = {
      result: {
        mode: res.mode,
        status: "BLOCKED",
        reasonCode: "SESSION_REVOKED",
        reason: "Session key invalidated. All further agent calls will be rejected.",
        txHash: res.txHash,
        spentTotal: spentUnits,
        remainingTotalCap: remainingUnits,
        timestamp: res.timestamp,
      },
      summary: "1-Tx Emergency Kill-Switch activated.",
    };

    if (surface === "APP" || surface === "BOTH") {
      setAppFeedback(revokeFeedback);
    }
    if (surface === "VERIFY" || surface === "BOTH") {
      setJudgeFeedback(revokeFeedback);
    }
  }

  function handleResetSession() {
    setPerTxCapUsdc(DEFAULT_PER_TX_CAP_USDC);
    setTotalCapUsdc(DEFAULT_TOTAL_CAP_USDC);
    rebuildSimulator(
      DEFAULT_PER_TX_CAP_USDC,
      DEFAULT_TOTAL_CAP_USDC,
      true,
    );
  }

  return (
    <div className="min-h-screen bg-[#f2f4ef] text-[#15171c]">
      <TopBar
        route={route}
        onNavigate={handleNavigate}
        runMode={runMode}
        onModeChange={setRunMode}
        liveWallet={liveWallet}
        isConnecting={isConnecting}
        onConnectWallet={handleConnectWallet}
        onDisconnectWallet={handleDisconnectWallet}
      />

      {/* Friendly Dismissible Wallet Banner (never renders [object Object]) */}
      {liveWallet.error && (
        <div className="fixed inset-x-0 top-[76px] z-30 px-4 sm:px-6">
          <div
            role="status"
            className={`chip-blur-in mx-auto flex max-w-2xl items-center justify-between gap-3 rounded-full border px-4 py-2 text-xs font-medium shadow-[0_8px_24px_rgba(21,23,28,0.12)] ${
              liveWallet.isUserRejection
                ? "border-[#d6dfd3] bg-[#ffffff] text-[#15171c]"
                : "border-[#ff6a5c]/35 bg-[#ffece9] text-[#a8342a]"
            }`}
          >
            <span>{liveWallet.error}</span>
            <button
              type="button"
              onClick={dismissWalletError}
              aria-label="Dismiss notification"
              className="cursor-pointer rounded-full p-1 text-[#5d7166] transition-colors hover:bg-[#f2f4ef] hover:text-[#15171c]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      <main>
        <motion.div
          key={route}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.34, ease: EASE_OUT_EXPO }}
        >
          {route === "OVERVIEW" && (
            <LandingPage
              onNavigate={handleNavigate}
              revoked={revoked}
              onRevokeSession={() => handleRevokeSession("BOTH")}
              onResetSession={handleResetSession}
              onOpenAgentCard={() => setAgentCardOpen(true)}
            />
          )}

          {route === "APP" && (
            <div className="mx-auto max-w-[1220px] px-4 pt-24 pb-12 sm:px-6 lg:px-8">
              <UserAppPage
                runMode={runMode}
                perTxCapUsdc={perTxCapUsdc}
                totalCapUsdc={totalCapUsdc}
                onApplyCustomCaps={handleApplyCustomCaps}
                spentUnits={spentUnits}
                totalCapUnits={totalCapUnits}
                remainingUnits={remainingUnits}
                revoked={revoked}
                isExecuting={isExecuting}
                lastResult={appFeedback?.result ?? null}
                lastResultSummary={appFeedback?.summary ?? null}
                auditEvents={auditEvents}
                dcaPosition={dcaPosition}
                onStartAutoDca={handleStartAutoDca}
                onSimulateNextDcaFill={handleSimulateNextDcaFill}
                onRevokeSession={() => handleRevokeSession("APP")}
                onResetSession={handleResetSession}
              />
              <footer className="mt-12 flex flex-wrap items-center justify-between gap-2 border-t border-[#e3e6eb] pt-5 font-numeric text-[11px] text-[#5d7166]">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span>CapRail ·</span>
                  <a
                    href={CAPRAIL_GITHUB_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-[#15171c] transition-colors hover:text-[#10372a] hover:underline"
                  >
                    <GitHubIcon className="h-3.5 w-3.5" />
                    <span>takaolovely/caprail</span>
                  </a>
                  <span>· Celo Agents Open for Business</span>
                </div>
                <span>ERC-8021 {CAPRAIL_DEFAULT_ATTRIBUTION_CODE} · Altana SDK v1.1.0</span>
              </footer>
            </div>
          )}

          {route === "VERIFY" && (
            <div className="mx-auto max-w-[1220px] px-4 pt-24 pb-12 sm:px-6 lg:px-8">
              <JudgeConsolePage
                runMode={runMode}
                perTxCapUsdc={perTxCapUsdc}
                totalCapUsdc={totalCapUsdc}
                onPerTxCapChange={handlePerTxCapChange}
                onTotalCapChange={handleTotalCapChange}
                dcaAmountUsdc={dcaAmountUsdc}
                onDcaAmountChange={setDcaAmountUsdc}
                spentUnits={spentUnits}
                totalCapUnits={totalCapUnits}
                remainingUnits={remainingUnits}
                revoked={revoked}
                shakeNonce={shakeNonce}
                lastResult={judgeFeedback?.result ?? null}
                lastResultSummary={judgeFeedback?.summary ?? null}
                calldataPreview={calldataPreview}
                auditEvents={auditEvents}
                isExecuting={isExecuting}
                onExecuteDca={() =>
                  executeDca(
                    dcaAmountUsdc,
                    `dca:custom-${dcaAmountUsdc}-usdc`,
                    "VERIFY",
                  )
                }
                onPresetSafeDca={() =>
                  executeDca(25, "preset:safe-auto-dca-25", "VERIFY")
                }
                onPresetMicroDca={() =>
                  executeDca(10, "preset:micro-auto-dca-10", "VERIFY")
                }
                onPresetOverCapAttack={() => {
                  const overCapAmount = perTxCapUsdc + 10;
                  void executeDca(
                    overCapAmount,
                    `attack:over-cap-${overCapAmount}-usdc`,
                    "VERIFY",
                  );
                }}
                onPresetUnlistedAttack={executeUnlistedTokenAttack}
                onRevokeSession={() => handleRevokeSession("VERIFY")}
                onResetSession={handleResetSession}
                onOpenAgentCard={() => setAgentCardOpen(true)}
                onClearAudit={() => setAuditEvents([])}
              />
              <footer className="mt-12 flex flex-wrap items-center justify-between gap-2 border-t border-[#e3e6eb] pt-5 font-numeric text-[11px] text-[#5d7166]">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span>CapRail ·</span>
                  <a
                    href={CAPRAIL_GITHUB_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-[#15171c] transition-colors hover:text-[#10372a] hover:underline"
                  >
                    <GitHubIcon className="h-3.5 w-3.5" />
                    <span>takaolovely/caprail</span>
                  </a>
                  <span>· Celo Agents Open for Business</span>
                </div>
                <span>ERC-8021 {CAPRAIL_DEFAULT_ATTRIBUTION_CODE} · Altana SDK v1.1.0</span>
              </footer>
            </div>
          )}
        </motion.div>
      </main>

      <AgentCardModal
        open={agentCardOpen}
        onClose={() => setAgentCardOpen(false)}
      />
    </div>
  );
}

export default App;
