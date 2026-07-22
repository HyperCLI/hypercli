"use client";

import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ClawTooltip";
import type { AgentChannel, AgentChannelsProvider } from "@hypercli.com/sdk/channels";
import type { AgentConnectorsProvider, AgentRuntimeDescriptor } from "@hypercli.com/sdk/connectors";
import {
  AlertTriangle,
  Check,
  CircleHelp,
  CircleDot,
  FlaskConical,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";

import { INTEGRATION_BRAND_LOGOS } from "@/components/dashboard/integrations/integration-brand-icons";
import { ConnectorAuthorizationGuide } from "./ConnectorAuthorizationGuide";
import { SLACK_PAIRING_AUTHORIZATION_FLOW, TELEGRAM_PAIRING_AUTHORIZATION_FLOW } from "./connector-authorization-flows";
import {
  buildOpenClawDiscordPatch,
  buildOpenClawSlackPatch,
  buildOpenClawTelegramPatch,
  buildOpenClawWhatsAppPatch,
  parseDelimitedIds,
  parseOpenClawChannelConfig,
  normalizeSlackWebhookPath,
  readOpenClawCredentialState,
  type MentionBehavior,
  type OpenClawConfiguredChannelId,
  type SafeOpenClawChannelConfig,
  type SlackChannelRule,
  type SlackDmPolicy,
  type SlackGroupPolicy,
  type SlackMentionBehavior,
  type TelegramDmPolicy,
  type TelegramGroupPolicy,
} from "./openclaw-channel-settings";

export interface OpenClawChannelSettingsPanelProps {
  channelId: OpenClawConfiguredChannelId;
  channel: AgentChannel;
  provider: AgentChannelsProvider;
  connectorsProvider?: AgentConnectorsProvider | null;
  runtime: AgentRuntimeDescriptor;
  connected: boolean;
  onRefresh?: () => Promise<void> | void;
  onOpenPairing?: () => void;
  slackPublicBaseUrl?: string;
}

type OptionalProviderOperations = Partial<Pick<AgentChannelsProvider, "readConfig" | "update" | "read" | "removeConfig">>;
type Operation = "save" | "probe" | "remove" | null;
type TelegramPrivacyMode = "enabled" | "disabled" | "unknown";

interface ChannelFormState {
  enabled: boolean;
  dmPolicy: TelegramDmPolicy;
  allowFrom: string;
  groupPolicy: TelegramGroupPolicy;
  groupAllowFrom: string;
  groupIds: string;
  mentionBehavior: MentionBehavior;
  guildId: string;
  userId: string;
  slackChannels: SlackChannelRule[];
  slackMode: "socket" | "http" | "relay";
  enterpriseOrgInstall: boolean;
  webhookPath: string;
  relayUrl: string;
  relayGatewayId: string;
  replaceBotToken: boolean;
  replaceAppToken: boolean;
  replaceSigningSecret: boolean;
  replaceRelayAuthToken: boolean;
  botToken: string;
  appToken: string;
  signingSecret: string;
  relayAuthToken: string;
}

const CHANNEL_NAMES: Record<OpenClawConfiguredChannelId, string> = {
  telegram: "Telegram",
  discord: "Discord",
  slack: "Slack",
  whatsapp: "WhatsApp",
};

const INPUT_CLASS = "mt-1.5 h-10 w-full rounded-lg border border-border bg-input-background px-3 text-sm text-foreground outline-none transition-colors placeholder:text-text-muted focus:border-[var(--channel-accent)] focus:ring-2 focus:ring-[var(--channel-accent)] disabled:cursor-not-allowed disabled:opacity-60";
const LABEL_CLASS = "text-[10px] font-bold uppercase tracking-[0.14em] text-text-muted";
const SECONDARY_BUTTON = "inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-border bg-surface-low px-3 text-xs font-semibold text-text-secondary transition-colors hover:border-border-strong hover:bg-surface-high hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--channel-accent)] disabled:cursor-not-allowed disabled:opacity-45";
const PRIMARY_BUTTON = "inline-flex min-h-9 items-center justify-center gap-2 rounded-lg bg-[var(--channel-accent)] px-3.5 text-xs font-black uppercase tracking-[0.1em] text-[var(--channel-accent-foreground)] transition-[filter,transform] hover:-translate-y-px hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--channel-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:translate-y-0 disabled:opacity-45";
const DANGER_BUTTON = "inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 text-xs font-semibold text-destructive transition-colors hover:bg-destructive/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive disabled:cursor-not-allowed disabled:opacity-45";

function initialForm(channelId: OpenClawConfiguredChannelId): ChannelFormState {
  const safe = parseOpenClawChannelConfig(channelId, undefined);
  return formFromConfig(safe);
}

function formFromConfig(config: SafeOpenClawChannelConfig): ChannelFormState {
  return {
    enabled: config.enabled,
    dmPolicy: config.channelId === "telegram" || config.channelId === "slack" ? config.dmPolicy : "runtime-default",
    allowFrom: config.channelId === "telegram" || config.channelId === "slack" ? config.allowFrom.join(", ") : "",
    groupPolicy: config.channelId === "telegram" || config.channelId === "slack" ? config.groupPolicy : "runtime-default",
    groupAllowFrom: config.channelId === "telegram" ? config.groupAllowFrom.join(", ") : "",
    groupIds: config.channelId === "telegram" ? config.groupIds.join(", ") : "",
    mentionBehavior: config.channelId === "telegram" ? config.mentionBehavior : "runtime-default",
    guildId: config.channelId === "discord" ? config.guildId : "",
    userId: config.channelId === "discord" ? config.userId : "",
    slackChannels: config.channelId === "slack" ? config.channels : [],
    slackMode: config.channelId === "slack" && config.mode !== "runtime-default" ? config.mode : "socket",
    enterpriseOrgInstall: config.channelId === "slack" ? config.enterpriseOrgInstall : false,
    webhookPath: config.channelId === "slack" ? config.webhookPath : "/slack/events",
    relayUrl: config.channelId === "slack" ? config.relayUrl : "",
    relayGatewayId: config.channelId === "slack" ? config.relayGatewayId : "",
    replaceBotToken: false,
    replaceAppToken: false,
    replaceSigningSecret: false,
    replaceRelayAuthToken: false,
    botToken: "",
    appToken: "",
    signingSecret: "",
    relayAuthToken: "",
  };
}

function credentialStatusLabel(status?: string): string {
  if (status === "available") return "Available";
  if (status === "configured_unavailable") return "Configured, unavailable";
  if (status === "missing") return "Missing";
  return "Not reported";
}

function rawStatusLabel(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const candidate = [record.statusState, record.mode, record.healthState]
    .find((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
  return candidate?.trim() ?? null;
}

function validSlackRelayUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
    return url.protocol === "wss:" || (loopback && url.protocol === "ws:");
  } catch {
    return false;
  }
}

function buildSlackRequestUrl(baseUrl: string | undefined, webhookPath: string): string | null {
  if (!baseUrl) return null;
  try {
    const base = new URL(baseUrl);
    if (base.protocol !== "https:") return null;
    return new URL(normalizeSlackWebhookPath(webhookPath), `${base.origin}/`).toString();
  } catch {
    return null;
  }
}

function readTelegramPrivacyMode(...sources: unknown[]): TelegramPrivacyMode {
  for (const source of sources) {
    if (!source || typeof source !== "object" || Array.isArray(source)) continue;
    const probe = (source as Record<string, unknown>).probe;
    if (!probe || typeof probe !== "object" || Array.isArray(probe)) continue;
    const bot = (probe as Record<string, unknown>).bot;
    if (!bot || typeof bot !== "object" || Array.isArray(bot)) continue;
    const canReadAllGroupMessages = (bot as Record<string, unknown>).canReadAllGroupMessages;
    if (typeof canReadAllGroupMessages === "boolean") {
      return canReadAllGroupMessages ? "disabled" : "enabled";
    }
  }
  return "unknown";
}

function fieldLabel(label: string, content: React.ReactNode) {
  return (
    <label className="block min-w-0">
      <span className={LABEL_CLASS}>{label}</span>
      {content}
    </label>
  );
}

export function OpenClawChannelSettingsPanel({
  channelId,
  channel,
  provider,
  connectorsProvider,
  connected,
  onRefresh,
  onOpenPairing,
  slackPublicBaseUrl,
}: OpenClawChannelSettingsPanelProps) {
  const operations = provider as OptionalProviderOperations;
  const name = CHANNEL_NAMES[channelId];
  const brand = INTEGRATION_BRAND_LOGOS[channelId];
  const BrandIcon = brand.icon;
  const knownAccountIds = Array.from(new Set([
    channel.defaultAccountId?.trim(),
    ...channel.accounts.map((account) => account.accountId?.trim()),
  ].filter((accountId): accountId is string => Boolean(accountId))));
  const preferredAccountId = channel.defaultAccountId?.trim() || knownAccountIds[0];
  const [accountSelection, setAccountSelection] = useState<{ channelId: string; accountId?: string }>({
    channelId,
    accountId: preferredAccountId,
  });
  const [safeConfig, setSafeConfig] = useState<SafeOpenClawChannelConfig>(() => parseOpenClawChannelConfig(channelId, undefined));
  const [form, setForm] = useState<ChannelFormState>(() => initialForm(channelId));
  const [resolvedAccountId, setResolvedAccountId] = useState<string | undefined>();
  const [savedTelegramDmPolicy, setSavedTelegramDmPolicy] = useState<TelegramDmPolicy>("runtime-default");
  const [savedSlackDmPolicy, setSavedSlackDmPolicy] = useState<SlackDmPolicy>("runtime-default");
  const [loadedScope, setLoadedScope] = useState<string | null>(null);
  const [operation, setOperation] = useState<Operation>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [telegramPrivacyProbe, setTelegramPrivacyProbe] = useState<{ scope: string; mode: TelegramPrivacyMode } | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const confirmRemoveRef = useRef<HTMLButtonElement>(null);
  const selectedAccountId = accountSelection.channelId === channelId && accountSelection.accountId && knownAccountIds.includes(accountSelection.accountId)
    ? accountSelection.accountId
    : preferredAccountId;
  const selectedAccount = channel.accounts.find((account) => account.accountId === selectedAccountId)
    ?? (selectedAccountId ? undefined : channel.accounts[0]);
  const canReadConfig = typeof operations.readConfig === "function";
  const canUpdate = typeof operations.update === "function";
  const canProbe = typeof operations.read === "function";
  const canRemove = typeof operations.removeConfig === "function";
  const readConfigOperation = operations.readConfig;
  const readScope = `${channelId}:${selectedAccountId ?? "default"}`;
  const reportedTelegramPrivacyMode = readTelegramPrivacyMode(selectedAccount?.rawRuntimeStatus, channel.rawChannelStatus);
  const telegramPrivacyMode = telegramPrivacyProbe?.scope === readScope
    ? telegramPrivacyProbe.mode
    : reportedTelegramPrivacyMode;
  const loading = canReadConfig && loadedScope !== readScope;
  const busy = operation !== null;
  const style = {
    "--channel-accent": "var(--selection-accent)",
    "--channel-accent-foreground": "var(--selection-accent-foreground)",
  } as CSSProperties;

  useEffect(() => {
    if (typeof readConfigOperation !== "function") return;

    let cancelled = false;
    void readConfigOperation.call(provider, { channelId, ...(selectedAccountId ? { accountId: selectedAccountId } : {}) })
      .then((result) => {
        if (cancelled) return;
        const parsed = parseOpenClawChannelConfig(channelId, result.config);
        setSafeConfig(parsed);
        setForm(formFromConfig(parsed));
        setResolvedAccountId(result.accountId);
        setSavedTelegramDmPolicy(parsed.channelId === "telegram" ? parsed.dmPolicy : "runtime-default");
        setSavedSlackDmPolicy(parsed.channelId === "slack" ? parsed.dmPolicy : "runtime-default");
        setError(null);
        setLoadedScope(readScope);
      })
      .catch(() => {
        if (!cancelled) {
          setError(`Could not read ${name} settings from this agent.`);
          setLoadedScope(readScope);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [channelId, name, provider, readConfigOperation, readScope, selectedAccountId]);

  useEffect(() => {
    if (confirmingRemove) confirmRemoveRef.current?.focus();
  }, [confirmingRemove]);

  const setField = <K extends keyof ChannelFormState>(field: K, value: ChannelFormState[K]) => {
    setForm((current) => ({ ...current, [field]: value }));
    setError(null);
    setNotice(null);
  };

  const refresh = async () => {
    if (!onRefresh) return;
    try {
      await onRefresh();
    } catch {
      setNotice((current) => current ? `${current} Status refresh was unavailable.` : "Status refresh was unavailable.");
    }
  };

  const validate = (): string | null => {
    if (!connected) return "Reconnect the workspace before changing integration settings.";
    if (!canUpdate) return "This agent cannot update integration settings.";
    if ((form.replaceBotToken && !form.botToken.trim())
      || (channelId === "slack" && form.slackMode === "socket" && form.replaceAppToken && !form.appToken.trim())
      || (channelId === "slack" && form.slackMode === "http" && form.replaceSigningSecret && !form.signingSecret.trim())
      || (channelId === "slack" && form.slackMode === "relay" && form.replaceRelayAuthToken && !form.relayAuthToken.trim())) {
      return "Enter each credential selected for replacement.";
    }
    if (channelId === "telegram") {
      const allowFrom = parseDelimitedIds(form.allowFrom);
      const groupAllowFrom = parseDelimitedIds(form.groupAllowFrom);
      const groupIds = parseDelimitedIds(form.groupIds);
      if (!allowFrom.every((entry) => /^\d+$/.test(entry) || entry === "*")) return "Telegram sender IDs must be numeric or an explicit wildcard.";
      if (!groupAllowFrom.every((entry) => /^\d+$/.test(entry) || entry === "*")) return "Telegram group sender IDs must be numeric or an explicit wildcard.";
      if (!groupIds.every((entry) => /^-?\d+$/.test(entry) || entry === "*")) return "Telegram group IDs must be numeric or an explicit wildcard.";
    }
    if (channelId === "discord") {
      const guildId = form.guildId.trim();
      const userId = form.userId.trim();
      if (Boolean(guildId) !== Boolean(userId)) return "Enter both the server ID and member ID, or clear both.";
      if ((guildId && !/^\d+$/.test(guildId)) || (userId && !/^\d+$/.test(userId))) return "Discord server and member IDs must be numeric.";
    }
    if (channelId === "slack") {
      if (form.replaceBotToken && !form.botToken.trim().startsWith("xoxb-")) return "Slack bot tokens must start with xoxb-.";
      if (form.slackMode === "socket" && form.replaceAppToken && !form.appToken.trim().startsWith("xapp-")) return "Slack app tokens must start with xapp-.";
      const allowFrom = parseDelimitedIds(form.allowFrom);
      if (form.dmPolicy === "allowlist" && allowFrom.length === 0) return "Add at least one Slack user ID for direct-message allowlist access.";
      if (!allowFrom.every((entry) => /^U[A-Z0-9]{8,}$/.test(entry) || (entry === "*" && form.dmPolicy === "open"))) {
        return "Slack sender IDs must be uppercase U... IDs. The wildcard is only allowed with Open access.";
      }
      const channelIds = form.slackChannels.map((rule) => rule.channelId.trim());
      if (form.groupPolicy === "allowlist" && channelIds.length === 0) return "Add at least one Slack channel for channel allowlist access.";
      if (!channelIds.every((entry) => /^C[A-Z0-9]{8,}$/.test(entry))) return "Slack channel IDs must be uppercase C... IDs, not channel names.";
      if (new Set(channelIds).size !== channelIds.length) return "Each Slack channel ID can only be listed once.";
      const credentialAvailable = (configured: boolean, status?: string) => configured || status === "available" || status === "configured_unavailable";
      if (!credentialAvailable(safeConfig.channelId === "slack" && safeConfig.botTokenConfigured, slackBotCredential.status) && !(form.replaceBotToken && form.botToken.trim())) {
        return "Enter a Slack bot token for this transport.";
      }
      if (form.slackMode === "socket" && !credentialAvailable(safeConfig.channelId === "slack" && safeConfig.appTokenConfigured, slackAppCredential.status) && !(form.replaceAppToken && form.appToken.trim())) {
        return "Enter a Slack app token for Socket Mode.";
      }
      if (form.slackMode === "http") {
        if (!slackRequestUrl) return "This agent needs a public HTTPS hostname before HTTP Request URLs can be enabled.";
        if (!credentialAvailable(safeConfig.channelId === "slack" && safeConfig.signingSecretConfigured, slackSigningSecretCredential.status) && !(form.replaceSigningSecret && form.signingSecret.trim())) {
          return "Enter the Slack signing secret for HTTP Request URLs.";
        }
        const webhookPath = normalizeSlackWebhookPath(form.webhookPath);
        if (webhookPath === "/" || /[\s?#]/.test(webhookPath)) return "Slack webhook paths must be a non-root path without spaces, queries, or fragments.";
      }
      if (form.slackMode === "relay") {
        if (form.enterpriseOrgInstall) return "Relay mode is unavailable for Enterprise Grid organization installs.";
        if (!validSlackRelayUrl(form.relayUrl.trim())) return "Relay URLs must use wss://. ws:// is allowed only for loopback hosts.";
        if (!form.relayGatewayId.trim()) return "Enter the relay gateway ID.";
        if (!(safeConfig.channelId === "slack" && safeConfig.relayAuthTokenConfigured) && !(form.replaceRelayAuthToken && form.relayAuthToken.trim())) {
          return "Enter the relay authentication token.";
        }
      }
    }
    return null;
  };

  const save = async () => {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    const update = operations.update;
    if (typeof update !== "function") return;
    setOperation("save");
    setError(null);
    setNotice(null);
    try {
      let patch: Record<string, unknown>;
      if (channelId === "telegram" && safeConfig.channelId === "telegram") {
        patch = buildOpenClawTelegramPatch(safeConfig, {
          enabled: form.enabled,
          dmPolicy: form.dmPolicy,
          allowFrom: parseDelimitedIds(form.allowFrom),
          groupPolicy: form.groupPolicy,
          groupAllowFrom: parseDelimitedIds(form.groupAllowFrom),
          groupIds: parseDelimitedIds(form.groupIds),
          mentionBehavior: form.mentionBehavior,
          ...(form.replaceBotToken ? { replacementBotToken: form.botToken } : {}),
        });
      } else if (channelId === "discord" && safeConfig.channelId === "discord") {
        patch = buildOpenClawDiscordPatch(safeConfig, {
          enabled: form.enabled,
          guildId: form.guildId,
          userId: form.userId,
          ...(form.replaceBotToken ? { replacementBotToken: form.botToken } : {}),
        });
      } else if (channelId === "slack" && safeConfig.channelId === "slack") {
        patch = buildOpenClawSlackPatch(safeConfig, {
          enabled: form.enabled,
          mode: form.slackMode,
          enterpriseOrgInstall: form.enterpriseOrgInstall,
          webhookPath: form.webhookPath,
          relayUrl: form.relayUrl,
          relayGatewayId: form.relayGatewayId,
          dmPolicy: form.dmPolicy,
          allowFrom: parseDelimitedIds(form.allowFrom),
          groupPolicy: form.groupPolicy,
          channels: form.slackChannels.map((rule) => ({ ...rule, channelId: rule.channelId.trim() })),
          ...(form.replaceBotToken ? { replacementBotToken: form.botToken } : {}),
          ...(form.replaceAppToken ? { replacementAppToken: form.appToken } : {}),
          ...(form.replaceSigningSecret ? { replacementSigningSecret: form.signingSecret } : {}),
          ...(form.replaceRelayAuthToken ? { replacementRelayAuthToken: form.relayAuthToken } : {}),
        });
      } else {
        patch = buildOpenClawWhatsAppPatch(form.enabled);
      }
      const updateAccountId = channelId === "slack"
        ? resolvedAccountId ?? (selectedAccountId && selectedAccountId !== "default" ? selectedAccountId : undefined)
        : resolvedAccountId;
      await update.call(provider, { channelId, ...(updateAccountId ? { accountId: updateAccountId } : {}), patch });
      if (channelId === "telegram") setSavedTelegramDmPolicy(form.dmPolicy);
      if (channelId === "slack") {
        setSavedSlackDmPolicy(form.dmPolicy);
        setSafeConfig({
          channelId: "slack",
          enabled: form.enabled,
          mode: form.slackMode,
          enterpriseOrgInstall: form.slackMode === "relay" ? false : form.enterpriseOrgInstall,
          webhookPath: normalizeSlackWebhookPath(form.webhookPath),
          relayUrl: form.relayUrl.trim(),
          relayGatewayId: form.relayGatewayId.trim(),
          botTokenConfigured: (safeConfig.channelId === "slack" && safeConfig.botTokenConfigured) || Boolean(form.replaceBotToken && form.botToken.trim()),
          appTokenConfigured: (safeConfig.channelId === "slack" && safeConfig.appTokenConfigured) || Boolean(form.replaceAppToken && form.appToken.trim()),
          signingSecretConfigured: (safeConfig.channelId === "slack" && safeConfig.signingSecretConfigured) || Boolean(form.replaceSigningSecret && form.signingSecret.trim()),
          relayAuthTokenConfigured: (safeConfig.channelId === "slack" && safeConfig.relayAuthTokenConfigured) || Boolean(form.replaceRelayAuthToken && form.relayAuthToken.trim()),
          dmPolicy: form.dmPolicy,
          allowFrom: parseDelimitedIds(form.allowFrom),
          groupPolicy: form.groupPolicy,
          channels: form.slackChannels.map((rule) => ({ ...rule, channelId: rule.channelId.trim() })),
          existingChannelKeys: form.slackChannels.map((rule) => rule.channelId.trim()),
        });
      }
      setForm((current) => ({
        ...current,
        enterpriseOrgInstall: current.slackMode === "relay" ? false : current.enterpriseOrgInstall,
        webhookPath: normalizeSlackWebhookPath(current.webhookPath),
        replaceBotToken: false,
        replaceAppToken: false,
        replaceSigningSecret: false,
        replaceRelayAuthToken: false,
        botToken: "",
        appToken: "",
        signingSecret: "",
        relayAuthToken: "",
      }));
      setNotice("Settings saved.");
      await refresh();
    } catch {
      setError(`Could not save ${name} settings. Check the agent connection and try again.`);
    } finally {
      setOperation(null);
    }
  };

  const probe = async () => {
    const read = operations.read;
    if (typeof read !== "function") {
      setError("Connection testing is unavailable for this agent.");
      return;
    }
    setOperation("probe");
    setError(null);
    setNotice(null);
    try {
      const snapshot = await read.call(provider, { channelId, probe: true });
      const refreshedChannel = snapshot.channels.find((candidate) => candidate.channelId === channelId);
      const refreshedAccount = selectedAccountId
        ? refreshedChannel?.accounts.find((candidate) => candidate.accountId === selectedAccountId)
        : refreshedChannel?.accounts.length === 1 ? refreshedChannel.accounts[0] : undefined;
      if (channelId === "telegram") {
        setTelegramPrivacyProbe({
          scope: readScope,
          mode: readTelegramPrivacyMode(refreshedAccount?.rawRuntimeStatus, refreshedChannel?.rawChannelStatus),
        });
      }
      if (!refreshedAccount) {
        setError(`Could not identify the selected ${name} account after testing.`);
      } else if (refreshedAccount.configured && refreshedAccount.running === true && refreshedAccount.healthState === "healthy") {
        setNotice("Connection test passed. Connection status refreshed.");
      } else {
        setError(refreshedAccount.lastError?.trim() || `${name} is configured but not healthy yet.`);
      }
      await refresh();
    } catch {
      setError(`Could not test the ${name} connection right now.`);
    } finally {
      setOperation(null);
    }
  };

  const remove = async () => {
    const removeConfig = operations.removeConfig;
    if (typeof removeConfig !== "function") {
      setError("Configuration removal is unavailable for this agent.");
      return;
    }
    setOperation("remove");
    setError(null);
    setNotice(null);
    try {
      const resolvedRemovalAccountId = resolvedAccountId ?? selectedAccountId;
      const removalAccountId = resolvedRemovalAccountId && resolvedRemovalAccountId !== "default"
        ? resolvedRemovalAccountId
        : undefined;
      if (removalAccountId) await removeConfig.call(provider, channelId, removalAccountId);
      else await removeConfig.call(provider, channelId);
    } catch {
      setError(`Could not remove the ${name} configuration.`);
      setOperation(null);
      return;
    }

    setConfirmingRemove(false);
    setForm(initialForm(channelId));
    setSavedTelegramDmPolicy("runtime-default");
    setSavedSlackDmPolicy("runtime-default");
    let remainsConfigured = false;
    let statusUnavailable = false;
    try {
      if (typeof operations.read === "function") {
        const snapshot = await operations.read.call(provider, { channelId });
        const refreshedChannel = snapshot.channels.find((candidate) => candidate.channelId === channelId);
        const refreshedAccount = selectedAccountId
          ? refreshedChannel?.accounts.find((candidate) => candidate.accountId === selectedAccountId)
          : refreshedChannel?.accounts.length === 1 ? refreshedChannel.accounts[0] : undefined;
        remainsConfigured = refreshedAccount?.configured === true;
      }
    } catch {
      statusUnavailable = true;
    }
    setNotice(remainsConfigured
      ? "Local configuration removed. Inherited or environment-backed settings still configure this account."
      : statusUnavailable
        ? "Configuration removed. Status refresh was unavailable."
        : "Configuration removed.");
    try {
      await refresh();
    } catch {
      setNotice((current) => current?.includes("Status refresh was unavailable")
        ? current
        : `${current ?? "Configuration removed."} Status refresh was unavailable.`);
    } finally {
      setOperation(null);
    }
  };

  const renderTelegramSettings = () => (
    <div className="grid gap-4 md:grid-cols-2">
      {fieldLabel("Direct-message policy", (
        <select aria-label="Telegram direct-message policy" className={INPUT_CLASS} value={form.dmPolicy} onChange={(event) => setField("dmPolicy", event.target.value as TelegramDmPolicy)}>
          <option value="runtime-default">Runtime default</option>
          <option value="allowlist">Allowlist</option>
          <option value="pairing">Pairing approval</option>
          <option value="open">Open</option>
          <option value="disabled">Disabled</option>
        </select>
      ))}
      {fieldLabel("Allowed sender IDs", <input aria-label="Telegram allowed sender IDs" className={INPUT_CLASS} value={form.allowFrom} onChange={(event) => setField("allowFrom", event.target.value)} placeholder="123456789, 987654321" inputMode="numeric" />)}
      {fieldLabel("Group policy", (
        <select aria-label="Telegram group policy" className={INPUT_CLASS} value={form.groupPolicy} onChange={(event) => setField("groupPolicy", event.target.value as TelegramGroupPolicy)}>
          <option value="runtime-default">Runtime default</option>
          <option value="allowlist">Allowlist</option>
          <option value="open">Open</option>
          <option value="disabled">Disabled</option>
        </select>
      ))}
      {fieldLabel("Allowed group sender IDs", <input aria-label="Telegram allowed group sender IDs" className={INPUT_CLASS} value={form.groupAllowFrom} onChange={(event) => setField("groupAllowFrom", event.target.value)} placeholder="123456789 or *" />)}
      {fieldLabel("Group IDs", <input aria-label="Telegram group IDs" className={INPUT_CLASS} value={form.groupIds} onChange={(event) => setField("groupIds", event.target.value)} placeholder="-1001234567890" />)}
      {fieldLabel("Mention behavior", (
        <select aria-label="Telegram mention behavior" className={INPUT_CLASS} value={form.mentionBehavior} onChange={(event) => setField("mentionBehavior", event.target.value as MentionBehavior)}>
           <option value="runtime-default">Runtime default</option>
           <option value="required">Require mention</option>
           <option value="not-required">Do not require mention</option>
           {form.mentionBehavior === "mixed" ? <option value="mixed">Keep existing per-group rules</option> : null}
        </select>
      ))}
    </div>
  );

  const renderDiscordSettings = () => (
    <div className="grid gap-4 md:grid-cols-2">
      {fieldLabel("Server ID", <input aria-label="Discord server ID" className={INPUT_CLASS} value={form.guildId} onChange={(event) => setField("guildId", event.target.value)} inputMode="numeric" placeholder="123456789012345678" />)}
      {fieldLabel("Allowed member ID", <input aria-label="Discord allowed member ID" className={INPUT_CLASS} value={form.userId} onChange={(event) => setField("userId", event.target.value)} inputMode="numeric" placeholder="987654321098765432" />)}
      <p className="md:col-span-2 text-xs leading-5 text-text-muted">Leave both fields empty to remove the server restriction. A restriction always requires a matching server and member ID.</p>
    </div>
  );

  const updateSlackChannel = <K extends keyof SlackChannelRule>(index: number, field: K, value: SlackChannelRule[K]) => {
    setForm((current) => ({
      ...current,
      slackChannels: current.slackChannels.map((rule, ruleIndex) => ruleIndex === index ? { ...rule, [field]: value } : rule),
    }));
    setError(null);
    setNotice(null);
  };

  const renderSlackSettings = () => (
    <div className="space-y-5">
      <div className="rounded-lg border border-border bg-background p-3 text-xs leading-5 text-text-muted">
        This account uses {slackModeLabel}. Create or manage the app at <a href="https://api.slack.com/apps" target="_blank" rel="noopener noreferrer" className="font-semibold text-text-secondary underline-offset-2 hover:text-foreground hover:underline">Slack API</a>, then keep its bot invited to every allowed channel.
      </div>

      <div className="space-y-3">
        <div>
          <h4 className="text-xs font-bold uppercase tracking-[0.12em] text-text-secondary">Connection</h4>
          <p className="mt-1 text-xs text-text-muted">Choose how Slack delivers events to this agent. Switching transport keeps credentials saved for other modes.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {fieldLabel("Transport", (
            <select aria-label="Slack transport" className={INPUT_CLASS} value={form.slackMode} onChange={(event) => {
              const mode = event.target.value as ChannelFormState["slackMode"];
              setField("slackMode", mode);
            }}>
              <option value="socket">Socket Mode</option>
              <option value="http">HTTP Request URLs</option>
              <option value="relay">Relay</option>
            </select>
          ))}
          <label className="mt-[1.45rem] flex h-10 items-center gap-2 rounded-lg border border-border bg-input-background px-3 text-xs text-text-secondary">
            <input type="checkbox" aria-label="Slack Enterprise Grid organization install" checked={form.enterpriseOrgInstall} onChange={(event) => setField("enterpriseOrgInstall", event.target.checked)} className="h-4 w-4 accent-[var(--channel-accent)]" />
            Enterprise Grid organization install
          </label>
        </div>
        {form.slackMode === "socket" ? (
          <p className="rounded-lg border border-border bg-background px-3 py-2 text-xs leading-5 text-text-muted">Enable Socket Mode and app-level connections in Slack, then use a bot token and an app token with the <code>connections:write</code> scope.</p>
        ) : form.slackMode === "http" ? (
          <div className="grid gap-4 md:grid-cols-2">
            {fieldLabel("Webhook path", <input aria-label="Slack webhook path" className={INPUT_CLASS} value={form.webhookPath} onChange={(event) => setField("webhookPath", event.target.value)} placeholder="/slack/events" spellCheck={false} />)}
            {fieldLabel("Slack Request URL", <input aria-label="Slack Request URL" className={INPUT_CLASS} value={slackRequestUrl ?? "Public agent hostname unavailable"} readOnly spellCheck={false} />)}
            <p className="md:col-span-2 text-xs leading-5 text-text-muted">Paste the Request URL into Slack Event Subscriptions and Interactivity. The URL updates when the webhook path changes.</p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {fieldLabel("Relay WebSocket URL", <input aria-label="Slack relay WebSocket URL" className={INPUT_CLASS} value={form.relayUrl} onChange={(event) => setField("relayUrl", event.target.value)} placeholder="wss://relay.example.com/slack" spellCheck={false} />)}
            {fieldLabel("Relay gateway ID", <input aria-label="Slack relay gateway ID" className={INPUT_CLASS} value={form.relayGatewayId} onChange={(event) => setField("relayGatewayId", event.target.value)} placeholder="gateway-1" spellCheck={false} />)}
            <p className="md:col-span-2 text-xs leading-5 text-text-muted">Relay mode is for a managed Slack relay endpoint and is unavailable for Enterprise Grid organization installs.</p>
          </div>
        )}
      </div>

      <div className="space-y-3 border-t border-border pt-5">
        <div>
          <h4 className="text-xs font-bold uppercase tracking-[0.12em] text-text-secondary">Direct messages</h4>
          <p className="mt-1 text-xs text-text-muted">Choose who may start direct conversations with this agent.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {fieldLabel("Direct-message policy", (
            <select aria-label="Slack direct-message policy" className={INPUT_CLASS} value={form.dmPolicy} onChange={(event) => setField("dmPolicy", event.target.value as SlackDmPolicy)}>
              <option value="runtime-default">Runtime default</option>
              <option value="pairing">Pairing approval</option>
              <option value="allowlist">Allowlist</option>
              <option value="open">Open</option>
              <option value="disabled">Disabled</option>
            </select>
          ))}
          {fieldLabel("Allowed Slack user IDs", (
            <input aria-label="Slack allowed user IDs" className={INPUT_CLASS} value={form.allowFrom} onChange={(event) => setField("allowFrom", event.target.value)} placeholder="U0123456789, U9876543210" spellCheck={false} />
          ))}
        </div>
        {form.dmPolicy === "open" ? (
          <div role="alert" className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">Open access allows any workspace member to direct-message this agent.</div>
        ) : null}
      </div>

      <div className="space-y-3 border-t border-border pt-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h4 className="text-xs font-bold uppercase tracking-[0.12em] text-text-secondary">Channel access</h4>
            <p className="mt-1 text-xs leading-5 text-text-muted">Use stable C... channel IDs from Slack channel links, never #channel-name.</p>
          </div>
          <button type="button" className={SECONDARY_BUTTON} onClick={() => setField("slackChannels", [
            ...form.slackChannels,
            { channelId: "", enabled: true, mentionBehavior: "required" },
          ])} disabled={busy}>
            <Plus className="h-3.5 w-3.5" /> Add channel
          </button>
        </div>
        {fieldLabel("Channel policy", (
          <select aria-label="Slack channel policy" className={INPUT_CLASS} value={form.groupPolicy} onChange={(event) => setField("groupPolicy", event.target.value as SlackGroupPolicy)}>
            <option value="runtime-default">Runtime default</option>
            <option value="allowlist">Allowlist</option>
            <option value="open">Open</option>
            <option value="disabled">Disabled</option>
          </select>
        ))}
        <div className="space-y-2">
          {form.slackChannels.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-text-muted">No channel rules configured.</div>
          ) : form.slackChannels.map((rule, index) => (
            <div key={`slack-channel-${index}`} className="grid gap-3 rounded-lg border border-border bg-background p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
              {fieldLabel("Channel ID", (
                <input aria-label={`Slack channel ID ${index + 1}`} className={INPUT_CLASS} value={rule.channelId} onChange={(event) => updateSlackChannel(index, "channelId", event.target.value)} placeholder="C0123456789" spellCheck={false} />
              ))}
              {fieldLabel("Mention behavior", (
                <select aria-label={`Slack channel mention behavior ${index + 1}`} className={INPUT_CLASS} value={rule.mentionBehavior} onChange={(event) => updateSlackChannel(index, "mentionBehavior", event.target.value as SlackMentionBehavior)}>
                  <option value="runtime-default">Runtime default</option>
                  <option value="required">Require mention</option>
                  <option value="not-required">Do not require mention</option>
                </select>
              ))}
              <div className="flex items-center gap-2 md:pb-0.5">
                <label className="inline-flex h-10 items-center gap-2 rounded-lg border border-border px-3 text-xs text-text-secondary">
                  <input type="checkbox" aria-label={`Enable Slack channel ${index + 1}`} checked={rule.enabled} onChange={(event) => updateSlackChannel(index, "enabled", event.target.checked)} className="h-4 w-4 accent-[var(--channel-accent)]" /> Enabled
                </label>
                <button type="button" aria-label={`Remove Slack channel ${index + 1}`} className={DANGER_BUTTON} onClick={() => setField("slackChannels", form.slackChannels.filter((_, ruleIndex) => ruleIndex !== index))}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const credentialState = (credential: "botToken" | "appToken" | "signingSecret" | "relayAuthToken", configured: boolean) => {
    const reported = readOpenClawCredentialState(selectedAccount?.rawRuntimeStatus, credential);
    return reported.status ? reported : configured ? { status: "configured_unavailable" as const, source: "saved settings" } : reported;
  };
  const slackBotCredential = credentialState("botToken", safeConfig.channelId === "slack" && safeConfig.botTokenConfigured);
  const slackAppCredential = credentialState("appToken", safeConfig.channelId === "slack" && safeConfig.appTokenConfigured);
  const slackSigningSecretCredential = credentialState("signingSecret", safeConfig.channelId === "slack" && safeConfig.signingSecretConfigured);
  const slackRelayAuthCredential = credentialState("relayAuthToken", safeConfig.channelId === "slack" && safeConfig.relayAuthTokenConfigured);
  const slackMode = form.slackMode;
  const slackModeLabel = slackMode === "http" ? "HTTP Request URLs" : slackMode === "relay" ? "Relay" : "Socket Mode";
  const slackRequestUrl = buildSlackRequestUrl(slackPublicBaseUrl, form.webhookPath);
  const renderCredentialReplacement = (kind: "bot" | "app" | "signing" | "relay") => {
    const enabled = kind === "app" ? form.replaceAppToken
      : kind === "signing" ? form.replaceSigningSecret
        : kind === "relay" ? form.replaceRelayAuthToken
          : form.replaceBotToken;
    const value = kind === "app" ? form.appToken
      : kind === "signing" ? form.signingSecret
        : kind === "relay" ? form.relayAuthToken
          : form.botToken;
    const label = kind === "app" ? "app token" : kind === "signing" ? "signing secret" : kind === "relay" ? "relay authentication token" : "bot token";
    const title = kind === "app" ? "App token" : kind === "signing" ? "Signing secret" : kind === "relay" ? "Relay authentication token" : "Bot token";
    const state = kind === "app" ? slackAppCredential : kind === "signing" ? slackSigningSecretCredential : kind === "relay" ? slackRelayAuthCredential : slackBotCredential;
    const setReplacementEnabled = (next: boolean) => {
      if (kind === "app") setField("replaceAppToken", next);
      else if (kind === "signing") setField("replaceSigningSecret", next);
      else if (kind === "relay") setField("replaceRelayAuthToken", next);
      else setField("replaceBotToken", next);
    };
    const setCredentialValue = (next: string) => {
      if (kind === "app") setField("appToken", next);
      else if (kind === "signing") setField("signingSecret", next);
      else if (kind === "relay") setField("relayAuthToken", next);
      else setField("botToken", next);
    };
    return (
      <div className="rounded-xl border border-border bg-background p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-foreground">{title}</p>
            {channelId === "slack" ? (
              <p className="mt-0.5 text-[11px] text-text-muted">
                {credentialStatusLabel(state.status)}
                {state.source ? ` · ${state.source}` : ""}
              </p>
            ) : <p className="mt-0.5 text-[11px] text-text-muted">Current value is never loaded into this page.</p>}
          </div>
          {!enabled ? (
            <button type="button" className={SECONDARY_BUTTON} onClick={() => setReplacementEnabled(true)}>
              <KeyRound className="h-3.5 w-3.5" /> Replace {label}
            </button>
          ) : null}
        </div>
        {enabled ? (
          <div className="mt-3">
            {fieldLabel(`New ${label}`, <input aria-label={`${name} new ${label}`} className={INPUT_CLASS} type="password" autoComplete="new-password" spellCheck={false} value={value} onChange={(event) => setCredentialValue(event.target.value)} />)}
            <button type="button" className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-text-muted hover:text-foreground" onClick={() => {
              setReplacementEnabled(false);
              setCredentialValue("");
            }}>
              <X className="h-3 w-3" /> Keep current {label}
            </button>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <section className="relative overflow-hidden rounded-2xl border border-border bg-background text-foreground [box-shadow:var(--glass-card-shadow)]" style={style} aria-labelledby={`${channelId}-settings-title`}>
      <header className="border-b border-border bg-surface-low px-4 py-4 sm:px-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3.5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--channel-accent)]/30 bg-background">
              <BrandIcon className="h-5 w-5" style={{ color: brand.color }} />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id={`${channelId}-settings-title`} className="text-base font-bold tracking-tight">{name} configuration</h2>
                <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${selectedAccount?.healthState === "healthy" ? "border-selection-accent/30 bg-selection-accent/10 text-selection-accent" : "border-border bg-surface-high text-text-secondary"}`}>
                  <CircleDot className="h-2.5 w-2.5" /> {selectedAccount?.running ? "Online" : selectedAccount?.configured ? "Configured" : "Status unknown"}
                </span>
              </div>
            </div>
          </div>
          <div className="min-w-0 shrink-0 text-right">
            <p className="text-[10px] font-bold uppercase tracking-[0.13em] text-text-muted">Account</p>
            <p className="mt-1 truncate text-sm font-medium text-text-secondary">{selectedAccount?.accountDisplayName || selectedAccountId || "Default account"}</p>
          </div>
        </div>
      </header>

      <div className="space-y-3 p-4 sm:p-5">
        {knownAccountIds.length > 1 ? (
          <div className="rounded-xl border border-border bg-surface-low p-3.5">
            {fieldLabel("Configured account", (
              <select aria-label={`${name} configured account`} className={INPUT_CLASS} value={selectedAccountId ?? ""} onChange={(event) => {
                setAccountSelection({ channelId, accountId: event.target.value || undefined });
                setForm(initialForm(channelId));
                setSafeConfig(parseOpenClawChannelConfig(channelId, undefined));
                setResolvedAccountId(undefined);
                setSavedTelegramDmPolicy("runtime-default");
                setSavedSlackDmPolicy("runtime-default");
                setError(null);
                setNotice(null);
                setConfirmingRemove(false);
              }} disabled={busy}>
                {knownAccountIds.map((accountId) => {
                  const account = channel.accounts.find((candidate) => candidate.accountId === accountId);
                  return <option key={accountId} value={accountId}>{account?.accountDisplayName || accountId}{accountId === channel.defaultAccountId ? " (default)" : ""}</option>;
                })}
              </select>
            ))}
          </div>
        ) : null}

        {!connected ? (
          <div role="alert" className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 px-3.5 py-3 text-xs text-warning">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> Reconnect the workspace before changing integration settings.
          </div>
        ) : null}
        {!canReadConfig ? <div role="alert" className="rounded-xl border border-warning/30 bg-warning/10 px-3.5 py-3 text-xs text-warning">This agent cannot read integration settings.</div> : null}
        {error ? <div role="alert" className="rounded-xl border border-destructive/35 bg-destructive/10 px-3.5 py-3 text-xs text-destructive">{error}</div> : null}
        {notice ? <div role="status" className="flex items-center gap-2 rounded-xl border border-selection-accent/25 bg-selection-accent/10 px-3.5 py-3 text-xs text-selection-accent"><Check className="h-4 w-4" />{notice}</div> : null}

        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_240px]">
          <div className="rounded-xl border border-border bg-surface-low p-4">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold">Access policy</h3>
                <p className="mt-1 text-xs leading-5 text-text-muted">Choose how this account can receive messages.</p>
              </div>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-2 text-xs font-semibold text-text-secondary">
                <input type="checkbox" aria-label={`Enable ${name} integration`} checked={form.enabled} onChange={(event) => setField("enabled", event.target.checked)} className="h-4 w-4 accent-[var(--channel-accent)]" disabled={loading || busy} /> Enable {name} integration
              </label>
            </div>
            {loading ? (
              <div role="status" className="flex min-h-32 items-center justify-center gap-2 text-xs text-text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Reading configured settings...</div>
            ) : channelId === "telegram" ? renderTelegramSettings()
              : channelId === "discord" ? renderDiscordSettings()
                : channelId === "slack" ? renderSlackSettings()
                  : (
                    <div className="space-y-3 text-xs text-text-secondary">
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div className="rounded-lg border border-border bg-background p-3"><span className={LABEL_CLASS}>Account</span><p className="mt-1.5 text-sm text-foreground">{selectedAccount?.accountDisplayName || selectedAccountId || "Default account"}</p></div>
                        <div className="rounded-lg border border-border bg-background p-3"><span className={LABEL_CLASS}>Connection state</span><p className="mt-1.5 text-sm capitalize text-foreground">{rawStatusLabel(selectedAccount?.rawRuntimeStatus) || selectedAccount?.healthState || "Unknown"}</p></div>
                      </div>
                      <p className="leading-5 text-text-muted">Ordinary settings changes do not restart pairing. Use Re-pair only when the linked WhatsApp account must be replaced.</p>
                    </div>
                  )}
          </div>

          <aside className="space-y-3">
            <div className="rounded-xl border border-border bg-surface-low p-3.5">
              <div className="flex items-center gap-2 text-text-secondary"><ShieldCheck className="h-4 w-4 text-[var(--channel-accent)]" /><h3 className="text-xs font-bold uppercase tracking-[0.1em]">Connection status</h3></div>
              <dl className="mt-3 space-y-2 text-xs">
                <div className="flex justify-between gap-3"><dt className="text-text-muted">Configured</dt><dd className="text-text-secondary">{selectedAccount?.configured ? "Yes" : "No"}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-text-muted">Authenticated</dt><dd className="text-text-secondary">{selectedAccount?.authenticated === undefined ? "Not reported" : selectedAccount.authenticated ? "Yes" : "No"}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-text-muted">Health</dt><dd className="capitalize text-text-secondary">{selectedAccount?.healthState || "Unknown"}</dd></div>
                {channelId === "telegram" ? (
                  <div className="flex justify-between gap-3">
                    <dt className="flex items-center gap-1 text-text-muted">
                      Privacy mode
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button type="button" aria-label="How to change Telegram privacy mode" className="rounded-sm text-text-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--channel-accent)]">
                            <CircleHelp className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="left" className="max-w-72 border border-border px-3 py-2 shadow-xl">
                          Open BotFather, send /setprivacy, select this bot, then choose Enable to limit group messages or Disable to receive all group messages. Run Test connection afterward.
                        </TooltipContent>
                      </Tooltip>
                    </dt>
                    <dd className="text-text-secondary">{telegramPrivacyMode === "unknown" ? "Not reported" : telegramPrivacyMode === "enabled" ? "Enabled" : "Disabled"}</dd>
                  </div>
                ) : null}
                {channelId === "slack" ? <div className="flex justify-between gap-3"><dt className="text-text-muted">Transport</dt><dd className="text-text-secondary">{slackModeLabel}</dd></div> : null}
              </dl>
              {channelId === "telegram" ? (
                <p className="mt-3 border-t border-border pt-3 text-[11px] leading-4 text-text-muted">
                  {telegramPrivacyMode === "enabled"
                    ? <>Telegram limits group delivery to commands, replies, and mentions. Change it with <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer" className="font-semibold text-text-secondary hover:text-foreground hover:underline">BotFather&apos;s /setprivacy</a>.</>
                    : telegramPrivacyMode === "disabled"
                      ? "Telegram can deliver all messages from groups this bot belongs to."
                      : "Test the connection to retrieve this setting from Telegram."}
                </p>
              ) : null}
            </div>
            <button type="button" className={`${PRIMARY_BUTTON} w-full`} disabled={!connected || !canProbe || busy} onClick={() => void probe()}>
              {operation === "probe" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />} Test connection
            </button>
            {channelId === "whatsapp" && onOpenPairing ? (
              <button type="button" className={`${SECONDARY_BUTTON} w-full`} disabled={!connected || busy} onClick={onOpenPairing}><RefreshCw className="h-3.5 w-3.5" /> Re-pair WhatsApp</button>
            ) : null}
          </aside>
        </div>

        {(channelId === "telegram" || channelId === "slack") && form.dmPolicy === "pairing" ? (
          <div className="rounded-xl border border-border bg-surface-low p-4">
            <div className="mb-4">
              <h3 className="text-sm font-bold text-foreground">Approve {name} pairing</h3>
              <p className="mt-1 text-xs leading-5 text-text-muted">Approve the short code returned after a new sender messages the bot.</p>
            </div>
            {(channelId === "telegram" ? savedTelegramDmPolicy : savedSlackDmPolicy) === "pairing" ? (
              <ConnectorAuthorizationGuide
                connectorId={channelId}
                displayName={name}
                flow={channelId === "telegram" ? TELEGRAM_PAIRING_AUTHORIZATION_FLOW : SLACK_PAIRING_AUTHORIZATION_FLOW}
                provider={connectorsProvider}
                accountId={resolvedAccountId ?? selectedAccountId}
                variant="owner"
                onApproved={() => setNotice("Pairing code approved.")}
              />
            ) : (
              <div role="status" className="rounded-xl border border-warning/30 bg-warning/10 px-3.5 py-3 text-xs text-warning">
                Save {name} with the pairing policy before approving a code.
              </div>
            )}
          </div>
        ) : null}

        {channelId === "telegram" || channelId === "discord" ? (
          <div className="rounded-xl border border-border bg-surface-low p-4">
            <div className="mb-3 flex items-center gap-2"><KeyRound className="h-4 w-4 text-[var(--channel-accent)]" /><h3 className="text-sm font-bold">Protected credential</h3></div>
            {renderCredentialReplacement("bot")}
          </div>
        ) : null}
        {channelId === "slack" ? (
          <div className="rounded-xl border border-border bg-surface-low p-4">
            <div className="mb-3 flex items-center gap-2"><KeyRound className="h-4 w-4 text-[var(--channel-accent)]" /><h3 className="text-sm font-bold">{slackModeLabel} credentials</h3></div>
            {slackMode === "socket" ? (
              <div className="grid gap-3 md:grid-cols-2">{renderCredentialReplacement("bot")}{renderCredentialReplacement("app")}</div>
            ) : slackMode === "http" ? (
              <div className="grid gap-3 md:grid-cols-2">{renderCredentialReplacement("bot")}{renderCredentialReplacement("signing")}</div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">{renderCredentialReplacement("bot")}{renderCredentialReplacement("relay")}</div>
            )}
          </div>
        ) : null}

        <footer className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface-low p-3.5">
          <div className="min-w-0">
            {!confirmingRemove ? (
              <button type="button" className={DANGER_BUTTON} disabled={!connected || !canRemove || busy} onClick={() => setConfirmingRemove(true)}><Trash2 className="h-3.5 w-3.5" /> Remove configuration</button>
            ) : (
              <div role="group" aria-label={`Confirm removal of ${name} configuration`} className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-text-secondary">Remove this account configuration?</span>
                <button ref={confirmRemoveRef} type="button" className={DANGER_BUTTON} disabled={busy} onClick={() => void remove()}>{operation === "remove" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Confirm remove</button>
                <button type="button" className={SECONDARY_BUTTON} disabled={busy} onClick={() => setConfirmingRemove(false)}>Cancel</button>
              </div>
            )}
          </div>
          <button type="button" className={PRIMARY_BUTTON} disabled={!connected || !canUpdate || loading || busy} onClick={() => void save()}>
            {operation === "save" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save settings
          </button>
        </footer>
      </div>
    </section>
  );
}
