"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn, Button } from "@hypercli/shared-ui";
import {
  LayoutDashboard,
  Rocket,
  Server,
  Settings,
  CreditCard,
  HelpCircle,
  Moon,
  Sun,
} from "lucide-react";
import { useState, useEffect } from "react";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/deployments", label: "Deployments", icon: Rocket },
  { href: "/instances", label: "Instances", icon: Server },
  { href: "/billing", label: "Billing", icon: CreditCard },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Navigation() {
  const pathname = usePathname();
  const [theme, setTheme] = useState<"light" | "dark">("dark");

  // Load and apply theme
  useEffect(() => {
    const savedTheme = localStorage.getItem("hypercli_theme") as "light" | "dark" | null;
    if (savedTheme) {
      setTheme(savedTheme);
      document.documentElement.setAttribute("data-theme", savedTheme);
      document.body.setAttribute("data-theme", savedTheme);
    } else {
      document.documentElement.setAttribute("data-theme", "dark");
      document.body.setAttribute("data-theme", "dark");
    }

    // Listen for theme changes from other tabs
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === "hypercli_theme" && e.newValue) {
        const newTheme = e.newValue as "light" | "dark";
        setTheme(newTheme);
        document.documentElement.setAttribute("data-theme", newTheme);
        document.body.setAttribute("data-theme", newTheme);
      }
    };

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

  const toggleTheme = () => {
    setTheme((prev) => {
      const newTheme = prev === "light" ? "dark" : "light";
      document.documentElement.setAttribute("data-theme", newTheme);
      document.body.setAttribute("data-theme", newTheme);
      localStorage.setItem("hypercli_theme", newTheme);
      return newTheme;
    });
  };

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-lg border-b border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16 items-center">
          {/* Logo */}
          <div className="flex-shrink-0">
            <Link href="/" className="text-xl font-bold text-foreground">
              Hyper<span className="text-primary">CLI</span>
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                Console
              </span>
            </Link>
          </div>

          {/* Navigation Links */}
          <div className="hidden md:flex items-center space-x-1">
            {navIte
              variant="ghost"
              size="icon"
              onClick={toggleTheme}
              className="text-muted-foreground hover:text-foreground"
            >
              {theme === "light" ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
            </Button>
            <Buttonms.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-surface-low"
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </div>

          {/* Right side */}
          <div className="flex items-center space-x-4">
            <Button variant="ghost" size="icon" className="text-muted-foreground">
              <HelpCircle className="h-5 w-5" />
            </Button>
            <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center">
              <span className="text-sm font-medium text-primary">U</span>
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}
