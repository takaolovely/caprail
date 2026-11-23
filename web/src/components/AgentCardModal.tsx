import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Copy, ExternalLink, FileJson, X } from "lucide-react";
import {
  CAPRAIL_AGENT_CARD,
  CELO_ERC8004_REGISTRY,
} from "../data/mainnetProof.js";

const EASE_OUT_EXPO = [0.22, 1, 0.36, 1] as const;

interface AgentCardModalProps {
  open: boolean;
  onClose: () => void;
}

export function AgentCardModal({ open, onClose }: AgentCardModalProps) {
  const [copied, setCopied] = useState(false);
  const formattedJson = JSON.stringify(CAPRAIL_AGENT_CARD, null, 2);

  async function handleCopy() {
    await navigator.clipboard.writeText(formattedJson);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <AnimatePresence>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="erc8004-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-[#0a281e]/45 backdrop-blur-[2px]"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 10 }}
            transition={{ duration: 0.28, ease: EASE_OUT_EXPO }}
            className="card-surface relative z-10 w-full max-w-xl overflow-hidden rounded-[24px]"
          >
            <div className="flex items-center justify-between border-b border-[#e3e6eb] bg-[#f2f4ef] px-5 py-4">
              <div className="flex items-center gap-2">
                <FileJson className="h-4 w-4 text-[#10372a]" />
                <h3
                  id="erc8004-modal-title"
                  className="text-sm font-semibold text-[#15171c]"
                >
                  ERC-8004 Agent Identity Card
                </h3>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close modal"
                className="cursor-pointer rounded-full p-1.5 text-[#5d7166] hover:bg-[#e6ece4] hover:text-[#15171c]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-[#e3e6eb] bg-[#f2f4ef] px-3.5 py-2.5 text-xs">
                <div>
                  <span className="text-[#5d7166]">Celo Mainnet Registry: </span>
                  <span className="font-numeric font-medium text-[#15171c]">
                    {CELO_ERC8004_REGISTRY}
                  </span>
                </div>
                <a
                  href={`https://celoscan.io/address/${CELO_ERC8004_REGISTRY}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-[#10372a] hover:underline"
                >
                  Celoscan <ExternalLink className="h-3 w-3" />
                </a>
              </div>

              <div className="relative">
                <pre className="max-h-80 overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words rounded-[16px] border border-[#e3e6eb] bg-[#f2f4ef] p-4 pt-11 font-numeric text-[11px] leading-relaxed text-[#15171c]">
                  {formattedJson}
                </pre>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="absolute top-2.5 right-2.5 inline-flex cursor-pointer items-center gap-1 rounded-full border border-[#e3e6eb] bg-[#ffffff] px-3 py-1 text-[11px] font-medium text-[#15171c] hover:bg-[#e6ece4]"
                >
                  {copied ? (
                    <>
                      <Check className="h-3 w-3 text-[#21744e]" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" />
                      <span>Copy JSON</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
