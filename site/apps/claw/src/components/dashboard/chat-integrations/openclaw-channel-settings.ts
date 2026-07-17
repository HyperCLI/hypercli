export type OpenClawConfiguredChannelId = "telegram" | "discord" | "slack" | "whatsapp";

export type RuntimeDefaultChoice<T extends string> = T | "runtime-default";
export type TelegramDmPolicy = RuntimeDefaultChoice<"allowlist" | "pairing" | "open" | "disabled">;
export type TelegramGroupPolicy = RuntimeDefaultChoice<"allowlist" | "open" | "disabled">;
export type MentionBehavior = "runtime-default" | "required" | "not-required" | "mixed";
export type SlackTransportMode = "socket" | "http" | "relay" | "runtime-default";
export type SlackDmPolicy = TelegramDmPolicy;
export type SlackGroupPolicy = TelegramGroupPolicy;
export type SlackMentionBehavior = Exclude<MentionBehavior, "mixed">;

type UnknownRecord = Record<string, unknown>;

export interface SafeTelegramChannelConfig {
  channelId: "telegram";
  enabled: boolean;
  dmPolicy: TelegramDmPolicy;
  allowFrom: string[];
  groupPolicy: TelegramGroupPolicy;
  groupAllowFrom: string[];
  groupIds: string[];
  existingGroupKeys: string[];
  mentionBehavior: MentionBehavior;
}

export interface SafeDiscordChannelConfig {
  channelId: "discord";
  enabled: boolean;
  guildId: string;
  userId: string;
  existingGuildKeys: string[];
}

export interface SafeSlackChannelConfig {
  channelId: "slack";
  enabled: boolean;
  mode: SlackTransportMode;
  enterpriseOrgInstall: boolean;
  webhookPath: string;
  relayUrl: string;
  relayGatewayId: string;
  botTokenConfigured: boolean;
  appTokenConfigured: boolean;
  signingSecretConfigured: boolean;
  relayAuthTokenConfigured: boolean;
  dmPolicy: SlackDmPolicy;
  allowFrom: string[];
  groupPolicy: SlackGroupPolicy;
  channels: SlackChannelRule[];
  existingChannelKeys: string[];
}

export interface SlackChannelRule {
  channelId: string;
  enabled: boolean;
  mentionBehavior: SlackMentionBehavior;
}

export interface SafeWhatsAppChannelConfig {
  channelId: "whatsapp";
  enabled: boolean;
}

export type SafeOpenClawChannelConfig =
  | SafeTelegramChannelConfig
  | SafeDiscordChannelConfig
  | SafeSlackChannelConfig
  | SafeWhatsAppChannelConfig;

export interface TelegramSettingsUpdate {
  enabled: boolean;
  dmPolicy: TelegramDmPolicy;
  allowFrom: string[];
  groupPolicy: TelegramGroupPolicy;
  groupAllowFrom: string[];
  groupIds: string[];
  mentionBehavior: MentionBehavior;
  replacementBotToken?: string;
}

export interface DiscordSettingsUpdate {
  enabled: boolean;
  guildId: string;
  userId: string;
  replacementBotToken?: string;
}

export interface SlackSettingsUpdate {
  enabled: boolean;
  mode: Exclude<SlackTransportMode, "runtime-default">;
  enterpriseOrgInstall: boolean;
  webhookPath: string;
  relayUrl: string;
  relayGatewayId: string;
  dmPolicy: SlackDmPolicy;
  allowFrom: string[];
  groupPolicy: SlackGroupPolicy;
  channels: SlackChannelRule[];
  replacementBotToken?: string;
  replacementAppToken?: string;
  replacementSigningSecret?: string;
  replacementRelayAuthToken?: string;
}

export interface RuntimeCredentialState {
  status?: "available" | "configured_unavailable" | "missing";
  source?: string;
}

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : null;
}

function cleanStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean)));
}

function ownKeys(value: unknown): string[] {
  return Object.keys(asRecord(value) ?? {}).filter(Boolean);
}

