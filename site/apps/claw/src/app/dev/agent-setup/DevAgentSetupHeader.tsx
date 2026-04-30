"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard } from "lucide-react";
import { useMemo, useSyncExternalStore } from "react";

const navLinks = [
  { label: "Features", href: "/#features" },
  { label: "Pricing", href: "/#pricing" },
  { label: "Docs", href: "https://docs.hypercli.com/hyperclaw", external: true },
];

const defaultEmail = "sam@hypercli.com";
const emailStorageKey = "dev-agent-setup-email";
const emailChangeEvent = "dev-agent-setup-email-change";

function subscribeToEmailChanges(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(emailChangeEvent, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(emailChangeEvent, onStoreChange);
  };
}

function getEmailSnapshot() {
  return window.sessionStorage.getItem(emailStorageKey) ?? defaultEmail;
}

export function DevAgentSetupHeader() {
  const pathname = usePathname();
  const email = useSyncExternalStore(subscribeToEmailChanges, getEmailSnapshot, () => defaultEmail);
  const showLoggedInHeader = pathname !== "/dev/agent-setup/signup";
  const initial = useMemo(() => (email.trim()[0] ?? "S").toUpperCase(), [email]);

  return (
    <header className="fixed left-0 right-0 top-0 z-50 border-b border-border bg-background/80 backdrop-blur-lg">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2">
          <span className="text-xl font-bold">
            <span className="text-foreground">Hyper</span>
            <span className="text-primary">Claw</span>
          </span>
        </Link>

        <nav className="hidden flex-1 items-center justify-center gap-8 md:flex">
          {navLinks.map((link) => {
            const className = "text-sm font-medium text-text-tertiary transition-colors hover:text-foreground";
            return link.external ? (
              <a key={link.label} href={link.href} target="_blank" rel="noopener noreferrer" className={className}>
                {link.label}
              </a>
            ) : (
              <Link key={link.label} href={link.href} className={className}>
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {showLoggedInHeader ? (
            <>
              <Link href="/dev/agent-setup/agents" className="btn-primary hidden items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium sm:inline-flex">
                <LayoutDashboard className="h-4 w-4" />
                Agent workspace
              </Link>
              <div className="inline-flex min-w-0 items-center gap-2 rounded-lg border border-border bg-surface-low px-2.5 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
                <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                  {initial}
                </span>
                <span className="hidden max-w-[180px] truncate text-sm font-medium text-foreground sm:block">{email}</span>
              </div>
            </>
          ) : (
            <>
              <Link href="/dev/agent-setup/signup" className="btn-secondary rounded-lg px-4 py-2 text-sm font-medium">
                Sign In
              </Link>
              <Link href="/dev/agent-setup/signup" className="btn-primary rounded-lg px-4 py-2 text-sm font-medium">
                Get Started
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
