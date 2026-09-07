import {
  Brain,
  Bot,
  Briefcase,
  Code2,
  Compass,
  Flame,
  Globe,
  Mail,
  Palette,
  Rocket,
  Sparkles,
  Terminal,
  Star,
  Triangle,
  WandSparkles,
  Zap,
  type LucideIcon,
} from "lucide-react";

const ICON_MAP: Record<string, LucideIcon> = {
  bot: Bot,
  briefcase: Briefcase,
  triangle: Triangle,
  mail: Mail,
  flame: Flame,
  globe: Globe,
  star: Star,
  zap: Zap,
  sparkles: Sparkles,
  rocket: Rocket,
  wand: WandSparkles,
  compass: Compass,
  terminal: Terminal,
  code: Code2,
  brain: Brain,
  palette: Palette,
};

const AVATAR_COLORS = ["#c97b12", "#d0483b", "#3d9b63", "#7c5cd6", "#4a6fd6"];

export function avatarColor(name: string): string {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "?";
  const second = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + second).toUpperCase();
}

export function Avatar({
  name,
  url,
  size = 22,
  color,
  icon,
  className = "",
}: {
  name: string;
  url?: string | null;
  size?: number;
  color?: string;
  icon?: string;
  className?: string;
}) {
  if (url) {
    return (
      <img
        src={url}
        alt={name}
        width={size}
        height={size}
        className={`rounded-full object-cover shrink-0 ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }
  const Icon = icon ? ICON_MAP[icon] : undefined;
  return (
    <div
      className={`rounded-full flex items-center justify-center text-white font-medium shrink-0 ${className}`}
      style={{
        width: size,
        height: size,
        backgroundColor: color ?? avatarColor(name),
        fontSize: size * 0.42,
      }}
    >
      {Icon ? <Icon size={size * 0.55} strokeWidth={2.2} /> : initials(name)}
    </div>
  );
}
