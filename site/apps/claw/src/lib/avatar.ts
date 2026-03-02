import {
  Bot,
  Cpu,
  Terminal,
  Globe,
  Zap,
  Brain,
  Server,
  Shield,
  type LucideIcon,
} from "lucide-react";

const ICONS: LucideIcon[] = [Bot, Cpu, Terminal, Globe, Zap, Brain, Server, Shield];

// Harmonious hue offsets from the primary green (#38D39F ≈ hue 157)
const HUES = [157, 180, 210, 260, 310, 340, 30, 60];

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
}

/**
 * Deterministic avatar generation from agent name.
 * Returns an icon component + HSL color strings.
 */
export function agentAvatar(name: string): AgentAvatarInfo {
  const h = hashString(name);
  const icon = ICONS[h % ICONS.length];
  const hue = HUES[(h >>> 4) % HUES.length];

  return {
    icon,
    hue,
    bgColor: `hsl(${hue} 60% 20%)`,
    fgColor: `hsl(${hue} 70% 70%)`,
  };
}
