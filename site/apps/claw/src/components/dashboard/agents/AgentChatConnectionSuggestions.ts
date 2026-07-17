import type { AgentChannelSummary } from "@hypercli.com/sdk/channels";
import { MessageSquare } from "lucide-react";
import { INTEGRATION_BRAND_LOGOS, type IntegrationBrandIcon } from "@/components/dashboard/integrations/integration-brand-icons";
import { CHANNEL_SETUP_CANDIDATE_IDS, PLUGIN_REGISTRY, type PluginMeta } from "@/components/dashboard/integrations/plugin-registry";
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

export type ChatIntegrationIntent =
  | { kind: "connector"; integrationId: ClawIntegrationConnectId }
  | { kind: "directory" };

const SUPPORTED_CHAT_CONNECTORS: Record<ClawIntegrationConnectId, string[]> = {
  github: ["github", "git hub"],
  telegram: ["telegram"],
  discord: ["discord"],
  slack: ["slack"],
  whatsapp: ["whatsapp", "whats app"],
};

const GENERIC_INTEGRATION_NOUN_RE = /\b(?:integration|integrations|channel|channels|chat connection|messaging connection)\b/i;
const DIRECT_SETUP_INTENT_RE = /\b(?:connect|configure|link|enable|integrate)\b|\bset\s+up\b|\bsetup\b/i;
const CREATE_SETUP_INTENT_RE = /\b(?:add|create|make|want|need)\b.{0,48}\b(?:integration|integrations|channel|channels|connection|bot)\b/i;
const REVERSE_CREATE_SETUP_INTENT_RE = /\b(?:integration|integrations|channel|channels|connection|bot)\b.{0,48}\b(?:add|create|make|want|need)\b/i;
const NEGATED_SETUP_INTENT_RE = /\b(?:do\s+not|don\s+t|dont|never|not)\s+(?:want\s+to\s+)?(?:connect|configure|link|enable|integrate|set\s+up|setup|add|create|make)\b/i;

const CONNECTION_ALIAS_OVERRIDES: Record<string, string[]> = {
  googlechat: ["google chat", "gchat"],
  imessage: ["imessage", "i message"],
  msteams: ["microsoft teams", "ms teams", "teams"],
  "nextcloud-talk": ["nextcloud talk", "nextcloud"],
  "synology-chat": ["synology chat", "synology"],
  whatsapp: ["whats app"],
  zalouser: ["zalo personal"],
};

