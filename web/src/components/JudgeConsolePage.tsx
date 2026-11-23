import { useEffect, useState } from "react";
import { motion } from "motion/react";
import {
  ArrowDownRight,
  CheckCircle2,
  GitFork,
  Lock,
  Power,
  RotateCcw,
  ShieldAlert,
  ShieldX,
} from "lucide-react";
import { AuditTrail } from "./AuditTrail.js";
import { CeloLogo, UsdcLogo } from "./BrandIcons.js";
import {
  GuardrailTerminal,
  type TerminalTab,
} from "./GuardrailTerminal.js";
import type { AppRunMode } from "./TopBar.js";
import { VerifiedReceiptCard } from "./VerifiedReceiptCard.js";
import type {
  AuditEvent,
  CalldataPreview,
  SplitRecipient,
  WalletExecutionResult,
} from "../lib/sandboxBridge.js";

const EASE_OUT_EXPO = [0.22, 1, 0.36, 1] as const;

type JudgeStepId = "safe-flows" | "attack-sim" | "mainnet-proof" | "revoke-test";

interface JudgeConsolePageProps {
  runMode: AppRunMode;
  activeTab: TerminalTab;
  onTabChange: (tab: TerminalTab) => void;
  perTxCapUsdc: number;
  totalCapUsdc: number;
  onPerTxCapChange: (val: number) => void;
  onTotalCapChange: (val: number) => void;
  dcaAmountUsdc: number;
  onDcaAmountChange: (val: number) => void;
  splitAmountUsdc: number;
  onSplitAmountChange: (val: number) => void;
  recipients: readonly SplitRecipient[];
  onRecipientBpsChange: (index: number, nextBps: number) => void;
  spentUnits: bigint;
  totalCapUnits: bigint;
  remainingUnits: bigint;
  revoked: boolean;
  shakeNonce: number;
  lastResult: WalletExecutionResult | null;
  lastResultSummary: string | null;
  calldataPreview: CalldataPreview;
  auditEvents: readonly AuditEvent[];
  isExecuting: boolean;
  onExecuteActiveTab: () => void;
  onPresetSafeDca: () => void;
  onPresetSafeSplit: () => void;
  onPresetOverCapAttack: () => void;
  onPresetUnlistedAttack: () => void;
  onRevokeSession: () => void;
  onResetSession: () => void;
  onOpenAgentCard: () => void;
  onClearAudit: () => void;
}

