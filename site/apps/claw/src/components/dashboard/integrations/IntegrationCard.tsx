"use client";

import type { LucideIcon } from "lucide-react";
import { ResourceCard } from "@hypercli/shared-ui";

export type CardStatus = "connected" | "pending" | "available" | "coming-soon" | "built-in";

interface IntegrationCardProps {
  icon: LucideIcon;
  name: string;
  status: CardStatus;
  statusText?: string;
  description?: string;
  ctaLabel?: string;
  onClick?: () => void;
}

export function IntegrationCard({
  icon: Icon,
  name,
  status,
  statusText,
  description,
  ctaLabel,
  onClick,
}: IntegrationCardProps) {
  return (
    <ResourceCard
      icon={Icon}
      title={name}
      status={status}
      statusText={statusText}
      description={description}
      ctaLabel={ctaLabel}
      onClick={onClick}
    />
  );
}
