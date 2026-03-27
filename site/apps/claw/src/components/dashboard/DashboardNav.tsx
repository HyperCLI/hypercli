"use client";

import { useState, useRef, useEffect, type ComponentType } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  Key,
  CreditCard,
  Settings,
  LogOut,
  Menu,
  X,
  ChevronDown,
  MessageSquare,
  TerminalSquare,
  FolderOpen,
  HardDrive,
  SlidersHorizontal,
  Plug,
  Trash2,
  Loader2,
} from "lucide-react";
import { useAgentAuth } from "@/hooks/useAgentAuth";
import { useDashboardMobileAgentMenu, type AgentMainTab } from "@/components/dashboard/DashboardMobileAgentMenuContext";

const dropdownNavItems = [
  { label: "API Keys", href: "/dashboard/keys", icon: Key },
  { label: "Plans", href: "/dashboard/plans", icon: CreditCard },
  { label: "Billing", href: "/dashboard/billing", icon: CreditCard },
];

export function DashboardNav() {
  const pathname = usePathname();
  const { user, logout } = useAgentAuth();
  const { agentMenu } = useDashboardMobileAgentMenu();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const isActive = (href: string) =>
    pathname === href ||
    (href !== "/dashboard" && pathname.startsWith(href));
  const hideMobileHamburger = pathname.startsWith("/dashboard/agents");

  // Close user menu on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    if (userMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [userMenuOpen]);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  const emailInitial = user?.email ? user.email[0].toUpperCase() : "?";
  const agentTabItems: Array<{ key: AgentMainTab; label: string; icon: ComponentType<{ className?: string }> }> = [
    { key: "chat", label: "Chat", icon: MessageSquare },
    { key: "logs", label: "Logs", icon: TerminalSquare },
    { key: "shell", label: "Shell", icon: TerminalSquare },
    { key: "files", label: "Files", icon: HardDrive },
    { key: "workspace", label: "Workspace", icon: FolderOpen },
    { key: "openclaw", label: "OpenClaw", icon: SlidersHorizontal },
    { key: "integrations", label: "Integrations", icon: Plug },
    { key: "settings", label: "Settings", icon: Settings },
  ];

  return (
    <>
      {/* Top header bar */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-lg border-b border-border">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14">
            {/* Logo + Dashboard badge */}
            <div className="flex items-center space-x-12">
              <Link href="/" className="flex items-center gap-2">
                <span className="text-lg font-bold">
                  <span className="text-foreground">Hyper</span>
                  <span className="text-primary">Claw</span>
                </span>
              </Link>
              <Link href="/dashboard" className="text-md font-medium text-text-tertiary hover:text-foreground transition-colors">
                Dashboard
              </Link>
            </div>

            {/* Right side — avatar dropdown + mobile hamburger */}
            <div className="flex items-center gap-1">
            <div className="flex items-center relative" ref={userMenuRef}>
              <button
                onClick={() => setUserMenuOpen(!userMenuOpen)}
                className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-surface-low transition-colors"
              >
                <div className="w-7 h-7 rounded-full bg-surface-high flex items-center justify-center text-xs font-bold text-foreground">
                  {emailInitial}
                </div>
                <ChevronDown className={`w-3.5 h-3.5 text-text-muted transition-transform ${userMenuOpen ? "rotate-180" : ""}`} />
              </button>

              <AnimatePresence>
                {userMenuOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -4, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -4, scale: 0.97 }}
                    transition={{ duration: 0.15 }}
                    className="absolute right-0 top-12 w-56 rounded-[var(--radius)] border border-white/5 bg-[#141416] p-1 shadow-xl"
                  >
                    {/* User info */}
                    <div className="px-3 py-2 border-b border-border mb-1">
                      <p className="text-sm text-foreground font-medium truncate">{user?.email || "User"}</p>
                    </div>

                    {dropdownNavItems.map((item) => {
                      const Icon = item.icon;
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          onClick={() => setUserMenuOpen(false)}
                          className="flex items-center gap-2 px-3 py-2 text-sm text-text-secondary hover:text-foreground hover:bg-surface-low rounded-md transition-colors"
                        >
                          <Icon className="w-4 h-4" />
                          {item.label}
                        </Link>
                      );
                    })}

                    <Link
                      href="/dashboard/settings"
                      onClick={() => setUserMenuOpen(false)}
                      className="flex items-center gap-2 px-3 py-2 text-sm text-text-secondary hover:text-foreground hover:bg-surface-low rounded-md transition-colors"
                    >
                      <Settings className="w-4 h-4" />
                      Settings
                    </Link>

                    <button
                      onClick={() => {
                        setUserMenuOpen(false);
                        logout();
                      }}
                      className="flex items-center gap-2 px-3 py-2 text-sm text-text-secondary hover:text-foreground hover:bg-surface-low rounded-md transition-colors w-full text-left"
                    >
                      <LogOut className="w-4 h-4" />
                      Sign Out
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Mobile hamburger */}
            {!hideMobileHamburger && (
              <button
                className="md:hidden p-2 text-text-secondary hover:text-foreground transition-colors"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                aria-label={mobileMenuOpen ? "Close navigation menu" : "Open navigation menu"}
              >
                {mobileMenuOpen ? (
                  <X className="h-5 w-5" />
                ) : (
                  <Menu className="h-5 w-5" />
                )}
              </button>
            )}
            </div>
          </div>
        </div>

        {/* Mobile dropdown menu */}
        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="md:hidden bg-background border-t border-border overflow-hidden"
            >
              <div className="px-4 py-3">
                {/* User info */}
                <div className="flex items-center gap-2 mb-3 pb-3 border-b border-border">
                  <div className="w-8 h-8 rounded-full bg-surface-high flex items-center justify-center text-sm font-bold text-foreground">
                    {emailInitial}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-foreground truncate">{user?.email || "User"}</p>
                  </div>
                </div>

                <div className="space-y-1 mb-3 pb-3 border-b border-border">
                  <p className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-text-muted">Account</p>
                  {dropdownNavItems.map((item) => {
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setMobileMenuOpen(false)}
                        className={`flex items-center gap-2 px-2 py-2 rounded-md text-sm transition-colors ${
                          isActive(item.href)
                            ? "text-foreground bg-surface-low"
                            : "text-text-tertiary hover:text-foreground hover:bg-surface-low"
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                        <span>{item.label}</span>
                      </Link>
                    );
                  })}
                </div>

                {agentMenu?.selectedAgentId && (
                  <div className="space-y-1 mb-3 pb-3 border-b border-border">
                    <p className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-text-muted">Agent</p>
                    {agentTabItems.map((item) => {
                      const Icon = item.icon;
                      return (
                        <button
                          key={item.key}
                          onClick={() => {
                            agentMenu.onSelectTab(item.key);
                            setMobileMenuOpen(false);
                          }}
                          className={`w-full flex items-center gap-2 px-2 py-2 rounded-md text-sm transition-colors ${
                            agentMenu.activeTab === item.key
                              ? "text-foreground bg-surface-low"
                              : "text-text-tertiary hover:text-foreground hover:bg-surface-low"
                          }`}
                        >
                          <Icon className="w-4 h-4" />
                          <span>{item.label}</span>
                        </button>
                      );
                    })}
                    <button
                      onClick={() => {
                        agentMenu.onDelete();
                        setMobileMenuOpen(false);
                      }}
                      disabled={agentMenu.deleting}
                      className="w-full flex items-center gap-2 px-2 py-2 rounded-md text-sm text-text-tertiary hover:text-[#d05f5f] hover:bg-surface-low transition-colors disabled:opacity-60"
                    >
                      {agentMenu.deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                      <span>Delete</span>
                    </button>
                  </div>
                )}

                <button
                  onClick={() => {
                    setMobileMenuOpen(false);
                    logout();
                  }}
                  className="flex items-center gap-2 text-sm text-text-tertiary hover:text-foreground transition-colors w-full"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Sign Out</span>
                </button>
              </div>
            </motion.div>
        )}
      </AnimatePresence>
      </header>
    </>
  );
}