function isTelegramDmPolicy(value: unknown): value is Exclude<TelegramDmPolicy, "runtime-default"> {
  return value === "allowlist" || value === "pairing" || value === "open" || value === "disabled";
}

function isTelegramGroupPolicy(value: unknown): value is Exclude<TelegramGroupPolicy, "runtime-default"> {
  return value === "allowlist" || value === "open" || value === "disabled";
}

function enabledValue(config: UnknownRecord | null): boolean {
  return typeof config?.enabled === "boolean" ? config.enabled : true;
}

function configuredSecret(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  const secret = asRecord(value);
  return Boolean(secret && typeof secret.provider === "string" && secret.provider.trim() && typeof secret.id === "string" && secret.id.trim());
}

export function parseOpenClawTelegramConfig(value: unknown): SafeTelegramChannelConfig {
  const config = asRecord(value);
  const groups = asRecord(config?.groups);
  const existingGroupKeys = ownKeys(groups);
  const mentionValues = Object.values(groups ?? {})
    .map((entry) => asRecord(entry)?.requireMention)
    .filter((entry): entry is boolean => typeof entry === "boolean");
  const mentionBehavior: MentionBehavior = mentionValues.length === 0
    ? "runtime-default"
    : mentionValues.every(Boolean)
      ? "required"
      : mentionValues.every((entry) => !entry)
        ? "not-required"
        : "mixed";

  return {
    channelId: "telegram",
    enabled: enabledValue(config),
    dmPolicy: isTelegramDmPolicy(config?.dmPolicy) ? config.dmPolicy : "runtime-default",
    allowFrom: cleanStrings(config?.allowFrom),
    groupPolicy: isTelegramGroupPolicy(config?.groupPolicy) ? config.groupPolicy : "runtime-default",
    groupAllowFrom: cleanStrings(config?.groupAllowFrom),
    groupIds: existingGroupKeys,
    existingGroupKeys,
    mentionBehavior,
  };
}

export function parseOpenClawDiscordConfig(value: unknown): SafeDiscordChannelConfig {
  const config = asRecord(value);
  const guilds = asRecord(config?.guilds);
  const existingGuildKeys = ownKeys(guilds);
  let guildId = "";
  let userId = "";

  for (const key of existingGuildKeys) {
    const users = cleanStrings(asRecord(guilds?.[key])?.users);
    if (/^\d+$/.test(key) && users.some((entry) => /^\d+$/.test(entry))) {
      guildId = key;
      userId = users.find((entry) => /^\d+$/.test(entry)) ?? "";
      break;
    }
  }

  return {
    channelId: "discord",
    enabled: enabledValue(config),
    guildId,
    userId,
    existingGuildKeys,
  };
}

export function parseOpenClawSlackConfig(value: unknown): SafeSlackChannelConfig {
  const config = asRecord(value);
  const mode = config?.mode;
  const channels = asRecord(config?.channels);
  const relay = asRecord(config?.relay);
  const existingChannelKeys = ownKeys(channels);
  return {
    channelId: "slack",
    enabled: enabledValue(config),
    mode: mode === "socket" || mode === "http" || mode === "relay" ? mode : "runtime-default",
    enterpriseOrgInstall: config?.enterpriseOrgInstall === true,
    webhookPath: typeof config?.webhookPath === "string" ? normalizeSlackWebhookPath(config.webhookPath) : "/slack/events",
    relayUrl: typeof relay?.url === "string" ? relay.url.trim() : "",
    relayGatewayId: typeof relay?.gatewayId === "string" ? relay.gatewayId.trim() : "",
    botTokenConfigured: configuredSecret(config?.botToken),
    appTokenConfigured: configuredSecret(config?.appToken),
    signingSecretConfigured: configuredSecret(config?.signingSecret),
    relayAuthTokenConfigured: configuredSecret(relay?.authToken),
    dmPolicy: isTelegramDmPolicy(config?.dmPolicy) ? config.dmPolicy : "runtime-default",
    allowFrom: cleanStrings(config?.allowFrom),
    groupPolicy: isTelegramGroupPolicy(config?.groupPolicy) ? config.groupPolicy : "runtime-default",
    channels: existingChannelKeys.map((channelId) => {
      const rule = asRecord(channels?.[channelId]);
      return {
        channelId,
        enabled: typeof rule?.enabled === "boolean" ? rule.enabled : true,
        mentionBehavior: typeof rule?.requireMention !== "boolean"
          ? "runtime-default"
          : rule.requireMention ? "required" : "not-required",
      };
    }),
    existingChannelKeys,
  };
}

