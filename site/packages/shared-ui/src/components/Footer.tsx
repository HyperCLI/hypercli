"use client";

import Link from "next/link";
import { useState } from "react";
import { NAV_URLS } from "../utils/navigation";
import ContactModal from "./ContactModal";

export default function Footer() {
  const [isContactModalOpen, setIsContactModalOpen] = useState(false);

  return (
    <footer className="bg-background border-t border-border-medium">
      <div className="max-w-[1400px] mx-auto py-12 px-4 sm:px-6 lg:py-16 lg:px-8">
        <div className="xl:grid xl:grid-cols-4 xl:gap-8">
          <div className="space-y-8 xl:col-span-1">
            <Link href="/" className="hover:opacity-80 transition-opacity">
              <span className="text-xl font-semibold">
                <span className="text-foreground">Hyper</span>
                <span className="text-primary">CLI</span>
              </span>
            </Link>
            <p className="text-muted-foreground text-sm max-w-xs">
              Developer-first AI infrastructure. Deploy models in one command, scale to millions of requests.
            </p>
            <div className="flex items-center gap-4">
              {/* Social Icons */}
              <Link href="#" className="w-9 h-9 rounded-lg bg-surface-low hover:bg-surface-high flex items-center justify-center transition-colors">
                <span className="sr-only">Twitter</span>
                <svg className="h-4 w-4 text-muted-foreground" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M8.29 20.251c7.547 0 11.675-6.253 11.675-11.675 0-.178 0-.355-.012-.53A8.348 8.348 0 0022 5.92a8.19 8.19 0 01-2.357.646 4.118 4.118 0 001.804-2.27 8.224 8.224 0 01-2.605.996 4.107 4.107 0 00-6.993 3.743 11.65 11.65 0 01-8.457-4.287 4.106 4.106 0 001.27 5.477A4.072 4.072 0 012.8 9.71v.052a4.105 4.105 0 003.292 4.022 4.095 4.095 0 01-1.853.07 4.108 4.108 0 003.834 2.85A8.233 8.233 0 012 18.407a11.616 11.616 0 006.29 1.84" />
                </svg>
              </Link>
              <Link href="#" className="w-9 h-9 rounded-lg bg-surface-low hover:bg-surface-high flex items-center justify-center transition-colors">
                <span className="sr-only">GitHub</span>
                <svg className="h-4 w-4 text-muted-foreground" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fillRule="evenodd"
                    d="M12 2C6.477 2 2 6.477 2 12c0 4.418 2.865 8.168 6.839 9.49.5.092.682-.217.682-.482 0-.237-.009-.868-.014-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.031-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.203 2.398.1 2.651.64.7 1.03 1.595 1.03 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.001 10.001 0 0022 12c0-5.523-4.477-10-10-10z"
                    clipRule="evenodd"
                  />
                </svg>
              </Link>
            </div>
          </div>
          <div className="mt-12 grid grid-cols-2 gap-8 md:grid-cols-3 lg:grid-cols-5 xl:mt-0 xl:col-span-3">
            <div>
              <h3 className="text-foreground mb-4">Product</h3>
              <ul className="space-y-3">
                <li>
                    <Link href={NAV_URLS.home} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                      Deployments
                    </Link>
                </li>
                <li>
                  <Link href="#" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                    Fine-Tuning
                  </Link>
                </li>
                <li>
                  <Link href={NAV_URLS.docs} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                    API Reference
                  </Link>
                </li>
                <li>
                  <Link href="#" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                    Pricing
                  </Link>
                </li>
              </ul>
            </div>

            <div>
              <h3 className="text-foreground mb-4">Company</h3>
              <ul className="space-y-3">
                <li>
                  <Link href={NAV_URLS.home} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                    About
                  </Link>
                </li>
                <li>
                  <Link href="#" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                    Blog
                  </Link>
                </li>
                <li>
                  <Link href="#" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                    Careers
                  </Link>
                </li>
                <li>
                  <Link href={NAV_URLS.architecture} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                    Architecture and Security
                  </Link>
                </li>
                <li>
                  <button onClick={() => setIsContactModalOpen(true)} className="text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
                    Contact
                  </button>
                </li>
              </ul>
            </div>

            <div>
              <h3 className="text-foreground mb-4">Resources</h3>
              <ul className="space-y-3">
                <li>
                  <Link href={NAV_URLS.docs} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                    Documentation
                  </Link>
                </li>
                <li>
                  <Link href="#" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                    Guides
                  </Link>
                </li>
                <li>
                  <Link href="#" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                    Support
                  </Link>
                </li>
                <li>
                  <Link href="#" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                    Status
                  </Link>
                </li>
              </ul>
            </div>

            <div>
              <h3 className="text-foreground mb-4">Solutions</h3>
              <ul className="space-y-3">
                <li>
                  <Link href={NAV_URLS.enterprise} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                    Enterprise
                  </Link>
                </li>
                <li>
                  <Link href={NAV_URLS.dataCenter} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                    Data Center
                  </Link>
                </li>
                <li>
                  <Link href={NAV_URLS.partner} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                    Partners
                  </Link>
                </li>
              </ul>
            </div>

            <div>
              <h3 className="text-foreground mb-4">Legal</h3>
              <ul className="space-y-3">
                <li>
                  <Link href={NAV_URLS.home} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                    Privacy
                  </Link>
                </li>
                <li>
                  <Link href={NAV_URLS.home} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                    Terms
                  </Link>
                </li>
                <li>
                  <Link href="#" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                    Security
                  </Link>
                </li>
              </ul>
            </div>
          </div>
        </div>
        <div className="mt-12 pt-8 border-t border-border-medium flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-sm text-text-muted">&copy; 2025 HyperCLI. All rights reserved.</p>
          <div className="flex items-center gap-6">
            <Link href="#" className="text-sm text-text-muted hover:text-muted-foreground transition-colors">
              Privacy Policy
            </Link>
              <Link href={NAV_URLS.enterprise} className="text-sm text-text-muted hover:text-muted-foreground transition-colors">
                Enterprise
              </Link>
              <Link href="#" className="text-sm text-text-muted hover:text-muted-foreground transition-colors">
                Terms of Service
              </Link>
          </div>
        </div>
      </div>
      <ContactModal isOpen={isContactModalOpen} onClose={() => setIsContactModalOpen(false)} source="footer-contact" />
    </footer>
  );
}
