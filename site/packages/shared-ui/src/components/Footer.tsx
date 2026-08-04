"use client";

import Link from "next/link";
import { NAV_URLS } from "../utils/navigation";
import { HyperCLILogo } from "./HyperCLILogo";

export default function Footer() {
  return (
    <footer className="bg-background border-t border-border-medium">
      <div className="max-w-[1400px] mx-auto py-12 px-4 sm:px-6 lg:py-16 lg:px-8">
        <div className="xl:grid xl:grid-cols-5 xl:gap-8">
          <div className="space-y-8 xl:col-span-1">
            <Link href="/" aria-label="HyperCLI home" className="inline-flex hover:opacity-80 transition-opacity">
              <HyperCLILogo decorative className="h-[31px] w-[158px]" />
            </Link>
          </div>
          <div className="mt-12 grid grid-cols-2 gap-8 md:grid-cols-4 xl:mt-0 xl:col-span-4">
            <div>
              <h3 className="text-foreground mb-4">Product</h3>
              <ul className="space-y-3">
                <li>
                  <Link href={NAV_URLS.capabilities} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                    Capabilities
                  </Link>
                </li>
                <li>
                  <Link href={NAV_URLS.cli} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                    CLI
                  </Link>
                </li>
                <li>
                  <Link href={NAV_URLS.inference} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                    Inference
                  </Link>
                </li>
                <li>
                  <Link href={NAV_URLS.slack} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                    Channels
                  </Link>
                </li>
                <li>
                  <Link href={NAV_URLS.pricing} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                    Pricing
                  </Link>
                </li>
              </ul>
            </div>

            <div>
              <h3 className="text-foreground mb-4">Solutions</h3>
              <ul className="space-y-3">
                <li>
                  <Link href={NAV_URLS.forTeams} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                    For teams
                  </Link>
                </li>
                <li>
                  <Link href={NAV_URLS.whatItCanDo} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                    What it can do
                  </Link>
                </li>
                <li>
                  <Link href={NAV_URLS.pilotProgram} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                    Pilot Program
                  </Link>
                </li>
                <li>
                  <Link href={NAV_URLS.selfHosted} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                    Self-Hosted
                  </Link>
                </li>
                <li>
                  <Link href={NAV_URLS.dataCenter} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                    For data centers
                  </Link>
                </li>
                <li>
                  <Link href={NAV_URLS.buildersProgram} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                    Builders Program
                  </Link>
                </li>
              </ul>
            </div>

            <div>
              <h3 className="text-foreground mb-4">Resources</h3>
              <ul className="space-y-3">
                <li>
                  <a href={NAV_URLS.docs} target="_blank" rel="noopener noreferrer" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                    Docs
                  </a>
                </li>
                <li>
                  <Link href={NAV_URLS.quickstart} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                    Quickstart
                  </Link>
                </li>
                <li>
                  <a href={NAV_URLS.apiReference} target="_blank" rel="noopener noreferrer" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                    API reference
                  </a>
                </li>
                <li>
                  <Link href={NAV_URLS.status} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                    Status
                  </Link>
                </li>
              </ul>
            </div>

            <div>
              <h3 className="text-foreground mb-4">Company</h3>
              <ul className="space-y-3">
                <li>
                  <Link href={NAV_URLS.enterprise} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                    About
                  </Link>
                </li>
                <li>
                  <Link href={NAV_URLS.privacy} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                    Privacy
                  </Link>
                </li>
                <li>
                  <Link href={NAV_URLS.terms} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                    Terms
                  </Link>
                </li>
                <li>
                  <Link href={NAV_URLS.terms} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                    Fair use
                  </Link>
                </li>
              </ul>
            </div>
          </div>
        </div>
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
      </div>
    </footer>
  );
}