export function JudgeConsolePage({
  runMode,
  activeTab,
  onTabChange,
  perTxCapUsdc,
  totalCapUsdc,
  onPerTxCapChange,
  onTotalCapChange,
  dcaAmountUsdc,
  onDcaAmountChange,
  splitAmountUsdc,
  onSplitAmountChange,
  recipients,
  onRecipientBpsChange,
  spentUnits,
  totalCapUnits,
  remainingUnits,
  revoked,
  shakeNonce,
  lastResult,
  lastResultSummary,
  calldataPreview,
  auditEvents,
  isExecuting,
  onExecuteActiveTab,
  onPresetSafeDca,
  onPresetSafeSplit,
  onPresetOverCapAttack,
  onPresetUnlistedAttack,
  onRevokeSession,
  onResetSession,
  onOpenAgentCard,
  onClearAudit,
}: JudgeConsolePageProps) {
  const [activeStep, setActiveStep] = useState<JudgeStepId>("safe-flows");

  const hasSafeRun = auditEvents.some((e) => e.status === "APPROVED");
  const hasBlockedAttack = auditEvents.some(
    (e) =>
      e.status === "BLOCKED" &&
      (e.reasonCode === "EXCEEDS_PER_TX_CAP" ||
        e.reasonCode === "EXCEEDS_TOTAL_CAP" ||
        e.reasonCode === "TARGET_NOT_ALLOWLISTED" ||
        e.reasonCode === "TOKEN_MISMATCH"),
  );
  const hasRevoked = revoked || auditEvents.some((e) => e.status === "REVOKED");
  const overCapAmount = perTxCapUsdc + 10;

  const walkthroughSteps: readonly {
    id: JudgeStepId;
    num: string;
    title: string;
    desc: string;
    done: boolean;
  }[] = [
    {
      id: "safe-flows",
      num: "01",
      title: "Run Safe Flows",
      desc: "Execute Auto-DCA or 3-Way Split within configured USDC caps.",
      done: hasSafeRun,
    },
    {
      id: "attack-sim",
      num: "02",
      title: "Trigger Attack Simulation",
      desc: `Test Over-Cap ($${overCapAmount} > $${perTxCapUsdc}) and Unlisted USD₮ deterministic blocks.`,
      done: hasBlockedAttack,
    },
    {
      id: "mainnet-proof",
      num: "03",
      title: "Inspect ERC-8021 & Mainnet",
      desc: "Verify celo_0518175d3efe calldata & 3 live Celoscan receipts.",
      done: true,
    },
    {
      id: "revoke-test",
      num: "04",
      title: "Test 1-Tx Revoke",
      desc: "Activate Kill-Switch & verify SESSION_REVOKED lock + Audit JSON.",
      done: hasRevoked,
    },
  ];

  // Smooth scroll-synced highlight for Sticky Left Walkthrough Index
  useEffect(() => {
    const ids: JudgeStepId[] = [
      "safe-flows",
      "attack-sim",
      "mainnet-proof",
      "revoke-test",
    ];
    function handleScrollSync() {
      const offset = 180;
      let current: JudgeStepId = "safe-flows";
      for (const id of ids) {
        const el = document.getElementById(`judge-${id}`);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (rect.top <= offset) {
          current = id;
        }
      }
      setActiveStep(current);
    }

    handleScrollSync();
    window.addEventListener("scroll", handleScrollSync, { passive: true });
    return () => window.removeEventListener("scroll", handleScrollSync);
  }, []);

  function jumpToStep(id: JudgeStepId) {
    setActiveStep(id);
    const el = document.getElementById(`judge-${id}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-[#e3e6eb] pb-6">
        <div className="space-y-2.5">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-[#e6ece4] px-2.5 py-0.5 font-numeric text-[11px] font-semibold text-[#10372a]">
              VERIFY
            </span>
            <span className="font-numeric text-xs uppercase tracking-[0.05em] text-[#5d7166]">
              Judge &amp; Mainnet Proof Console
            </span>
          </div>
          <h1 className="text-3xl font-medium tracking-[-0.04em] sm:text-4xl">
            <span className="text-[#15171c]">Audit every guardrail in 60 seconds.</span>{" "}
            <span className="text-[#5d7166]">
              Live attack tests, ERC-8021 hex &amp; stamped Celoscan receipts.
            </span>
          </h1>
        </div>

        <span className="rounded-full bg-[#e6ece4] px-3.5 py-1.5 font-numeric text-xs font-medium text-[#10372a]">
          {runMode === "SANDBOX"
            ? "Sandbox · Zero Gas"
            : "Live Celo Wallet Mode"}
        </span>
      </header>

      {/* Ondrel Sticky Left Walkthrough Index + Right Interactive Stream */}
      <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[260px_1fr]">
        <aside className="lg:sticky lg:top-24">
          <div className="card-surface rounded-[16px] p-4">
            <p className="mb-3 px-2 font-numeric text-[10px] font-semibold tracking-[0.06em] text-[#5d7166] uppercase">
              Judge Walkthrough
            </p>
            <nav aria-label="Judge verification steps" className="space-y-1">
              {walkthroughSteps.map((step) => {
                const isActive = activeStep === step.id;
                return (
                  <button
                    key={step.id}
                    type="button"
                    onClick={() => jumpToStep(step.id)}
                    className={`relative flex w-full cursor-pointer items-start gap-3 rounded-[10px] px-3 py-2.5 text-left transition-colors ${
                      isActive
                        ? "bg-[#f2f4ef] text-[#15171c]"
                        : "text-[#5d7166] hover:bg-[#f2f4ef]/60 hover:text-[#15171c]"
                    }`}
                  >
                    {isActive && (
                      <motion.span
                        layoutId="ondrel-sticky-accent-bar"
                        transition={{ duration: 0.34, ease: EASE_OUT_EXPO }}
                        className="absolute top-2 bottom-2 left-0 w-[3px] rounded-full bg-[#10372a]"
                      />
                    )}
                    <span
                      className={`mt-0.5 font-numeric text-[11px] font-semibold ${
                        isActive ? "text-[#10372a]" : "text-[#5d7166]"
                      }`}
                    >
                      {step.num}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1.5">
                        <span className="text-xs font-semibold">{step.title}</span>
                        {step.done && (
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#21744e]" />
                        )}
                      </div>
                      <p className="mt-0.5 text-[11px] leading-snug text-[#5d7166]">
                        {step.desc}
                      </p>
                    </div>
                  </button>
                );
              })}
            </nav>
          </div>
        </aside>

        <div className="space-y-8">
          {/* Steps 01 & 02: Presets + GuardrailTerminal */}
          <section id="judge-safe-flows" className="scroll-mt-28 space-y-5">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="card-surface space-y-2.5 rounded-[16px] p-4">
                <div className="flex items-center justify-between">
                  <span className="font-numeric text-[10px] font-semibold uppercase tracking-[0.05em] text-[#21744e]">
                    01 · Safe Flows (Should Pass)
                  </span>
                  <span className="rounded-full bg-[#e4f5eb] px-2 py-0.5 font-numeric text-[10px] font-semibold text-[#21744e]">
                    PASS
                  </span>
                </div>

                <button
                  type="button"
                  disabled={isExecuting}
                  onClick={() => {
                    setActiveStep("safe-flows");
                    onPresetSafeDca();
                  }}
                  className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-[10px] border border-[#e3e6eb] bg-[#ffffff] px-3.5 py-2.5 text-left transition-colors hover:border-[#10372a] disabled:opacity-60"
                >
                  <span className="flex items-center gap-2 text-xs font-semibold text-[#15171c]">
                    <ArrowDownRight className="h-4 w-4 text-[#21744e]" />
                    <span>Safe Auto-DCA ($25 USDC → CELO)</span>
                  </span>
                  <span className="flex shrink-0 items-center -space-x-1">
                    <UsdcLogo size={16} className="ring-1 ring-[#ffffff]" />
                    <CeloLogo size={16} className="ring-1 ring-[#ffffff]" />
                  </span>
                </button>

                <button
                  type="button"
                  disabled={isExecuting}
                  onClick={() => {
                    setActiveStep("safe-flows");
                    onPresetSafeSplit();
                  }}
                  className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-[10px] border border-[#e3e6eb] bg-[#ffffff] px-3.5 py-2.5 text-left transition-colors hover:border-[#10372a] disabled:opacity-60"
                >
                  <span className="flex items-center gap-2 text-xs font-semibold text-[#15171c]">
                    <GitFork className="h-4 w-4 text-[#10372a]" />
                    <span>3-Way Revenue Split ($40 USDC)</span>
                  </span>
                  <UsdcLogo size={16} />
                </button>
              </div>

              <div
                id="judge-attack-sim"
                className="card-surface scroll-mt-28 space-y-2.5 rounded-[16px] p-4"
              >
                <div className="flex items-center justify-between">
                  <span className="font-numeric text-[10px] font-semibold uppercase tracking-[0.05em] text-[#a8342a]">
                    02 · Attack Simulator (Should Block)
                  </span>
                  <span className="rounded-full bg-[#ffece9] px-2 py-0.5 font-numeric text-[10px] font-semibold text-[#a8342a]">
                    BLOCK
                  </span>
                </div>

                <button
                  type="button"
                  disabled={isExecuting}
                  onClick={() => {
                    setActiveStep("attack-sim");
                    onPresetOverCapAttack();
                  }}
                  className="flex w-full cursor-pointer items-center justify-between rounded-[10px] border border-[#e3e6eb] bg-[#ffffff] px-3.5 py-2.5 text-left transition-colors hover:border-[#ff6a5c] disabled:opacity-60"
                >
                  <span className="flex items-center gap-2 text-xs font-semibold text-[#15171c]">
                    <ShieldAlert className="h-4 w-4 text-[#ff6a5c]" />
                    Over-Cap Attack (${overCapAmount} &gt; ${perTxCapUsdc} limit)
                  </span>
                </button>

                <button
                  type="button"
                  disabled={isExecuting}
                  onClick={() => {
                    setActiveStep("attack-sim");
                    onPresetUnlistedAttack();
                  }}
                  className="flex w-full cursor-pointer items-center justify-between rounded-[10px] border border-[#e3e6eb] bg-[#ffffff] px-3.5 py-2.5 text-left transition-colors hover:border-[#ff6a5c] disabled:opacity-60"
                >
                  <span className="flex items-center gap-2 text-xs font-semibold text-[#15171c]">
                    <ShieldX className="h-4 w-4 text-[#ff6a5c]" />
                    Unlisted Token Attack (USD₮)
                  </span>
                </button>
              </div>
            </div>

            <GuardrailTerminal
              runMode={runMode}
              activeTab={activeTab}
              onTabChange={onTabChange}
              perTxCapUsdc={perTxCapUsdc}
              totalCapUsdc={totalCapUsdc}
              onPerTxCapChange={onPerTxCapChange}
              onTotalCapChange={onTotalCapChange}
              dcaAmountUsdc={dcaAmountUsdc}
              onDcaAmountChange={onDcaAmountChange}
              splitAmountUsdc={splitAmountUsdc}
              onSplitAmountChange={onSplitAmountChange}
              recipients={recipients}
              onRecipientBpsChange={onRecipientBpsChange}
              spentUnits={spentUnits}
              totalCapUnits={totalCapUnits}
              remainingUnits={remainingUnits}
              revoked={revoked}
              shakeNonce={shakeNonce}
              lastResult={lastResult}
              lastResultSummary={lastResultSummary}
              calldataPreview={calldataPreview}
              onExecuteActiveTab={onExecuteActiveTab}
              onResetSession={onResetSession}
              isExecuting={isExecuting}
            />
          </section>

          {/* Step 03: Stamped Verified Mainnet Receipt Card */}
          <section id="judge-mainnet-proof" className="scroll-mt-28">
            <VerifiedReceiptCard
              eyebrow="03 · VERIFIED MAINNET RECEIPT"
              onOpenAgentCard={onOpenAgentCard}
            />
          </section>

          {/* Step 04: 1-Tx Emergency Kill-Switch + Full Live Audit Trail */}
          <section id="judge-revoke-test" className="scroll-mt-28 space-y-5">
            <div className="card-surface flex flex-col items-start justify-between gap-4 rounded-[24px] p-6 sm:flex-row sm:items-center">
              <div className="space-y-1">
                <span className="font-numeric text-[10px] font-semibold uppercase tracking-[0.05em] text-[#a8342a]">
                  04 · 1-Tx Emergency Kill-Switch
                </span>
                <h2 className="text-base font-semibold text-[#15171c]">
                  {revoked
                    ? "Session Revoked — All Subsequent Calls Blocked"
                    : "Invalidate Delegated Session Key Instantly"}
                </h2>
                <p className="text-xs text-[#5d7166]">
                  Trigger revocation and try any Safe Flow preset above to confirm{" "}
                  <span className="font-numeric text-[#a8342a]">SESSION_REVOKED</span>.
                </p>
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={revoked}
                  onClick={() => {
                    setActiveStep("revoke-test");
                    onRevokeSession();
                  }}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-[#a8342a] px-4 py-2.5 text-xs font-semibold text-[#ffffff] transition-colors hover:bg-[#8d2a22] disabled:cursor-not-allowed disabled:bg-[#e3e6eb] disabled:text-[#5d7166]"
                >
                  {revoked ? (
                    <>
                      <Lock className="h-3.5 w-3.5" />
                      <span>Revoked</span>
                    </>
                  ) : (
                    <>
                      <Power className="h-3.5 w-3.5" />
                      <span>Revoke Session (1-Tx)</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={onResetSession}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-[#e3e6eb] bg-[#ffffff] px-4 py-2.5 text-xs font-medium text-[#15171c] hover:bg-[#e6ece4]"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>Reset Sandbox</span>
                </button>
              </div>
            </div>

            <AuditTrail events={auditEvents} onClear={onClearAudit} />
          </section>
        </div>
      </div>
    </div>
  );
}
