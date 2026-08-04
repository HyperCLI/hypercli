"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, LogOut } from "lucide-react";
import { useTurnkey } from "@turnkey/react-wallet-kit";
import ContactModal from "./ContactModal";
import { HyperCLILogo } from "./HyperCLILogo";
import { PrivyLoginModal } from "./PrivyLogin";
import { ThemeSelector } from "./ThemeSelector";
import { useAuth } from "../providers/AuthProvider";
import { clearLocalAuthTokens, cookieUtils, markAuthLogout } from "../utils/cookies";
import { NAV_URLS } from "../utils/navigation";
import {
  NavigationMenu,
  NavigationMenuList,
  NavigationMenuItem,
  NavigationMenuTrigger,
  NavigationMenuContent,
  NavigationMenuLink,
} from "./ui/navigation-menu";

export default function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [isContactModalOpen, setIsContactModalOpen] = useState(false);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [openMenu, setOpenMenu] = useState<"platform" | "product" | "solutions" | null>(null);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const { logout } = useTurnkey();
  const { isAuthenticated, userInfo } = useAuth();
  const accountInitial = userInfo?.email?.trim()[0]?.toUpperCase() || "U";

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

    // Call Turnkey logout
    if (logout) {
      await logout();
    }

    setMobileMenuOpen(false);

    // Reload page to reset state
    window.location.href = "/";
  };

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 10);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    if (!accountMenuOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!accountMenuRef.current?.contains(event.target as Node)) setAccountMenuOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [accountMenuOpen]);

  const openMenuFullyOpenRef = useRef(false);

  // Track menu open state; only allow closing once the menu has been fully
  // open for a moment so hover transitions between triggers don't flicker
  useEffect(() => {
    if (openMenu) {
      openMenuFullyOpenRef.current = false;
      const timer = setTimeout(() => {
        openMenuFullyOpenRef.current = true;
      }, 200);
      return () => clearTimeout(timer);
    } else {
      openMenuFullyOpenRef.current = false;
    }
  }, [openMenu]);

  const menuValueProps = (menu: "platform" | "product" | "solutions") => ({
    value: openMenu === menu ? menu : undefined,
    onValueChange: (value: string) => {
      if (value === menu) {
        setOpenMenu(menu);
      } else if (openMenuFullyOpenRef.current) {
        setOpenMenu(null);
      }
    },
  });

  return (
    <>
      <header
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
          mobileMenuOpen ? "bg-background" : "bg-background/80"
        } backdrop-blur-lg border-b border-border ${
          scrolled ? "shadow-md" : ""
        }`}
      >
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="flex items-center justify-between h-16">
            {/* Logo */}
            <Link
              href={NAV_URLS.home}
              aria-label="HyperCLI home"
              className="inline-flex hover:opacity-80 transition-opacity"
            >
              <HyperCLILogo decorative className="h-[31px] w-[158px]" />
            </Link>

            {/* Desktop Nav Links */}
            <div className="hidden md:!flex items-center space-x-6">
              {/* Platform dropdown grouping console/agents/playground/models/gpus (Radix) */}
              <NavigationMenu
                data-slot="header-platform"
                viewport={false}
                className="!flex-none"
                {...menuValueProps("platform")}
                delayDuration={150}
                skipDelayDuration={0}
              >
                <NavigationMenuList>
                  <NavigationMenuItem value="platform">
                    <NavigationMenuTrigger className="text-sm !text-text-secondary hover:text-foreground transition-colors cursor-pointer !bg-transparent !px-0 !py-0 !h-auto !rounded-none !shadow-none focus-visible:ring-2 focus-visible:ring-primary/30 data-[state=open]:!text-text-secondary data-[state=open]:!bg-transparent data-[state=open]:hover:!text-text-secondary">
                      Platform
                    </NavigationMenuTrigger>
                    <NavigationMenuContent className="md:w-auto overflow-visible bg-transparent p-0 border-none shadow-none">
                      <div className="bg-surface-low border border-border rounded-lg p-2 shadow-lg w-56">
                        <nav className="flex flex-col">
                          <NavigationMenuLink
                            href={NAV_URLS.console}
                            className="block px-3 py-2 text-sm text-text-secondary hover:text-foreground hover:bg-surface-high rounded-md"
                          >
                            Console
                          </NavigationMenuLink>
                          <NavigationMenuLink
                            href={NAV_URLS.agents}
                            className="block px-3 py-2 text-sm text-text-secondary hover:text-foreground hover:bg-surface-high rounded-md"
                          >
                            Agents
                          </NavigationMenuLink>
                          <NavigationMenuLink
                            href={NAV_URLS.playground}
                            className="block px-3 py-2 text-sm text-text-secondary hover:text-foreground hover:bg-surface-high rounded-md"
                          >
                            Playground
                          </NavigationMenuLink>
                          <NavigationMenuLink
                            href={NAV_URLS.models}
                            className="block px-3 py-2 text-sm text-text-secondary hover:text-foreground hover:bg-surface-high rounded-md"
                          >
                            Models
                          </NavigationMenuLink>
                          <NavigationMenuLink
                            href={NAV_URLS.gpus}
                            className="block px-3 py-2 text-sm text-text-secondary hover:text-foreground hover:bg-surface-high rounded-md"
                          >
                            GPUs
                          </NavigationMenuLink>
                        </nav>
                      </div>
                    </NavigationMenuContent>
                  </NavigationMenuItem>
                </NavigationMenuList>
              </NavigationMenu>

              {/* Product dropdown grouping pricing/capabilities/cli/quickstart/inference (Radix) */}
              <NavigationMenu
                data-slot="header-product"
                viewport={false}
                className="!flex-none"
                {...menuValueProps("product")}
                delayDuration={150}
                skipDelayDuration={0}
              >
                <NavigationMenuList>
                  <NavigationMenuItem value="product">
                    <NavigationMenuTrigger className="text-sm !text-text-secondary hover:text-foreground transition-colors cursor-pointer !bg-transparent !px-0 !py-0 !h-auto !rounded-none !shadow-none focus-visible:ring-2 focus-visible:ring-primary/30 data-[state=open]:!text-text-secondary data-[state=open]:!bg-transparent data-[state=open]:hover:!text-text-secondary">
                      Product
                    </NavigationMenuTrigger>
                    <NavigationMenuContent className="md:w-auto overflow-visible bg-transparent p-0 border-none shadow-none">
                      <div className="bg-surface-low border border-border rounded-lg p-2 shadow-lg w-56">
                        <nav className="flex flex-col">
                          <NavigationMenuLink
                            href={NAV_URLS.pricing}
                            className="block px-3 py-2 text-sm text-text-secondary hover:text-foreground hover:bg-surface-high rounded-md"
                          >
                            Pricing
                          </NavigationMenuLink>
                          <NavigationMenuLink
                            href={NAV_URLS.capabilities}
                            className="block px-3 py-2 text-sm text-text-secondary hover:text-foreground hover:bg-surface-high rounded-md"
                          >
                            Capabilities
                          </NavigationMenuLink>
                          <NavigationMenuLink
                            href={NAV_URLS.cli}
                            className="block px-3 py-2 text-sm text-text-secondary hover:text-foreground hover:bg-surface-high rounded-md"
                          >
                            CLI
                          </NavigationMenuLink>
                          <NavigationMenuLink
                            href={NAV_URLS.quickstart}
                            className="block px-3 py-2 text-sm text-text-secondary hover:text-foreground hover:bg-surface-high rounded-md"
                          >
                            Quickstart
                          </NavigationMenuLink>
                          <NavigationMenuLink
                            href={NAV_URLS.inference}
                            className="block px-3 py-2 text-sm text-text-secondary hover:text-foreground hover:bg-surface-high rounded-md"
                          >
                            Inference
                          </NavigationMenuLink>
                        </nav>
                      </div>
                    </NavigationMenuContent>
                  </NavigationMenuItem>
                </NavigationMenuList>
              </NavigationMenu>

              {/* Solutions dropdown grouping for-teams/developers/enterprise/data-center (Radix) */}
              <NavigationMenu
                data-slot="header-solutions"
                viewport={false}
                className="!flex-none"
                {...menuValueProps("solutions")}
                delayDuration={150}
                skipDelayDuration={0}
              >
                <NavigationMenuList>
                  <NavigationMenuItem value="solutions">
                    <NavigationMenuTrigger className="text-sm !text-text-secondary hover:text-foreground transition-colors cursor-pointer !bg-transparent !px-0 !py-0 !h-auto !rounded-none !shadow-none focus-visible:ring-2 focus-visible:ring-primary/30 data-[state=open]:!text-text-secondary data-[state=open]:!bg-transparent data-[state=open]:hover:!text-text-secondary">
                      Solutions
                    </NavigationMenuTrigger>
                    <NavigationMenuContent className="md:w-auto overflow-visible bg-transparent p-0 border-none shadow-none">
                      <div className="bg-surface-low border border-border rounded-lg p-2 shadow-lg w-56">
                        <nav className="flex flex-col">
                          <NavigationMenuLink
                            href={NAV_URLS.forTeams}
                            className="block px-3 py-2 text-sm text-text-secondary hover:text-foreground hover:bg-surface-high rounded-md"
                          >
                            For Teams
                          </NavigationMenuLink>
                          <NavigationMenuLink
                            href={NAV_URLS.developers}
                            className="block px-3 py-2 text-sm text-text-secondary hover:text-foreground hover:bg-surface-high rounded-md"
                          >
                            Developers
                          </NavigationMenuLink>
                          <NavigationMenuLink
                            href={NAV_URLS.enterprise}
                            className="block px-3 py-2 text-sm text-text-secondary hover:text-foreground hover:bg-surface-high rounded-md"
                          >
                            Enterprise
                          </NavigationMenuLink>
                          <NavigationMenuLink
                            href={NAV_URLS.dataCenter}
                            className="block px-3 py-2 text-sm text-text-secondary hover:text-foreground hover:bg-surface-high rounded-md"
                          >
                            Data Center
                          </NavigationMenuLink>
                        </nav>
                      </div>
                    </NavigationMenuContent>
                  </NavigationMenuItem>
                </NavigationMenuList>
              </NavigationMenu>

              <a
                href={NAV_URLS.docs}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-text-secondary hover:text-foreground transition-colors"
              >
                Docs
              </a>
              <a
                href={NAV_URLS.status}
                className="text-sm text-text-secondary hover:text-foreground transition-colors"
              >
                Status
              </a>
              <button
                onClick={openContactModal}
                className="text-sm text-text-secondary hover:text-foreground transition-colors cursor-pointer"
              >
                Contact
              </button>
            </div>

            {/* Desktop CTAs - Only show on medium screens and up */}
            <div className="hidden md:!flex items-center space-x-3">
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
                        <p className="truncate text-sm font-medium">{userInfo?.email || "HyperCLI account"}</p>
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
                  <ThemeSelector />
                  <button
                    onClick={openLoginModal}
                    className="px-5 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover transition-colors font-medium"
                  >
                    Login
                  </button>
                </>
              )}
            </div>

            {/* Mobile Menu Button - Only show on small screens */}
            <div className="block md:!hidden">
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

        {/* Mobile Menu - Only show on small screens when hamburger is clicked */}
        <div
          className={`bg-surface-low border-t border-border md:!hidden ${
            mobileMenuOpen ? "block" : "hidden"
          }`}
        >
          <div className="px-2 pt-2 pb-3 space-y-1 sm:px-3">
            {[
              { label: "Agents", href: NAV_URLS.agents },
              { label: "Console", href: NAV_URLS.console },
              { label: "Playground", href: NAV_URLS.playground },
              { label: "Models", href: NAV_URLS.models },
              { label: "GPUs", href: NAV_URLS.gpus },
              { label: "Pricing", href: NAV_URLS.pricing },
              { label: "Capabilities", href: NAV_URLS.capabilities },
              { label: "CLI", href: NAV_URLS.cli },
              { label: "Quickstart", href: NAV_URLS.quickstart },
              { label: "Inference", href: NAV_URLS.inference },
              { label: "For Teams", href: NAV_URLS.forTeams },
              { label: "Developers", href: NAV_URLS.developers },
              { label: "Enterprise", href: NAV_URLS.enterprise },
              { label: "Data Center", href: NAV_URLS.dataCenter },
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
            <div className="border-t border-border-medium mt-4 pt-4">
              {isAuthenticated ? (
                <button
                  onClick={handleLogoutClick}
                  className="block w-full text-center text-secondary-foreground hover:text-foreground font-semibold py-2 px-4 rounded-lg"
                >
                  Logout
                </button>
              ) : (
                <button
                  onClick={openLoginModal}
                  className="block w-full text-center bg-primary text-primary-foreground font-semibold py-2 px-4 rounded-lg hover:bg-primary-hover transition-colors"
                >
                  Login
                </button>
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
        onSuccess={() => window.location.reload()}
      />
    </>
  );
}
