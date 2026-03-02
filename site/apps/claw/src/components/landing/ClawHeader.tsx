"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Menu, X, LogOut } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useClawAuth } from "@/hooks/useClawAuth";

const navLinks = [
  { label: "Features", href: "#features" },
  { label: "Pricing", href: "#pricing" },
  { label: "Docs", href: "https://docs.hypercli.com/hyperclaw", external: true },
];

export function ClawHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const { isAuthenticated, isLoading, login, logout, user } = useClawAuth();
  const router = useRouter();
  const emailInitial = user?.email ? user.email[0].toUpperCase() : "?";

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

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

  // Redirect to dashboard only when user just completed login
  // (auth transitions from false → true), not on every page load
  const wasAuthenticated = useRef(isAuthenticated);
  useEffect(() => {
    if (!isLoading && isAuthenticated && !wasAuthenticated.current) {
      router.push("/dashboard");
    }
    if (!isLoading) {
      wasAuthenticated.current = isAuthenticated;
    }
  }, [isLoading, isAuthenticated, router]);

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        mobileOpen
          ? "bg-background border-b border-border"
          : scrolled
            ? "bg-background/80 backdrop-blur-lg border-b border-border"
            : "bg-transparent"
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <a href="/" className="flex items-center gap-2">
            <span className="text-xl font-bold">
              <span className="text-foreground">Hyper</span>
              <span className="text-primary">Claw</span>
            </span>
          </a>

          {/* Desktop Nav */}
          <nav className="hidden md:flex items-center gap-8">
            {navLinks.map((link) => (
              <a
                key={link.label}
                href={link.href}
                className="nav-link text-sm font-medium"
                {...(link.external
                  ? { target: "_blank", rel: "noopener noreferrer" }
                  : {})}
              >
                {link.label}
              </a>
            ))}
          </nav>

          {/* Desktop Auth */}
          <div className="hidden md:flex items-center gap-3">
            {isLoading ? (
              <div className="w-[100px] h-[36px] rounded-lg bg-surface-low animate-pulse" />
            ) : isAuthenticated ? (
              <div className="flex items-center gap-3">
                <button
                  onClick={() => router.push("/dashboard")}
                  className="btn-primary px-4 py-2 rounded-lg text-sm font-medium"
                >
                  Dashboard
                </button>
                <div className="relative" ref={userMenuRef}>
                  <button
                    onClick={() => setUserMenuOpen(!userMenuOpen)}
                    className="w-8 h-8 rounded-full bg-surface-high flex items-center justify-center text-sm font-bold text-foreground hover:bg-surface-low transition-colors"
                  >
                    {emailInitial}
                  </button>
                  <AnimatePresence>
                    {userMenuOpen && (
                      <motion.div
                        initial={{ opacity: 0, y: -4, scale: 0.97 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -4, scale: 0.97 }}
                        transition={{ duration: 0.15 }}
                        className="absolute right-0 top-10 w-48 glass-card p-1 shadow-xl z-50"
                      >
                        <div className="px-3 py-2 border-b border-border mb-1">
                          <p className="text-sm text-foreground font-medium truncate">{user?.email || "User"}</p>
                        </div>
                        <button
                          onClick={() => { setUserMenuOpen(false); logout(); }}
                          className="flex items-center gap-2 px-3 py-2 text-sm text-text-secondary hover:text-foreground hover:bg-surface-low rounded-md transition-colors w-full text-left"
                        >
                          <LogOut className="w-4 h-4" />
                          Sign Out
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            ) : (
              <>
                <button
                  onClick={login}
                  className="btn-secondary px-4 py-2 rounded-lg text-sm font-medium"
                >
                  Sign In
                </button>
                <button
                  onClick={login}
                  className="btn-primary px-4 py-2 rounded-lg text-sm font-medium"
                >
                  Get Started
                </button>
              </>
            )}
          </div>

          {/* Mobile Menu Button */}
          <button
            className="md:hidden p-2 text-text-secondary hover:text-foreground transition-colors"
            onClick={() => setMobileOpen(!mobileOpen)}
          >
            {mobileOpen ? (
              <X className="h-5 w-5" />
            ) : (
              <Menu className="h-5 w-5" />
            )}
          </button>
        </div>

        {/* Mobile Menu */}
        {mobileOpen && (
          <div className="md:hidden pb-4 border-t border-border mt-2 pt-4 bg-background">
            <nav className="flex flex-col gap-3">
              {navLinks.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  className="nav-link text-sm font-medium px-2 py-1"
                  onClick={() => setMobileOpen(false)}
                  {...(link.external
                    ? { target: "_blank", rel: "noopener noreferrer" }
                    : {})}
                >
                  {link.label}
                </a>
              ))}
            </nav>
            <div className="mt-4 flex flex-col gap-2">
              {isAuthenticated ? (
                <>
                  <button
                    onClick={() => { setMobileOpen(false); router.push("/dashboard"); }}
                    className="btn-primary px-4 py-2 rounded-lg text-sm font-medium w-full"
                  >
                    Dashboard
                  </button>
                  <button
                    onClick={() => { setMobileOpen(false); logout(); }}
                    className="btn-secondary px-4 py-2 rounded-lg text-sm font-medium w-full"
                  >
                    Sign Out
                  </button>
                </>
              ) : (
                <button
                  onClick={() => {
                    setMobileOpen(false);
                    login();
                  }}
                  className="btn-primary px-4 py-2 rounded-lg text-sm font-medium w-full"
                >
                  Get Started
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