function displayNameFromId(id: string): string {
  return id
    .split(/[-_.]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function pluginForChannel(channelId: string): PluginMeta | undefined {
  return PLUGIN_REGISTRY.find((plugin) => plugin.id === channelId && plugin.category === "chat");
}

function toConnectionSuggestion(channelId: string): ChatConnectionSuggestion {
  const plugin = pluginForChannel(channelId);
  const brand = INTEGRATION_BRAND_LOGOS[channelId];
  const displayName = plugin?.displayName ?? displayNameFromId(channelId);
  return {
    id: channelId,
    displayName,
    description: `Set up ${displayName} for this agent.`,
    category: "Communication",
    Icon: brand?.icon ?? plugin?.icon ?? MessageSquare,
    iconColor: brand?.color,
    directoryPluginId: channelId,
    connectorId: CHANNEL_SETUP_CANDIDATE_IDS.includes(channelId as typeof CHANNEL_SETUP_CANDIDATE_IDS[number])
      ? channelId as ClawIntegrationConnectId
      : undefined,
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
    directoryPluginId: "github",
    connectorId: "github",
  };
}

export function getChatConnectorSuggestion(connectorId: ClawIntegrationConnectId): ChatConnectionSuggestion {
  if (connectorId === "github") return githubConnectionSuggestion();
  const plugin = pluginForChannel(connectorId);
  if (plugin) return { ...toConnectionSuggestion(plugin.id), connectorId };
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
    ? pluginForChannel(suggestion.directoryPluginId)
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
  channels: AgentChannelSummary[],
): ChatConnectionSuggestion[] {
  const grouped = new Map<string, AgentChannelSummary[]>();
  CHANNEL_SETUP_CANDIDATE_IDS.forEach((channelId) => grouped.set(channelId, []));
  channels.forEach((channel) => {
    grouped.set(channel.channelId, [...(grouped.get(channel.channelId) ?? []), channel]);
  });
  return Array.from(grouped.entries())
    .filter(([, entries]) => !entries.some((entry) => entry.configured))
    .map(([channelId]) => toConnectionSuggestion(channelId));
}

function aliasAppearsInInput(input: string, alias: string): boolean {
  const compactInput = normalizeConnectionAlias(input);
  if (!compactInput) return false;
  const escapedAlias = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(^|\\s)${escapedAlias}(\\s|$)`, "i").test(compactInput);
}

function hasSetupIntent(input: string): boolean {
  if (NEGATED_SETUP_INTENT_RE.test(input)) return false;
  return DIRECT_SETUP_INTENT_RE.test(input) || CREATE_SETUP_INTENT_RE.test(input) || REVERSE_CREATE_SETUP_INTENT_RE.test(input);
}

export function detectChatIntegrationIntent(
  input: string,
  channels: AgentChannelSummary[] = [],
): ChatIntegrationIntent | null {
  const normalizedInput = normalizeConnectionAlias(input);
  if (!normalizedInput || !hasSetupIntent(normalizedInput)) return null;

  const supportedMatches = (Object.entries(SUPPORTED_CHAT_CONNECTORS) as Array<[ClawIntegrationConnectId, string[]]>)
    .filter(([, aliases]) => aliases.some((alias) => aliasAppearsInInput(normalizedInput, alias)))
    .map(([connectorId]) => connectorId);
  const knownIntegrationIds = new Set([
    ...PLUGIN_REGISTRY.filter((plugin) => plugin.category === "chat").map((plugin) => plugin.id),
    ...channels.map((channel) => channel.channelId),
  ]);
  const namedIntegrationMatches = Array.from(knownIntegrationIds).filter((integrationId) => {
    const plugin = pluginForChannel(integrationId);
    const aliases = plugin ? pluginAliases(plugin) : [integrationId, displayNameFromId(integrationId)].map(normalizeConnectionAlias);
    return aliases.some((alias) => aliasAppearsInInput(normalizedInput, alias));
  });

  if (supportedMatches.length === 1 && namedIntegrationMatches.length <= 1) {
    return { kind: "connector", integrationId: supportedMatches[0] };
  }
  if (supportedMatches.length > 1 || namedIntegrationMatches.length > 0 || GENERIC_INTEGRATION_NOUN_RE.test(normalizedInput)) {
    return { kind: "directory" };
  }
  return null;
}

export function getConnectionSuggestions(
  input: string,
  channels: AgentChannelSummary[],
): ChatConnectionSuggestion[] {
  const trimmed = input.trim();
  if (trimmed.length < 3) return [];
  if (!hasSetupIntent(normalizeConnectionAlias(trimmed))) return [];

  return availableConnectionSuggestions(channels)
    .filter((suggestion) => suggestionAliases(suggestion).some((alias) => aliasAppearsInInput(trimmed, alias)))
    .slice(0, 3);
}

export function getConnectCommandSuggestions(
  query: string,
  channels: AgentChannelSummary[],
  limit = 8,
): ChatConnectionSuggestion[] {
  const suggestions = availableConnectionSuggestions(channels);
  const normalizedQuery = normalizeConnectionAlias(query);
  if (!normalizedQuery) return suggestions.slice(0, limit);

  return suggestions
    .map((suggestion) => ({ suggestion, rank: rankConnectionSuggestion(suggestion, normalizedQuery) }))
    .filter((entry): entry is { suggestion: ChatConnectionSuggestion; rank: number } => entry.rank !== null)
    .sort((a, b) => a.rank - b.rank || a.suggestion.displayName.localeCompare(b.suggestion.displayName))
    .slice(0, limit)
    .map((entry) => entry.suggestion);
}
