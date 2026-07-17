"use client";

import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import type { AgentChannel, AgentChannelsProvider } from "@hypercli.com/sdk/channels";
import type { AgentConnectorsProvider, AgentRuntimeDescriptor } from "@hypercli.com/sdk/connectors";
import {
  AlertTriangle,
  Check,
  CircleDot,
  FlaskConical,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";

import { INTEGRATION_BRAND_LOGOS } from "@/components/dashboard/integrations/integration-brand-icons";
import { ConnectorAuthorizationGuide } from "./ConnectorAuthorizationGuide";
import { TELEGRAM_PAIRING_AUTHORIZATION_FLOW } from "./connector-authorization-flows";
import {
  buildOpenClawDiscordPatch,
  buildOpenClawSlackPatch,
  buildOpenClawTelegramPatch,
  buildOpenClawWhatsAppPatch,
  parseDelimitedIds,
  parseOpenClawChannelConfig,
  readOpenClawCredentialState,
  type MentionBehavior,
  type OpenClawConfiguredChannelId,
  type SafeOpenClawChannelConfig,
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
}

type OptionalProviderOperations = Partial<Pick<AgentChannelsProvider, "readConfig" | "update" | "read" | "removeConfig">>;
type Operation = "save" | "probe" | "remove" | null;

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
  replaceBotToken: boolean;
  replaceAppToken: boolean;
  botToken: string;
  appToken: string;
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
    dmPolicy: config.channelId === "telegram" ? config.dmPolicy : "runtime-default",
    allowFrom: config.channelId === "telegram" ? config.allowFrom.join(", ") : "",
    groupPolicy: config.channelId === "telegram" ? config.groupPolicy : "runtime-default",
    groupAllowFrom: config.channelId === "telegram" ? config.groupAllowFrom.join(", ") : "",
    groupIds: config.channelId === "telegram" ? config.groupIds.join(", ") : "",
    mentionBehavior: config.channelId === "telegram" ? config.mentionBehavior : "runtime-default",
    guildId: config.channelId === "discord" ? config.guildId : "",
    userId: config.channelId === "discord" ? config.userId : "",
    replaceBotToken: false,
    replaceAppToken: false,
    botToken: "",
    appToken: "",
  };
}

