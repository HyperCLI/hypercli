"use client"

import { motion } from "framer-motion"
import { ArrowRight } from "lucide-react"
import Link from "next/link"
import type { CTA } from "../types"

type HeroSectionProps = {
  headline: string
  subheadline: string
  primaryCTA: CTA
  secondaryCTA: CTA
  trustBadges?: string[]
}

export function HeroSection({
  headline,
  subheadline,
  primaryCTA,
  secondaryCTA,
  trustBadges,
}: HeroSectionProps) {
  return (
    <section className="pt-32 pb-24 px-4 sm:px-6 lg:px-8">
      <motion.div
        className="max-w-5xl mx-auto"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
      >
        <h1 className="text-5xl sm:text-6xl lg:text-7xl text-white font-bold leading-[1.1] tracking-tight max-w-4xl mb-6">
          {headline}
        </h1>

        <p className="text-xl text-muted-foreground leading-relaxed mb-10 max-w-2xl">
          {subheadline}
        </p>

        <div className="flex flex-wrap gap-4 mb-10">
          <Link
            href={primaryCTA.href}
            className="px-8 py-4 bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover transition-colors flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {primaryCTA.label}
            <ArrowRight className="w-5 h-5" />
          </Link>
          <Link
            href={secondaryCTA.href}
            className="px-8 py-4 bg-surface-low/40 text-white rounded-lg hover:bg-surface-low/60 transition-colors border border-border-medium/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {secondaryCTA.label}
          </Link>
        </div>

        {trustBadges && trustBadges.length > 0 && (
          <div className="flex flex-wrap gap-3">
            {trustBadges.map((badge) => (
              <span
                key={badge}
                className="text-sm text-primary border border-border-medium/50 rounded-full px-3 py-1.5"
              >
                {badge}
              </span>
            ))}
          </div>
        )}
      </motion.div>
    </section>
  )
}
