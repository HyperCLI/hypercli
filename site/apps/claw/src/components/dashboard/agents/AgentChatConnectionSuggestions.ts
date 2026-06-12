import type { OpenClawConfigSchemaResponse } from "@hypercli.com/sdk/openclaw/gateway";
import { isPluginAvailableInSchema, isPluginConnected, schemaPathExists } from "@/components/dashboard/directory/directory-utils";
import { INTEGRATION_BRAND_LOGOS, type IntegrationBrandIcon } from "@/components/dashboard/integrations/integration-brand-icons";
import { PLUGIN_REGISTRY, type PluginMeta } from "@/components/dashboard/integrations/plugin-registry";
import type { ClawIntegrationConnectId } from "@/components/dashboard/chat-integrations/claw-ui-actions";

export type ChatConnectionIcon = IntegrationBrandIcon;

export interface ChatConnectionSuggestion {
  id: string;
  displayName: string;
  description: string;
  category: string;
  Icon: ChatConnectionIcon;
  iconColor?: string;
  directoryPluginId?: string;
  connectorId?: ClawIntegrationConnectId;
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
  const brand = INTEGRATION_BRAND_LOGOS[plugin.id];
  return {
    id: plugin.id,
    displayName: plugin.displayName,
    description: plugin.description,
    category: categoryLabelForPlugin(plugin),
    Icon: brand?.icon ?? plugin.icon,
    iconColor: brand?.color,
    directoryPluginId: plugin.id,
    connectorId: plugin.id === "telegram" ? "telegram" : undefined,
  };
}

function githubConnectionSuggestion(): ChatConnectionSuggestion {
  return {
    id: "github",
    displayName: "GitHub",
    description: "Connect repositories and issues with device authorization.",
    category: "Tools",
    Icon: INTEGRATION_BRAND_LOGOS.github.icon,
    iconColor: INTEGRATION_BRAND_LOGOS.github.color,
    connectorId: "github",
  };
}

export function getChatConnectorSuggestion(connectorId: ClawIntegrationConnectId): ChatConnectionSuggestion {
  if (connectorId === "github") return githubConnectionSuggestion();
  const plugin = PLUGIN_REGISTRY.find((item) => item.id === connectorId);
  if (plugin) return { ...toConnectionSuggestion(plugin), connectorId };
  return {
    id: "telegram",
    displayName: "Telegram",
    description: "Bot API via grammY",
    category: "Communication",
    Icon: INTEGRATION_BRAND_LOGOS.telegram.icon,
    iconColor: INTEGRATION_BRAND_LOGOS.telegram.color,
    directoryPluginId: "telegram",
    connectorId: "telegram",
  };
}

function hasGitHubConnectorCapability(configSchema: OpenClawConfigSchemaResponse | null): boolean {
  if (!configSchema) return false;
  const hintKeys = [
    "integrations.github",
    "integrations.github.auth",
    "integrations.github.connect",
    "services.github",
    "services.github.auth",
    "services.github.connect",
  ];
  return (
    schemaPathExists(configSchema.schema, "integrations.github") ||
    schemaPathExists(configSchema.schema, "services.github") ||
    hintKeys.some((key) => Boolean(configSchema.uiHints?.[key]))
  );
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

function suggestionAliases(suggestion: ChatConnectionSuggestion): string[] {
  if (suggestion.connectorId === "github") {
    return ["github", "gh", "git hub", "repos", "repository", "repositories", "issues"];
  }

  const plugin = suggestion.directoryPluginId
    ? PLUGIN_REGISTRY.find((item) => item.id === suggestion.directoryPluginId)
    : null;
  if (plugin) return pluginAliases(plugin);

  return [suggestion.id, suggestion.displayName]
    .map(normalizeConnectionAlias)
    .filter(Boolean);
}

function rankConnectionSuggestion(suggestion: ChatConnectionSuggestion, query: string): number | null {
  const normalizedQuery = normalizeConnectionAlias(query);
  if (!normalizedQuery) return 0;
  const aliases = suggestionAliases(suggestion);
  if (aliases.some((alias) => alias === normalizedQuery)) return 0;
  if (aliases.some((alias) => alias.startsWith(normalizedQuery))) return 1;
  if (normalizeConnectionAlias(suggestion.displayName).includes(normalizedQuery)) return 2;
  if (aliases.some((alias) => alias.includes(normalizedQuery))) return 3;
  return null;
}

function availableConnectionSuggestions(
  config: Record<string, unknown> | null,
  configSchema: OpenClawConfigSchemaResponse | null,
): ChatConnectionSuggestion[] {
  const serviceSuggestions = [githubConnectionSuggestion()];
  const pluginSuggestions = configSchema
    ? PLUGIN_REGISTRY
      .filter((plugin) => plugin.category !== "built-in")
      .filter((plugin) => isPluginAvailableInSchema(plugin, configSchema))
      .filter((plugin) => !isPluginConnected(plugin.id, config))
      .map(toConnectionSuggestion)
    : [];

  return [...serviceSuggestions, ...pluginSuggestions]
    .filter((suggestion, index, suggestions) => suggestions.findIndex((item) => item.id === suggestion.id) === index);
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

  const githubSuggestion = githubConnectionSuggestion();
  const serviceSuggestions: ChatConnectionSuggestion[] = hasGitHubConnectorCapability(configSchema) &&
    suggestionAliases(githubSuggestion).some((alias) => aliasAppearsInInput(trimmed, alias))
    ? [githubSuggestion]
    : [];

  const pluginSuggestions = PLUGIN_REGISTRY
    .filter((plugin) => plugin.category !== "built-in")
    .filter((plugin) => isPluginAvailableInSchema(plugin, configSchema))
    .filter((plugin) => !isPluginConnected(plugin.id, config))
    .filter((plugin) => pluginAliases(plugin).some((alias) => aliasAppearsInInput(trimmed, alias)))
    .slice(0, 3)
    .map(toConnectionSuggestion);

  return [...serviceSuggestions, ...pluginSuggestions]
    .filter((suggestion, index, suggestions) => suggestions.findIndex((item) => item.id === suggestion.id) === index)
    .slice(0, 3);
}

export function getConnectCommandSuggestions(
  query: string,
  config: Record<string, unknown> | null,
  configSchema: OpenClawConfigSchemaResponse | null,
  limit = 8,
): ChatConnectionSuggestion[] {
  const suggestions = availableConnectionSuggestions(config, configSchema);
  const normalizedQuery = normalizeConnectionAlias(query);
  if (!normalizedQuery) return suggestions.slice(0, limit);

  return suggestions
    .map((suggestion) => ({ suggestion, rank: rankConnectionSuggestion(suggestion, normalizedQuery) }))
    .filter((entry): entry is { suggestion: ChatConnectionSuggestion; rank: number } => entry.rank !== null)
    .sort((a, b) => a.rank - b.rank || a.suggestion.displayName.localeCompare(b.suggestion.displayName))
    .slice(0, limit)
    .map((entry) => entry.suggestion);
}
