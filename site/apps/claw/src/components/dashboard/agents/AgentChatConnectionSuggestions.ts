import type { LucideIcon } from "lucide-react";
import type { OpenClawConfigSchemaResponse } from "@hypercli.com/sdk/openclaw/gateway";
import { isPluginAvailableInSchema, isPluginConnected } from "@/components/dashboard/directory/directory-utils";
import { PLUGIN_REGISTRY, type PluginMeta } from "@/components/dashboard/integrations/plugin-registry";

export interface ChatConnectionSuggestion {
  id: string;
  displayName: string;
  description: string;
  category: string;
  Icon: LucideIcon;
  directoryPluginId: string;
}

const CONNECTION_ALIAS_OVERRIDES: Record<string, string[]> = {
  "amazon-bedrock": ["aws bedrock", "bedrock"],
  "cloudflare-ai-gateway": ["cloudflare", "cloudflare ai"],
  duckduckgo: ["duck duck go", "ddg"],
  "github-copilot": ["github copilot", "copilot"],
  googlechat: ["google chat", "gchat"],
  huggingface: ["hugging face", "hf"],
  imessage: ["imessage", "i message"],
  microsoft: ["azure speech", "microsoft speech"],
  msteams: ["microsoft teams", "ms teams", "teams"],
  "nextcloud-talk": ["nextcloud talk", "nextcloud"],
  openai: ["open ai", "chatgpt"],
  openrouter: ["open router"],
  "qwen-portal-auth": ["qwen", "qwen oauth"],
  "synology-chat": ["synology chat", "synology"],
  whatsapp: ["whats app"],
  xai: ["x ai", "grok"],
  zalouser: ["zalo personal"],
};

function categoryLabelForPlugin(plugin: PluginMeta): string {
  if (plugin.category === "chat") return "Communication";
  if (plugin.category === "ai-providers") return "Models";
  return "Tools";
}

function toConnectionSuggestion(plugin: PluginMeta): ChatConnectionSuggestion {
  return {
    id: plugin.id,
    displayName: plugin.displayName,
    description: plugin.description,
    category: categoryLabelForPlugin(plugin),
    Icon: plugin.icon,
    directoryPluginId: plugin.id,
  };
}

function normalizeConnectionAlias(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function pluginAliases(plugin: PluginMeta): string[] {
  const baseAliases = [
    plugin.id,
    plugin.displayName,
    normalizeConnectionAlias(plugin.displayName).replace(/\s+/g, ""),
  ];
  return Array.from(
    new Set(
      [...baseAliases, ...(CONNECTION_ALIAS_OVERRIDES[plugin.id] ?? [])]
        .map(normalizeConnectionAlias)
        .filter((alias) => alias.length >= 3),
    ),
  );
}

function aliasAppearsInInput(input: string, alias: string): boolean {
  const compactInput = normalizeConnectionAlias(input);
  if (!compactInput) return false;
  const escapedAlias = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(^|\\s)${escapedAlias}(\\s|$)`, "i").test(compactInput);
}

export function getConnectionSuggestions(
  input: string,
  config: Record<string, unknown> | null,
  configSchema: OpenClawConfigSchemaResponse | null,
): ChatConnectionSuggestion[] {
  const trimmed = input.trim();
  if (trimmed.length < 3 || !configSchema) return [];

  return PLUGIN_REGISTRY
    .filter((plugin) => plugin.category !== "built-in")
    .filter((plugin) => isPluginAvailableInSchema(plugin, configSchema))
    .filter((plugin) => !isPluginConnected(plugin.id, config))
    .filter((plugin) => pluginAliases(plugin).some((alias) => aliasAppearsInInput(trimmed, alias)))
    .slice(0, 3)
    .map(toConnectionSuggestion);
}
