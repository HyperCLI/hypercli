"use client";

import Link from "next/link";

export function Navbar() {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-[#0B0D0E]/80 backdrop-blur-lg border-b border-[#2A2D2F]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Logo */}
          <div className="flex items-center">
            <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
              <div className="w-8 h-8 bg-[#38D39F] rounded-md flex items-center justify-center">
                <span className="text-[#0B0D0E] text-lg font-semibold">H</span>
              </div>
              <span className="text-xl text-white font-semibold">HyperCLI</span>
            </Link>
          </div>

          {/* Navigation Links */}
          <div className="hidden md:flex items-center gap-6">
            <Link
              href="/docs"
              className="text-sm text-[#D4D6D7] hover:text-white transition-colors"
            >
              Docs
            </Link>
            <Link
              href="/pricing"
              className="text-sm text-[#D4D6D7] hover:text-white transition-colors"
            >
              Pricing
            </Link>
            <Link
              href="/enterprise"
              className="text-sm text-[#D4D6D7] hover:text-white transition-colors"
            >
              Enterprise
            </Link>
            <Link
              href="/partners"
              className="text-sm text-[#D4D6D7] hover:text-white transition-colors"
            >
              Partners
            </Link>
          </div>

          {/* Right CTAs */}
          <div className="flex items-center gap-3">
            <button className="hidden sm:inline-flex px-4 py-2 text-sm text-[#D4D6D7] hover:text-white transition-colors">
              Sign In
            </button>
            <button className="px-5 py-2 text-sm bg-[#38D39F] text-[#0B0D0E] rounded-lg hover:bg-[#45E4AE] transition-colors font-medium">
              Get Started
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}
