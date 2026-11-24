import { motion } from "motion/react";
import {
  ArrowRight,
  Lock,
  Power,
  RotateCcw,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import { GitHubIcon } from "./GitHubIcon.js";
import {
  AutoPlayingShowcaseSection,
  LiveBoardPreviewSection,
  ProtocolMarqueeSection,
  ScrollStatementAndStatsSection,
} from "./LandingSections.js";
import type { AppRoute } from "./TopBar.js";
import { VerifiedReceiptCard } from "./VerifiedReceiptCard.js";
import {
  ALTANA_CELO_KEYSTORE,
  CAPRAIL_GITHUB_URL,
  CAPRAIL_METADATA,
} from "../data/mainnetProof.js";
import { shortenAddress } from "../lib/sandboxBridge.js";

const EASE_OUT_EXPO = [0.22, 1, 0.36, 1] as const;

const DIAGONAL_RIBBON_TEXT =
  `✓ 0x9280…954a Granted · ✓ 0xcb30…1c27 ERC-8021 0.05 USDC · ✕ call_not_permitted Blocked · ✕ spend_limit_exceeded Blocked · ✓ 0x1455…d320 Revoked · ERC-8021 ${CAPRAIL_METADATA.attributionCode} · `;

interface LandingPageProps {
  onNavigate: (route: AppRoute) => void;
  revoked: boolean;
  onRevokeSession: () => void;
  onResetSession: () => void;
  onOpenAgentCard: () => void;
}

export function LandingPage({
  onNavigate,
  revoked,
  onRevokeSession,
  onResetSession,
  onOpenAgentCard,
}: LandingPageProps) {
  return (
    <div className="space-y-20">
      {/* =====================================================================
       * 00 · FULL-BLEED EDGE-TO-EDGE FOREST HERO (starts at viewport top)
       * =================================================================== */}
      <section className="hero-forest-surface relative w-full overflow-hidden rounded-b-[40px] pt-28 pb-16 text-[#ffffff] shadow-[0_28px_70px_rgba(10,40,30,0.22)] sm:pt-32 md:pb-20">
        <div className="mx-auto max-w-[1220px] px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-4xl text-center">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: EASE_OUT_EXPO }}
              className="inline-flex items-center gap-2 rounded-full border border-[#ffffff]/15 bg-[#ffffff]/10 px-3.5 py-1.5 text-xs font-medium text-[#e4f5eb] backdrop-blur-sm"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-[#6ee7b7]" />
              <span>Live on Celo Mainnet · Altana EIP-7702 Session Keys</span>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.58, delay: 0.06, ease: EASE_OUT_EXPO }}
              className="mt-6 space-y-4"
            >
              <h1 className="text-4xl font-medium tracking-[-0.04em] text-[#ffffff] sm:text-5xl md:text-6xl">
                Bounded Auto-DCA for autonomous agents.
              </h1>
              <p className="mx-auto max-w-2xl text-base leading-relaxed font-normal text-[#b7cdc2] sm:text-lg">
                Delegate recurring USDC to CELO swaps on Celo Mainnet through
                Altana EIP-7702 session keys, hard spend caps, slippage guards,
                and a 1-tx kill-switch.
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.56, delay: 0.14, ease: EASE_OUT_EXPO }}
              className="mt-8 flex flex-wrap items-center justify-center gap-3"
            >
              <button
                type="button"
                onClick={() => onNavigate("APP")}
                className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-[#ffffff] px-6 py-3 text-sm font-semibold text-[#10372a] transition-transform duration-200 hover:-translate-y-0.5 hover:bg-[#f2f4ef]"
              >
                <span>Launch App</span>
                <ArrowRight className="h-4 w-4" />
              </button>

              <button
                type="button"
                onClick={() => onNavigate("VERIFY")}
                className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-[#ffffff]/25 bg-[#ffffff]/[0.06] px-6 py-3 text-sm font-medium text-[#ffffff] transition-colors hover:border-[#ffffff]/45 hover:bg-[#ffffff]/12"
              >
                <ShieldCheck className="h-4 w-4 text-[#6ee7b7]" />
                <span>Judge &amp; Mainnet Proof</span>
              </button>
            </motion.div>
          </div>
        </div>
      </section>

      {/* =====================================================================
       * MAIN CONTENT CONTAINER (Sections 01 -> 06)
       * =================================================================== */}
      <div className="mx-auto max-w-[1220px] space-y-20 px-4 sm:px-6 lg:px-8">
        {/* 01 · Interactive Live Guardrail Board Preview */}
        <LiveBoardPreviewSection />

        {/* 02 · Opposite-Direction 2-Row Protocol Marquee */}
        <ProtocolMarqueeSection />

        {/* 03 · Scroll-Scrubbed Statement Headline + Sparkline Stats */}
        <ScrollStatementAndStatsSection />

        {/* 04 · Auto-Playing 3-Step Showcase */}
        <AutoPlayingShowcaseSection />

        {/* ===================================================================
         * 05 · ASYMMETRIC BENTO GRID (60/40 + 3 Equal Cards + Receipt Stamp)
         * ================================================================= */}
        <section aria-label="Asymmetric bento architecture and mainnet receipt" className="space-y-6">
          <div className="space-y-3">
            <div className="flex items-center gap-2.5">
              <span className="rounded-full bg-[#e6ece4] px-2.5 py-0.5 font-numeric text-[11px] font-semibold text-[#10372a]">
                05
              </span>
              <span className="font-numeric text-xs uppercase tracking-[0.05em] text-[#5d7166]">
                Architecture &amp; Proof
              </span>
            </div>

            <h2 className="max-w-3xl text-2xl font-medium tracking-[-0.03em] sm:text-4xl">
              <span className="text-[#15171c]">Built like institutional rails, proven on Chain 42220.</span>{" "}
              <span className="text-[#5d7166]">
                Pre-flight schemas, on-chain KeyStore caps, and live Celoscan receipts.
              </span>
            </h2>
          </div>

          {/* Row 1: Asymmetric 60% / 40% */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            {/* 60% Left Light Card: Auto-DCA Pipeline + Floating Policy Pill */}
            <article className="card-surface flex flex-col justify-between rounded-[24px] p-6 lg:col-span-7">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <span className="font-numeric text-[10px] font-semibold uppercase tracking-[0.06em] text-[#5d7166]">
                    Auto-DCA Execution Rail
                  </span>
                  <h3 className="mt-1.5 text-lg font-semibold text-[#15171c]">
                    Uniswap V3 SwapRouter02 Pipeline
                  </h3>
                </div>
                <span className="rounded-full bg-[#e4f5eb] px-3 py-1 font-numeric text-[11px] font-semibold text-[#21744e]">
                  slippage ≤ 100 bps · 3600s
                </span>
              </div>

              <p className="mt-2 text-xs leading-relaxed text-[#5d7166]">
                Every scheduled USDC to CELO swap passes cadence, slippage floor,
                router allowlist, and Altana EIP-7702 session caps before
                appending the ERC-8021 suffix.
              </p>

              <div className="mt-5 rounded-[16px] border border-[#e3e6eb] bg-[#f2f4ef] p-4">
                <svg
                  viewBox="0 0 540 110"
                  className="h-auto w-full"
                  role="img"
                  aria-label="USDC to Altana KeyStore to SwapRouter02 pipeline"
                >
                  <line
                    x1="130"
                    y1="52"
                    x2="188"
                    y2="52"
                    stroke="#15171c"
                    strokeWidth="1.25"
                    strokeDasharray="3 3"
                  />
                  <polygon points="186,48 194,52 186,56" fill="#15171c" />
                  <line
                    x1="346"
                    y1="52"
                    x2="404"
                    y2="52"
                    stroke="#10372a"
                    strokeWidth="1.6"
                  />
                  <polygon points="402,48 410,52 402,56" fill="#10372a" />

                  <rect x="8" y="22" width="122" height="60" rx="12" fill="#ffffff" stroke="#e3e6eb" />
                  <text x="22" y="47" fill="#15171c" fontSize="12" fontWeight="600" fontFamily="Inter, sans-serif">
                    Native USDC
                  </text>
                  <text x="22" y="66" fill="#5d7166" fontSize="10" fontFamily="JetBrains Mono, monospace">
                    0xcebA…118C
                  </text>

                  <rect x="194" y="16" width="152" height="72" rx="12" fill="#ffffff" stroke="#10372a" strokeWidth="1.5" />
                  <text x="208" y="40" fill="#10372a" fontSize="12" fontWeight="600" fontFamily="Inter, sans-serif">
                    Altana KeyStore
                  </text>
                  <text x="208" y="57" fill="#15171c" fontSize="9.5" fontFamily="JetBrains Mono, monospace">
                    EIP-7702 Session Key
                  </text>
                  <text x="208" y="73" fill="#5d7166" fontSize="9.5" fontFamily="JetBrains Mono, monospace">
                    {shortenAddress(ALTANA_CELO_KEYSTORE)}
                  </text>

                  <rect x="410" y="22" width="122" height="60" rx="12" fill="#ffffff" stroke="#e3e6eb" />
                  <text x="424" y="47" fill="#15171c" fontSize="12" fontWeight="600" fontFamily="Inter, sans-serif">
                    SwapRouter02
                  </text>
                  <text x="424" y="66" fill="#5d7166" fontSize="10" fontFamily="JetBrains Mono, monospace">
                    0x5615…abc4
                  </text>
                </svg>
              </div>
            </article>

            {/* 40% Right Dark Forest Matrix Card (#0f2e24) */}
            <article className="relative flex flex-col justify-between overflow-hidden rounded-[24px] border border-[#1a4d3c] bg-[#0f2e24] p-6 text-[#ffffff] lg:col-span-5">
              {/* Animated Pulsing Node Wave Matrix Grid Background */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 grid grid-cols-8 grid-rows-5 place-items-center p-6 opacity-75"
              >
                {Array.from({ length: 40 }).map((_, idx) => {
                  const row = Math.floor(idx / 8);
                  const col = idx % 8;
                  const delaySec = ((row + col) * 0.16).toFixed(2);
                  return (
                    <span
                      key={idx}
                      className="animate-matrix-node h-2 w-2 rounded-full bg-[#6ee7b7]"
                      style={{ animationDelay: `${delaySec}s` }}
                    />
                  );
                })}
              </div>

              <div className="relative z-10">
                <span className="inline-flex rounded-full border border-[#ffffff]/15 bg-[#ffffff]/10 px-2.5 py-0.5 font-numeric text-[10px] font-semibold text-[#86efac]">
                  ON-CHAIN ENFORCEMENT
                </span>
                <h3 className="mt-4 text-3xl leading-[1.06] font-medium tracking-[-0.04em] text-[#ffffff]">
                  Hard limits.
                  <br />
                  <span className="text-[#8eb3a2]">Zero leeway.</span>
                </h3>
              </div>

              <div className="relative z-10 mt-8 rounded-[16px] border border-[#ffffff]/14 bg-[#081d16]/80 p-4 backdrop-blur-sm">
                <p className="text-xs leading-relaxed text-[#d7e6df]">
                  Even if an agent prompt is hijacked or bypassed off-chain, Altana&apos;s
                  account validator reverts over-cap calls and unlisted targets directly
                  on Celo Mainnet.
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5 font-numeric text-[10px]">
                  <span className="rounded-full bg-[#ffece9] px-2.5 py-0.5 font-semibold text-[#a8342a]">
                    [call_not_permitted]
                  </span>
                  <span className="rounded-full bg-[#ffece9] px-2.5 py-0.5 font-semibold text-[#a8342a]">
                    [spend_limit_exceeded]
                  </span>
                </div>
              </div>
            </article>
          </div>

          {/* Row 2: 3 Equal Cards (Policy Code Block, Liquidity-Gated Slippage Guard, Mini Kill-Switch) */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {/* (a) Monospace Policy Code Block */}
            <article className="card-surface flex flex-col justify-between rounded-[24px] p-5">
              <div>
                <div className="flex items-center gap-2 text-xs font-semibold text-[#15171c]">
                  <Terminal className="h-4 w-4 text-[#10372a]" />
                  <span>Deterministic Policy Schema</span>
                </div>
                <pre className="mt-3 overflow-x-auto rounded-[12px] border border-[#e3e6eb] bg-[#f2f4ef] p-3.5 font-numeric text-[11px] leading-relaxed text-[#15171c]">
{`spendCapPerTx: "50.00 USDC"
totalSpendCap: "100.00 USDC"
allowedTargets: [
  SwapRouter02
]
maxSlippageBps: 100
attribution: "${CAPRAIL_METADATA.attributionCode}"`}
                </pre>
              </div>
              <p className="mt-3 font-numeric text-[10px] text-[#5d7166]">
                Validated via zod@4.6.7 · zero wildcard targets
              </p>
            </article>

            {/* (b) Liquidity-Gated Pool & Slippage Guard */}
            <article className="card-surface flex flex-col justify-between rounded-[24px] p-5">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[#15171c]">
                    Liquidity-Gated Pool Guard
                  </span>
                  <span className="rounded-full bg-[#e4f5eb] px-2 py-0.5 font-numeric text-[10px] font-semibold text-[#21744e]">
                    0.01% TIER
                  </span>
                </div>

                <p className="mt-2 text-xs leading-relaxed text-[#5d7166]">
                  Restricted strictly to the active Celo Mainnet USDC/CELO 0.01%
                  Uniswap V3 pool. Live swaps quote on-chain via{" "}
                  <span className="font-numeric text-[#15171c]">simulateContract</span>{" "}
                  to enforce a 1.00% slippage floor.
                </p>

                <div className="mt-4 space-y-2 rounded-[12px] border border-[#e3e6eb] bg-[#f2f4ef] p-3 font-numeric text-[11px]">
                  <div className="flex items-center justify-between">
                    <span className="text-[#5d7166]">USDC / CELO (0.01%)</span>
                    <span className="font-semibold text-[#21744e]">Active (~$12.4k)</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[#5d7166]">USDC / WETH</span>
                    <span className="font-semibold text-[#a8342a]">Blocked (L = 0)</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[#5d7166]">USDC / WBTC</span>
                    <span className="font-semibold text-[#a8342a]">Blocked (No Pool)</span>
                  </div>
                </div>
              </div>
              <p className="mt-3 font-numeric text-[10px] text-[#5d7166]">
                Verified on Celo 42220 · Nov 23, 2026
              </p>
            </article>

            {/* (c) Mini Interactive Kill-Switch Card */}
            <article className="card-surface flex flex-col justify-between rounded-[24px] p-5">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[#15171c]">
                    1-Tx Kill-Switch
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 font-numeric text-[10px] font-semibold ${
                      revoked
                        ? "bg-[#ffece9] text-[#a8342a]"
                        : "bg-[#e4f5eb] text-[#21744e]"
                    }`}
                  >
                    {revoked ? "REVOKED" : "ARMED"}
                  </span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-[#5d7166]">
                  Test revoking the shared Sandbox session right here. Page 2 and Page 3
                  lock immediately.
                </p>
              </div>

              <div className="mt-4 flex flex-col gap-2">
                <button
                  type="button"
                  disabled={revoked}
                  onClick={onRevokeSession}
                  className="inline-flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-full bg-[#a8342a] px-4 py-2.5 text-xs font-semibold text-[#ffffff] transition-colors hover:bg-[#8d2a22] disabled:cursor-not-allowed disabled:bg-[#e3e6eb] disabled:text-[#5d7166]"
                >
                  {revoked ? (
                    <>
                      <Lock className="h-3.5 w-3.5" />
                      <span>Session Revoked</span>
                    </>
                  ) : (
                    <>
                      <Power className="h-3.5 w-3.5" />
                      <span>Revoke Session</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={onResetSession}
                  className="inline-flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-full border border-[#e3e6eb] bg-[#f2f4ef] px-4 py-2 text-xs font-medium text-[#15171c] transition-colors hover:bg-[#e6ece4]"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>Reset Sandbox Session</span>
                </button>
              </div>
            </article>
          </div>

          {/* Verified Mainnet Receipt Card with Circular VERIFIED · CHAIN 42220 Seal */}
          <VerifiedReceiptCard onOpenAgentCard={onOpenAgentCard} />
        </section>

        {/* ===================================================================
         * 06 · DARK FOREST CTA CARD WITH DIAGONAL MARQUEE RIBBON (-rotate-3)
         * ================================================================= */}
        <section
          aria-label="Call to action"
          className="relative overflow-hidden rounded-[28px] border border-[#1b4d3c] bg-[#0d2b21] px-6 py-14 text-center text-[#ffffff] sm:px-12 sm:py-16"
        >
          {/* Low-opacity Tilted Diagonal Marquee Ribbon Behind CTA */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-[-10%] top-1/2 -translate-y-1/2 -rotate-3 border-y border-[#6ee7b7]/20 bg-[#10372a]/50 py-2.5 opacity-20"
          >
            <div className="animate-marquee-ribbon flex w-max whitespace-nowrap font-numeric text-xs font-medium text-[#86efac]">
              <span>{DIAGONAL_RIBBON_TEXT}</span>
              <span>{DIAGONAL_RIBBON_TEXT}</span>
              <span>{DIAGONAL_RIBBON_TEXT}</span>
            </div>
          </div>

          {/* Subtle Dark Radial Backdrop behind center text for crisp legibility */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(65% 75% at 50% 50%, rgba(13, 43, 33, 0.96) 0%, rgba(13, 43, 33, 0.80) 58%, rgba(13, 43, 33, 0.15) 100%)",
            }}
          />

          <div className="relative z-10 mx-auto max-w-2xl space-y-5">
            <span className="inline-flex rounded-full border border-[#ffffff]/15 bg-[#0d2b21]/80 px-3 py-1 font-numeric text-[11px] font-medium text-[#86efac] backdrop-blur-sm">
              06 · READY FOR CELO MAINNET
            </span>

            <h2 className="text-3xl font-medium tracking-[-0.04em] text-[#ffffff] sm:text-5xl">
              Put hard rails around every autonomous agent.
            </h2>

            <p className="mx-auto max-w-xl text-sm leading-relaxed text-[#b7cdc2]">
              Configure bounded USDC to CELO Auto-DCA orders in zero-gas Sandbox
              mode, or run negative guardrail tests in the Judge Console.
            </p>

            <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => onNavigate("APP")}
                className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-[#ffffff] px-6 py-3 text-sm font-semibold text-[#10372a] transition-transform duration-200 hover:-translate-y-0.5 hover:bg-[#f2f4ef]"
              >
                <span>Launch App</span>
                <ArrowRight className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => onNavigate("VERIFY")}
                className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-[#ffffff]/25 bg-[#0d2b21]/85 px-6 py-3 text-sm font-medium text-[#ffffff] backdrop-blur-sm transition-colors hover:border-[#ffffff]/50 hover:bg-[#17483a]"
              >
                <span>Judge &amp; Proof</span>
              </button>
            </div>
          </div>
        </section>
      </div>

      {/* =====================================================================
       * PROPORTIONAL WATERMARK FOOTER WORDMARK WITH BOTTOM GRADIENT FADE
       * =================================================================== */}
      <footer className="relative overflow-hidden border-t border-[#e3e6eb] pt-10 pb-6">
        <div className="mx-auto flex max-w-[1220px] flex-wrap items-center justify-between gap-3 px-4 pb-6 font-numeric text-[11px] text-[#5d7166] sm:px-6 lg:px-8">
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
          <span>ERC-8021 {CAPRAIL_METADATA.attributionCode} · Altana SDK v1.1.0</span>
        </div>

        <div
          aria-hidden="true"
          className="pointer-events-none select-none px-4 text-center"
          style={{
            maskImage:
              "linear-gradient(to bottom, rgba(0,0,0,1) 30%, rgba(0,0,0,0.42) 72%, rgba(0,0,0,0) 100%)",
            WebkitMaskImage:
              "linear-gradient(to bottom, rgba(0,0,0,1) 30%, rgba(0,0,0,0.42) 72%, rgba(0,0,0,0) 100%)",
          }}
        >
          <span className="block text-[clamp(4.2rem,15vw,13.5rem)] leading-[0.94] font-semibold tracking-[-0.055em] text-[#10372a]/[0.11]">
            CapRail
          </span>
        </div>
      </footer>
    </div>
  );
}
