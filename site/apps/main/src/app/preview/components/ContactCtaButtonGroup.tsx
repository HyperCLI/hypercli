"use client"

import { useState } from "react"
import { ContactModal, CTAButtonGroup, type CTAAction } from "@hypercli/shared-ui"
import type { CTA } from "../types"

interface ContactCtaButtonGroupProps {
  primaryCTA: CTA
  secondaryCTA: CTA
  align?: "left" | "center"
  className?: string
}

export function ContactCtaButtonGroup({
  primaryCTA,
  secondaryCTA,
  align = "left",
  className,
}: ContactCtaButtonGroupProps) {
  const [activeSource, setActiveSource] = useState<string | null>(null)
  const actionFor = (cta: CTA, variant: CTAAction["variant"], showArrow = false): CTAAction => {
    const source = cta.source
    return {
      label: cta.label,
      variant,
      showArrow,
      ...(source ? { onClick: () => setActiveSource(source) } : { href: cta.href }),
    }
  }

  return (
    <>
      <CTAButtonGroup
        align={align}
        className={className}
        actions={[
          actionFor(primaryCTA, "primary", true),
          actionFor(secondaryCTA, "secondary"),
        ]}
      />
      <ContactModal
        isOpen={activeSource !== null}
        onClose={() => setActiveSource(null)}
        source={activeSource ?? "preview-contact"}
      />
    </>
  )
}
