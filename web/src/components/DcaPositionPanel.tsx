import { motion } from "motion/react";
import {
  ExternalLink,
  Lock,
  Play,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { CeloLogo, UniswapLogo, UsdcLogo } from "./BrandIcons.js";
import type { AppRunMode } from "./TopBar.js";

const SPRING_PILL = { type: "spring", stiffness: 400, damping: 32 } as const;

export type DcaFrequency = "Hourly" | "Daily" | "Weekly";

export interface DcaFillRecord {
  orderNumber: number;
  amountUsdc: number;
  celoReceived: number;
  executionPriceUsd: number;
  timestamp: string;
  mode: "LOCAL_SIMULATION" | "CELO_MAINNET";
  txHash?: `0x${string}`;
}

export interface ActiveDcaPosition {
  frequency: DcaFrequency;
  totalOrders: number;
  perOrderUsdc: number;
  totalBudgetUsdc: number;
  spotPriceUsd: number;
  fills: DcaFillRecord[];
}

interface DcaPositionPanelProps {
  position: ActiveDcaPosition;
  runMode: AppRunMode;
  revoked: boolean;
  isExecuting: boolean;
  onSimulateNextFill: () => void;
}

function formatClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function DcaPositionPanel({
  position,
  runMode,
  revoked,
  isExecuting,
  onSimulateNextFill,
}: DcaPositionPanelProps) {
  const filledCount = position.fills.length;
  const totalSpentUsdc = position.fills.reduce((acc, f) => acc + f.amountUsdc, 0);
  const totalCelo = position.fills.reduce((acc, f) => acc + f.celoReceived, 0);
  const avgEntryUsd = totalCelo > 0 ? totalSpentUsdc / totalCelo : position.spotPriceUsd;
  const currentValueUsd = totalCelo * position.spotPriceUsd;
  const pnlPct =
    avgEntryUsd > 0 ? ((position.spotPriceUsd - avgEntryUsd) / avgEntryUsd) * 100 : 0;
  const pnlPositive = pnlPct >= 0;

  const progressPct =
    position.totalOrders > 0
      ? Math.min(100, (filledCount / position.totalOrders) * 100)
      : 0;
  const isCompleted = filledCount >= position.totalOrders;
  const nextOrderNumber = filledCount + 1;

  // Compute SVG chart geometry (clean fintech line chart)
  const chartW = 420;
  const chartH = 128;
  const padL = 16;
  const padR = 74;
  const padT = 18;
  const padB = 26;
  const plotW = chartW - padL - padR;
  const plotH = chartH - padT - padB;

  const prices = position.fills.map((f) => f.executionPriceUsd);
  const allVals = [...prices, avgEntryUsd, position.spotPriceUsd];
  const rawMin = Math.min(...allVals);
  const rawMax = Math.max(...allVals);
  const span = Math.max(0.032, (rawMax - rawMin) * 1.45);
  const mid = (rawMin + rawMax) / 2;
  const minY = mid - span / 2;
  const maxY = mid + span / 2;

  function toY(price: number): number {
    const ratio = (price - minY) / (maxY - minY);
    return padT + plotH - ratio * plotH;
  }

  function toX(index: number): number {
    if (position.totalOrders <= 1) return padL + plotW / 2;
    const denom = Math.max(position.totalOrders - 1, Math.max(1, position.fills.length - 1));
    return padL + (index / denom) * plotW;
  }

  const points = position.fills.map((fill, idx) => ({
    x: toX(idx),
    y: toY(fill.executionPriceUsd),
    fill,
  }));

  const polylineStr = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const areaPathStr =
    points.length >= 2
      ? `M ${points[0]!.x.toFixed(1)} ${(padT + plotH).toFixed(1)} ` +
        points.map((p) => `L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ") +
        ` L ${points[points.length - 1]!.x.toFixed(1)} ${(padT + plotH).toFixed(1)} Z`
      : "";

  const avgY = toY(avgEntryUsd);

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
      aria-label="Active DCA Position and Mini Performance Chart"
      className="card-surface rounded-[24px] p-5 sm:p-6"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="flex items-center -space-x-1.5">
            <UsdcLogo size={22} className="ring-2 ring-[#ffffff]" />
            <CeloLogo size={22} className="ring-2 ring-[#ffffff]" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[#15171c]">
              Active DCA Position
            </h2>
            <p className="inline-flex items-center gap-1 font-numeric text-[10px] text-[#5d7166]">
              <span>USDC → CELO · {position.frequency} ·</span>
              <UniswapLogo size={11} />
              <span>Uniswap V3</span>
            </p>
          </div>
        </div>

        <span
          className={`rounded-full px-2.5 py-0.5 font-numeric text-[10px] font-semibold ${
            revoked
              ? "bg-[#ffece9] text-[#a8342a]"
              : isCompleted
                ? "bg-[#10372a] text-[#ffffff]"
                : "bg-[#e4f5eb] text-[#21744e]"
          }`}
        >
          {revoked
            ? "PAUSED · REVOKED"
            : isCompleted
              ? `COMPLETED (${filledCount}/${position.totalOrders})`
              : `IN PROGRESS (${filledCount}/${position.totalOrders})`}
        </span>
      </div>

      {/* Order Progress Bar */}
      <div className="mt-4">
        <div className="flex items-baseline justify-between gap-2 text-xs">
          <span className="font-medium text-[#15171c]">
            <span className="font-numeric font-semibold">
              {filledCount} / {position.totalOrders}
            </span>{" "}
            Orders Filled
          </span>
          <span className="font-numeric text-[11px] text-[#5d7166]">
            <strong className="text-[#15171c]">${totalSpentUsdc.toFixed(2)}</strong> / $
            {position.totalBudgetUsdc.toFixed(2)} USDC spent
          </span>
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[#e3e6eb]">
          <motion.div
            className="h-full rounded-full"
            initial={false}
            animate={{
              width: `${progressPct}%`,
              backgroundColor: revoked ? "#ff6a5c" : "#10372a",
            }}
            transition={SPRING_PILL}
          />
        </div>
      </div>

      {/* KPI Metrics Grid */}
      <div className="mt-4 grid grid-cols-2 gap-2.5">
        <div className="rounded-[14px] border border-[#e3e6eb] bg-[#f2f4ef] p-3.5">
          <p className="text-[11px] font-medium text-[#5d7166]">Total Accumulated</p>
          <p className="mt-1 flex items-center gap-1.5 font-numeric text-lg font-semibold text-[#15171c]">
            <CeloLogo size={16} />
            <span>{totalCelo.toFixed(2)}</span>
            <span className="text-xs font-medium text-[#5d7166]">CELO</span>
          </p>
          <p className="mt-0.5 font-numeric text-[10px] text-[#5d7166]">
            ≈ ${currentValueUsd.toFixed(2)} USD (@ ${position.spotPriceUsd.toFixed(3)})
          </p>
        </div>

        <div className="rounded-[14px] border border-[#e3e6eb] bg-[#f2f4ef] p-3.5">
          <div className="flex items-center justify-between gap-1">
            <p className="text-[11px] font-medium text-[#5d7166]">Avg Entry Price</p>
            <span
              className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-numeric text-[10px] font-semibold ${
                pnlPositive
                  ? "bg-[#e4f5eb] text-[#21744e]"
                  : "bg-[#ffece9] text-[#a8342a]"
              }`}
            >
              {pnlPositive ? (
                <TrendingUp className="h-2.5 w-2.5" />
              ) : (
                <TrendingDown className="h-2.5 w-2.5" />
              )}
              <span>
                {pnlPositive ? "+" : ""}
                {pnlPct.toFixed(2)}%
              </span>
            </span>
          </div>
          <p className="mt-1 font-numeric text-lg font-semibold text-[#15171c]">
            ${avgEntryUsd.toFixed(3)}
            <span className="text-xs font-medium text-[#5d7166]"> / CELO</span>
          </p>
          <p className="mt-0.5 font-numeric text-[10px] text-[#5d7166]">
            Spot vs Avg entry delta
          </p>
        </div>
      </div>

      {/* Mini SVG Execution Line Chart */}
      <div className="mt-4 rounded-[16px] border border-[#e3e6eb] bg-[#f8faf7] p-3">
        <div className="mb-1.5 flex items-center justify-between text-[10px] text-[#5d7166]">
          <span className="font-semibold uppercase tracking-[0.04em]">
            Execution Fill Curve (USD / CELO)
          </span>
          <span className="font-numeric">
            Spot: <strong className="text-[#15171c]">${position.spotPriceUsd.toFixed(3)}</strong>
          </span>
        </div>

        <svg
          viewBox={`0 0 ${chartW} ${chartH}`}
          className="h-[126px] w-full overflow-visible"
          role="img"
          aria-label={`Mini execution price line chart across ${filledCount} DCA order fills with average entry price $${avgEntryUsd.toFixed(3)}`}
        >
          <defs>
            <linearGradient id="dca-mint-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#21744e" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#21744e" stopOpacity="0.01" />
            </linearGradient>
          </defs>

          {/* Subtle horizontal hairline guides */}
          {[0, 0.5, 1].map((frac) => {
            const y = padT + frac * plotH;
            return (
              <line
                key={frac}
                x1={padL}
                y1={y}
                x2={padL + plotW}
                y2={y}
                stroke="#e3e6eb"
                strokeWidth="1"
              />
            );
          })}

          {/* Dashed Horizontal Average Entry Price Line */}
          <line
            x1={padL}
            y1={avgY}
            x2={padL + plotW}
            y2={avgY}
            stroke="#10372a"
            strokeWidth="1.2"
            strokeDasharray="4 4"
            opacity="0.7"
          />
          <rect
            x={padL + plotW + 6}
            y={avgY - 9}
            width="64"
            height="18"
            rx="9"
            fill="#10372a"
          />
          <text
            x={padL + plotW + 38}
            y={avgY + 3.5}
            textAnchor="middle"
            fill="#ffffff"
            fontSize="9"
            fontWeight="600"
            fontFamily="JetBrains Mono, monospace"
          >
            Avg ${avgEntryUsd.toFixed(3)}
          </text>

          {/* Mint Gradient Fill Under Curve */}
          {areaPathStr && <path d={areaPathStr} fill="url(#dca-mint-fill)" />}

          {/* Execution Polyline */}
          {points.length >= 2 && (
            <polyline
              points={polylineStr}
              fill="none"
              stroke="#21744e"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Planned Order Tick Slots Along X-Axis */}
          {Array.from({ length: position.totalOrders }).map((_, slotIdx) => {
            const sx = toX(slotIdx);
            const isFilled = slotIdx < filledCount;
            const showLabel =
              position.totalOrders <= 6 ||
              slotIdx === 0 ||
              slotIdx === position.totalOrders - 1 ||
              slotIdx % 2 === 0;
            return (
              <g key={`slot-${slotIdx}`}>
                {!isFilled && (
                  <circle
                    cx={sx}
                    cy={avgY}
                    r="2.5"
                    fill="#ffffff"
                    stroke="#c9d3cb"
                    strokeWidth="1.2"
                  />
                )}
                {showLabel && (
                  <text
                    x={sx}
                    y={chartH - 6}
                    textAnchor="middle"
                    fill={isFilled ? "#15171c" : "#5d7166"}
                    fontSize="9"
                    fontWeight={isFilled ? "600" : "400"}
                    fontFamily="JetBrains Mono, monospace"
                  >
                    #{slotIdx + 1}
                  </text>
                )}
              </g>
            );
          })}

          {/* Filled Order Dots */}
          {points.map((pt, i) => {
            const isLatest = i === points.length - 1;
            return (
              <g key={`fill-dot-${pt.fill.orderNumber}`}>
                {isLatest && (
                  <circle
                    cx={pt.x}
                    cy={pt.y}
                    r="8"
                    fill="#21744e"
                    opacity="0.16"
                  />
                )}
                <circle
                  cx={pt.x}
                  cy={pt.y}
                  r={isLatest ? "4.5" : "3.8"}
                  fill={isLatest ? "#10372a" : "#ffffff"}
                  stroke="#21744e"
                  strokeWidth="2"
                >
                  <title>{`Order #${pt.fill.orderNumber}: $${pt.fill.amountUsdc.toFixed(2)} USDC → ${pt.fill.celoReceived.toFixed(2)} CELO @ $${pt.fill.executionPriceUsd.toFixed(3)}`}</title>
                </circle>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Sandbox Interactive Next-Fill Trigger */}
      {runMode === "SANDBOX" && !isCompleted && (
        <div className="mt-3.5">
          <motion.button
            type="button"
            whileTap={{ scale: 0.98 }}
            transition={SPRING_PILL}
            disabled={revoked || isExecuting}
            onClick={onSimulateNextFill}
            className="flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-full border border-[#10372a] bg-[#e6ece4] px-4 text-xs font-semibold text-[#10372a] transition-colors hover:bg-[#10372a] hover:text-[#ffffff] disabled:cursor-not-allowed disabled:border-[#e3e6eb] disabled:bg-[#f2f4ef] disabled:text-[#5d7166]"
          >
            {revoked ? (
              <>
                <Lock className="h-3.5 w-3.5" />
                <span>Session Revoked: Next Fill Blocked</span>
              </>
            ) : isExecuting ? (
              <span>Simulating Bounded Fill…</span>
            ) : (
              <>
                <Play className="h-3.5 w-3.5" />
                <span>
                  Simulate Next Fill (#{nextOrderNumber}/{position.totalOrders}) · $
                  {position.perOrderUsdc.toFixed(2)} USDC
                </span>
              </>
            )}
          </motion.button>
        </div>
      )}

      {/* Per-Order Fill History */}
      <div className="mt-4 border-t border-[#e3e6eb] pt-3.5">
        <div className="flex items-center justify-between text-[11px] text-[#5d7166]">
          <span className="font-medium">Per-Order Fill History</span>
          <span className="font-numeric text-[10px]">
            {runMode === "SANDBOX" ? "LOCAL_SIMULATION" : "CELO_MAINNET"}
          </span>
        </div>

        <ul className="mt-2 max-h-40 divide-y divide-[#e3e6eb] overflow-y-auto rounded-[12px] border border-[#e3e6eb] bg-[#ffffff]">
          {[...position.fills].reverse().map((fill) => (
            <li
              key={`order-fill-${fill.orderNumber}-${fill.timestamp}`}
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[11px]"
            >
              <div className="min-w-0 font-numeric text-[#15171c]">
                <span className="font-semibold text-[#10372a]">
                  Order #{fill.orderNumber}
                </span>{" "}
                <span className="text-[#5d7166]">·</span> ${fill.amountUsdc.toFixed(2)}{" "}
                USDC → <strong>{fill.celoReceived.toFixed(2)} CELO</strong>{" "}
                <span className="text-[#5d7166]">
                  @ ${fill.executionPriceUsd.toFixed(3)}
                </span>
              </div>

              <div className="flex shrink-0 items-center gap-2 font-numeric text-[10px] text-[#5d7166]">
                <span>{formatClock(fill.timestamp)}</span>
                {fill.mode === "CELO_MAINNET" && fill.txHash ? (
                  <a
                    href={`https://celoscan.io/tx/${fill.txHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-0.5 font-semibold text-[#21744e] hover:underline"
                  >
                    Celoscan <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                ) : (
                  <span className="rounded-full bg-[#e4f5eb] px-1.5 py-0.5 text-[9px] font-semibold text-[#21744e]">
                    Filled
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </motion.section>
  );
}
