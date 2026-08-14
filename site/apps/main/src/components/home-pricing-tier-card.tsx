"use client";

import { useState } from "react";
import { ContactModal } from "@hypercli/shared-ui";
import { Check } from "lucide-react";
import { agentPlanCtaHref } from "@/lib/agent-links";
import type { PlanTier } from "@/lib/plans";

interface HomePricingTierCardProps {
  tier: PlanTier;
}

export function HomePricingTierCard({ tier }: HomePricingTierCardProps) {
  const [isWaitlistOpen, setIsWaitlistOpen] = useState(false);
  const isPro = tier.id === "pro";
  const features = [
    tier.id === "solo" ? `${tier.agents} on its own machine` : `${tier.agents}, shared memory`,
    "Every channel + API access",
    tier.id === "pro" ? `${tier.models[0]} · ${tier.memory} memory` : "Browser, voice, media, memory",
  ];
  const actionClassName = isPro
    ? "border-[#4F7CFF] bg-[#4F7CFF] text-white hover:bg-[#3D68E6]"
    : "border-border-medium bg-transparent text-foreground hover:border-[#4F7CFF] hover:text-[#4F7CFF] dark:hover:border-[#5D87FF] dark:hover:text-[#9DB4FF]";

  const action = isPro ? (
    <button
      type="button"
      onClick={() => setIsWaitlistOpen(true)}
      className={`inline-flex w-full cursor-pointer items-center justify-center rounded-full border px-5 py-[13px] text-[15px] font-semibold transition-colors ${actionClassName}`}
    >
      {tier.cta}
    </button>
  ) : (
    <a
      href={agentPlanCtaHref(tier.id)}
      className={`inline-flex w-full items-center justify-center rounded-full border px-5 py-[13px] text-[15px] font-semibold transition-colors ${actionClassName}`}
    >
      {tier.cta}
    </a>
  );

  return (
    <>
      <article
        data-slot="home-pricing-tier-card"
        className={`relative flex h-full flex-col rounded-[26px] bg-surface p-8 text-left shadow-[var(--elevation-shadow-soft)] ${
          isPro
            ? "border-2 border-[#4F7CFF] shadow-[0_22px_54px_-22px_rgba(79,124,255,0.4)] dark:border-[#5D87FF]"
            : "border border-border"
        }`}
      >
        {isPro ? (
          <span className="absolute -top-[13px] left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-[#4F7CFF] px-3.5 py-1 text-[11.5px] font-bold uppercase tracking-[0.08em] text-white">
            Most popular
          </span>
        ) : null}

        <p className="mb-2.5 text-[13px] font-bold uppercase tracking-[0.1em] text-text-muted">{tier.name}</p>
        <p className="mb-1 text-[44px] font-extrabold leading-none tracking-[-0.03em] text-foreground">
          ${tier.price}
          <span className="text-[15px] font-medium tracking-normal text-text-muted">/mo</span>
        </p>
        <p className="mb-5 text-sm text-text-secondary">
          <strong className="font-semibold text-foreground">{tier.tokensPerDay}</strong> · {tier.models[0]}
        </p>

        <ul className="mb-[26px] flex-1 space-y-1">
          {features.map((feature, index) => (
            <li key={feature} className="flex items-start gap-3 py-1.5 text-[14.5px] text-text-secondary">
              <Check aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 stroke-[2.5] text-success" />
              <span className={index === 0 ? "font-semibold text-foreground" : undefined}>{feature}</span>
            </li>
          ))}
        </ul>

        {action}
      </article>

      {isPro ? (
        <ContactModal
          isOpen={isWaitlistOpen}
          onClose={() => setIsWaitlistOpen(false)}
          source="home-pricing-pro-waitlist"
          heading="Join the Pro waitlist"
          description="Due to demand, access to 100M daily tokens of Kimi K3 is available on a first come, first served basis. Join the list and we'll notify you when access opens."
          submitLabel="Join waitlist"
          successHeading="You're on the list"
          successMessage="We'll notify you when Pro access is available."
          messageMode="hidden"
        />
      ) : null}
    </>
  );
}
