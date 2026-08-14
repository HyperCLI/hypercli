"use client";

import { useCallback, useContext, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, ExternalLink, LogOut } from "lucide-react";
import { useTurnkey } from "@turnkey/react-wallet-kit";
import ContactModal from "./ContactModal";
import { HyperCLILogo } from "./HyperCLILogo";
import { PrivyLoginModal } from "./PrivyLogin";
import { ThemeSelector } from "./ThemeSelector";
import { ThemeToggle } from "./ThemeToggle";
import { AuthContext as SharedAuthContext } from "../providers/AuthProvider";
import { AuthContext as PrivyAuthContext } from "../auth/AuthProvider";
import { clearLocalAuthTokens, cookieUtils, markAuthLogout } from "../utils/cookies";
import { NAV_URLS } from "../utils/navigation";

type TrackId = "teams" | "dev" | "ent";

interface SubLink {
  label: string;
  href: string;
  paths: string[];
  external?: boolean;
}

const CHANNEL_PATHS = ["/slack", "/teams", "/telegram", "/whatsapp", "/discord", "/buzz"];
const HEADER_COLLAPSE_SCROLL_Y = 80;

const TRACKS: Record<TrackId, { paths: string[]; links: SubLink[] }> = {
  teams: {
    paths: ["/for-teams", "/what-it-can-do", ...CHANNEL_PATHS],
    links: [
      { label: "Overview", href: NAV_URLS.forTeams, paths: ["/for-teams"] },
      { label: "What it can do", href: NAV_URLS.whatItCanDo, paths: ["/what-it-can-do"] },
      { label: "Channels", href: NAV_URLS.slack, paths: CHANNEL_PATHS },
      { label: "Pricing", href: NAV_URLS.pricing, paths: ["/pricing"] },
    ],
  },
  dev: {
    paths: ["/developers", "/capabilities", "/cli", "/inference", "/quickstart", "/pricing"],
    links: [
      { label: "Overview", href: NAV_URLS.developers, paths: ["/developers"] },
      { label: "Capabilities", href: NAV_URLS.capabilities, paths: ["/capabilities"] },
      { label: "CLI", href: NAV_URLS.cli, paths: ["/cli"] },
      { label: "Inference", href: NAV_URLS.inference, paths: ["/inference"] },
      { label: "Channels", href: NAV_URLS.slack, paths: CHANNEL_PATHS },
      { label: "Docs", href: NAV_URLS.docs, paths: [], external: true },
      { label: "Pricing", href: NAV_URLS.pricing, paths: ["/pricing"] },
    ],
  },
  ent: {
    paths: ["/enterprise", "/security", "/self-hosted", "/pilot-program"],
    links: [
      { label: "Overview", href: NAV_URLS.enterprise, paths: ["/enterprise"] },
      { label: "Self-Hosted", href: NAV_URLS.selfHosted, paths: ["/self-hosted"] },
      { label: "Pilot Program", href: NAV_URLS.pilotProgram, paths: ["/pilot-program"] },
      { label: "Security", href: NAV_URLS.security, paths: ["/security"] },
      { label: "Pricing", href: NAV_URLS.pricing, paths: ["/pricing"] },
    ],
  },
};

const AUDIENCE_LINKS: { label: string; href: string; track: TrackId }[] = [
  { label: "Teams", href: NAV_URLS.forTeams, track: "teams" },
  { label: "Developers", href: NAV_URLS.developers, track: "dev" },
  { label: "Enterprise", href: NAV_URLS.enterprise, track: "ent" },
];

function detectTrack(pathname: string): TrackId | null {
  for (const track of Object.keys(TRACKS) as TrackId[]) {
    if (TRACKS[track].paths.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
      return track;
    }
  }
  return null;
}

export interface HeaderProps {
  homepage?: boolean;
  loginApiBaseUrl?: string;
  loginTokenStorageKey?: string;
}

// Mounted only when the shared (Turnkey-backed) auth provider is present,
// since TurnkeyProvider always wraps it. Exposes Turnkey logout without
// requiring every consumer of Header to mount a TurnkeyProvider.
function TurnkeyLogoutBridge({ register }: { register: (logout: (() => Promise<void>) | null) => void }) {
  const { logout } = useTurnkey();
  useEffect(() => {
    register(logout ? async () => { await logout(); } : null);
    return () => register(null);
  }, [logout, register]);
  return null;
}

