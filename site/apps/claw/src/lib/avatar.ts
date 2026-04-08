import {
  Bot,
  Brain,
  Cat,
  Crown,
  Dog,
  Eye,
  Flame,
  Globe,
  Heart,
  Leaf,
  Moon,
  Rocket,
  Shield,
  Sparkles,
  Star,
  Zap,
  type LucideIcon,
} from "lucide-react";

const ICONS: LucideIcon[] = [
  Bot,
  Brain,
  Cat,
  Crown,
  Dog,
  Eye,
  Flame,
  Globe,
  Heart,
  Leaf,
  Moon,
  Rocket,
  Shield,
  Sparkles,
  Star,
  Zap,
];

// Harmonious hue offsets from the primary green (#38D39F ≈ hue 157)
const HUES = [157, 180, 210, 240, 260, 280, 310, 340, 10, 30, 50, 70, 90, 120, 140, 200];

export interface AgentUiAvatar {
  image?: string | null;
  icon_index?: number | null;
}

export interface AgentUiMeta {
  avatar?: AgentUiAvatar | null;
  [key: string]: unknown;
}

export interface AgentMeta {
  ui?: AgentUiMeta | null;
}

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export interface AgentAvatarInfo {
  icon: LucideIcon;
  hue: number;
  bgColor: string;
  fgColor: string;
  imageUrl?: string | null;
}

/**
 * Deterministic avatar generation from agent name.
 * Returns an icon component + HSL color strings.
 */
export function agentAvatar(name: string, meta?: AgentMeta | null): AgentAvatarInfo {
  const persistedAvatar = meta?.ui?.avatar;
  const persistedImage = typeof persistedAvatar?.image === "string" && persistedAvatar.image
    ? persistedAvatar.image
    : null;
  const persistedIconIndex = Number.isFinite(persistedAvatar?.icon_index)
    ? Math.abs(Math.trunc(persistedAvatar?.icon_index as number)) % ICONS.length
    : null;
  const h = hashString(name);
  const iconIndex = persistedIconIndex ?? (h % ICONS.length);
  const hue = HUES[persistedIconIndex ?? ((h >>> 4) % HUES.length)];
  const icon = ICONS[iconIndex];

  return {
    icon,
    hue,
    bgColor: `hsl(${hue} 60% 20%)`,
    fgColor: `hsl(${hue} 70% 70%)`,
    imageUrl: persistedImage,
  };
}
