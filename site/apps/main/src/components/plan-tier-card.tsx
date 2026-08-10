"use client";

import { useState } from "react";
import { ContactModal, PricingTierCard } from "@hypercli/shared-ui";
import { agentPlanCtaHref } from "@/lib/agent-links";
import type { PlanTier } from "@/lib/plans";

interface PlanTierCardProps {
  tier: PlanTier;
  specs: string[];
  source: string;
}

export function PlanTierCard({ tier, specs, source }: PlanTierCardProps) {
  const [isWaitlistOpen, setIsWaitlistOpen] = useState(false);
  const isWaitlist = tier.id === "pro";

  return (
    <>
      <PricingTierCard
        name={tier.name}
        tagline={tier.tagline}
        price={`$${tier.price}`}
        specs={specs}
        models={tier.models}
        gaugePercent={tier.gaugePercent}
        highlighted={tier.highlighted}
        ctaLabel={tier.cta}
        ctaHref={isWaitlist ? undefined : agentPlanCtaHref(tier.id)}
        ctaNote={tier.ctaNote}
        onCtaClick={isWaitlist ? () => setIsWaitlistOpen(true) : undefined}
      />
      {isWaitlist ? (
        <ContactModal
          isOpen={isWaitlistOpen}
          onClose={() => setIsWaitlistOpen(false)}
          source={`${source}-pro-waitlist`}
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
