"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { LayoutDashboard, Key, CreditCard, Settings, LogOut, Bot, Menu, X } from "lucide-react";
import { useClawAuth } from "@/hooks/useClawAuth";

const navItems = [
  { label: "Overview", href: "/dashboard", icon: LayoutDashboard },
  { label: "Agents", href: "/dashboard/agents", icon: Bot },
  { label: "API Keys", href: "/dashboard/keys", icon: Key, mobileLabel: "Keys" },
  { label: "Plans", href: "/dashboard/plans", icon: CreditCard },
  { label: "Settings", href: "/dashboard/settings", icon: Settings },
];

export function DashboardNav() {
  const pathname = usePathname();
  const { user, logout } = useClawAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const isActive = (href: string) =>
    pathname === href ||
    (href !== "/dashboard" && pathname.startsWith(href));

  return (
    <>
      {/* Top header bar */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-lg border-b border-border">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14">
            {/* Logo + Dashboard badge */}
            <div className="flex items-center gap-3">
              <Link href="/" className="flex items-center gap-2">
                <span className="text-lg font-bold">
                  <span className="text-foreground">Hyper</span>
                  <span className="text-primary">Claw</span>
                </span>
              </Link>
              <span className="text-xs bg-surface-low text-text-tertiary px-2 py-0.5 rounded">
                Dashboard
              </span>
            </div>

            {/* Desktop nav links */}
            <nav className="hidden md:flex items-center gap-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      isActive(item.href)
                        ? "text-primary bg-[#38D39F]/10"
                        : "text-text-tertiary hover:text-foreground hover:bg-surface-low"
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>

            {/* Desktop right side */}
            <div className="hidden md:flex items-center gap-3">
              {user?.email && (
                <span className="text-sm text-text-muted">
                  {user.email}
                </span>
              )}
              <button
                onClick={logout}
                className="flex items-center gap-1.5 text-sm text-text-tertiary hover:text-foreground transition-colors"
              >
                <LogOut className="w-4 h-4" />
                <span>Logout</span>
              </button>
            </div>

            {/* Mobile hamburger (for user info / logout) */}
            <button
              className="md:hidden p-2 text-text-secondary hover:text-foreground transition-colors"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? (
                <X className="h-5 w-5" />
              ) : (
                <Menu className="h-5 w-5" />
              )}
            </button>
          </div>
        </div>

        {/* Mobile dropdown menu (user info + logout) */}
        {mobileMenuOpen && (
          <div className="md:hidden bg-background border-t border-border px-4 py-3">
            {user?.email && (
              <div className="text-sm text-text-muted mb-3 truncate">
                {user.email}
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
              <span>Logout</span>
            </button>
          </div>
        )}
      </header>

      {/* Mobile bottom tab bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-lg border-t border-border">
        <div className="flex items-center justify-around h-16 px-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex flex-col items-center justify-center gap-0.5 flex-1 py-1 transition-colors ${
                  active
                    ? "text-primary"
                    : "text-text-tertiary"
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[10px] font-medium">
                  {"mobileLabel" in item ? item.mobileLabel : item.label}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
