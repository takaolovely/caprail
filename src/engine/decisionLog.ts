import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

export type DecisionLogMode = "DRY_RUN" | "LIVE";
export type DecisionLogOutcome = "EXECUTE" | "DEFER" | "HALTED_NO_GAS";

export interface DecisionLogEntry {
  timestamp: string;
  mode: DecisionLogMode;
  blockNumber: number;
  poolAddress: string;
  sqrtPriceX96: string;
  spotPriceUsdcPerCelo: number;
  twap24hUsdcPerCelo: number;
  deviationBps: number;
  estimatedPoolImpactBps: number;
  decision: DecisionLogOutcome;
  reason: string;
  txHash: string | null;
}

export const DEFAULT_DECISION_LOG_REL_PATH = path.join("logs", "decisions.jsonl");

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Resolves a log file path strictly confined within `workspaceDir`.
 * Rejects path traversal attempts outside `workspaceDir`.
 */
export function resolveConfinedLogPath(
  workspaceDir: string = process.cwd(),
  relativePath: string = DEFAULT_DECISION_LOG_REL_PATH,
): string {
  const root = path.resolve(workspaceDir);
  const resolved = path.resolve(root, relativePath);
  const rel = path.relative(root, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(
      `Path confinement violation: decision log path "${relativePath}" escapes workspace directory`,
    );
  }
  return resolved;
}

/**
 * Formats a `DecisionLogEntry` as a deterministic single-line JSON string,
 * preserving exact `blockNumber` and raw string `sqrtPriceX96`.
 */
export function formatDecisionLogLine(entry: DecisionLogEntry): string {
  const normalized: DecisionLogEntry = {
    timestamp: entry.timestamp,
    mode: entry.mode,
    blockNumber: entry.blockNumber,
    poolAddress: entry.poolAddress,
    sqrtPriceX96: String(entry.sqrtPriceX96),
    spotPriceUsdcPerCelo: entry.spotPriceUsdcPerCelo,
    twap24hUsdcPerCelo: entry.twap24hUsdcPerCelo,
    deviationBps: entry.deviationBps,
    estimatedPoolImpactBps: entry.estimatedPoolImpactBps,
    decision: entry.decision,
    reason: entry.reason,
    txHash: entry.txHash,
  };
  return JSON.stringify(normalized);
}

/**
 * Appends a single decision record to `logs/decisions.jsonl`, creating the
 * parent `logs/` directory automatically if it does not exist.
 */
export function appendDecisionLog(
  entry: DecisionLogEntry,
  opts?: {
    workspaceDir?: string | undefined;
    relativePath?: string | undefined;
  },
): string {
  const logPath = resolveConfinedLogPath(
    opts?.workspaceDir,
    opts?.relativePath,
  );
  const dir = path.dirname(logPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const line = formatDecisionLogLine(entry);
  appendFileSync(logPath, `${line}\n`, "utf8");
  return logPath;
}

/**
 * Reads persisted `DecisionLogEntry` lines from `logs/decisions.jsonl`.
 * Returns an empty array if the file does not exist yet.
 */
export function readDecisionLogs(opts?: {
  workspaceDir?: string | undefined;
  relativePath?: string | undefined;
}): DecisionLogEntry[] {
  const logPath = resolveConfinedLogPath(
    opts?.workspaceDir,
    opts?.relativePath,
  );
  if (!existsSync(logPath)) {
    return [];
  }
  const raw = readFileSync(logPath, "utf8");
  const entries: DecisionLogEntry[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    try {
      const parsed = JSON.parse(trimmed) as DecisionLogEntry;
      if (
        typeof parsed.spotPriceUsdcPerCelo === "number" &&
        typeof parsed.timestamp === "string"
      ) {
        entries.push(parsed);
      }
    } catch {
      // Ignore malformed trailing line without crashing agent ticks
    }
  }
  return entries;
}

/**
 * Computes a rolling 24-hour average spot price from persisted decision logs.
 * Returns `null` if no entries exist within the last 24 hours.
 */
export function computeRolling24hTwapFromLogs(
  entries: readonly DecisionLogEntry[],
  nowMs: number = Date.now(),
): number | null {
  const cutoff = nowMs - TWENTY_FOUR_HOURS_MS;
  const recent = entries.filter((e) => {
    const t = Date.parse(e.timestamp);
    return (
      !Number.isNaN(t) &&
      t >= cutoff &&
      t <= nowMs + 60_000 &&
      Number.isFinite(e.spotPriceUsdcPerCelo) &&
      e.spotPriceUsdcPerCelo > 0
    );
  });

  if (recent.length === 0) {
    return null;
  }

  const sum = recent.reduce((acc, e) => acc + e.spotPriceUsdcPerCelo, 0);
  return Math.round((sum / recent.length) * 1_000_000) / 1_000_000;
}

/**
 * Returns the initial anchor price from the current 7-day rolling window in
 * `logs/decisions.jsonl`, or `null` on cold start.
 */
export function getWeeklyAnchorPriceFromLogs(
  entries: readonly DecisionLogEntry[],
  nowMs: number = Date.now(),
): number | null {
  const cutoff = nowMs - SEVEN_DAYS_MS;
  for (const entry of entries) {
    const t = Date.parse(entry.timestamp);
    if (
      !Number.isNaN(t) &&
      t >= cutoff &&
      Number.isFinite(entry.spotPriceUsdcPerCelo) &&
      entry.spotPriceUsdcPerCelo > 0
    ) {
      return entry.spotPriceUsdcPerCelo;
    }
  }
  return null;
}
