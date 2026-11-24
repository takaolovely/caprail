import { useEffect, useState } from "react";
import { motion } from "motion/react";
import {
  ArrowDown,
  CheckCircle2,
  ExternalLink,
  Lock,
  Power,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import { CeloLogo, UniswapLogo, UsdcLogo } from "./BrandIcons.js";
import type { AppRunMode } from "./TopBar.js";
import {
  DcaPositionPanel,
  type ActiveDcaPosition,
  type DcaFrequency,
} from "./DcaPositionPanel.js";
import {
  formatUsdcDisplay,
  type AuditEvent,
  type WalletExecutionResult,
} from "../lib/sandboxBridge.js";

const SPRING_PILL = { type: "spring", stiffness: 400, damping: 32 } as const;
const INDICATIVE_CELO_PRICE_USD = 0.72;
const UNISWAP_CELO_USDC_URL =
  "https://app.uniswap.org/swap?chain=celo&inputCurrency=NATIVE&outputCurrency=0xcebA9300f2b948710d2653dD7B07f33A8B32118C";

interface UserAppPageProps {
  runMode: AppRunMode;
  perTxCapUsdc: number;
  totalCapUsdc: number;
  onApplyCustomCaps: (perTxUsdc: number, totalUsdc: number) => void;
  spentUnits: bigint;
  totalCapUnits: bigint;
  remainingUnits: bigint;
  revoked: boolean;
  isExecuting: boolean;
  lastResult: WalletExecutionResult | null;
  lastResultSummary: string | null;
  auditEvents: readonly AuditEvent[];
  dcaPosition: ActiveDcaPosition | null;
  onStartAutoDca: (opts: {
    totalAllocateUsdc: number;
    perOrderUsdc: number;
    ordersCount: number;
    frequency: DcaFrequency;
    customPerTxCapUsdc?: number;
    customTotalCapUsdc?: number;
  }) => void;
  onSimulateNextDcaFill: () => void;
  onRevokeSession: () => void;
  onResetSession: () => void;
}

export function UserAppPage({
  runMode,
  perTxCapUsdc,
  totalCapUsdc,
  onApplyCustomCaps,
  spentUnits,
  totalCapUnits,
  remainingUnits,
  revoked,
  isExecuting,
  lastResult,
  lastResultSummary,
  auditEvents,
  dcaPosition,
  onStartAutoDca,
  onSimulateNextDcaFill,
  onRevokeSession,
  onResetSession,
}: UserAppPageProps) {
  const [dcaAllocateStr, setDcaAllocateStr] = useState<string>("25.00");
  const [frequency, setFrequency] = useState<DcaFrequency>("Daily");
  const [ordersCount, setOrdersCount] = useState<number>(5);
  const [customizeCapOpen, setCustomizeCapOpen] = useState<boolean>(false);
  const [customPerTx, setCustomPerTx] = useState<string>(perTxCapUsdc.toFixed(2));
  const [customTotal, setCustomTotal] = useState<string>(totalCapUsdc.toFixed(2));

  useEffect(() => {
    setCustomPerTx(perTxCapUsdc.toFixed(2));
    setCustomTotal(totalCapUsdc.toFixed(2));
  }, [perTxCapUsdc, totalCapUsdc]);

  const dcaAllocateNum = Math.max(0, Number.parseFloat(dcaAllocateStr) || 0);
  const perOrderUsdc = ordersCount > 0 ? dcaAllocateNum / ordersCount : dcaAllocateNum;
  const estCeloTotal = dcaAllocateNum / INDICATIVE_CELO_PRICE_USD;

  function handleSubmitDca() {
    if (dcaAllocateNum <= 0) return;
    if (customizeCapOpen) {
      const p = Math.max(1, Number.parseFloat(customPerTx) || perOrderUsdc);
      const t = Math.max(p, Number.parseFloat(customTotal) || dcaAllocateNum);
      onApplyCustomCaps(p, t);
      onStartAutoDca({
        totalAllocateUsdc: dcaAllocateNum,
        perOrderUsdc,
        ordersCount,
        frequency,
        customPerTxCapUsdc: p,
        customTotalCapUsdc: t,
      });
    } else {
      onStartAutoDca({
        totalAllocateUsdc: dcaAllocateNum,
        perOrderUsdc,
        ordersCount,
        frequency,
      });
    }
  }

  const remainingPct =
    totalCapUnits > 0n
      ? Math.max(
          0,
          Math.min(100, Number((remainingUnits * 10_000n) / totalCapUnits) / 100),
        )
      : 0;

  const recentHumanEvents = [...auditEvents].reverse().slice(0, 3);

  return (
    <div className="ondrel-grid-backdrop relative border-x border-[#e3e6eb] py-6 sm:py-10">
      <div className="mx-auto max-w-[500px] space-y-5 px-3 sm:px-0">
        {/* Clean Header */}
        <div className="flex items-center justify-between px-1">
          <div>
            <h1 className="text-2xl font-medium tracking-[-0.03em] text-[#15171c]">
              CapRail Auto-DCA
            </h1>
            <p className="mt-1 text-xs text-[#5d7166]">
              Scheduled USDC to CELO swaps on Uniswap V3 with hard spend caps
            </p>
          </div>
          <span className="rounded-full bg-[#e6ece4] px-3 py-1 font-numeric text-[11px] font-medium text-[#10372a]">
            {runMode === "SANDBOX" ? "Sandbox · No Gas" : "Celo Mainnet"}
          </span>
        </div>

        {/* Main Auto-DCA Widget Shell */}
        <section className="card-surface overflow-hidden rounded-[24px] p-5 sm:p-6">
          <div className="space-y-3.5">
            {/* Box 1: You Pay / Allocate */}
            <div className="rounded-[16px] border border-[#e3e6eb] bg-[#f2f4ef] p-4">
              <div className="flex items-center justify-between text-xs text-[#5d7166]">
                <label htmlFor="user-dca-input" className="font-medium">
                  You Pay / Allocate
                </label>
                <div className="flex items-center gap-1">
                  {[10, 25, 50, 100].map((preset) => {
                    const selected = Math.abs(dcaAllocateNum - preset) < 0.01;
                    return (
                      <motion.button
                        key={preset}
                        type="button"
                        whileTap={{ scale: 0.94 }}
                        transition={SPRING_PILL}
                        disabled={revoked}
                        onClick={() => setDcaAllocateStr(preset.toFixed(2))}
                        className={`relative cursor-pointer rounded-full border px-2.5 py-0.5 font-numeric text-[11px] font-medium transition-colors disabled:opacity-45 ${
                          selected
                            ? "border-[#10372a] bg-[#10372a] text-[#ffffff]"
                            : "border-[#e3e6eb] bg-[#ffffff] text-[#5d7166] hover:text-[#15171c]"
                        }`}
                      >
                        ${preset}
                      </motion.button>
                    );
                  })}
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between gap-3">
                <input
                  id="user-dca-input"
                  type="number"
                  min={1}
                  step="any"
                  disabled={revoked}
                  value={dcaAllocateStr}
                  onChange={(e) => setDcaAllocateStr(e.target.value)}
                  className="w-full bg-transparent font-numeric text-3xl font-semibold text-[#15171c] outline-none placeholder:text-[#5d7166]/40 disabled:opacity-50"
                  placeholder="0.00"
                />
                <div className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[#e3e6eb] bg-[#ffffff] px-2.5 py-1.5 text-xs font-semibold text-[#15171c]">
                  <UsdcLogo size={18} />
                  <span>USDC</span>
                </div>
              </div>

              <div className="mt-2.5 flex justify-end">
                <a
                  href={UNISWAP_CELO_USDC_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-full border border-[#e3e6eb] bg-[#ffffff] px-2.5 py-0.5 text-[11px] font-medium text-[#5d7166] transition-colors hover:border-[#10372a] hover:text-[#10372a]"
                >
                  <span>Need USDC? Swap CELO ↗</span>
                </a>
              </div>
            </div>

            {/* Direction Connector with Official Uniswap V3 & Celo Icons */}
            <div className="flex items-center justify-center gap-2 py-0.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-full border border-[#e3e6eb] bg-[#ffffff] text-[#10372a]">
                <ArrowDown className="h-3.5 w-3.5" />
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#e3e6eb] bg-[#ffffff] px-2.5 py-1 font-numeric text-[11px] text-[#5d7166]">
                <UniswapLogo size={14} />
                <span>via Uniswap V3</span>
                <span className="opacity-45">·</span>
                <CeloLogo size={13} />
                <span>Celo</span>
              </span>
            </div>

            {/* Box 2: To Receive with Smooth Animated CELO Estimate */}
            <div className="rounded-[16px] border border-[#e3e6eb] bg-[#f2f4ef] p-4">
              <div className="flex items-center justify-between text-xs text-[#5d7166]">
                <span className="font-medium">To Receive (Estimated)</span>
                <span className="font-numeric text-[11px]">
                  ~${INDICATIVE_CELO_PRICE_USD.toFixed(2)} / CELO
                </span>
              </div>

              <div className="mt-2.5 flex items-center justify-between gap-3">
                <motion.span
                  key={estCeloTotal.toFixed(2)}
                  initial={{ opacity: 0.45, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={SPRING_PILL}
                  className="font-numeric text-2xl font-semibold text-[#15171c]"
                >
                  {estCeloTotal.toFixed(2)}
                </motion.span>
                <div className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[#e3e6eb] bg-[#ffffff] px-2.5 py-1.5 text-xs font-semibold text-[#15171c]">
                  <CeloLogo size={18} />
                  <span>CELO</span>
                </div>
              </div>
            </div>

            {/* Spring Frequency & Order Count Pills */}
            <div className="grid grid-cols-2 gap-3 pt-1">
              <div className="space-y-1.5">
                <span className="text-[11px] font-medium text-[#5d7166]">
                  Frequency
                </span>
                <div className="relative grid grid-cols-3 gap-0.5 rounded-full border border-[#e3e6eb] bg-[#f2f4ef] p-0.5">
                  {(["Hourly", "Daily", "Weekly"] as const).map((freq) => {
                    const active = frequency === freq;
                    return (
                      <button
                        key={freq}
                        type="button"
                        disabled={revoked}
                        onClick={() => setFrequency(freq)}
                        className={`relative z-10 cursor-pointer rounded-full py-1.5 text-[11px] font-medium transition-colors disabled:opacity-45 ${
                          active
                            ? "text-[#15171c]"
                            : "text-[#5d7166] hover:text-[#15171c]"
                        }`}
                      >
                        {active && (
                          <motion.span
                            layoutId="user-freq-pill"
                            transition={SPRING_PILL}
                            className="absolute inset-0 -z-10 rounded-full bg-[#ffffff] shadow-[0_1px_2px_rgba(21,23,28,0.08)]"
                          />
                        )}
                        {freq}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-1.5">
                <span className="text-[11px] font-medium text-[#5d7166]">
                  Orders
                </span>
                <div className="relative grid grid-cols-3 gap-0.5 rounded-full border border-[#e3e6eb] bg-[#f2f4ef] p-0.5">
                  {[2, 5, 10].map((count) => {
                    const active = ordersCount === count;
                    return (
                      <button
                        key={count}
                        type="button"
                        disabled={revoked}
                        onClick={() => setOrdersCount(count)}
                        className={`relative z-10 cursor-pointer rounded-full py-1.5 font-numeric text-[11px] font-medium transition-colors disabled:opacity-45 ${
                          active
                            ? "text-[#15171c]"
                            : "text-[#5d7166] hover:text-[#15171c]"
                        }`}
                      >
                        {active && (
                          <motion.span
                            layoutId="user-orders-pill"
                            transition={SPRING_PILL}
                            className="absolute inset-0 -z-10 rounded-full bg-[#ffffff] shadow-[0_1px_2px_rgba(21,23,28,0.08)]"
                          />
                        )}
                        {count}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Auto-Derived Guardrail Box */}
            <div className="rounded-[16px] border border-[#d6dfd3] bg-[#e6ece4]/60 p-3.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 font-semibold text-[#10372a]">
                  <ShieldCheck className="h-3.5 w-3.5 text-[#21744e]" />
                  <span>Auto-Derived Guardrail</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setCustomPerTx(perOrderUsdc.toFixed(2));
                    setCustomTotal(dcaAllocateNum.toFixed(2));
                    setCustomizeCapOpen((v) => !v);
                  }}
                  className="inline-flex cursor-pointer items-center gap-1 text-[11px] font-medium text-[#10372a] hover:underline"
                >
                  <SlidersHorizontal className="h-3 w-3" />
                  <span>{customizeCapOpen ? "Use auto cap" : "Customize cap"}</span>
                </button>
              </div>

              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 font-numeric text-[11px] text-[#5d7166]">
                <span>
                  Per Order:{" "}
                  <strong className="text-[#15171c]">
                    ${perOrderUsdc.toFixed(2)} USDC
                  </strong>
                </span>
                <span>
                  Hard Cap:{" "}
                  <strong className="text-[#15171c]">
                    Max $
                    {(customizeCapOpen
                      ? Number.parseFloat(customPerTx) || 0
                      : perOrderUsdc
                    ).toFixed(2)}
                  </strong>{" "}
                  / tx ·{" "}
                  <strong className="text-[#15171c]">
                    $
                    {(customizeCapOpen
                      ? Number.parseFloat(customTotal) || 0
                      : dcaAllocateNum
                    ).toFixed(2)}
                  </strong>{" "}
                  total budget
                </span>
              </div>

              {customizeCapOpen && (
                <div className="mt-3 grid grid-cols-2 gap-2.5 border-t border-[#d6dfd3] pt-3">
                  <label className="space-y-1 text-[11px] text-[#5d7166]">
                    <span>Max Per Trade (USDC)</span>
                    <input
                      type="number"
                      min={1}
                      step="any"
                      value={customPerTx}
                      onChange={(e) => setCustomPerTx(e.target.value)}
                      className="w-full rounded-[8px] border border-[#e3e6eb] bg-[#ffffff] px-2.5 py-1.5 font-numeric text-xs text-[#15171c] outline-none focus:border-[#10372a]"
                    />
                  </label>
                  <label className="space-y-1 text-[11px] text-[#5d7166]">
                    <span>Total Budget (USDC)</span>
                    <input
                      type="number"
                      min={1}
                      step="any"
                      value={customTotal}
                      onChange={(e) => setCustomTotal(e.target.value)}
                      className="w-full rounded-[8px] border border-[#e3e6eb] bg-[#ffffff] px-2.5 py-1.5 font-numeric text-xs text-[#15171c] outline-none focus:border-[#10372a]"
                    />
                  </label>
                </div>
              )}
            </div>

            {/* 52px Full-Width Primary CTA */}
            <motion.button
              type="button"
              whileTap={{ scale: 0.985 }}
              transition={SPRING_PILL}
              disabled={revoked || isExecuting || dcaAllocateNum <= 0}
              onClick={handleSubmitDca}
              className="flex h-[52px] w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-[#10372a] px-5 text-sm font-semibold text-[#ffffff] transition-colors hover:bg-[#17483a] disabled:cursor-not-allowed disabled:bg-[#e3e6eb] disabled:text-[#5d7166]"
            >
              {revoked ? (
                <>
                  <Lock className="h-4 w-4" />
                  <span>Session Revoked: Reset to Continue</span>
                </>
              ) : isExecuting ? (
                <span>Executing Guarded Order…</span>
              ) : (
                <span>Start Auto-DCA (${dcaAllocateNum.toFixed(2)} USDC)</span>
              )}
            </motion.button>
          </div>

          {/* Smooth .chip-blur-in Receipt Notification */}
          {lastResult !== null && (
            <div
              key={`${lastResult.timestamp}-${lastResult.status}-${lastResult.spentTotal.toString()}`}
              className={`chip-blur-in mt-4 flex items-start gap-2.5 rounded-[16px] p-3.5 text-xs ${
                lastResult.status === "APPROVED"
                  ? "bg-[#e4f5eb] text-[#21744e]"
                  : "bg-[#ffece9] text-[#a8342a]"
              }`}
            >
              {lastResult.status === "APPROVED" ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              ) : (
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-[#ff6a5c]" />
              )}
              <div className="min-w-0 space-y-0.5">
                <p className="font-semibold">
                  {lastResultSummary ??
                    (lastResult.status === "APPROVED"
                      ? "Transaction approved within your session budget."
                      : "Blocked by CapRail spending guardrail.")}
                </p>
                {lastResult.status === "BLOCKED" && lastResult.reason && (
                  <p className="text-[11px] opacity-85">{lastResult.reason}</p>
                )}
                {runMode === "SANDBOX" &&
                  lastResult.status === "BLOCKED" &&
                  lastResult.reasonCode === "EXCEEDS_TOTAL_CAP" && (
                    <p className="pt-1 text-[11px] font-medium text-[#15171c]">
                      Remaining sandbox budget is low. Click{" "}
                      <strong>Reset Demo Session</strong> below to restore the $
                      {totalCapUsdc} demo allowance.
                    </p>
                  )}
                {lastResult.txHash && lastResult.mode === "CELO_MAINNET" && (
                  <a
                    href={`https://celoscan.io/tx/${lastResult.txHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-numeric text-[11px] font-semibold underline"
                  >
                    View on Celoscan <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </div>
          )}
        </section>

        {/* Active DCA Position & Mini Performance Chart (appears once DCA is started) */}
        {dcaPosition !== null && (
          <DcaPositionPanel
            position={dcaPosition}
            runMode={runMode}
            revoked={revoked}
            isExecuting={isExecuting}
            onSimulateNextFill={onSimulateNextDcaFill}
          />
        )}

        {/* Bottom Card: Active Agent Session */}
        <section className="card-surface rounded-[24px] p-5 sm:p-6">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-[#15171c]">
              Active Agent Session
            </h2>
            <span
              className={`rounded-full px-2.5 py-0.5 font-numeric text-[10px] font-semibold ${
                revoked
                  ? "bg-[#ffece9] text-[#a8342a]"
                  : "bg-[#e4f5eb] text-[#21744e]"
              }`}
            >
              {revoked ? "REVOKED" : "ACTIVE"}
            </span>
          </div>

          <div className="mt-4">
            <div className="flex items-baseline justify-between text-xs">
              <span className="text-[#5d7166]">Remaining Budget</span>
              <motion.span
                key={remainingUnits.toString()}
                initial={{ opacity: 0.55, y: -3 }}
                animate={{ opacity: 1, y: 0 }}
                transition={SPRING_PILL}
                className="font-numeric font-semibold text-[#15171c]"
              >
                {formatUsdcDisplay(remainingUnits)}{" "}
                <span className="font-normal text-[#5d7166]">
                  / {formatUsdcDisplay(totalCapUnits)}
                </span>
              </motion.span>
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[#e3e6eb]">
              <motion.div
                className="h-full rounded-full"
                initial={false}
                animate={{
                  width: `${revoked ? 0 : remainingPct}%`,
                  backgroundColor: revoked ? "#ff6a5c" : "#10372a",
                }}
                transition={SPRING_PILL}
              />
            </div>
            <div className="mt-1.5 flex justify-between font-numeric text-[11px] text-[#5d7166]">
              <span>Spent: {formatUsdcDisplay(spentUnits)}</span>
              <span>Max / trade: ${perTxCapUsdc.toFixed(2)}</span>
            </div>
          </div>

          <div className="mt-4 border-t border-[#e3e6eb] pt-3.5">
            <p className="text-[11px] font-medium text-[#5d7166]">Recent Activity</p>
            {recentHumanEvents.length === 0 ? (
              <p className="mt-2 text-xs text-[#5d7166]">
                No activity yet. Start an Auto-DCA order above.
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {recentHumanEvents.map((ev, i) => {
                  const amt = BigInt(ev.totalAmount);
                  const label =
                    ev.engine === "AUTO_DCA"
                      ? "Auto-DCA Swap"
                      : "Session Key Revoked";
                  return (
                    <li
                      key={`${ev.timestamp}-${i}`}
                      className="flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${
                            ev.status === "APPROVED"
                              ? "bg-[#21744e]"
                              : "bg-[#ff6a5c]"
                          }`}
                        />
                        <span className="truncate font-medium text-[#15171c]">
                          {label}
                        </span>
                      </div>
                      <div className="flex shrink-0 items-center gap-2 font-numeric text-[11px]">
                        <span className="text-[#15171c]">
                          {amt > 0n ? formatUsdcDisplay(amt) : "-"}
                        </span>
                        <span
                          className={
                            ev.status === "APPROVED"
                              ? "text-[#21744e]"
                              : "text-[#a8342a]"
                          }
                        >
                          {ev.status === "APPROVED" ? "Done" : ev.status}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="mt-4 flex items-center gap-2.5 border-t border-[#e3e6eb] pt-4">
            <motion.button
              type="button"
              whileTap={{ scale: 0.97 }}
              transition={SPRING_PILL}
              disabled={revoked}
              onClick={onRevokeSession}
              className="inline-flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-full bg-[#a8342a] px-4 py-2.5 text-xs font-semibold text-[#ffffff] transition-colors hover:bg-[#8d2a22] disabled:cursor-not-allowed disabled:bg-[#e3e6eb] disabled:text-[#5d7166]"
            >
              <Power className="h-3.5 w-3.5" />
              <span>{revoked ? "Key Revoked" : "Emergency Stop (Revoke Key)"}</span>
            </motion.button>

            {runMode === "SANDBOX" && (
              <motion.button
                type="button"
                whileTap={{ scale: 0.97 }}
                transition={SPRING_PILL}
                onClick={onResetSession}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-[#e3e6eb] bg-[#ffffff] px-3.5 py-2.5 text-xs font-medium text-[#15171c] transition-colors hover:bg-[#e6ece4]"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Reset Demo Session</span>
              </motion.button>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
