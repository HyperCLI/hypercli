"use client";

import { useState } from "react";
import { ContactModal, cn } from "@hypercli/shared-ui";

interface ContactCtaProps {
  source: string;
  primaryLabel: string;
  secondaryLabel?: string;
  theme?: "light" | "dark";
  className?: string;
}

export function ContactCta({ source, primaryLabel, secondaryLabel, theme = "light", className }: ContactCtaProps) {
  const [isOpen, setIsOpen] = useState(false);
  const open = () => setIsOpen(true);

  return (
    <>
      <div className={cn("flex flex-wrap justify-center gap-3.5", className)}>
        <button
          type="button"
          onClick={open}
          className="btn-primary inline-block rounded-full px-8 py-4 text-base font-semibold"
        >
          {primaryLabel}
        </button>
        {secondaryLabel ? (
          <button
            type="button"
            onClick={open}
            className={cn(
              "inline-block rounded-full px-8 py-4 text-base font-semibold transition-colors",
              theme === "dark"
                ? "border border-terminal-border text-terminal-foreground hover:border-accent-hover hover:text-accent-hover"
                : "btn-secondary",
            )}
          >
            {secondaryLabel}
          </button>
        ) : null}
      </div>
      <ContactModal isOpen={isOpen} onClose={() => setIsOpen(false)} source={source} />
    </>
  );
}
