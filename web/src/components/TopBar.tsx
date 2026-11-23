import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronDown, Copy, LogOut, Terminal, Wallet } from "lucide-react";
import { CapRailLogo } from "./CapRailLogo.js";
import { GitHubIcon } from "./GitHubIcon.js";
import { CAPRAIL_GITHUB_URL, CELO_CHAIN_ID } from "../data/mainnetProof.js";
import type { LiveWalletState } from "../lib/liveWallet.js";
import { shortenAddress } from "../lib/sandboxBridge.js";

export type AppRunMode = "SANDBOX" | "LIVE_WALLET";
export type AppRoute = "OVERVIEW" | "APP" | "VERIFY";

const EASE_OUT_EXPO = [0.22, 1, 0.36, 1] as const;

interface TopBarProps {
  route: AppRoute;
  onNavigate: (route: AppRoute) => void;
  runMode: AppRunMode;
  onModeChange: (mode: AppRunMode) => void;
  liveWallet: LiveWalletState;
  isConnecting: boolean;
  onConnectWallet: () => void;
  onDisconnectWallet: () => void;
}

const NAV_ITEMS: readonly { id: AppRoute; label: string; href: string }[] = [
  { id: "OVERVIEW", label: "Overview", href: "#/" },
  { id: "APP", label: "Launch App", href: "#app" },
  { id: "VERIFY", label: "Judge & Proof", href: "#verify" },
];

