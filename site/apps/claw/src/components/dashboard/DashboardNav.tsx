"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { LayoutDashboard, Key, CreditCard, Settings, LogOut, Bot } from "lucide-react";
import { useClawAuth } from "@/hooks/useClawAuth";

const navItems = [
  { label: "Overview", href: "/dashboard", icon: LayoutDashboard },
  { label: "Agents", href: "/dashboard/agents", icon: Bot },
  { label: "API Keys", href: "/dashboard/keys", icon: Key },
  { label: "Plans", href: "/dashboard/plans", icon: CreditCard },
  { label: "Settings", href: "/dashboard/settings", icon: Settings },
];

export function DashboardNav() {
  const pathname = usePathname();
  const { user, logout } = useClawAuth();

  return (
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

          {/* Nav links */}
          <nav className="hidden md:flex items-center gap-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive =
                pathname === item.href ||
                (item.href !== "/dashboard" &&
                  pathname.startsWith(item.href));

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    isActive
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

          {/* Right side */}
          <div className="flex items-center gap-3">
            {user?.email && (
              <span className="hidden sm:block text-sm text-text-muted">
                {user.email}
              </span>
            )}
            <button
              onClick={logout}
              className="flex items-center gap-1.5 text-sm text-text-tertiary hover:text-foreground transition-colors"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