export function parseOpenClawWhatsAppConfig(value: unknown): SafeWhatsAppChannelConfig {
  return {
    channelId: "whatsapp",
    enabled: enabledValue(asRecord(value)),
  };
}

export function parseOpenClawChannelConfig(
  channelId: OpenClawConfiguredChannelId,
  value: unknown,
): SafeOpenClawChannelConfig {
  if (channelId === "telegram") return parseOpenClawTelegramConfig(value);
  if (channelId === "discord") return parseOpenClawDiscordConfig(value);
  if (channelId === "slack") return parseOpenClawSlackConfig(value);
  return parseOpenClawWhatsAppConfig(value);
}

export function buildOpenClawTelegramPatch(
  current: SafeTelegramChannelConfig,
  update: TelegramSettingsUpdate,
): UnknownRecord {
  const allowFrom = update.dmPolicy === "open"
    ? Array.from(new Set(["*", ...update.allowFrom]))
    : update.allowFrom;
  const nextGroupIds = Array.from(new Set(update.groupIds.map((entry) => entry.trim()).filter(Boolean)));
  const nextGroupSet = new Set(nextGroupIds);
  const groups: UnknownRecord = {};

  current.existingGroupKeys.forEach((groupId) => {
    if (!nextGroupSet.has(groupId)) groups[groupId] = null;
  });
  nextGroupIds.forEach((groupId) => {
    if (update.mentionBehavior === "mixed" && current.existingGroupKeys.includes(groupId)) return;
    if (update.mentionBehavior === "mixed") {
      groups[groupId] = {};
      return;
    }
    groups[groupId] = {
      requireMention: update.mentionBehavior === "runtime-default"
        ? null
        : update.mentionBehavior === "required",
    };
  });

  return {
    enabled: update.enabled,
    dmPolicy: update.dmPolicy === "runtime-default" ? null : update.dmPolicy,
    allowFrom: allowFrom.length > 0 ? allowFrom : null,
    groupPolicy: update.groupPolicy === "runtime-default" ? null : update.groupPolicy,
    groupAllowFrom: update.groupAllowFrom.length > 0 ? update.groupAllowFrom : null,
    ...(nextGroupIds.length === 0
      ? { groups: null }
      : Object.keys(groups).length > 0 ? { groups } : {}),
    ...(update.replacementBotToken?.trim() ? { botToken: update.replacementBotToken.trim() } : {}),
  };
}

export function buildOpenClawDiscordPatch(
  current: SafeDiscordChannelConfig,
  update: DiscordSettingsUpdate,
): UnknownRecord {
  const guildId = update.guildId.trim();
  const userId = update.userId.trim();
  const restrictionUnchanged = guildId === current.guildId && userId === current.userId;
  const guilds: UnknownRecord = {};

  if (!restrictionUnchanged) {
    current.existingGuildKeys.forEach((existingGuildId) => {
      if (!guildId || existingGuildId !== guildId) guilds[existingGuildId] = null;
    });
    if (guildId && userId) {
      guilds[guildId] = { requireMention: true, users: [userId] };
    }
  }

  return {
    enabled: update.enabled,
    ...(!restrictionUnchanged ? {
      groupPolicy: guildId && userId ? "allowlist" : null,
      guilds: Object.keys(guilds).length > 0 ? guilds : null,
    } : {}),
    ...(update.replacementBotToken?.trim() ? { token: update.replacementBotToken.trim() } : {}),
  };
}

