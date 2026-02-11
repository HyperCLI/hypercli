"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useTurnkey } from "@turnkey/react-wallet-kit";
import ContactModal from "./ContactModal";
import { WalletAuth } from "./WalletAuth";
import { useAuth } from "../providers/AuthProvider";
import { cookieUtils } from "../utils/cookies";
import { NAV_URLS } from "../utils/navigation";
import { 
  initializeTheme, 
  toggleTheme as toggleThemeUtil, 
  subscribeToThemeChanges,
  type Theme 
} from "../utils/theme";
import { useRef } from "react";
import { Moon, Sun } from "lucide-react";
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
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [platformMenuOpen, setPlatformMenuOpen] = useState(false);
  const [platformMenuFullyOpen, setPlatformMenuFullyOpen] = useState(false);
  const [solutionsMenuOpen, setSolutionsMenuOpen] = useState(false);
  const [solutionsMenuFullyOpen, setSolutionsMenuFullyOpen] = useState(false);
  const { logout } = useTurnkey();
  const { isAuthenticated } = useAuth();

  const openContactModal = () => {
    setIsContactModalOpen(true);
    setMobileMenuOpen(false);
  };

  const openLoginModal = () => {
    setIsLoginModalOpen(true);
    setMobileMenuOpen(false);
  };

  const handleLogoutClick = async () => {
    // Clear auth cookie
    cookieUtils.remove('auth_token')

    // Call Turnkey logout
    if (logout) {
      await logout()
    }

    setMobileMenuOpen(false);

    // Reload page to reset state
    window.location.href = '/';
  };

  // Load and apply theme
  useEffect(() => {
    const currentTheme = initializeTheme();
    setTheme(currentTheme);

    // Subscribe to theme changes from other tabs/apps
    const unsubscribe = subscribeToThemeChanges((newTheme) => {
      setTheme(newTheme);
    });

    return unsubscribe;
  }, []);

  const toggleTheme = () => {
    const newTheme = toggleThemeUtil();
    setTheme(newTheme);
  };

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 10);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const productRef = useRef<HTMLDivElement | null>(null);
  const platformMenuFullyOpenRef = useRef(false);
  const solutionsMenuFullyOpenRef = useRef(false);

  // Track menu states
  useEffect(() => {
    if (platformMenuOpen) {
      platformMenuFullyOpenRef.current = false;
      // Close the other menu
      if (solutionsMenuOpen) {
        setSolutionsMenuOpen(false);
      }
      const timer = setTimeout(() => {
        platformMenuFullyOpenRef.current = true;
      }, 200);
      return () => clearTimeout(timer);
    } else {
      platformMenuFullyOpenRef.current = false;
    }
  }, [platformMenuOpen, solutionsMenuOpen]);

  useEffect(() => {
    if (solutionsMenuOpen) {
      solutionsMenuFullyOpenRef.current = false;
      // Close the other menu
      if (platformMenuOpen) {
        setPlatformMenuOpen(false);
      }
      const timer = setTimeout(() => {
        solutionsMenuFullyOpenRef.current = true;
      }, 200);
      return () => clearTimeout(timer);
    } else {
      solutionsMenuFullyOpenRef.current = false;
    }
  }, [solutionsMenuOpen, platformMenuOpen]);

  return (
    <>
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 bg-background/80 backdrop-blur-lg border-b border-border ${
        scrolled ? "shadow-md" : ""
      }`}
    >
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
        <nav className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href={NAV_URLS.home} className="hover:opacity-80 transition-opacity">
            <span className="text-xl font-semibold">
              <span className="text-foreground">Hyper</span>
              <span className="text-primary">CLI</span>
            </span>
          </Link>

          {/* Desktop Nav Links */}
          <div className="hidden md:!flex items-center space-x-6">
            <a href={NAV_URLS.chat} className="text-sm text-text-secondary hover:text-foreground transition-colors">
              Chat
            </a>

            {/* Product dropdown grouping console/playground/models/gpus/launch (Radix) */}
            <NavigationMenu 
              data-slot="header-product" 
              viewport={false} 
              className="!flex-none" 
              value={platformMenuOpen ? "platform" : undefined}
              onValueChange={(value) => {
                const shouldOpen = value === "platform";
                if (shouldOpen) {
                  setPlatformMenuOpen(true);
                } else if (platformMenuFullyOpenRef.current) {
                  setPlatformMenuOpen(false);
                }
              }}
              delayDuration={150}
              skipDelayDuration={0}
            >
              <NavigationMenuList>
                <NavigationMenuItem value="platform">
                    <NavigationMenuTrigger className="text-sm !text-text-secondary hover:text-foreground transition-colors cursor-pointer !bg-transparent !px-0 !py-0 !h-auto !rounded-none !shadow-none focus-visible:ring-2 focus-visible:ring-primary/30 data-[state=open]:!text-text-secondary data-[state=open]:!bg-transparent data-[state=open]:hover:!text-text-secondary">Platform</NavigationMenuTrigger>
                  <NavigationMenuContent className="md:w-auto overflow-visible bg-transparent p-0 border-none shadow-none">
                    <div className="bg-surface-low border border-border rounded-lg p-2 shadow-lg w-56">
                      <nav className="flex flex-col">
                        <NavigationMenuLink href={NAV_URLS.console} className="block px-3 py-2 text-sm text-text-secondary hover:text-foreground hover:bg-surface-high rounded-md">Console</NavigationMenuLink>
                        <NavigationMenuLink href={NAV_URLS.playground} className="block px-3 py-2 text-sm text-text-secondary hover:text-foreground hover:bg-surface-high rounded-md">Playground</NavigationMenuLink>
                        <NavigationMenuLink href={NAV_URLS.models} className="block px-3 py-2 text-sm text-text-secondary hover:text-foreground hover:bg-surface-high rounded-md">Models</NavigationMenuLink>
                        <NavigationMenuLink href={NAV_URLS.gpus} className="block px-3 py-2 text-sm text-text-secondary hover:text-foreground hover:bg-surface-high rounded-md">GPUs</NavigationMenuLink>
                        <NavigationMenuLink href={NAV_URLS.launch} className="block px-3 py-2 text-sm text-text-secondary hover:text-foreground hover:bg-surface-high rounded-md">Launch</NavigationMenuLink>
                      </nav>
                    </div>
                  </NavigationMenuContent>
                </NavigationMenuItem>
              </NavigationMenuList>
            </NavigationMenu>

            {/* Solutions dropdown grouping partners/enterprise/data-center (Radix) */}
            <NavigationMenu 
              data-slot="header-solutions" 
              viewport={false} 
              className="!flex-none" 
              value={solutionsMenuOpen ? "solutions" : undefined}
              onValueChange={(value) => {
                const shouldOpen = value === "solutions";
                if (shouldOpen) {
                  setSolutionsMenuOpen(true);
                } else if (solutionsMenuFullyOpenRef.current) {
                  setSolutionsMenuOpen(false);
                }
              }}
              delayDuration={150}
              skipDelayDuration={0}
            >
              <NavigationMenuList>
                <NavigationMenuItem value="solutions">
                    <NavigationMenuTrigger className="text-sm !text-text-secondary hover:text-foreground transition-colors cursor-pointer !bg-transparent !px-0 !py-0 !h-auto !rounded-none !shadow-none focus-visible:ring-2 focus-visible:ring-primary/30 data-[state=open]:!text-text-secondary data-[state=open]:!bg-transparent data-[state=open]:hover:!text-text-secondary">Solutions</NavigationMenuTrigger>
                  <NavigationMenuContent className="md:w-auto overflow-visible bg-transparent p-0 border-none shadow-none">
                    <div className="bg-surface-low border border-border rounded-lg p-2 shadow-lg w-56">
                      <nav className="flex flex-col">
                        <NavigationMenuLink href={NAV_URLS.partner} className="block px-3 py-2 text-sm text-text-secondary hover:text-foreground hover:bg-surface-high rounded-md">Partners</NavigationMenuLink>
                        <NavigationMenuLink href={NAV_URLS.enterprise} className="block px-3 py-2 text-sm text-text-secondary hover:text-foreground hover:bg-surface-high rounded-md">Enterprise</NavigationMenuLink>
                        <NavigationMenuLink href="/data-center" className="block px-3 py-2 text-sm text-text-secondary hover:text-foreground hover:bg-surface-high rounded-md">Data Center</NavigationMenuLink>
                      </nav>
                    </div>
                  </NavigationMenuContent>
                </NavigationMenuItem>
              </NavigationMenuList>
            </NavigationMenu>

            <a href={NAV_URLS.docs} target="_blank" rel="noopener noreferrer" className="text-sm text-text-secondary hover:text-foreground transition-colors">
              Docs
            </a>
            <button onClick={openContactModal} className="text-sm text-text-secondary hover:text-foreground transition-colors cursor-pointer">
              Contact
            </button>
          </div>

          {/* Desktop CTAs - Only show on medium screens and up */}
          <div className="hidden md:!flex items-center space-x-3">
            <button
              onClick={toggleTheme}
              className="p-2 text-text-secondary hover:text-foreground transition-colors cursor-pointer"
              aria-label="Toggle theme"
            >
              {theme === "light" ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
            </button>
            {isAuthenticated ? (
              <button onClick={handleLogoutClick} className="px-4 py-2 text-sm text-text-secondary hover:text-foreground transition-colors cursor-pointer">
                Logout
              </button>
            ) : (
              <button onClick={openLoginModal} className="px-5 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover transition-colors font-medium">
                Login
              </button>
            )}
          </div>

          {/* Mobile Menu Button - Only show on small screens */}
          <div className="block md:!hidden">
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="text-foreground hover:text-primary focus:outline-none"
              aria-label="Toggle mobile menu"
            >
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
          <a
            href={NAV_URLS.chat}
            className="block px-3 py-2 rounded-md text-base font-medium text-text-secondary hover:text-foreground hover:bg-surface-high"
            onClick={() => setMobileMenuOpen(false)}
          >
            Chat
          </a>
          <a
            href={NAV_URLS.console}
            className="block px-3 py-2 rounded-md text-base font-medium text-text-secondary hover:text-foreground hover:bg-surface-high"
            onClick={() => setMobileMenuOpen(false)}
          >
            Console
          </a>
          <a
            href={NAV_URLS.gpus}
            className="block px-3 py-2 rounded-md text-base font-medium text-text-secondary hover:text-foreground hover:bg-surface-high"
            onClick={() => setMobileMenuOpen(false)}
          >
            GPUs
          </a>
          <a
            href={NAV_URLS.models}
            className="block px-3 py-2 rounded-md text-base font-medium text-text-secondary hover:text-foreground hover:bg-surface-high"
            onClick={() => setMobileMenuOpen(false)}
          >
            Models
          </a>
          <a
            href={NAV_URLS.playground}
            className="block px-3 py-2 rounded-md text-base font-medium text-text-secondary hover:text-foreground hover:bg-surface-high"
            onClick={() => setMobileMenuOpen(false)}
          >
            Playground
          </a>
          <a
            href={NAV_URLS.launch}
            className="block px-3 py-2 rounded-md text-base font-medium text-text-secondary hover:text-foreground hover:bg-surface-high"
            onClick={() => setMobileMenuOpen(false)}
          >
            Launch
          </a>
          <a
            href={NAV_URLS.docs}
            target="_blank"
            rel="noopener noreferrer"
            className="block px-3 py-2 rounded-md text-base font-medium text-text-secondary hover:text-foreground hover:bg-surface-high"
            onClick={() => setMobileMenuOpen(false)}
          >
            Docs
          </a>
          <a
            href={NAV_URLS.partner}
            className="block px-3 py-2 rounded-md text-base font-medium text-text-secondary hover:text-foreground hover:bg-surface-high"
            onClick={() => setMobileMenuOpen(false)}
          >
            Partners
          </a>
          <a
            href={NAV_URLS.enterprise}
            className="block px-3 py-2 rounded-md text-base font-medium text-text-secondary hover:text-foreground hover:bg-surface-high"
            onClick={() => setMobileMenuOpen(false)}
          >
            Enterprise
          </a>
          <a
            href="/data-center"
            className="block px-3 py-2 rounded-md text-base font-medium text-text-secondary hover:text-foreground hover:bg-surface-high"
            onClick={() => setMobileMenuOpen(false)}
          >
            Data Center
          </a>
          <button
            onClick={openContactModal}
            className="block w-full text-left px-3 py-2 rounded-md text-base font-medium text-text-secondary hover:text-foreground hover:bg-surface-high"
          >
            Contact
          </button>
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

    <ContactModal isOpen={isContactModalOpen} onClose={() => setIsContactModalOpen(false)} source="header-talk-to-sales" />

    {/* Login Modal - Outside header to avoid backdrop-blur stacking context issues */}
    {isLoginModalOpen && (
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
        <div className="bg-surface-low border border-border-medium rounded-2xl shadow-2xl p-8 max-w-md w-full relative">
          {/* Close button */}
          <button
            onClick={() => setIsLoginModalOpen(false)}
            className="absolute top-4 right-4 text-text-muted hover:text-foreground transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          {/* WalletAuth component */}
          <WalletAuth
            showTitle={true}
            title="Welcome to HyperCLI Console"
            description="Please sign in to continue"
            onEmailLoginClick={() => setIsLoginModalOpen(false)}
            onAuthSuccess={() => {
              setIsLoginModalOpen(false);
              window.location.reload();
            }}
          />
        </div>
      </div>
    )}
    </>
  );
}
