import { useEffect, useRef, useState } from "react";
import {
  AnimatePresence,
  motion,
  useInView,
  useScroll,
  useTransform,
  type MotionValue,
} from "motion/react";
import {
  Activity,
  Bot,
  CheckCircle2,
  Cpu,
  Fingerprint,
  GitFork,
  KeyRound,
  Layers,
  Lock,
  Power,
  Repeat,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import { CeloLogo, UniswapLogo, UsdcLogo } from "./BrandIcons.js";
import { CAPRAIL_METADATA } from "../data/mainnetProof.js";

const EASE_OUT_EXPO = [0.22, 1, 0.36, 1] as const;

/* ============================================================================
 * SECTION 01: INTERACTIVE LIVE GUARDRAIL BOARD PREVIEW ("One calm board")
 * ========================================================================== */

type BoardFilter = "ALL" | "AUTO_DCA" | "REVENUE_SPLIT" | "BLOCKED";

interface BoardEventRow {
  id: string;
  category: Exclude<BoardFilter, "ALL">;
  title: string;
  detail: string;
  amount: string;
  status: "APPROVED" | "BLOCKED";
  tag: string;
  time: string;
}

const BOARD_EVENTS: readonly BoardEventRow[] = [
  {
    id: "ev-1",
    category: "AUTO_DCA",
    title: "Auto-DCA · USDC → CELO",
    detail: "SwapRouter02 · slippage 42 bps · within $50/tx cap",
    amount: "$25.00",
    status: "APPROVED",
    tag: "ERC-8021 ✓",
    time: "12s ago",
  },
  {
    id: "ev-2",
    category: "REVENUE_SPLIT",
    title: "3-Way Atomic Revenue Split",
    detail: "Treasury 50% · Collaborator 30% · Ops 20% (10,000 bps)",
    amount: "$40.00",
    status: "APPROVED",
    tag: "0xcb30…1c27",
    time: "1m ago",
  },
  {
    id: "ev-3",
    category: "BLOCKED",
    title: "Over-Cap Swap Blocked",
    detail: "Requested $60.00 > $50.00 per-tx limit · spend_limit_exceeded",
    amount: "$60.00",
    status: "BLOCKED",
    tag: "EXCEEDS_PER_TX_CAP",
    time: "3m ago",
  },
  {
    id: "ev-4",
    category: "BLOCKED",
    title: "Unlisted USD₮ Transfer Blocked",
    detail: "Contract 0x4806…3D5e not in session allowedTargets",
    amount: "$10.00",
    status: "BLOCKED",
    tag: "call_not_permitted",
    time: "4m ago",
  },
  {
    id: "ev-5",
    category: "AUTO_DCA",
    title: "Scheduled Hourly DCA Run",
    detail: "Interval verified (3600s) · ERC-8021 celo_cbf00f366dda",
    amount: "$15.00",
    status: "APPROVED",
    tag: "ERC-8021 ✓",
    time: "1h ago",
  },
];

const BOARD_METRICS: Record<
  BoardFilter,
  readonly { label: string; value: number; prefix?: string; suffix?: string }[]
> = {
  ALL: [
    { label: "Total Evaluated", value: 5 },
    { label: "Approved Volume", value: 80, prefix: "$", suffix: ".00" },
    { label: "Attacks Blocked", value: 2 },
    { label: "Policy Adherence", value: 100, suffix: "%" },
  ],
  AUTO_DCA: [
    { label: "DCA Runs", value: 2 },
    { label: "Swapped Volume", value: 40, prefix: "$", suffix: ".00" },
    { label: "Avg Slippage", value: 42, suffix: " bps" },
    { label: "Router Guard", value: 100, suffix: "%" },
  ],
  REVENUE_SPLIT: [
    { label: "Atomic Batches", value: 1 },
    { label: "Distributed USDC", value: 40, prefix: "$", suffix: ".00" },
    { label: "Allocation Precision", value: 10000, suffix: " bps" },
    { label: "Dust Loss", value: 0, suffix: " wei" },
  ],
  BLOCKED: [
    { label: "Blocked Intents", value: 2 },
    { label: "USDC Protected", value: 70, prefix: "$", suffix: ".00" },
    { label: "Leakage", value: 0, prefix: "$", suffix: ".00" },
    { label: "KeyStore Rejections", value: 100, suffix: "%" },
  ],
};

function RollingNumber({
  value,
  prefix = "",
  suffix = "",
}: {
  value: number;
  prefix?: string;
  suffix?: string;
}) {
  const [display, setDisplay] = useState(value);
  const prevRef = useRef(value);

  useEffect(() => {
    const from = prevRef.current;
    const to = value;
    prevRef.current = to;
    if (from === to) return;

    const start = performance.now();
    const dur = 420;
    let raf = 0;

    function frame(now: number) {
      const p = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round(from + (to - from) * eased));
      if (p < 1) raf = requestAnimationFrame(frame);
    }

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return (
    <span className="font-numeric">
      {prefix}
      {display.toLocaleString("en-US")}
      {suffix}
    </span>
  );
}

export function LiveBoardPreviewSection() {
  const [filter, setFilter] = useState<BoardFilter>("ALL");

  const filteredEvents =
    filter === "ALL"
      ? BOARD_EVENTS
      : BOARD_EVENTS.filter((e) => e.category === filter);
  const metrics = BOARD_METRICS[filter];

  return (
    <section aria-label="Interactive live guardrail board preview" className="space-y-6">
      <div className="space-y-3">
        <div className="flex items-center gap-2.5">
          <span className="rounded-full bg-[#e6ece4] px-2.5 py-0.5 font-numeric text-[11px] font-semibold text-[#10372a]">
            01
          </span>
          <span className="font-numeric text-xs uppercase tracking-[0.05em] text-[#5d7166]">
            One Calm Board
          </span>
        </div>

        <h2 className="max-w-3xl text-2xl font-medium tracking-[-0.03em] sm:text-4xl">
          <span className="text-[#15171c]">Every swap, split, and blocked attack in one ledger.</span>{" "}
          <span className="text-[#5d7166]">
            Filter live agent telemetry before a single dollar leaves your wallet.
          </span>
        </h2>
      </div>

      {/* Outer Sage Frame */}
      <div className="rounded-[24px] border border-[#d6dfd3] bg-[#e6ece4]/65 p-3">
        <div className="grid grid-cols-1 overflow-hidden rounded-[18px] border border-[#e3e6eb] bg-[#ffffff] lg:grid-cols-12">
          {/* Interactive Left Sidebar */}
          <aside className="border-b border-[#e3e6eb] bg-[#f8faf7] p-4 lg:col-span-3 lg:border-r lg:border-b-0">
            <div className="mb-3 flex items-center justify-between px-2">
              <span className="font-numeric text-[10px] font-semibold uppercase tracking-[0.06em] text-[#5d7166]">
                Workspace Filter
              </span>
              <span className="h-2 w-2 rounded-full bg-[#21744e]" />
            </div>

            <div className="space-y-1">
              {(
                [
                  { id: "ALL", label: "All Events", count: 5, icon: Activity },
                  { id: "AUTO_DCA", label: "Auto-DCA", count: 2, icon: Repeat },
                  { id: "REVENUE_SPLIT", label: "Revenue Split", count: 1, icon: GitFork },
                  { id: "BLOCKED", label: "Blocked Attacks", count: 2, icon: ShieldAlert },
                ] as const
              ).map((item) => {
                const active = filter === item.id;
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setFilter(item.id)}
                    className={`relative flex w-full cursor-pointer items-center justify-between rounded-[10px] px-3 py-2 text-xs font-medium transition-colors ${
                      active
                        ? "text-[#ffffff]"
                        : "text-[#5d7166] hover:bg-[#e6ece4]/55 hover:text-[#15171c]"
                    }`}
                  >
                    {active && (
                      <motion.span
                        layoutId="board-sidebar-active"
                        transition={{ duration: 0.32, ease: EASE_OUT_EXPO }}
                        className="absolute inset-0 -z-0 rounded-[10px] bg-[#10372a]"
                      />
                    )}
                    <span className="relative z-10 flex items-center gap-2">
                      <Icon className="h-3.5 w-3.5" />
                      <span>{item.label}</span>
                    </span>
                    <span
                      className={`relative z-10 rounded-full px-2 py-0.5 font-numeric text-[10px] ${
                        active
                          ? "bg-[#ffffff]/18 text-[#ffffff]"
                          : "bg-[#e6ece4] text-[#10372a]"
                      }`}
                    >
                      {item.count}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="mt-5 hidden rounded-[12px] border border-[#e3e6eb] bg-[#ffffff] p-3 text-[11px] lg:block">
              <p className="font-semibold text-[#15171c]">Session Policy</p>
              <p className="mt-1 font-numeric text-[#5d7166]">
                Cap: $50/tx · $100 total
              </p>
              <p className="mt-0.5 font-numeric text-[#21744e]">
                Tag: {CAPRAIL_METADATA.attributionCode}
              </p>
            </div>
          </aside>

          {/* Right Live Metrics + Filtered Feed */}
          <div className="p-5 lg:col-span-9">
            {/* 4 Rolling Count-Up KPI Cards */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {metrics.map((m) => (
                <div
                  key={m.label}
                  className="rounded-[12px] border border-[#e3e6eb] bg-[#f2f4ef]/75 p-3.5"
                >
                  <p className="text-[11px] font-medium text-[#5d7166]">{m.label}</p>
                  <p className="mt-1.5 text-xl font-semibold tracking-[-0.03em] text-[#15171c]">
                    <RollingNumber
                      value={m.value}
                      prefix={m.prefix}
                      suffix={m.suffix}
                    />
                  </p>
                </div>
              ))}
            </div>

            {/* Filtered Status Event Rows */}
            <div className="mt-4 divide-y divide-[#e3e6eb] rounded-[14px] border border-[#e3e6eb]">
              <AnimatePresence mode="popLayout">
                {filteredEvents.map((ev) => (
                  <motion.div
                    key={ev.id}
                    layout
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.26, ease: EASE_OUT_EXPO }}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span
                        className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                          ev.status === "APPROVED"
                            ? "bg-[#e4f5eb] text-[#21744e]"
                            : "bg-[#ffece9] text-[#a8342a]"
                        }`}
                      >
                        {ev.status === "APPROVED" ? (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        ) : (
                          <ShieldAlert className="h-3.5 w-3.5 text-[#ff6a5c]" />
                        )}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-[#15171c]">
                          {ev.title}
                        </p>
                        <p className="truncate text-[11px] text-[#5d7166]">
                          {ev.detail}
                        </p>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2.5 font-numeric text-[11px]">
                      <span className="font-semibold text-[#15171c]">
                        {ev.amount}
                      </span>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${
                          ev.status === "APPROVED"
                            ? "bg-[#e4f5eb] text-[#21744e]"
                            : "bg-[#ffece9] text-[#a8342a]"
                        }`}
                      >
                        {ev.tag}
                      </span>
                      <span className="hidden text-[#5d7166] sm:inline">
                        {ev.time}
                      </span>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============================================================================
 * SECTION 02: OPPOSITE-DIRECTION 2-ROW PROTOCOL MARQUEE
 * ========================================================================== */

const MARQUEE_ROW_1 = [
  { kind: "dark" as const, label: "Celo 42220", sub: "Mainnet L2", brand: "celo" as const },
  { kind: "dots" as const, label: "EIP-7702", sub: "Delegated EOA" },
  { kind: "dark" as const, label: "Altana EIP-7702", sub: "Session Keys", icon: KeyRound },
  { kind: "dots" as const, label: "Zero Custody", sub: "Owner Admin" },
  { kind: "dark" as const, label: "Uniswap V3", sub: "SwapRouter02", brand: "uniswap" as const },
  { kind: "dots" as const, label: "10,000 BPS", sub: "Atomic Math" },
  { kind: "dark" as const, label: "Native USDC", sub: "0xcebA…118C", brand: "usdc" as const },
  { kind: "dots" as const, label: "1-Tx Revoke", sub: "Kill-Switch" },
];

const MARQUEE_ROW_2 = [
  { kind: "dots" as const, label: "Spend Caps", sub: "Per-Tx & Total" },
  { kind: "dark" as const, label: "ERC-8021", sub: CAPRAIL_METADATA.attributionCode, icon: ShieldCheck },
  { kind: "dots" as const, label: "Allowlists", sub: "Strict Selectors" },
  { kind: "dark" as const, label: "ERC-8004", sub: "Agent Identity", icon: Fingerprint },
  { kind: "dots" as const, label: "Pre-Flight", sub: "Zod Schemas" },
  { kind: "dark" as const, label: "Viem", sub: "ABI Calldata", icon: Cpu },
  { kind: "dots" as const, label: "Audit JSON", sub: "Deterministic" },
  { kind: "dark" as const, label: "KeyStore", sub: "0x83b3…d27c", icon: Layers },
];

type MarqueeTile = (typeof MARQUEE_ROW_1)[number] | (typeof MARQUEE_ROW_2)[number];

function MarqueeTrack({
  items,
  direction,
}: {
  items: readonly MarqueeTile[];
  direction: "left" | "right";
}) {
  const doubled = [...items, ...items];
  return (
    <div className="marquee-edge-mask overflow-hidden py-1.5">
      <div
        className={`flex w-max gap-3 ${
          direction === "left" ? "animate-marquee-left" : "animate-marquee-right"
        }`}
      >
        {doubled.map((tile, idx) =>
          tile.kind === "dark" ? (
            <div
              key={`${tile.label}-${idx}`}
              className="flex h-[78px] w-[196px] shrink-0 items-center gap-3 rounded-[16px] border border-[#1a4d3c] bg-[#10372a] px-4 text-[#ffffff]"
            >
              {"brand" in tile ? (
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border border-[#ffffff]/10 bg-[#ffffff]/10">
                  {tile.brand === "celo" && <CeloLogo size={28} />}
                  {tile.brand === "uniswap" && <UniswapLogo size={28} />}
                  {tile.brand === "usdc" && <UsdcLogo size={28} />}
                </span>
              ) : (
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border border-[#ffffff]/10 bg-[#ffffff]/10 text-[#86efac]">
                  <tile.icon className="h-[18px] w-[18px]" />
                </span>
              )}
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-[#ffffff]">
                  {tile.label}
                </p>
                <p className="truncate font-numeric text-[10px] text-[#9fc3b2]">
                  {tile.sub}
                </p>
              </div>
            </div>
          ) : (
            <div
              key={`${tile.label}-${idx}`}
              className="dot-grid-card flex h-[78px] w-[176px] shrink-0 flex-col justify-center rounded-[16px] border border-[#e3e6eb] px-4"
            >
              <p className="text-xs font-semibold text-[#15171c]">{tile.label}</p>
              <p className="mt-0.5 font-numeric text-[10px] text-[#5d7166]">
                {tile.sub}
              </p>
            </div>
          ),
        )}
      </div>
    </div>
  );
}

export function ProtocolMarqueeSection() {
  return (
    <section aria-label="Protocol stack marquee" className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="rounded-full bg-[#e6ece4] px-2.5 py-0.5 font-numeric text-[11px] font-semibold text-[#10372a]">
            02
          </span>
          <span className="font-numeric text-xs uppercase tracking-[0.05em] text-[#5d7166]">
            Native Celo &amp; Altana Primitives
          </span>
        </div>
        <span className="font-numeric text-[11px] text-[#5d7166]">
          Zero mocked SDK methods · 100% real mainnet stack
        </span>
      </div>

      <div className="space-y-3">
        <MarqueeTrack items={MARQUEE_ROW_1} direction="left" />
        <MarqueeTrack items={MARQUEE_ROW_2} direction="right" />
      </div>
    </section>
  );
}

/* ============================================================================
 * SECTION 03: SCROLL-SCRUBBED STATEMENT HEADLINE + SPARKLINE STATS
 * ========================================================================== */

interface StatementToken {
  text: string;
  chip?: "agents" | "KeyStore" | "Celo";
}

const STATEMENT_TOKENS: readonly StatementToken[] = [
  { text: "Intents" },
  { text: "in" },
  { text: "→" },
  { text: "agents,", chip: "agents" },
  { text: "limits" },
  { text: "in" },
  { text: "→" },
  { text: "KeyStore,", chip: "KeyStore" },
  { text: "payouts" },
  { text: "on" },
  { text: "→" },
  { text: "Celo.", chip: "Celo" },
  { text: "CapRail" },
  { text: "enforces" },
  { text: "the" },
  { text: "rules," },
  { text: "and" },
  { text: "gives" },
  { text: "you" },
  { text: "the" },
  { text: "receipts." },
];

function ScrubbedWord({
  token,
  progress,
  range,
}: {
  token: StatementToken;
  progress: MotionValue<number>;
  range: [number, number];
}) {
  const opacity = useTransform(progress, range, [0.2, 1]);

  if (token.chip) {
    return (
      <motion.span
        style={{ opacity }}
        className="mx-1 inline-flex items-center gap-1.5 rounded-full border border-[#d6dfd3] bg-[#e4f5eb] px-3 py-1 align-middle text-[0.72em] font-semibold text-[#10372a]"
      >
        {token.chip === "Celo" ? (
          <CeloLogo size={18} />
        ) : token.chip === "agents" ? (
          <Bot className="h-[0.82em] w-[0.82em] text-[#21744e]" />
        ) : (
          <KeyRound className="h-[0.82em] w-[0.82em] text-[#21744e]" />
        )}
        <span>{token.text}</span>
      </motion.span>
    );
  }

  return (
    <motion.span style={{ opacity }} className="mr-[0.26em] inline-block text-[#10372a]">
      {token.text}
    </motion.span>
  );
}

const SPARKLINE_STATS = [
  {
    value: "42,220",
    label: "Celo Mainnet",
    sub: "Live EIP-7702 execution",
    bars: [32, 48, 42, 64, 58, 82, 76, 96],
  },
  {
    value: "10,000",
    label: "BPS Precision",
    sub: "Exact atomic BigInt split",
    bars: [60, 75, 68, 85, 80, 92, 88, 100],
  },
  {
    value: "3",
    label: "Live Mainnet Txs",
    sub: "Grant, Split & 1-Tx Revoke",
    bars: [24, 38, 52, 44, 70, 84, 78, 95],
  },
  {
    value: "1-Tx",
    label: "Kill-Switch",
    sub: "Instant KeyStore revoke",
    bars: [90, 86, 82, 74, 60, 42, 22, 12],
  },
] as const;

export function ScrollStatementAndStatsSection() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const statsRef = useRef<HTMLDivElement | null>(null);
  const statsInView = useInView(statsRef, { once: true, amount: 0.35 });

  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start 0.85", "end 0.42"],
  });

  return (
    <section aria-label="Scroll scrubbed mission statement and metrics" className="space-y-10">
      <div className="flex items-center gap-2.5">
        <span className="rounded-full bg-[#e6ece4] px-2.5 py-0.5 font-numeric text-[11px] font-semibold text-[#10372a]">
          03
        </span>
        <span className="font-numeric text-xs uppercase tracking-[0.05em] text-[#5d7166]">
          Protocol Guarantee
        </span>
      </div>

      {/* Scroll-Scrubbed Statement Headline */}
      <div ref={containerRef} className="max-w-4xl py-2">
        <p className="text-3xl leading-[1.22] font-medium tracking-[-0.035em] sm:text-5xl">
          {STATEMENT_TOKENS.map((token, idx) => {
            const start = idx / STATEMENT_TOKENS.length;
            const end = Math.min(1, start + 1 / STATEMENT_TOKENS.length + 0.08);
            return (
              <ScrubbedWord
                key={`${token.text}-${idx}`}
                token={token}
                progress={scrollYProgress}
                range={[start, end]}
              />
            );
          })}
        </p>
      </div>

      {/* 4 Sparkline Stat Columns */}
      <div
        ref={statsRef}
        className="grid grid-cols-2 border-y border-[#e3e6eb] md:grid-cols-4 md:divide-x md:divide-[#e3e6eb]"
      >
        {SPARKLINE_STATS.map((stat, colIdx) => (
          <div
            key={stat.label}
            className={`p-6 ${colIdx % 2 === 1 ? "border-l border-[#e3e6eb] md:border-l-0" : ""} ${
              colIdx >= 2 ? "border-t border-[#e3e6eb] md:border-t-0" : ""
            }`}
          >
            {/* Mini Vertical Sparkline Bars */}
            <div className="mb-4 flex h-8 items-end gap-1" aria-hidden="true">
              {stat.bars.map((heightPct, barIdx) => (
                <motion.span
                  key={`${stat.label}-b-${barIdx}`}
                  initial={{ scaleY: 0.15, opacity: 0.35 }}
                  animate={
                    statsInView
                      ? { scaleY: 1, opacity: barIdx === stat.bars.length - 1 ? 1 : 0.45 }
                      : { scaleY: 0.15, opacity: 0.35 }
                  }
                  transition={{
                    duration: 0.55,
                    delay: colIdx * 0.06 + barIdx * 0.03,
                    ease: EASE_OUT_EXPO,
                  }}
                  style={{
                    height: `${heightPct}%`,
                    transformOrigin: "bottom",
                  }}
                  className={`w-1.5 rounded-full ${
                    barIdx === stat.bars.length - 1 ? "bg-[#10372a]" : "bg-[#21744e]"
                  }`}
                />
              ))}
            </div>

            <p className="font-numeric text-3xl font-medium tracking-[-0.04em] text-[#15171c] sm:text-4xl">
              {stat.value}
            </p>
            <p className="mt-1.5 text-xs font-semibold text-[#15171c]">
              {stat.label}
            </p>
            <p className="mt-0.5 text-[11px] text-[#5d7166]">{stat.sub}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ============================================================================
 * SECTION 04: AUTO-PLAYING 3-STEP SPLIT SHOWCASE ("Watch one agent stay bounded")
 * ========================================================================== */

const SHOWCASE_STEPS = [
  {
    num: "01",
    title: "Set Caps",
    desc: "Define per-trade limits, total USDC budget, slippage ceilings, and allowlisted contracts.",
    chip: "✓ Policy Locked · Max $50/tx · $100 Total",
    chipTone: "mint" as const,
  },
  {
    num: "02",
    title: "Delegate Scoped Key",
    desc: "Authorize an Altana EIP-7702 Session Key on Celo Mainnet while your admin key stays offline.",
    chip: "✓ KeyStore Granted · 0x9280…954a",
    chipTone: "mint" as const,
  },
  {
    num: "03",
    title: "Execute or 1-Tx Revoke",
    desc: "Automate DCA & 10,000-bps splits with ERC-8021 tags—or pull the 1-tx kill-switch anytime.",
    chip: "✕ Revoke Triggered · SESSION_REVOKED",
    chipTone: "alert" as const,
  },
] as const;

const STEP_DURATION_MS = 5000;

export function AutoPlayingShowcaseSection() {
  const [activeIdx, setActiveIdx] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setActiveIdx((prev) => (prev + 1) % SHOWCASE_STEPS.length);
    }, STEP_DURATION_MS);
    return () => window.clearInterval(timer);
  }, [activeIdx]);

  const currentStep = SHOWCASE_STEPS[activeIdx] ?? SHOWCASE_STEPS[0];

  return (
    <section aria-label="Auto-playing 3-step showcase" className="space-y-6">
      <div className="space-y-3">
        <div className="flex items-center gap-2.5">
          <span className="rounded-full bg-[#e6ece4] px-2.5 py-0.5 font-numeric text-[11px] font-semibold text-[#10372a]">
            04
          </span>
          <span className="font-numeric text-xs uppercase tracking-[0.05em] text-[#5d7166]">
            Watch One Agent Stay Bounded
          </span>
        </div>

        <h2 className="max-w-3xl text-2xl font-medium tracking-[-0.03em] sm:text-4xl">
          <span className="text-[#15171c]">Three deterministic checkpoints from setup to kill-switch.</span>{" "}
          <span className="text-[#5d7166]">
            Auto-cycles every 5 seconds or click any step to inspect.
          </span>
        </h2>
      </div>

      <div className="grid grid-cols-1 items-stretch gap-5 lg:grid-cols-12">
        {/* Left: 3 Step Cards with Linear Progress Bar */}
        <div className="flex flex-col justify-between gap-3 lg:col-span-5">
          {SHOWCASE_STEPS.map((step, idx) => {
            const active = idx === activeIdx;
            return (
              <button
                key={step.num}
                type="button"
                onClick={() => setActiveIdx(idx)}
                className={`relative cursor-pointer overflow-hidden rounded-[16px] border p-5 text-left transition-colors ${
                  active
                    ? "border-[#10372a] bg-[#ffffff] shadow-[0_6px_24px_rgba(16,55,42,0.06)]"
                    : "border-[#e3e6eb] bg-[#ffffff]/70 hover:bg-[#ffffff]"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <span
                    className={`rounded-full px-2.5 py-0.5 font-numeric text-[11px] font-semibold ${
                      active
                        ? "bg-[#10372a] text-[#ffffff]"
                        : "bg-[#e6ece4] text-[#5d7166]"
                    }`}
                  >
                    {step.num}
                  </span>
                  <h3 className="text-sm font-semibold text-[#15171c]">
                    {step.title}
                  </h3>
                </div>

                <p className="mt-2 text-xs leading-relaxed text-[#5d7166]">
                  {step.desc}
                </p>

                {/* Thin Linear Progress Bar on Active Step */}
                <div className="mt-4 h-[3px] w-full overflow-hidden rounded-full bg-[#e3e6eb]">
                  {active && (
                    <motion.div
                      key={`progress-${activeIdx}`}
                      initial={{ width: "0%" }}
                      animate={{ width: "100%" }}
                      transition={{ duration: STEP_DURATION_MS / 1000, ease: "linear" }}
                      className="h-full rounded-full bg-[#10372a]"
                    />
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Right: Crossfading Visual Stage + Floating .chip-blur-in Notification */}
        <div className="relative flex flex-col justify-between overflow-hidden rounded-[24px] border border-[#d6dfd3] bg-[#e6ece4]/65 p-5 sm:p-7 lg:col-span-7">
          {/* Floating Chip Notification */}
          <div className="mb-4 flex items-center justify-between gap-2">
            <span className="font-numeric text-[10px] font-semibold uppercase tracking-[0.06em] text-[#5d7166]">
              Stage Preview · Step {currentStep.num}
            </span>
            <div
              key={`chip-${activeIdx}`}
              className={`chip-blur-in inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-numeric text-[11px] font-semibold ${
                currentStep.chipTone === "mint"
                  ? "bg-[#e4f5eb] text-[#21744e]"
                  : "bg-[#ffece9] text-[#a8342a]"
              }`}
            >
              <span>{currentStep.chip}</span>
            </div>
          </div>

          <AnimatePresence mode="wait">
            {activeIdx === 0 && (
              <motion.div
                key="stage-0"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.34, ease: EASE_OUT_EXPO }}
                className="card-surface flex-1 space-y-4 rounded-[20px] p-5"
              >
                <div className="flex items-center gap-2 text-xs font-semibold text-[#15171c]">
                  <SlidersHorizontal className="h-4 w-4 text-[#10372a]" />
                  <span>Deterministic Spending Policy</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-[12px] border border-[#e3e6eb] bg-[#f2f4ef] p-3.5">
                    <p className="text-[11px] text-[#5d7166]">Max Per Trade</p>
                    <p className="mt-1 font-numeric text-2xl font-semibold text-[#15171c]">
                      $50.00
                    </p>
                    <div className="mt-2 h-1.5 w-full rounded-full bg-[#e3e6eb]">
                      <div className="h-full w-1/2 rounded-full bg-[#10372a]" />
                    </div>
                  </div>
                  <div className="rounded-[12px] border border-[#e3e6eb] bg-[#f2f4ef] p-3.5">
                    <p className="text-[11px] text-[#5d7166]">Total Session Cap</p>
                    <p className="mt-1 font-numeric text-2xl font-semibold text-[#15171c]">
                      $100.00
                    </p>
                    <div className="mt-2 h-1.5 w-full rounded-full bg-[#e3e6eb]">
                      <div className="h-full w-3/4 rounded-full bg-[#21744e]" />
                    </div>
                  </div>
                </div>
                <div className="rounded-[12px] border border-[#e3e6eb] bg-[#ffffff] p-3.5 font-numeric text-[11px] text-[#5d7166]">
                  allowedTargets: [Native USDC, Uniswap V3 SwapRouter02] · TTL: 3600s
                </div>
              </motion.div>
            )}

            {activeIdx === 1 && (
              <motion.div
                key="stage-1"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.34, ease: EASE_OUT_EXPO }}
                className="card-surface flex-1 space-y-4 rounded-[20px] p-5"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-semibold text-[#15171c]">
                    <KeyRound className="h-4 w-4 text-[#10372a]" />
                    <span>Altana EIP-7702 Session Delegation</span>
                  </div>
                  <span className="rounded-full bg-[#e4f5eb] px-2.5 py-0.5 font-numeric text-[10px] font-semibold text-[#21744e]">
                    NON-CUSTODIAL
                  </span>
                </div>
                <div className="space-y-2 rounded-[12px] border border-[#e3e6eb] bg-[#f2f4ef] p-4 font-numeric text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-[#5d7166]">Admin Key</span>
                    <span className="font-semibold text-[#15171c]">Never Exposed</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#5d7166]">KeyStore Registry</span>
                    <span className="text-[#10372a]">0x83b3…d27c (Celo)</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#5d7166]">Scoped Selector</span>
                    <span className="text-[#21744e]">transfer(address,uint256)</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#5d7166]">Mainnet Grant Tx</span>
                    <span className="text-[#15171c]">0x9280…954a</span>
                  </div>
                </div>
              </motion.div>
            )}

            {activeIdx === 2 && (
              <motion.div
                key="stage-2"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.34, ease: EASE_OUT_EXPO }}
                className="card-surface flex-1 space-y-4 rounded-[20px] p-5"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-semibold text-[#15171c]">
                    <Power className="h-4 w-4 text-[#a8342a]" />
                    <span>Autonomous Execution &amp; 1-Tx Revoke</span>
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-full bg-[#ffece9] px-2.5 py-0.5 font-numeric text-[10px] font-semibold text-[#a8342a]">
                    <Lock className="h-3 w-3" /> 1-TX KILL-SWITCH
                  </span>
                </div>
                <div className="space-y-2.5 text-xs">
                  <div className="flex items-center justify-between rounded-[10px] bg-[#e4f5eb] px-3.5 py-2.5 text-[#21744e]">
                    <span className="font-medium">0.05 USDC Split Settled (ERC-8021)</span>
                    <span className="font-numeric font-semibold">0xcb30…1c27</span>
                  </div>
                  <div className="flex items-center justify-between rounded-[10px] bg-[#ffece9] px-3.5 py-2.5 text-[#a8342a]">
                    <span className="font-medium">1-Tx Revoke Invalidated KeyStore Key</span>
                    <span className="font-numeric font-semibold">0x1455…d320</span>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}
