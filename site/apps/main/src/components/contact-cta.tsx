"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ContactModal } from "@hypercli/shared-ui";
import {
  MarketingActionGroup,
  marketingCtaClassName,
} from "@hypercli/shared-ui/marketing";

interface ContactCtaProps {
  source: string;
  primarySource?: string;
  secondarySource?: string;
  primaryLabel: string;
  secondaryLabel?: string;
  theme?: "light" | "dark";
  className?: string;
}

interface ContactLinkProps {
  source: string;
  href?: string;
  children: ReactNode;
  className?: string;
}

export function ContactLink({ source, href, children, className }: ContactLinkProps) {
  const [isOpen, setIsOpen] = useState(false);
  const open = () => setIsOpen(true);

  return (
    <>
      {href ? (
        <Link
          href={href}
          aria-haspopup="dialog"
          onClick={(event) => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            open();
          }}
          className={className}
        >
          {children}
        </Link>
      ) : (
        <button type="button" aria-haspopup="dialog" onClick={open} className={className}>
          {children}
        </button>
      )}
      <ContactModal isOpen={isOpen} onClose={() => setIsOpen(false)} source={source} />
    </>
  );
}

export function ContactCta({
  source,
  primarySource,
  secondarySource,
  primaryLabel,
  secondaryLabel,
  theme = "light",
  className,
}: ContactCtaProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeSource, setActiveSource] = useState(primarySource ?? source);
  const open = (nextSource: string) => {
    setActiveSource(nextSource);
    setIsOpen(true);
  };

  return (
    <>
      <MarketingActionGroup className={className}>
        <button
          type="button"
          onClick={() => open(primarySource ?? source)}
          className={marketingCtaClassName({ size: "final" })}
        >
          {primaryLabel}
        </button>
        {secondaryLabel ? (
          <button
            type="button"
            onClick={() => open(secondarySource ?? `${source}-secondary`)}
            className={marketingCtaClassName({
              variant: theme === "dark" ? "terminal-secondary" : "secondary",
              size: "final",
            })}
          >
            {secondaryLabel}
          </button>
        ) : null}
      </MarketingActionGroup>
      <ContactModal isOpen={isOpen} onClose={() => setIsOpen(false)} source={activeSource} />
    </>
  );
}
