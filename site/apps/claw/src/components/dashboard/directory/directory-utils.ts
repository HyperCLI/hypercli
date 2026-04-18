import { PLUGIN_REGISTRY, type PluginMeta } from "../integrations/plugin-registry";

export type DirectoryCategory = "intelligence" | "web" | "channels" | "tools" | "media";

export interface DirectoryCategoryDef {
  id: DirectoryCategory;
  label: string;
  icon: string;
  description: string;
}

export const DIRECTORY_CATEGORIES: DirectoryCategoryDef[] = [
  { id: "intelligence", label: "Intelligence", icon: "Sparkles", description: "AI models and inference powering your agent" },
  { id: "web", label: "Web", icon: "Globe", description: "Search and browse the internet" },
  { id: "channels", label: "Channels", icon: "MessageSquare", description: "Messaging platforms your agent can join" },
  { id: "tools", label: "Tools", icon: "Wrench", description: "Utilities, memory, code execution, and automation" },
  { id: "media", label: "Media", icon: "Palette", description: "Voice, vision, images, video, and 3D" },
];

/** IDs of plugins that belong in the "web" directory category */
const WEB_PLUGIN_IDS = new Set(["brave", "duckduckgo", "exa", "tavily", "firecrawl"]);

/** Map a DirectoryCategory to filtered plugins from the registry */
export function getPluginsForCategory(category: DirectoryCategory): PluginMeta[] {
  switch (category) {
    case "intelligence":
      return PLUGIN_REGISTRY.filter((p) => p.category === "ai-providers");
    case "web":
      return PLUGIN_REGISTRY.filter((p) => WEB_PLUGIN_IDS.has(p.id));
    case "channels":
      return PLUGIN_REGISTRY.filter((p) => p.category === "chat");
    case "tools":
      return PLUGIN_REGISTRY.filter((p) => p.category === "tools" && !WEB_PLUGIN_IDS.has(p.id));
    case "media":
      return PLUGIN_REGISTRY.filter((p) => p.category === "built-in");
    default:
      return [];
  }
}

/** Determine which DirectoryCategory a plugin belongs to */
export function getCategoryForPlugin(pluginId: string): DirectoryCategory | null {
  if (WEB_PLUGIN_IDS.has(pluginId)) return "web";
  const plugin = PLUGIN_REGISTRY.find((p) => p.id === pluginId);
  if (!plugin) return null;
  switch (plugin.category) {
    case "chat": return "channels";
    case "ai-providers": return "intelligence";
    case "tools": return "tools";
    case "built-in": return "media";
    default: return null;
  }
}

/** Check if a plugin is connected based on gateway config */
export function isPluginConnected(pluginId: string, config: Record<string, unknown> | null): boolean {
  if (!config) return false;
  const plugin = PLUGIN_REGISTRY.find((p) => p.id === pluginId);
  if (!plugin) return false;

  const parts = plugin.configPath.split(".");
  let current: unknown = config;
  for (const part of parts) {
    if (current && typeof current === "object" && part in current) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return false;
    }
  }

  if (current && typeof current === "object") {
    const obj = current as Record<string, unknown>;
    return obj.enabled === true || obj.token != null || obj.botToken != null || obj.apiKey != null;
  }
  return false;
}

/** IDs of plugins we mark as "Recommended" when not configured */
export const RECOMMENDED_PLUGIN_IDS = new Set(["duckduckgo", "brave", "memory-core"]);
