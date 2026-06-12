import type { ComponentType, CSSProperties } from "react";

import { INTEGRATION_BRAND_LOGOS } from "@/components/dashboard/integrations/integration-brand-icons";
import { getPlugin } from "@/components/dashboard/integrations/plugin-registry";

export type SessionSourceChannel = {
  label: string;
  Icon: ComponentType<{ className?: string; style?: CSSProperties }>;
  color?: string;
};

export function resolveSessionSourceChannel(sourceChannelId: string | null | undefined): SessionSourceChannel | null {
  const normalizedSourceChannelId = sourceChannelId?.trim().toLowerCase();
  if (!normalizedSourceChannelId) return null;

  const plugin = getPlugin(normalizedSourceChannelId);
  if (!plugin || plugin.category !== "chat") return null;

  const brand = INTEGRATION_BRAND_LOGOS[normalizedSourceChannelId];
  return {
    label: plugin.displayName,
    Icon: brand?.icon ?? plugin.icon,
    color: brand?.color,
  };
}
