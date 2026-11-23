import { CheckCircle2, ExternalLink, FileJson } from "lucide-react";
import { GitHubIcon } from "./GitHubIcon.js";
import {
  CAPRAIL_AGENT_WALLET,
  CAPRAIL_GITHUB_URL,
  CAPRAIL_METADATA,
  CELO_CHAIN_ID,
  ONCHAIN_NEGATIVE_PROOFS,
  VERIFIED_MAINNET_PROOFS,
} from "../data/mainnetProof.js";
import { shortenAddress } from "../lib/sandboxBridge.js";

interface VerifiedReceiptCardProps {
  onOpenAgentCard: () => void;
  eyebrow?: string;
}

export function VerifiedReceiptCard({
  onOpenAgentCard,
  eyebrow = "VERIFIED MAINNET PROOF RECEIPT",
}: VerifiedReceiptCardProps) {
  return (
    <article className="card-surface relative overflow-hidden rounded-[24px] p-6 sm:p-8">
      {/* Circular Stamped Seal (VERIFIED · CHAIN 42220) */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-5 right-5 hidden -rotate-12 sm:block"
      >
        <svg width="92" height="92" viewBox="0 0 92 92" fill="none">
          <circle
            cx="46"
            cy="46"
            r="42"
            stroke="#21744e"
            strokeWidth="1.5"
            strokeDasharray="3 3"
            opacity="0.7"
          />
          <circle
            cx="46"
            cy="46"
            r="35"
            stroke="#21744e"
            strokeWidth="1.25"
            opacity="0.85"
          />
          <text
            x="46"
            y="42"
            textAnchor="middle"
            fill="#21744e"
            fontSize="9.5"
            fontWeight="700"
            fontFamily="JetBrains Mono, monospace"
            letterSpacing="0.08em"
          >
            VERIFIED
          </text>
          <text
            x="46"
            y="55"
            textAnchor="middle"
            fill="#10372a"
            fontSize="8.5"
            fontWeight="600"
            fontFamily="JetBrains Mono, monospace"
          >
            CHAIN {CELO_CHAIN_ID}
          </text>
        </svg>
      </div>

      {/* Receipt Header */}
      <div className="pr-0 sm:pr-28">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-[#e4f5eb] px-2.5 py-0.5 font-numeric text-[10px] font-semibold text-[#21744e]">
            {eyebrow}
          </span>
          <span className="font-numeric text-[11px] text-[#5d7166]">
            ERC-8021 {CAPRAIL_METADATA.attributionCode}
          </span>
          <a
            href={`https://celoscan.io/address/${CAPRAIL_AGENT_WALLET}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-full border border-[#e3e6eb] bg-[#f2f4ef] px-2.5 py-0.5 font-numeric text-[10.5px] font-medium text-[#15171c] transition-colors hover:border-[#10372a] hover:text-[#10372a]"
          >
            <span>Agent Wallet {shortenAddress(CAPRAIL_AGENT_WALLET)}</span>
            <ExternalLink className="h-2.5 w-2.5" />
          </a>
        </div>

        <h3 className="mt-2.5 text-lg font-semibold text-[#15171c] sm:text-xl">
          Live Celo Mainnet Execution Ledger
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-[#5d7166]">
          Three settled Altana EIP-7702 transactions on Celo Mainnet (Chain ID 42220)
          plus verified smart-contract rejections directly from Altana KeyStore / Relay.
        </p>
      </div>

      {/* Perforated Receipt Divider */}
      <div className="my-5 border-t border-dashed border-[#d5dce0]" />

      {/* 3 Mainnet Transaction Rows */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {VERIFIED_MAINNET_PROOFS.map((proof) => (
          <div
            key={proof.id}
            className="flex flex-col justify-between rounded-[16px] border border-[#e3e6eb] bg-[#f2f4ef]/75 p-4"
          >
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="font-numeric text-[11px] font-semibold text-[#5d7166]">
                  RECEIPT #{proof.step}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 font-numeric text-[10px] font-semibold ${
                    proof.tone === "approved"
                      ? "bg-[#e4f5eb] text-[#21744e]"
                      : proof.tone === "revoked"
                        ? "bg-[#ffece9] text-[#a8342a]"
                        : "bg-[#e6ece4] text-[#10372a]"
                  }`}
                >
                  {proof.tag}
                </span>
              </div>
              <p className="mt-2.5 text-xs font-semibold text-[#15171c]">
                {proof.title}
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-[#5d7166]">
                {proof.detail}
              </p>
            </div>

            <a
              href={proof.celoscanUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex items-center justify-between rounded-full border border-[#e3e6eb] bg-[#ffffff] px-3 py-1.5 font-numeric text-[11px] font-medium text-[#15171c] transition-colors hover:border-[#10372a] hover:text-[#10372a]"
            >
              <span>{shortenAddress(proof.txHash)}</span>
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        ))}
      </div>

      {/* Receipt Footer: On-Chain Negative Tests + ERC-8004 Card Button */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[16px] border border-[#e3e6eb] bg-[#f2f4ef] px-4 py-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1.5 font-medium text-[#15171c]">
            <CheckCircle2 className="h-3.5 w-3.5 text-[#21744e]" />
            On-Chain Altana Rejections:
          </span>
          {ONCHAIN_NEGATIVE_PROOFS.map((neg) => (
            <span
              key={neg.code}
              title={neg.label}
              className="rounded-full bg-[#ffece9] px-2.5 py-0.5 font-numeric text-[11px] font-semibold text-[#a8342a]"
            >
              {neg.code}
            </span>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <a
            href={CAPRAIL_GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full border border-[#e3e6eb] bg-[#ffffff] px-3.5 py-1.5 text-xs font-medium text-[#15171c] transition-colors hover:border-[#10372a] hover:text-[#10372a]"
          >
            <GitHubIcon className="h-3.5 w-3.5" />
            <span>GitHub Source ↗</span>
          </a>

          <button
            type="button"
            onClick={onOpenAgentCard}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-[#10372a] bg-[#10372a] px-3.5 py-1.5 text-xs font-medium text-[#ffffff] transition-colors hover:bg-[#17483a]"
          >
            <FileJson className="h-3.5 w-3.5" />
            <span>ERC-8004 Agent Card</span>
          </button>
        </div>
      </div>
    </article>
  );
}
