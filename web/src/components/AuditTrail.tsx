import { useState } from "react";
import { ChevronDown, ChevronRight, Code, Trash2 } from "lucide-react";
import {
  formatUsdcDisplay,
  shortenAddress,
  type AuditEvent,
} from "../lib/sandboxBridge.js";

interface AuditTrailProps {
  events: readonly AuditEvent[];
  onClear: () => void;
}

export function AuditTrail({ events, onClear }: AuditTrailProps) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  return (
    <section
      aria-label="Live audit trail"
      className="card-surface overflow-hidden rounded-[24px]"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e3e6eb] bg-[#f2f4ef]/70 px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <h2 className="text-sm font-semibold text-[#15171c]">Live Audit Trail</h2>
          <span className="rounded-full bg-[#e6ece4] px-2.5 py-0.5 font-numeric text-[11px] font-medium text-[#10372a]">
            {events.length} {events.length === 1 ? "event" : "events"}
          </span>
        </div>

        {events.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setExpandedIndex(null);
              onClear();
            }}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-[#e3e6eb] bg-[#ffffff] px-3 py-1 text-xs font-medium text-[#5d7166] transition-colors hover:text-[#15171c]"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>Clear Log</span>
          </button>
        )}
      </div>

      {events.length === 0 ? (
        <div className="px-5 py-10 text-center text-xs text-[#5d7166]">
          No policy evaluations recorded yet. Run a Safe Flow or Attack Preset above to
          inspect structured audit logs.
        </div>
      ) : (
        <div className="divide-y divide-[#e3e6eb]">
          {[...events].reverse().map((ev, revIdx) => {
            const origIndex = events.length - 1 - revIdx;
            const isExpanded = expandedIndex === origIndex;
            const amountUnits = BigInt(ev.totalAmount);
            const remainingUnits = BigInt(ev.remainingCap);

            return (
              <div key={`${ev.timestamp}-${origIndex}`} className="bg-[#ffffff]">
                <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-xs">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="font-numeric text-[11px] text-[#5d7166]">
                      {new Date(ev.timestamp).toLocaleTimeString("en-GB", {
                        hour12: false,
                      })}
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-0.5 font-numeric text-[10px] font-semibold ${
                        ev.status === "APPROVED"
                          ? "bg-[#e4f5eb] text-[#21744e]"
                          : "bg-[#ffece9] text-[#a8342a]"
                      }`}
                    >
                      {ev.status}
                    </span>
                    <span className="rounded-full bg-[#f2f4ef] px-2 py-0.5 font-numeric text-[10px] text-[#5d7166]">
                      {ev.engine}
                    </span>
                    <span className="font-medium text-[#15171c]">{ev.action}</span>
                    {ev.reasonCode && (
                      <span className="font-numeric text-[11px] font-semibold text-[#a8342a]">
                        {ev.reasonCode}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-3 font-numeric text-[11px]">
                    <span className="text-[#15171c]">
                      {amountUnits > 0n ? formatUsdcDisplay(amountUnits) : "—"}
                    </span>
                    <span className="hidden text-[#5d7166] sm:inline">
                      rem {formatUsdcDisplay(remainingUnits)}
                    </span>
                    {ev.txHash && (
                      <span className="hidden text-[#5d7166] md:inline">
                        {shortenAddress(ev.txHash)}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedIndex(isExpanded ? null : origIndex)
                      }
                      className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-[#e3e6eb] bg-[#f2f4ef] px-2.5 py-1 text-[11px] text-[#5d7166] transition-colors hover:text-[#15171c]"
                    >
                      <Code className="h-3 w-3" />
                      <span>JSON</span>
                      {isExpanded ? (
                        <ChevronDown className="h-3 w-3" />
                      ) : (
                        <ChevronRight className="h-3 w-3" />
                      )}
                    </button>
                  </div>
                </div>

                {ev.reason && !isExpanded && (
                  <div className="px-5 pb-2.5 font-numeric text-[11px] text-[#5d7166]">
                    {ev.reason}
                  </div>
                )}

                {isExpanded && (
                  <div className="border-t border-[#e3e6eb] bg-[#f2f4ef] px-5 py-3">
                    <pre className="overflow-x-auto rounded-[10px] border border-[#e3e6eb] bg-[#ffffff] p-3 font-numeric text-[11px] leading-relaxed text-[#15171c]">
                      {JSON.stringify(ev, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