export default function Header({ homepage = false, loginApiBaseUrl, loginTokenStorageKey }: HeaderProps = {}) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isCondensed, setIsCondensed] = useState(false);
  const [isContactModalOpen, setIsContactModalOpen] = useState(false);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const sharedAuth = useContext(SharedAuthContext);
  const privyAuth = useContext(PrivyAuthContext);
  const turnkeyLogoutRef = useRef<(() => Promise<void>) | null>(null);
  const registerTurnkeyLogout = useCallback((fn: (() => Promise<void>) | null) => {
    turnkeyLogoutRef.current = fn;
  }, []);

  const isAuthenticated = sharedAuth?.isAuthenticated ?? privyAuth?.isAuthenticated ?? false;
  const accountEmail = sharedAuth?.userInfo?.email ?? privyAuth?.user?.email ?? null;
  const accountInitial = accountEmail?.trim()[0]?.toUpperCase() || "U";

  const track = detectTrack(pathname);
  const trackLinks = track ? TRACKS[track].links : null;

  const openContactModal = () => {
    setIsContactModalOpen(true);
    setMobileMenuOpen(false);
  };

  const openLoginModal = () => {
    setIsLoginModalOpen(true);
    setMobileMenuOpen(false);
  };

  const handleLogoutClick = async () => {
    markAuthLogout();
    cookieUtils.remove("auth_token");
    clearLocalAuthTokens("app_auth_token", "claw_auth_token");

    if (sharedAuth) {
      if (turnkeyLogoutRef.current) {
        await turnkeyLogoutRef.current();
      }
    } else if (privyAuth) {
      await privyAuth.logout();
    }

    setMobileMenuOpen(false);

    // Reload page to reset state
    window.location.href = "/";
  };

  useEffect(() => {
    if (!accountMenuOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!accountMenuRef.current?.contains(event.target as Node)) setAccountMenuOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [accountMenuOpen]);

  useEffect(() => {
    const desktopQuery = window.matchMedia("(min-width: 1024px)");
    const updateHeader = () => {
      setIsCondensed(!homepage && desktopQuery.matches && window.scrollY > HEADER_COLLAPSE_SCROLL_Y);
    };

    updateHeader();
    window.addEventListener("scroll", updateHeader, { passive: true });
    desktopQuery.addEventListener("change", updateHeader);
    return () => {
      window.removeEventListener("scroll", updateHeader);
      desktopQuery.removeEventListener("change", updateHeader);
    };
  }, [homepage, pathname]);

  return (
    <>
      {sharedAuth ? <TurnkeyLogoutBridge register={registerTurnkeyLogout} /> : null}
      <header
        data-condensed={isCondensed ? "true" : "false"}
        className={`fixed top-0 left-0 right-0 z-50 ${
          mobileMenuOpen ? "bg-background" : "bg-background/80"
        } backdrop-blur-lg border-b border-border`}
      >
        <div
          className={`${homepage ? "max-w-[1120px] px-6" : "max-w-[1400px] px-4 sm:px-6 lg:px-8"} mx-auto ${
            isCondensed ? "lg:hidden" : ""
          }`}
        >
          <nav className={`flex items-center justify-between ${homepage ? "h-[58px] sm:h-[66px]" : "h-16"}`}>
            {/* Logo */}
            <Link
              href={NAV_URLS.home}
              aria-label="HyperCLI home"
              className="inline-flex hover:opacity-80 transition-opacity"
            >
              <HyperCLILogo decorative className="h-[31px] w-[158px]" />
            </Link>

            {/* Audience pill segmented control */}
            <nav
              aria-label="Audience"
              className="hidden lg:!flex items-center gap-0.5 rounded-full bg-surface-low p-1"
            >
              {AUDIENCE_LINKS.map((link) => {
                const isActive = track === link.track;
                return (
                  <a
                    key={link.label}
                    href={link.href}
                    aria-current={isActive ? "page" : undefined}
                    className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-surface-high text-foreground shadow-sm"
                        : "text-text-muted hover:text-foreground"
                    }`}
                  >
                    {link.label}
                  </a>
                );
              })}
            </nav>

            {/* Desktop CTAs */}
            <div className="hidden lg:!flex items-center space-x-4">
              <button
                onClick={openContactModal}
                className="text-sm text-text-muted hover:text-foreground transition-colors cursor-pointer"
              >
                Contact
              </button>
              {isAuthenticated ? (
                <div ref={accountMenuRef} className="relative">
                  <button
                    type="button"
                    aria-label="Open account menu"
                    aria-expanded={accountMenuOpen}
                    onClick={() => setAccountMenuOpen((open) => !open)}
                    className="inline-flex h-9 items-center gap-2 rounded-lg px-2 text-text-secondary transition-colors hover:bg-surface-high hover:text-foreground"
                  >
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-high text-xs font-bold text-foreground">{accountInitial}</span>
                    <ChevronDown aria-hidden="true" className={`h-3.5 w-3.5 transition-transform ${accountMenuOpen ? "rotate-180" : ""}`} />
                  </button>
                  {accountMenuOpen ? (
                    <div role="menu" className="absolute right-0 top-11 w-60 rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-xl">
                      <div className="border-b border-border px-3 py-2">
                        <p className="truncate text-sm font-medium">{accountEmail || "HyperCLI account"}</p>
                      </div>
                      <ThemeSelector menu aria-label="Appearance theme" className="mt-1 w-full" />
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => { setAccountMenuOpen(false); void handleLogoutClick(); }}
                        className="flex h-9 w-full items-center gap-2 rounded-lg px-3 text-left text-sm font-medium text-text-secondary transition-colors hover:bg-surface-high hover:text-foreground"
                      >
                        <LogOut aria-hidden="true" className="h-4 w-4" />
                        Logout
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : (
                <>
                  <ThemeToggle className="border border-border bg-surface-low/70 shadow-sm" />
                  <button
                    onClick={openLoginModal}
                    className="text-sm font-medium text-text-muted hover:text-foreground transition-colors cursor-pointer whitespace-nowrap"
                  >
                    Sign in
                  </button>
                </>
              )}
              <a
                href={NAV_URLS.agents}
                className="btn-primary whitespace-nowrap rounded-full px-5 py-2 text-sm font-semibold"
              >
                Get started
              </a>
            </div>

            {/* Mobile Menu Button */}
            <div className="block lg:!hidden">
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="text-foreground hover:text-primary focus:outline-none"
                aria-label="Toggle mobile menu"
              >
                <svg
                  className="h-6 w-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 6h16M4 12h16m-7 6h7"
                  />
                </svg>
              </button>
            </div>
          </nav>
        </div>

        {isCondensed ? (
          <div data-slot="condensed-header" className="hidden lg:!block">
            <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-3 px-8">
              <Link
                href={NAV_URLS.home}
                aria-label="HyperCLI home"
                className="inline-flex shrink-0 transition-opacity hover:opacity-80"
              >
                <HyperCLILogo markOnly decorative className="h-6 w-6" />
              </Link>

              <nav aria-label="Audience" className="flex shrink-0 items-center gap-0.5 rounded-full bg-surface-low p-1">
                {AUDIENCE_LINKS.map((link) => {
                  const isActive = track === link.track;
                  return (
                    <a
                      key={link.label}
                      href={link.href}
                      aria-current={isActive ? "page" : undefined}
                      className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                        isActive
                          ? "bg-surface-high text-foreground shadow-sm"
                          : "text-text-muted hover:text-foreground"
                      }`}
                    >
                      {link.label}
                    </a>
                  );
                })}
              </nav>

              {trackLinks ? (
                <nav
                  aria-label="Section"
                  className="flex min-w-0 flex-1 items-center gap-4 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                >
                  {trackLinks.map((link) => {
                    const isActive = link.paths.some(
                      (path) => pathname === path || pathname.startsWith(`${path}/`),
                    );
                    return (
                      <a
                        key={link.label}
                        href={link.href}
                        aria-current={isActive ? "page" : undefined}
                        {...(link.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                        className={`flex h-14 shrink-0 items-center whitespace-nowrap border-b-2 text-xs font-medium transition-colors ${
                          isActive
                            ? "border-primary text-foreground"
                            : "border-transparent text-text-muted hover:text-foreground"
                        }`}
                      >
                        {link.label}
                        {link.external ? <ExternalLink aria-hidden="true" className="ml-1 h-3 w-3" /> : null}
                      </a>
                    );
                  })}
                </nav>
              ) : (
                <span className="flex-1" />
              )}

              <ThemeToggle className="shrink-0 border border-border bg-surface-low/70 shadow-sm" />

              <a
                href={NAV_URLS.agents}
                className="btn-primary shrink-0 whitespace-nowrap rounded-full px-4 py-2 text-xs font-semibold"
              >
                Get started
              </a>
            </div>
          </div>
        ) : null}

        {/* Tier 2: per-track sub-bar */}
        {trackLinks && !isCondensed ? (
          <nav aria-label="Section" className="hidden lg:!block border-t border-border">
            <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex items-center gap-6 h-11 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {trackLinks.map((link) => {
                  const isActive = link.paths.some(
                    (p) => pathname === p || pathname.startsWith(`${p}/`),
                  );
                  const className = `flex items-center self-stretch whitespace-nowrap border-b-2 text-sm font-medium transition-colors ${
                    isActive
                      ? "border-primary text-foreground"
                      : "border-transparent text-text-muted hover:text-foreground"
                  }`;
                  return (
                    <a
                      key={link.label}
                      href={link.href}
                      aria-current={isActive ? "page" : undefined}
                      {...(link.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                      className={className}
                    >
                      {link.label}
                      {link.external ? <ExternalLink aria-hidden="true" className="ml-1 h-3 w-3" /> : null}
                    </a>
                  );
                })}
              </div>
            </div>
          </nav>
        ) : null}

        {/* Mobile Menu */}
        <div
          className={`bg-surface-low border-t border-border lg:!hidden ${
            mobileMenuOpen ? "block" : "hidden"
          }`}
        >
          <div className="px-2 pt-2 pb-3 space-y-1 sm:px-3">
            {AUDIENCE_LINKS.map((link) => (
              <a
                key={link.label}
                href={link.href}
                className={`block px-3 py-2 rounded-md text-base font-medium ${
                  track === link.track
                    ? "text-foreground bg-surface-high"
                    : "text-text-secondary hover:text-foreground hover:bg-surface-high"
                }`}
                onClick={() => setMobileMenuOpen(false)}
              >
                {link.label}
              </a>
            ))}
            {trackLinks ? (
              <div className="border-t border-border-medium mt-2 pt-2 space-y-1">
                {trackLinks.map((link) => (
                  <a
                    key={link.label}
                    href={link.href}
                    {...(link.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                    className="block px-3 py-2 rounded-md text-base font-medium text-text-secondary hover:text-foreground hover:bg-surface-high"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    {link.label}
                    {link.external ? " ↗" : ""}
                  </a>
                ))}
              </div>
            ) : null}
            <div className="border-t border-border-medium mt-2 pt-2 space-y-1">
              {[
                { label: "Agents", href: NAV_URLS.agents },
                { label: "Console", href: NAV_URLS.console },
                { label: "Playground", href: NAV_URLS.playground },
                { label: "Models", href: NAV_URLS.models },
                { label: "GPUs", href: NAV_URLS.gpus },
                { label: "Status", href: NAV_URLS.status },
              ].map((item) => (
                <a
                  key={item.label}
                  href={item.href}
                  className="block px-3 py-2 rounded-md text-base font-medium text-text-secondary hover:text-foreground hover:bg-surface-high"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {item.label}
                </a>
              ))}
              <a
                href={NAV_URLS.docs}
                target="_blank"
                rel="noopener noreferrer"
                className="block px-3 py-2 rounded-md text-base font-medium text-text-secondary hover:text-foreground hover:bg-surface-high"
                onClick={() => setMobileMenuOpen(false)}
              >
                Docs
              </a>
              <button
                onClick={openContactModal}
                className="block w-full text-left px-3 py-2 rounded-md text-base font-medium text-text-secondary hover:text-foreground hover:bg-surface-high"
              >
                Contact
              </button>
              <ThemeSelector className="w-full" />
            </div>
            <div className="border-t border-border-medium mt-4 pt-4 space-y-2">
              {isAuthenticated ? (
                <button
                  onClick={handleLogoutClick}
                  className="block w-full text-center text-secondary-foreground hover:text-foreground font-semibold py-2 px-4 rounded-lg"
                >
                  Logout
                </button>
              ) : (
                <>
                  <a
                    href={NAV_URLS.agents}
                    className="btn-primary block w-full text-center font-semibold py-2 px-4 rounded-lg"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    Get started
                  </a>
                  <button
                    onClick={openLoginModal}
                    className="block w-full text-center text-secondary-foreground hover:text-foreground font-semibold py-2 px-4 rounded-lg"
                  >
                    Sign in
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      <ContactModal
        isOpen={isContactModalOpen}
        onClose={() => setIsContactModalOpen(false)}
        source="header-talk-to-sales"
      />

      <PrivyLoginModal
        isOpen={isLoginModalOpen}
        onClose={() => setIsLoginModalOpen(false)}
        title="Welcome to HyperCLI Console"
        description="Please sign in to continue"
        showTurnkeyFallback={true}
        apiBaseUrl={loginApiBaseUrl}
        tokenStorageKey={loginTokenStorageKey}
        onSuccess={() => window.location.reload()}
      />
    </>
  );
}
