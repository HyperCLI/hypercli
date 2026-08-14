"use client";

import Link from "next/link";
import { NAV_URLS } from "../utils/navigation";
import { HyperCLILogo } from "./HyperCLILogo";

export interface FooterProps {
  compact?: boolean;
}

export default function Footer({ compact = false }: FooterProps = {}) {
  const headingClassName = compact
    ? "mb-3.5 text-xs font-bold uppercase tracking-[0.08em] text-text-muted"
    : "mb-4 text-foreground";
  const listClassName = compact ? "space-y-0.5" : "space-y-3";
  const linkClassName = compact
    ? "block py-1 text-[14.5px] text-muted-foreground transition-colors hover:text-foreground"
    : "text-sm text-muted-foreground transition-colors hover:text-foreground";

  return (
    <footer className="bg-background border-t border-border-medium">
      <div className={compact ? "mx-auto max-w-[1120px] px-6 pb-10 pt-[52px]" : "max-w-[1400px] mx-auto py-12 px-4 sm:px-6 lg:py-16 lg:px-8"}>
        <div className={compact ? "" : "xl:grid xl:grid-cols-5 xl:gap-8"}>
          <div className={compact ? "hidden" : "space-y-8 xl:col-span-1"}>
            <Link href="/" aria-label="HyperCLI home" className="inline-flex hover:opacity-80 transition-opacity">
              <HyperCLILogo decorative className="h-[31px] w-[158px]" />
            </Link>
          </div>
          <div className={compact ? "grid grid-cols-2 gap-8 md:grid-cols-4" : "mt-12 grid grid-cols-2 gap-8 md:grid-cols-4 xl:mt-0 xl:col-span-4"}>
            <div>
              <h3 className={headingClassName}>Product</h3>
              <ul className={listClassName}>
                <li>
                  <Link href={NAV_URLS.capabilities} className={linkClassName}>
                    Capabilities
                  </Link>
                </li>
                <li>
                  <Link href={NAV_URLS.cli} className={linkClassName}>
                    CLI
                  </Link>
                </li>
                <li>
                  <Link href={NAV_URLS.inference} className={linkClassName}>
                    Inference
                  </Link>
                </li>
                <li>
                  <Link href={NAV_URLS.slack} className={linkClassName}>
                    Channels
                  </Link>
                </li>
                <li>
                  <Link href={NAV_URLS.integrations} className={linkClassName}>
                    Integrations
                  </Link>
                </li>
                <li>
                  <Link href={NAV_URLS.pricing} className={linkClassName}>
                    Pricing
                  </Link>
                </li>
              </ul>
            </div>

            <div>
              <h3 className={headingClassName}>Solutions</h3>
              <ul className={listClassName}>
                <li>
                  <Link href={NAV_URLS.forTeams} className={linkClassName}>
                    For teams
                  </Link>
                </li>
                <li>
                  <Link href={NAV_URLS.whatItCanDo} className={linkClassName}>
                    What it can do
                  </Link>
                </li>
                <li>
                  <Link href={NAV_URLS.pilotProgram} className={linkClassName}>
                    Pilot Program
                  </Link>
                </li>
                <li>
                  <Link href={NAV_URLS.selfHosted} className={linkClassName}>
                    Self-Hosted
                  </Link>
                </li>
                <li>
                  <Link href={NAV_URLS.dataCenter} className={linkClassName}>
                    For data centers
                  </Link>
                </li>
                <li>
                  <Link href={NAV_URLS.buildersProgram} className={linkClassName}>
                    Builders Program
                  </Link>
                </li>
              </ul>
            </div>

            <div>
              <h3 className={headingClassName}>Resources</h3>
              <ul className={listClassName}>
                <li>
                  <a href={NAV_URLS.docs} target="_blank" rel="noopener noreferrer" className={linkClassName}>
                    Docs
                  </a>
                </li>
                <li>
                  <Link href={NAV_URLS.quickstart} className={linkClassName}>
                    Quickstart
                  </Link>
                </li>
                <li>
                  <a href={NAV_URLS.apiReference} target="_blank" rel="noopener noreferrer" className={linkClassName}>
                    API reference
                  </a>
                </li>
                <li>
                  <Link href={NAV_URLS.status} className={linkClassName}>
                    Status
                  </Link>
                </li>
              </ul>
            </div>

            <div>
              <h3 className={headingClassName}>Company</h3>
              <ul className={listClassName}>
                <li>
                  <Link href={NAV_URLS.enterprise} className={linkClassName}>
                    About
                  </Link>
                </li>
                <li>
                  <Link href={NAV_URLS.privacy} className={linkClassName}>
                    Privacy
                  </Link>
                </li>
                <li>
                  <Link href={NAV_URLS.terms} className={linkClassName}>
                    Terms
                  </Link>
                </li>
                <li>
                  <Link href={NAV_URLS.terms} className={linkClassName}>
                    Fair use
                  </Link>
                </li>
              </ul>
            </div>
          </div>
        </div>
        {compact ? (
          <p className="mt-8 text-[13.5px] text-text-muted">HyperCLI, Inc.</p>
        ) : (
          <div className="mt-12 pt-8 border-t border-border-medium flex flex-col md:flex-row justify-between items-center gap-4">
            <p className="text-sm text-text-muted">HyperCLI, Inc.</p>
            <div className="flex items-center gap-6">
              <Link href={NAV_URLS.privacy} className="text-sm text-text-muted hover:text-muted-foreground transition-colors">
                Privacy Policy
              </Link>
              <Link href={NAV_URLS.terms} className="text-sm text-text-muted hover:text-muted-foreground transition-colors">
                Terms of Service
              </Link>
            </div>
          </div>
        )}
      </div>
    </footer>
  );
}