function providerLabel(provider: string): string {
  if (provider.toLowerCase() === "openclaw") return "OpenClaw";
  return provider
    .split(/[-_.]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function runtimeLabel(runtime: AgentRuntimeDescriptor): string {
  const version = runtime.version?.trim();
  const protocol = runtime.protocol?.trim();
  return [
    `${providerLabel(runtime.provider)} runtime`,
    version ? (version.toLowerCase().startsWith("v") ? version : `v${version}`) : null,
    protocol || null,
  ].filter(Boolean).join(" · ");
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
  runtime,
  connected,
  onRefresh,
  onOpenPairing,
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
  const [loadedScope, setLoadedScope] = useState<string | null>(null);
  const [operation, setOperation] = useState<Operation>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
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
        setError(null);
        setLoadedScope(readScope);
      })
      .catch(() => {
        if (!cancelled) {
          setError(`Could not read ${name} settings from this runtime.`);
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
    if (!connected) return "Reconnect the workspace before changing channel settings.";
    if (!canUpdate) return "This runtime cannot update channel settings.";
    if ((form.replaceBotToken && !form.botToken.trim()) || (form.replaceAppToken && !form.appToken.trim())) {
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
      } else if (channelId === "slack") {
        patch = buildOpenClawSlackPatch({
          enabled: form.enabled,
          ...(form.replaceBotToken ? { replacementBotToken: form.botToken } : {}),
          ...(form.replaceAppToken ? { replacementAppToken: form.appToken } : {}),
        });
      } else {
        patch = buildOpenClawWhatsAppPatch(form.enabled);
      }
      await update.call(provider, { channelId, ...(resolvedAccountId ? { accountId: resolvedAccountId } : {}), patch });
      if (channelId === "telegram") setSavedTelegramDmPolicy(form.dmPolicy);
      setForm((current) => ({
        ...current,
        replaceBotToken: false,
        replaceAppToken: false,
        botToken: "",
        appToken: "",
      }));
      setNotice("Settings saved.");
      await refresh();
    } catch {
      setError(`Could not save ${name} settings. Check the runtime connection and try again.`);
    } finally {
      setOperation(null);
    }
  };

  const probe = async () => {
    const read = operations.read;
    if (typeof read !== "function") {
      setError("Connection testing is unavailable for this runtime.");
      return;
    }
    setOperation("probe");
    setError(null);
    setNotice(null);
    try {
      await read.call(provider, { channelId, probe: true });
      setNotice("Connection test complete. Runtime status refreshed.");
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
      setError("Configuration removal is unavailable for this runtime.");
      return;
    }
    setOperation("remove");
    setError(null);
    setNotice(null);
    try {
      await removeConfig.call(provider, channelId, resolvedAccountId);
      setConfirmingRemove(false);
      setForm(initialForm(channelId));
      setSavedTelegramDmPolicy("runtime-default");
      setNotice("Configuration removed.");
      await refresh();
    } catch {
      setError(`Could not remove the ${name} configuration.`);
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

  const slackBotCredential = readOpenClawCredentialState(selectedAccount?.rawRuntimeStatus, "botToken");
  const slackAppCredential = readOpenClawCredentialState(selectedAccount?.rawRuntimeStatus, "appToken");
  const renderCredentialReplacement = (kind: "bot" | "app") => {
    const isApp = kind === "app";
    const enabled = isApp ? form.replaceAppToken : form.replaceBotToken;
    const value = isApp ? form.appToken : form.botToken;
    const label = isApp ? "app token" : "bot token";
    return (
      <div className="rounded-xl border border-border bg-background p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-foreground">{isApp ? "App token" : "Bot token"}</p>
            {channelId === "slack" ? (
              <p className="mt-0.5 text-[11px] text-text-muted">
                {credentialStatusLabel((isApp ? slackAppCredential : slackBotCredential).status)}
                {(isApp ? slackAppCredential : slackBotCredential).source ? ` · ${(isApp ? slackAppCredential : slackBotCredential).source}` : ""}
              </p>
            ) : <p className="mt-0.5 text-[11px] text-text-muted">Current value is never loaded into this page.</p>}
          </div>
          {!enabled ? (
            <button type="button" className={SECONDARY_BUTTON} onClick={() => setField(isApp ? "replaceAppToken" : "replaceBotToken", true)}>
              <KeyRound className="h-3.5 w-3.5" /> Replace {label}
            </button>
          ) : null}
        </div>
        {enabled ? (
          <div className="mt-3">
            {fieldLabel(`New ${label}`, <input aria-label={`${name} new ${label}`} className={INPUT_CLASS} type="password" autoComplete="new-password" spellCheck={false} value={value} onChange={(event) => setField(isApp ? "appToken" : "botToken", event.target.value)} />)}
            <button type="button" className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-text-muted hover:text-foreground" onClick={() => {
              setField(isApp ? "replaceAppToken" : "replaceBotToken", false);
              setField(isApp ? "appToken" : "botToken", "");
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
              <p className="mt-1 font-mono text-[11px] tracking-tight text-text-muted">{runtimeLabel(runtime)}</p>
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
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> Reconnect the workspace before changing channel settings.
          </div>
        ) : null}
        {!canReadConfig ? <div role="alert" className="rounded-xl border border-warning/30 bg-warning/10 px-3.5 py-3 text-xs text-warning">This runtime cannot read channel settings.</div> : null}
        {error ? <div role="alert" className="rounded-xl border border-destructive/35 bg-destructive/10 px-3.5 py-3 text-xs text-destructive">{error}</div> : null}
        {notice ? <div role="status" className="flex items-center gap-2 rounded-xl border border-selection-accent/25 bg-selection-accent/10 px-3.5 py-3 text-xs text-selection-accent"><Check className="h-4 w-4" />{notice}</div> : null}

        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_240px]">
          <div className="rounded-xl border border-border bg-surface-low p-4">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold">Channel policy</h3>
                <p className="mt-1 text-xs leading-5 text-text-muted">Account-scoped controls reported by this runtime.</p>
              </div>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-2 text-xs font-semibold text-text-secondary">
                <input type="checkbox" aria-label={`${name} enabled`} checked={form.enabled} onChange={(event) => setField("enabled", event.target.checked)} className="h-4 w-4 accent-[var(--channel-accent)]" disabled={loading || busy} /> Enabled
              </label>
            </div>
            {loading ? (
              <div role="status" className="flex min-h-32 items-center justify-center gap-2 text-xs text-text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Reading configured settings...</div>
            ) : channelId === "telegram" ? renderTelegramSettings()
              : channelId === "discord" ? renderDiscordSettings()
                : channelId === "slack" ? <p className="text-xs leading-5 text-text-muted">Slack uses Socket Mode credentials independently. Replace only the values that need to rotate.</p>
                  : (
                    <div className="space-y-3 text-xs text-text-secondary">
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div className="rounded-lg border border-border bg-background p-3"><span className={LABEL_CLASS}>Account</span><p className="mt-1.5 text-sm text-foreground">{selectedAccount?.accountDisplayName || selectedAccountId || "Default account"}</p></div>
                        <div className="rounded-lg border border-border bg-background p-3"><span className={LABEL_CLASS}>Runtime state</span><p className="mt-1.5 text-sm capitalize text-foreground">{rawStatusLabel(selectedAccount?.rawRuntimeStatus) || selectedAccount?.healthState || "Unknown"}</p></div>
                      </div>
                      <p className="leading-5 text-text-muted">Ordinary settings changes do not restart pairing. Use Re-pair only when the linked WhatsApp account must be replaced.</p>
                    </div>
                  )}
          </div>

          <aside className="space-y-3">
            <div className="rounded-xl border border-border bg-surface-low p-3.5">
              <div className="flex items-center gap-2 text-text-secondary"><ShieldCheck className="h-4 w-4 text-[var(--channel-accent)]" /><h3 className="text-xs font-bold uppercase tracking-[0.1em]">Runtime status</h3></div>
              <dl className="mt-3 space-y-2 text-xs">
                <div className="flex justify-between gap-3"><dt className="text-text-muted">Configured</dt><dd className="text-text-secondary">{selectedAccount?.configured ? "Yes" : "No"}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-text-muted">Authenticated</dt><dd className="text-text-secondary">{selectedAccount?.authenticated === undefined ? "Not reported" : selectedAccount.authenticated ? "Yes" : "No"}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-text-muted">Health</dt><dd className="capitalize text-text-secondary">{selectedAccount?.healthState || "Unknown"}</dd></div>
              </dl>
            </div>
            <button type="button" className={`${PRIMARY_BUTTON} w-full`} disabled={!connected || !canProbe || busy} onClick={() => void probe()}>
              {operation === "probe" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />} Test connection
            </button>
            {channelId === "whatsapp" && onOpenPairing ? (
              <button type="button" className={`${SECONDARY_BUTTON} w-full`} disabled={!connected || busy} onClick={onOpenPairing}><RefreshCw className="h-3.5 w-3.5" /> Re-pair WhatsApp</button>
            ) : null}
          </aside>
        </div>

        {channelId === "telegram" && form.dmPolicy === "pairing" ? (
          <div className="rounded-xl border border-border bg-surface-low p-4">
            <div className="mb-4">
              <h3 className="text-sm font-bold text-foreground">Approve Telegram pairing</h3>
              <p className="mt-1 text-xs leading-5 text-text-muted">Approve the short code returned after a new sender messages the bot.</p>
            </div>
            {savedTelegramDmPolicy === "pairing" ? (
              <ConnectorAuthorizationGuide
                connectorId="telegram"
                displayName="Telegram"
                flow={TELEGRAM_PAIRING_AUTHORIZATION_FLOW}
                provider={connectorsProvider}
                accountId={resolvedAccountId}
                variant="owner"
                onApproved={() => setNotice("Pairing code approved.")}
              />
            ) : (
              <div role="status" className="rounded-xl border border-warning/30 bg-warning/10 px-3.5 py-3 text-xs text-warning">
                Save Telegram with the pairing policy before approving a code.
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
            <div className="mb-3 flex items-center gap-2"><KeyRound className="h-4 w-4 text-[var(--channel-accent)]" /><h3 className="text-sm font-bold">Socket Mode credentials</h3></div>
            <div className="grid gap-3 md:grid-cols-2">{renderCredentialReplacement("bot")}{renderCredentialReplacement("app")}</div>
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
