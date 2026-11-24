import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Code2,
  ExternalLink,
  Lock,
  ShieldAlert,
} from "lucide-react";
import { CeloLogo, UniswapLogo, UsdcLogo } from "./BrandIcons.js";
import type { AppRunMode } from "./TopBar.js";
import {
  formatUsdcDisplay,
  shortenAddress,
  type CalldataPreview,
  type WalletExecutionResult,
} from "../lib/sandboxBridge.js";

const EASE_OUT_EXPO = [0.22, 1, 0.36, 1] as const;

interface GuardrailTerminalProps {
  runMode: AppRunMode;
  perTxCapUsdc: number;
  totalCapUsdc: number;
  onPerTxCapChange: (val: number) => void;
  onTotalCapChange: (val: number) => void;
  dcaAmountUsdc: number;
  onDcaAmountChange: (val: number) => void;
  spentUnits: bigint;
  totalCapUnits: bigint;
  remainingUnits: bigint;
  revoked: boolean;
  shakeNonce: number;
  lastResult: WalletExecutionResult | null;
  lastResultSummary: string | null;
  calldataPreview: CalldataPreview;
  onExecuteDca: () => void;
  onResetSession?: () => void;
  isExecuting: boolean;
}

export function GuardrailTerminal({
  runMode,
  perTxCapUsdc,
  totalCapUsdc,
  onPerTxCapChange,
  onTotalCapChange,
  dcaAmountUsdc,
  onDcaAmountChange,
  spentUnits,
  totalCapUnits,
  remainingUnits,
  revoked,
  shakeNonce,
  lastResult,
  lastResultSummary,
  calldataPreview,
  onExecuteDca,
  onResetSession,
  isExecuting,
}: GuardrailTerminalProps) {
  const [calldataOpen, setCalldataOpen] = useState(false);

  const remainingPct =
    totalCapUnits > 0n
      ? Math.max(
          0,
          Math.min(100, Number((remainingUnits * 10_000n) / totalCapUnits) / 100),
        )
      : 0;
  const usedPct = Math.max(0, Math.min(100, 100 - remainingPct));

  return (
    <motion.section
      key={`terminal-shake-${shakeNonce}`}
      animate={
        shakeNonce > 0
          ? { x: [0, -7, 7, -5, 5, -2, 2, 0] }
          : { x: 0 }
      }
      transition={{ duration: 0.38, ease: "easeInOut" }}
      className="card-surface overflow-hidden rounded-[24px]"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e3e6eb] bg-[#f2f4ef]/65 px-5 py-3.5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold tracking-[-0.02em] text-[#15171c]">
            CapRail Guardrail Terminal
          </span>
          <span
            className={`rounded-full px-2.5 py-0.5 font-numeric text-[10px] font-semibold ${
              revoked
                ? "bg-[#ffece9] text-[#a8342a]"
                : "bg-[#e4f5eb] text-[#21744e]"
            }`}
          >
            {revoked ? "REVOKED" : "SESSION ACTIVE"}
          </span>
        </div>

        <span className="font-numeric text-[11px] text-[#5d7166]">
          {runMode === "SANDBOX" ? "MODE: LOCAL_SIMULATION" : "MODE: CELO_MAINNET"}
        </span>
      </div>

      <div className="space-y-5 p-5 sm:p-6">
        {/* Remaining Allowance Bar + Ticker */}
        <div className="rounded-[16px] border border-[#e3e6eb] bg-[#f2f4ef] p-4">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs font-medium text-[#5d7166]">
              Remaining Bot Budget
            </span>
            <motion.span
              key={remainingUnits.toString()}
              initial={{ opacity: 0.55, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.32, ease: EASE_OUT_EXPO }}
              className={`font-numeric text-xl font-semibold ${
                revoked
                  ? "text-[#a8342a] line-through"
                  : remainingUnits === 0n
                    ? "text-[#a8342a]"
                    : "text-[#15171c]"
              }`}
            >
              {formatUsdcDisplay(remainingUnits)}{" "}
              <span className="text-xs font-normal text-[#5d7166]">USDC</span>
            </motion.span>
          </div>

          <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-[#e3e6eb]">
            <motion.div
              className="h-full rounded-full"
              initial={false}
              animate={{
                width: `${revoked ? 0 : remainingPct}%`,
                backgroundColor: revoked
                  ? "#ff6a5c"
                  : remainingPct < 20
                    ? "#ff6a5c"
                    : "#10372a",
              }}
              transition={{ duration: 0.45, ease: EASE_OUT_EXPO }}
            />
          </div>

          <div className="mt-2 flex items-center justify-between font-numeric text-[11px] text-[#5d7166]">
            <span>
              Spent: {formatUsdcDisplay(spentUnits)} ({usedPct.toFixed(0)}%)
            </span>
            <span>Budget Cap: {formatUsdcDisplay(totalCapUnits)}</span>
          </div>
        </div>

        {/* STEP 1 · SET BOT LIMITS */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-numeric text-[10px] font-semibold tracking-[0.06em] text-[#5d7166] uppercase">
              STEP 1 · SET BOT LIMITS
            </span>
            <span className="font-numeric text-[10px] text-[#5d7166]">
              Pre-flight + Altana KeyStore
            </span>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <label htmlFor="slider-pertx" className="font-medium text-[#5d7166]">
                  Max Per Trade
                </label>
                <span className="font-numeric font-semibold text-[#15171c]">
                  ${perTxCapUsdc.toFixed(2)} USDC
                </span>
              </div>
              <input
                id="slider-pertx"
                type="range"
                min={5}
                max={100}
                step={5}
                value={perTxCapUsdc}
                disabled={revoked}
                onChange={(e) => onPerTxCapChange(Number(e.target.value))}
                className="caprail-slider w-full"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <label htmlFor="slider-total" className="font-medium text-[#5d7166]">
                  Total Max Budget
                </label>
                <span className="font-numeric font-semibold text-[#15171c]">
                  ${totalCapUsdc.toFixed(2)} USDC
                </span>
              </div>
              <input
                id="slider-total"
                type="range"
                min={Math.max(20, perTxCapUsdc)}
                max={200}
                step={10}
                value={totalCapUsdc}
                disabled={revoked}
                onChange={(e) => onTotalCapChange(Number(e.target.value))}
                className="caprail-slider w-full"
              />
            </div>
          </div>
        </div>

        {/* STEP 2 · AUTO-DCA STRATEGY */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-numeric text-[10px] font-semibold tracking-[0.06em] text-[#5d7166] uppercase">
              STEP 2 · AUTO-DCA SWAP
            </span>
            <span className="inline-flex items-center gap-1.5 font-numeric text-[10px] text-[#5d7166]">
              <UniswapLogo size={13} />
              <span>Uniswap V3 SwapRouter02</span>
            </span>
          </div>

          <div className="space-y-3 rounded-[16px] border border-[#e3e6eb] bg-[#ffffff] p-4">
            <div className="flex items-center justify-between text-xs">
              <label
                htmlFor="slider-dca-amt"
                className="inline-flex items-center gap-1.5 font-medium text-[#15171c]"
              >
                <span>Trade Amount</span>
                <span className="inline-flex items-center gap-1 rounded-full border border-[#e3e6eb] bg-[#f2f4ef] px-2 py-0.5 font-numeric text-[10px] text-[#5d7166]">
                  <UsdcLogo size={12} />
                  <span>USDC</span>
                  <span>-&gt;</span>
                  <CeloLogo size={12} />
                  <span>CELO</span>
                </span>
              </label>
              <span className="font-numeric font-semibold text-[#15171c]">
                ${dcaAmountUsdc.toFixed(2)} USDC
              </span>
            </div>
            <input
              id="slider-dca-amt"
              type="range"
              min={5}
              max={100}
              step={5}
              value={dcaAmountUsdc}
              disabled={revoked}
              onChange={(e) => onDcaAmountChange(Number(e.target.value))}
              className="caprail-slider w-full"
            />
            <div className="flex flex-wrap items-center justify-between gap-2 font-numeric text-[11px] text-[#5d7166]">
              <span className="inline-flex items-center gap-1.5">
                <UniswapLogo size={13} />
                <span>
                  Router: SwapRouter02 ({shortenAddress(calldataPreview.targetContract)})
                </span>
              </span>
              <span>Slippage Guard: 1.00% (100 bps)</span>
            </div>
          </div>
        </div>

        {/* Execute CTA */}
        <button
          type="button"
          onClick={onExecuteDca}
          disabled={revoked || isExecuting}
          className="flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-[#10372a] px-5 text-sm font-semibold text-[#ffffff] transition-colors hover:bg-[#17483a] disabled:cursor-not-allowed disabled:bg-[#e3e6eb] disabled:text-[#5d7166]"
        >
          {revoked ? (
            <>
              <Lock className="h-4 w-4" />
              <span>Session Revoked: Execution Locked</span>
            </>
          ) : isExecuting ? (
            <span>Evaluating Guardrails &amp; Encoding Calldata…</span>
          ) : (
            <>
              <span>Execute Guarded Auto-DCA (${dcaAmountUsdc.toFixed(2)} USDC)</span>
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </button>

        {/* Verdict Banner (.chip-blur-in) */}
        {lastResult !== null && (
          <div
            key={`${lastResult.timestamp}-${lastResult.status}-${lastResult.spentTotal.toString()}`}
            className={`chip-blur-in rounded-[16px] p-4 text-xs ${
              lastResult.status === "APPROVED"
                ? "bg-[#e4f5eb] text-[#21744e]"
                : "bg-[#ffece9] text-[#a8342a]"
            }`}
          >
            <div className="flex items-start gap-2.5">
              {lastResult.status === "APPROVED" ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              ) : (
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-[#ff6a5c]" />
              )}
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-numeric font-semibold">
                    {lastResult.status}
                  </span>
                  {lastResult.reasonCode && (
                    <span className="rounded-full bg-[#ffffff]/80 px-2 py-0.5 font-numeric text-[10px] font-semibold text-[#a8342a]">
                      {lastResult.reasonCode}
                    </span>
                  )}
                  <span className="font-numeric text-[10px] opacity-80">
                    [{lastResult.mode}]
                  </span>
                </div>
                {lastResultSummary && (
                  <p className="font-medium text-[#15171c]">{lastResultSummary}</p>
                )}
                {lastResult.reason && (
                  <p className="font-numeric text-[11px] opacity-90">
                    {lastResult.reason}
                  </p>
                )}
                {runMode === "SANDBOX" &&
                  lastResult.status === "BLOCKED" &&
                  lastResult.reasonCode === "EXCEEDS_TOTAL_CAP" && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 rounded-[10px] border border-[#ff6a5c]/30 bg-[#ffffff]/80 px-2.5 py-1.5 text-[11px] text-[#15171c]">
                      <span>
                        Remaining sandbox budget is low. Click{" "}
                        <strong>Reset Sandbox</strong> to restore the $
                        {totalCapUsdc} demo allowance.
                      </span>
                      {onResetSession && (
                        <button
                          type="button"
                          onClick={onResetSession}
                          className="cursor-pointer rounded-full bg-[#10372a] px-2.5 py-0.5 font-numeric text-[10px] font-semibold text-[#ffffff] hover:bg-[#17483a]"
                        >
                          Reset Sandbox
                        </button>
                      )}
                    </div>
                  )}
                {lastResult.txHash && (
                  <div className="flex items-center gap-2 pt-0.5 font-numeric text-[11px]">
                    <span>
                      {lastResult.mode === "LOCAL_SIMULATION"
                        ? "Sim Receipt:"
                        : "Tx Hash:"}{" "}
                      {shortenAddress(lastResult.txHash)}
                    </span>
                    {lastResult.mode === "CELO_MAINNET" && (
                      <a
                        href={`https://celoscan.io/tx/${lastResult.txHash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-semibold underline"
                      >
                        Celoscan <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Collapsible Raw Calldata Inspector */}
        <div className="overflow-hidden rounded-[16px] border border-[#e3e6eb] bg-[#f2f4ef]">
          <button
            type="button"
            aria-expanded={calldataOpen}
            onClick={() => setCalldataOpen((prev) => !prev)}
            className="flex w-full cursor-pointer items-center justify-between gap-2 px-4 py-3 text-left transition-colors hover:bg-[#e6ece4]/60"
          >
            <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-[#15171c]">
              <Code2 className="h-3.5 w-3.5 shrink-0 text-[#10372a]" />
              <span className="truncate">
                Inspect Raw Calldata (ERC-8021 Verified) ·{" "}
                <span className="font-numeric text-[11px] text-[#5d7166]">
                  {calldataPreview.functionLabel}
                </span>
              </span>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <span className="inline-flex items-center rounded-full bg-[#e4f5eb] px-2.5 py-0.5 font-numeric text-[10px] font-semibold text-[#21744e]">
                {calldataPreview.decodedVerified
                  ? `✓ ${calldataPreview.attributionCode}`
                  : "unverified"}
              </span>
              <ChevronDown
                className={`h-4 w-4 text-[#5d7166] transition-transform duration-200 ${
                  calldataOpen ? "rotate-180" : ""
                }`}
              />
            </div>
          </button>

          <AnimatePresence initial={false}>
            {calldataOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
                className="overflow-hidden"
              >
                <div className="space-y-3 border-t border-[#e3e6eb] px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-1 font-numeric text-[11px] text-[#5d7166]">
                    <span className="font-semibold text-[#15171c]">
                      {calldataPreview.functionLabel}
                    </span>
                    <span>selector {calldataPreview.selector}</span>
                  </div>

                  <div className="space-y-2.5">
                    {calldataPreview.calls.map((call) => (
                      <div
                        key={call.id}
                        className="space-y-1.5 rounded-[12px] border border-[#e3e6eb] bg-[#ffffff] p-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-1.5 font-numeric text-[10.5px]">
                          <span className="font-semibold text-[#15171c]">
                            {call.label}
                          </span>
                          <span className="text-[#5d7166]">{call.sublabel}</span>
                        </div>

                        <div className="overflow-x-auto rounded-[8px] border border-[#e3e6eb] bg-[#f8faf7] p-2.5 font-numeric text-[11px] leading-relaxed break-all text-[#5d7166]">
                          <span className="font-semibold text-[#15171c]">
                            {call.rawData.slice(0, 10)}
                          </span>
                          <span>{call.rawData.slice(10)}</span>
                          <span
                            title={`ERC-8021 attribution suffix (${call.attributionCode})`}
                            className="ml-0.5 rounded bg-[#e4f5eb] px-1 py-0.5 font-semibold text-[#21744e]"
                          >
                            {call.suffixHex.slice(2)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {runMode === "SANDBOX" && (
                    <p className="flex items-center gap-1.5 text-[11px] text-[#5d7166]">
                      <AlertTriangle className="h-3 w-3 shrink-0" />
                      <span>
                        Sandbox verifies policy &amp; ERC-8021 calldata locally (zero gas).
                        Live Celo Mainnet receipts are verified in Step 03 below.
                      </span>
                    </p>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.section>
  );
}
