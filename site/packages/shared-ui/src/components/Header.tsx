"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useTurnkey } from "@turnkey/react-wallet-kit";
import ContactModal from "./ContactModal";
import { WalletAuth } from "./WalletAuth";
import { useAuth } from "../providers/AuthProvider";
import { cookieUtils } from "../utils/cookies";
import { NAV_URLS } from "../utils/navigation";

export default function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [isContactModalOpen, setIsContactModalOpen] = useState(false);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
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

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 10);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <>
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 bg-[#0B0D0E]/80 backdrop-blur-lg border-b border-[#2A2D2F] ${
        scrolled ? "shadow-md" : ""
      }`}
    >
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
        <nav className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href={NAV_URLS.home} className="flex items-center space-x-2 hover:opacity-80 transition-opacity">
            <div className="w-8 h-8 bg-[#38D39F] rounded-md flex items-center justify-center">
              <span className="text-[#0B0D0E] text-lg font-semibold">H</span>
            </div>
            <span className="text-xl font-semibold">
              <span className="text-white">Hyper</span>
              <span className="text-[#38D39F]">CLI</span>
            </span>
          </Link>

          {/* Desktop Nav Links */}
          <div className="hidden md:!flex items-center space-x-6">
            <a href={NAV_URLS.chat} className="text-sm text-[#D4D6D7] hover:text-white transition-colors">
              Chat
            </a>
            <a href={NAV_URLS.console} className="text-sm text-[#D4D6D7] hover:text-white transition-colors">
              Console
            </a>
            <a href={NAV_URLS.gpus} className="text-sm text-[#D4D6D7] hover:text-white transition-colors">
              GPUs
            </a>
            <a href={NAV_URLS.models} className="text-sm text-[#D4D6D7] hover:text-white transition-colors">
              Models
            </a>
            <a href={NAV_URLS.playground} className="text-sm text-[#D4D6D7] hover:text-white transition-colors">
              Playground
            </a>
            <a href={NAV_URLS.launch} className="text-sm text-[#D4D6D7] hover:text-white transition-colors">
              Launch
            </a>
            <a href={NAV_URLS.partner} className="text-sm text-[#D4D6D7] hover:text-white transition-colors">
              Partners
            </a>

            <a href={NAV_URLS.docs} target="_blank" rel="noopener noreferrer" className="text-sm text-[#D4D6D7] hover:text-white transition-colors">
              Docs
            </a>
            <button onClick={openContactModal} className="text-sm text-[#D4D6D7] hover:text-white transition-colors">
              Contact
            </button>
          </div>

          {/* Desktop CTAs - Only show on medium screens and up */}
          <div className="hidden md:!flex items-center space-x-3">
            {isAuthenticated ? (
              <button onClick={handleLogoutClick} className="px-4 py-2 text-sm text-[#D4D6D7] hover:text-white transition-colors">
                Logout
              </button>
            ) : (
              <button onClick={openLoginModal} className="px-5 py-2 text-sm bg-[#38D39F] text-[#0B0D0E] rounded-lg hover:bg-[#45E4AE] transition-colors font-medium">
                Login
              </button>
            )}
          </div>

          {/* Mobile Menu Button - Only show on small screens */}
          <div className="block md:!hidden">
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="text-white hover:text-[#38D39F] focus:outline-none"
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
        className={`bg-[#161819] border-t border-[#2A2D2F] md:!hidden ${
          mobileMenuOpen ? "block" : "hidden"
        }`}
      >
        <div className="px-2 pt-2 pb-3 space-y-1 sm:px-3">
          <a
            href={NAV_URLS.chat}
            className="block px-3 py-2 rounded-md text-base font-medium text-[#D4D6D7] hover:text-white hover:bg-[#1D1F21]"
            onClick={() => setMobileMenuOpen(false)}
          >
            Chat
          </a>
          <a
            href={NAV_URLS.console}
            className="block px-3 py-2 rounded-md text-base font-medium text-[#D4D6D7] hover:text-white hover:bg-[#1D1F21]"
            onClick={() => setMobileMenuOpen(false)}
          >
            Console
          </a>
          <a
            href={NAV_URLS.gpus}
            className="block px-3 py-2 rounded-md text-base font-medium text-[#D4D6D7] hover:text-white hover:bg-[#1D1F21]"
            onClick={() => setMobileMenuOpen(false)}
          >
            GPUs
          </a>
          <a
            href={NAV_URLS.models}
            className="block px-3 py-2 rounded-md text-base font-medium text-[#D4D6D7] hover:text-white hover:bg-[#1D1F21]"
            onClick={() => setMobileMenuOpen(false)}
          >
            Models
          </a>
          <a
            href={NAV_URLS.playground}
            className="block px-3 py-2 rounded-md text-base font-medium text-[#D4D6D7] hover:text-white hover:bg-[#1D1F21]"
            onClick={() => setMobileMenuOpen(false)}
          >
            Playground
          </a>
          <a
            href={NAV_URLS.launch}
            className="block px-3 py-2 rounded-md text-base font-medium text-[#D4D6D7] hover:text-white hover:bg-[#1D1F21]"
            onClick={() => setMobileMenuOpen(false)}
          >
            Launch
          </a>
          <a
            href={NAV_URLS.docs}
            target="_blank"
            rel="noopener noreferrer"
            className="block px-3 py-2 rounded-md text-base font-medium text-[#D4D6D7] hover:text-white hover:bg-[#1D1F21]"
            onClick={() => setMobileMenuOpen(false)}
          >
            Docs
          </a>
          <button
            onClick={openContactModal}
            className="block w-full text-left px-3 py-2 rounded-md text-base font-medium text-[#D4D6D7] hover:text-white hover:bg-[#1D1F21]"
          >
            Contact
          </button>
          <div className="border-t border-[#2A2D2F] mt-4 pt-4">
            {isAuthenticated ? (
              <button
                onClick={handleLogoutClick}
                className="block w-full text-center text-[#D4D6D7] hover:text-white font-semibold py-2 px-4 rounded-lg"
              >
                Logout
              </button>
            ) : (
              <button
                onClick={openLoginModal}
                className="block w-full text-center bg-[#38D39F] text-[#0B0D0E] font-semibold py-2 px-4 rounded-lg hover:bg-[#45E4AE] transition-colors"
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
        <div className="bg-[#161819] border border-[#2A2D2F] rounded-2xl shadow-2xl p-8 max-w-md w-full relative">
          {/* Close button */}
          <button
            onClick={() => setIsLoginModalOpen(false)}
            className="absolute top-4 right-4 text-[#6E7375] hover:text-white transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          {/* WalletAuth component */}
          <WalletAuth
            showTitle={true}
            title="Sign In"
            description="Choose how you want to sign in"
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