export function buildOpenClawSlackPatch(
  current: SafeSlackChannelConfig,
  update: SlackSettingsUpdate,
): UnknownRecord {
  const allowFrom = update.dmPolicy === "open"
    ? Array.from(new Set(["*", ...update.allowFrom]))
    : Array.from(new Set(update.allowFrom));
  const nextRules = new Map(update.channels.map((rule) => [rule.channelId.trim(), rule]));
  const currentRules = new Map(current.channels.map((rule) => [rule.channelId, rule]));
  const channels: UnknownRecord = {};

  current.existingChannelKeys.forEach((channelId) => {
    if (!nextRules.has(channelId)) channels[channelId] = null;
  });
  nextRules.forEach((rule, channelId) => {
    if (!channelId) return;
    const existing = currentRules.get(channelId);
    const mentionChanged = !existing || existing.mentionBehavior !== rule.mentionBehavior;
    const enabledChanged = !existing || existing.enabled !== rule.enabled;
    if (!mentionChanged && !enabledChanged) return;
    channels[channelId] = {
      ...(enabledChanged ? { enabled: rule.enabled } : {}),
      ...(mentionChanged ? {
        requireMention: rule.mentionBehavior === "runtime-default"
          ? null
          : rule.mentionBehavior === "required",
      } : {}),
    };
  });

  return {
    enabled: update.enabled,
    mode: update.mode,
    enterpriseOrgInstall: update.mode === "relay" ? false : update.enterpriseOrgInstall,
    dmPolicy: update.dmPolicy === "runtime-default" ? null : update.dmPolicy,
    allowFrom: allowFrom.length > 0 ? allowFrom : null,
    groupPolicy: update.groupPolicy === "runtime-default" ? null : update.groupPolicy,
    ...(update.channels.length === 0 && current.existingChannelKeys.length > 0
      ? { channels: null }
      : Object.keys(channels).length > 0 ? { channels } : {}),
    ...(update.replacementBotToken?.trim() ? { botToken: update.replacementBotToken.trim() } : {}),
    ...(update.mode === "socket" && update.replacementAppToken?.trim() ? { appToken: update.replacementAppToken.trim() } : {}),
    ...(update.mode === "http" ? {
      webhookPath: normalizeSlackWebhookPath(update.webhookPath),
      ...(update.replacementSigningSecret?.trim() ? { signingSecret: update.replacementSigningSecret.trim() } : {}),
    } : {}),
    ...(update.mode === "relay" ? {
      relay: {
        url: update.relayUrl.trim(),
        gatewayId: update.relayGatewayId.trim(),
        ...(update.replacementRelayAuthToken?.trim() ? { authToken: update.replacementRelayAuthToken.trim() } : {}),
      },
    } : {}),
  };
}

export function normalizeSlackWebhookPath(value: string): string {
  const path = value.trim();
  if (!path) return "/slack/events";
  return path.startsWith("/") ? path : `/${path}`;
}

export function buildOpenClawWhatsAppPatch(enabled: boolean): UnknownRecord {
  return { enabled };
}

export function readOpenClawCredentialState(
  rawRuntimeStatus: unknown,
  credential: "token" | "botToken" | "appToken" | "signingSecret" | "relayAuthToken" | "userToken",
): RuntimeCredentialState {
  const status = asRecord(rawRuntimeStatus);
  const rawStatus = status?.[`${credential}Status`];
  const rawSource = status?.[`${credential}Source`];
  return {
    status: rawStatus === "available" || rawStatus === "configured_unavailable" || rawStatus === "missing"
      ? rawStatus
      : undefined,
    source: typeof rawSource === "string" && rawSource.trim() ? rawSource.trim() : undefined,
  };
}

export function readOpenClawSlackMode(rawRuntimeStatus: unknown): Exclude<SlackTransportMode, "runtime-default"> | undefined {
  const mode = asRecord(rawRuntimeStatus)?.mode;
  return mode === "socket" || mode === "http" || mode === "relay" ? mode : undefined;
}

export function parseDelimitedIds(value: string): string[] {
  return Array.from(new Set(value.split(/[\s,]+/).map((entry) => entry.trim()).filter(Boolean)));
}