export function TopBar({
  route,
  onNavigate,
  runMode,
  onModeChange,
  liveWallet,
  isConnecting,
  onConnectWallet,
  onDisconnectWallet,
}: TopBarProps) {
  const [scrolled, setScrolled] = useState(false);
  const [walletMenuOpen, setWalletMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 24);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!walletMenuOpen) return;
    function handleOutsideClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setWalletMenuOpen(false);
      }
    }
    function handleEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setWalletMenuOpen(false);
    }
    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [walletMenuOpen]);

  async function handleCopyAddress() {
    if (!liveWallet.address) return;
    await navigator.clipboard.writeText(liveWallet.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function handleDisconnect() {
    setWalletMenuOpen(false);
    onDisconnectWallet();
  }

  return (
    <div className="fixed inset-x-0 top-4 z-40 px-4 sm:px-6">
      <header
        className={`mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 rounded-[16px] border px-4 py-2 backdrop-blur-md transition-all duration-300 ${
          scrolled
            ? "border-[#e3e6eb] bg-[#ffffff]/94 shadow-[0_12px_36px_rgba(10,40,30,0.12)]"
            : "border-[#e3e6eb]/90 bg-[#ffffff]/90 shadow-[0_8px_24px_rgba(10,40,30,0.08)]"
        }`}
      >
        {/* Left: CR Monogram + Wordmark + Celo · 42220 */}
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => onNavigate("OVERVIEW")}
            className="flex cursor-pointer items-center gap-2 text-left"
          >
            <CapRailLogo size={30} />
            <span className="text-[15px] font-semibold tracking-[-0.03em] text-[#15171c]">
              CapRail
            </span>
          </button>

          <span className="hidden items-center gap-1.5 rounded-full bg-[#e4f5eb] px-2.5 py-0.5 text-[11px] font-medium text-[#21744e] md:inline-flex">
            <span className="h-1.5 w-1.5 rounded-full bg-[#21744e]" />
            <span>Celo</span>
            <span className="font-numeric">· {CELO_CHAIN_ID}</span>
          </span>
        </div>

        {/* Center: 3-Page Switcher */}
        <nav
          aria-label="Primary navigation"
          className="relative inline-flex items-center rounded-full border border-[#e3e6eb] bg-[#f2f4ef] p-0.5"
        >
          {NAV_ITEMS.map((item) => {
            const active = route === item.id;
            return (
              <a
                key={item.id}
                href={item.href}
                onClick={(e) => {
                  e.preventDefault();
                  onNavigate(item.id);
                }}
                aria-current={active ? "page" : undefined}
                className={`relative z-10 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
                  active ? "text-[#ffffff]" : "text-[#5d7166] hover:text-[#15171c]"
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="metrivo-nav-pill"
                    transition={{ duration: 0.36, ease: EASE_OUT_EXPO }}
                    className="absolute inset-0 -z-10 rounded-full bg-[#10372a]"
                  />
                )}
                {item.label}
              </a>
            );
          })}
        </nav>

        {/* Right: Sandbox vs Connect Wallet + GitHub Repo Icon */}
        <div className="flex items-center gap-2">
          <div ref={menuRef} className="relative">
            <div
              role="tablist"
              aria-label="Execution mode"
              className="relative inline-flex rounded-full border border-[#e3e6eb] bg-[#f2f4ef] p-0.5"
            >
            <button
              type="button"
              role="tab"
              aria-selected={runMode === "SANDBOX"}
              onClick={() => {
                setWalletMenuOpen(false);
                onModeChange("SANDBOX");
              }}
              className={`relative z-10 inline-flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                runMode === "SANDBOX"
                  ? "text-[#15171c]"
                  : "text-[#5d7166] hover:text-[#15171c]"
              }`}
            >
              {runMode === "SANDBOX" && (
                <motion.span
                  layoutId="metrivo-mode-pill"
                  transition={{ duration: 0.32, ease: EASE_OUT_EXPO }}
                  className="absolute inset-0 -z-10 rounded-full border border-[#e3e6eb] bg-[#ffffff] shadow-[0_1px_2px_rgba(21,23,28,0.06)]"
                />
              )}
              <Terminal className="h-3.5 w-3.5" />
              <span>Sandbox</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={runMode === "LIVE_WALLET"}
              aria-expanded={liveWallet.connected ? walletMenuOpen : undefined}
              disabled={isConnecting}
              onClick={() => {
                onModeChange("LIVE_WALLET");
                if (!liveWallet.connected) {
                  onConnectWallet();
                } else {
                  setWalletMenuOpen((open) => !open);
                }
              }}
              className={`relative z-10 inline-flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-60 ${
                runMode === "LIVE_WALLET"
                  ? "text-[#15171c]"
                  : "text-[#5d7166] hover:text-[#15171c]"
              }`}
            >
              {runMode === "LIVE_WALLET" && (
                <motion.span
                  layoutId="metrivo-mode-pill"
                  transition={{ duration: 0.32, ease: EASE_OUT_EXPO }}
                  className="absolute inset-0 -z-10 rounded-full border border-[#e3e6eb] bg-[#ffffff] shadow-[0_1px_2px_rgba(21,23,28,0.06)]"
                />
              )}
              <Wallet className="h-3.5 w-3.5 text-[#10372a]" />
              {liveWallet.connected && liveWallet.address ? (
                <>
                  <span className="font-numeric">
                    {shortenAddress(liveWallet.address)}
                  </span>
                  <ChevronDown
                    className={`h-3 w-3 text-[#5d7166] transition-transform duration-200 ${
                      walletMenuOpen ? "rotate-180" : ""
                    }`}
                  />
                </>
              ) : (
                <span>{isConnecting ? "Connecting…" : "Connect Wallet"}</span>
              )}
            </button>
          </div>

          {/* Connected Wallet Dropdown (Copy Address + Disconnect Wallet) */}
          <AnimatePresence>
            {walletMenuOpen && liveWallet.connected && liveWallet.address && (
              <motion.div
                initial={{ opacity: 0, y: 6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 6, scale: 0.98 }}
                transition={{ duration: 0.18, ease: EASE_OUT_EXPO }}
                className="card-surface absolute right-0 mt-2 w-60 overflow-hidden rounded-[16px] p-2 shadow-[0_14px_34px_rgba(16,55,42,0.14)]"
              >
                <div className="rounded-[10px] bg-[#f2f4ef] px-3 py-2.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.05em] text-[#5d7166]">
                      Celo Mainnet
                    </span>
                    <span className="inline-flex items-center gap-1 font-numeric text-[10px] font-medium text-[#21744e]">
                      <span className="h-1.5 w-1.5 rounded-full bg-[#21744e]" />
                      Connected
                    </span>
                  </div>
                  <p className="mt-1 font-numeric text-xs font-semibold text-[#15171c]">
                    {shortenAddress(liveWallet.address)}
                  </p>
                  <div className="mt-1.5 flex items-center justify-between border-t border-[#e3e6eb] pt-1.5 font-numeric text-[11px] text-[#5d7166]">
                    <span>{liveWallet.celoBalanceFormatted} CELO</span>
                    <span className="font-semibold text-[#15171c]">
                      ${liveWallet.usdcBalanceFormatted} USDC
                    </span>
                  </div>
                </div>

                <div className="mt-1.5 space-y-1">
                  <button
                    type="button"
                    onClick={handleCopyAddress}
                    className="flex w-full cursor-pointer items-center gap-2 rounded-[10px] px-3 py-2 text-xs font-medium text-[#15171c] transition-colors hover:bg-[#f2f4ef]"
                  >
                    {copied ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-[#21744e]" />
                        <span className="text-[#21744e]">Address Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5 text-[#5d7166]" />
                        <span>Copy Address</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={handleDisconnect}
                    className="flex w-full cursor-pointer items-center gap-2 rounded-[10px] px-3 py-2 text-xs font-medium text-[#a8342a] transition-colors hover:bg-[#ffece9]"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    <span>Disconnect Wallet</span>
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          </div>

          <a
            href={CAPRAIL_GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="View CapRail on GitHub"
            title="View CapRail on GitHub"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[#e3e6eb] bg-[#f2f4ef] text-[#5d7166] transition-colors hover:border-[#10372a] hover:bg-[#ffffff] hover:text-[#10372a]"
          >
            <GitHubIcon className="h-4 w-4" />
          </a>
        </div>
      </header>
    </div>
  );
}
