import type {
  AgentChannel,
  AgentChannelAccountStatus,
  AgentChannelConfigurationReadRequest,
  AgentChannelConfigurationReadResult,
  AgentChannelHealthState,
  AgentChannelListOptions,
  AgentChannelReadOptions,
  AgentChannelSummary,
  AgentChannelsProvider,
  AgentChannelsProviderCapabilities,
  AgentChannelsSnapshot,
  AgentChannelUpdateRequest,
} from '../channels.js';
import type {
  ChannelEventLoopHealth,
  ChannelUiMeta,
  ChannelsStatusResult,
} from './gateway.js';

type UnknownRecord = Record<string, unknown>;

export type OpenClawChannelSecretRefSource = 'env' | 'file' | 'exec';

export interface OpenClawChannelSecretRef {
  source?: OpenClawChannelSecretRefSource;
  provider: string;
  id: string;
}

export type OpenClawChannelSecretInput = string | OpenClawChannelSecretRef;

export type OpenClawTelegramDmPolicy = 'allowlist' | 'pairing' | 'open' | 'disabled';
export type OpenClawTelegramGroupPolicy = 'allowlist' | 'open' | 'disabled';

export interface OpenClawTelegramGroupConfig extends Record<string, unknown> {
  enabled?: boolean;
  requireMention?: boolean;
  users?: Array<string | number>;
  skills?: string[];
  systemPrompt?: string;
}

export interface OpenClawTelegramAccountConfig extends Record<string, unknown> {
  name?: string;
  enabled?: boolean;
  botToken?: OpenClawChannelSecretInput;
  dmPolicy?: OpenClawTelegramDmPolicy;
  allowFrom?: Array<string | number>;
  groupPolicy?: OpenClawTelegramGroupPolicy;
  groupAllowFrom?: Array<string | number>;
  groups?: Record<string, OpenClawTelegramGroupConfig | null> | null;
  defaultTo?: string | number;
}

export interface OpenClawTelegramConfig extends OpenClawTelegramAccountConfig {
  accounts?: Record<string, OpenClawTelegramAccountConfig>;
  defaultAccount?: string;
}

export type OpenClawTelegramAccountConfigPatch = {
  [K in keyof OpenClawTelegramAccountConfig]?: OpenClawTelegramAccountConfig[K] | null;
} & Record<string, unknown>;

export type OpenClawTelegramConfigPatch = OpenClawTelegramAccountConfigPatch & {
  accounts?: Record<string, OpenClawTelegramAccountConfigPatch | null> | null;
  defaultAccount?: string | null;
};

export interface OpenClawWhatsAppAccountConfig extends Record<string, unknown> {
  name?: string;
  enabled?: boolean;
}

export interface OpenClawWhatsAppConfig extends OpenClawWhatsAppAccountConfig {
  accounts?: Record<string, OpenClawWhatsAppAccountConfig>;
  defaultAccount?: string;
}

export type OpenClawWhatsAppAccountConfigPatch = {
  [K in keyof OpenClawWhatsAppAccountConfig]?: OpenClawWhatsAppAccountConfig[K] | null;
} & Record<string, unknown>;

export type OpenClawWhatsAppConfigPatch = OpenClawWhatsAppAccountConfigPatch & {
  accounts?: Record<string, OpenClawWhatsAppAccountConfigPatch | null> | null;
  defaultAccount?: string | null;
};

export interface OpenClawChannelsClient {
  channelsStatus(probe?: boolean, timeoutMs?: number, channel?: string): Promise<ChannelsStatusResult>;
  channelsLogout(channel: string, accountId?: string): Promise<Record<string, unknown>>;
  configGet(): Promise<Record<string, unknown>>;
  configPatch(patch: Record<string, unknown>): Promise<unknown>;
}

export interface OpenClawChannelsDiagnostics extends Record<string, unknown> {
  eventLoop?: ChannelEventLoopHealth;
}

export type OpenClawChannel = AgentChannel<unknown, unknown, ChannelUiMeta | UnknownRecord>;

export type OpenClawChannelsSnapshot = AgentChannelsSnapshot<
  unknown,
  unknown,
  ChannelUiMeta | UnknownRecord,
  OpenClawChannelsDiagnostics,
  Record<string, unknown>
>;

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null;
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value.trim().length > 0)?.trim();
}

function firstBoolean(...values: unknown[]): boolean | undefined {
  return values.find((value): value is boolean => typeof value === 'boolean');
}

function firstTimestamp(...values: unknown[]): string | number | undefined {
  return values.find((value): value is string | number => (
    (typeof value === 'string' && value.trim().length > 0) ||
    (typeof value === 'number' && Number.isFinite(value))
  ));
}

function healthState(entry: UnknownRecord): AgentChannelHealthState {
  const probe = asRecord(entry.probe);
  if (probe?.ok === true) return 'healthy';
  if (probe?.ok === false) return 'unhealthy';

  const explicit = firstString(entry.healthState, entry.health, entry.status)?.toLowerCase();
  if (explicit && ['healthy', 'ok', 'online', 'ready', 'connected', 'running', 'busy', 'startup-connect-grace', 'unmanaged'].includes(explicit)) return 'healthy';
  if (explicit && ['degraded', 'warning', 'partial', 'stale', 'not-running'].includes(explicit)) return 'degraded';
  if (explicit && ['unhealthy', 'error', 'failed', 'offline', 'runtime-error', 'not-connected', 'disconnected', 'terminal-disconnect', 'stale-socket', 'stuck'].includes(explicit)) return 'unhealthy';
  if (firstString(entry.lastError, entry.error, entry.errorDetail)) return 'unhealthy';
  if (firstBoolean(entry.running, entry.started, entry.authenticated, entry.connected, entry.linked, entry.loggedIn) === true) return 'healthy';
  return 'unknown';
}

function normalizeAccountStatus(
  value: unknown,
  accountId: string | undefined,
  defaults: unknown,
): AgentChannelAccountStatus<unknown> {
  const rawRuntimeStatus = value;
  const entry = { ...(asRecord(defaults) ?? {}), ...(asRecord(value) ?? {}) };
  const probe = asRecord(entry.probe);
  return {
    accountId: firstString(entry.accountId, entry.id, accountId),
    accountDisplayName: firstString(entry.accountDisplayName, entry.displayName, entry.username, entry.name),
    enabled: firstBoolean(entry.enabled),
    configured: firstBoolean(entry.configured) ?? false,
    running: firstBoolean(entry.running, entry.started),
    authenticated: firstBoolean(entry.authenticated, entry.connected, entry.linked, entry.loggedIn),
    healthState: healthState(entry),
    healthReason: firstString(entry.healthState, entry.health, entry.status),
    lastError: firstString(entry.lastError, entry.error, entry.errorDetail, probe?.message),
    lastProbeAt: firstTimestamp(entry.lastProbeAt, entry.probedAt, probe?.at, probe?.timestamp),
    rawRuntimeStatus,
  };
}

function normalizeAccounts(
  summaryValue: unknown,
  accountValue: unknown,
  defaultAccountId?: string,
): AgentChannelAccountStatus<unknown>[] {
  const channel = asRecord(summaryValue);
  const accountsValue = accountValue !== undefined ? accountValue : channel?.accounts;

  if (Array.isArray(accountsValue)) {
    return accountsValue.map((account) => {
      const record = asRecord(account);
      const singletonDefault = accountsValue.length === 1 ? defaultAccountId : undefined;
      return normalizeAccountStatus(account, firstString(record?.accountId, record?.id, singletonDefault), channel);
    });
  }

  const accounts = asRecord(accountsValue);
  if (accounts) {
    return Object.entries(accounts).map(([accountId, account]) => (
      normalizeAccountStatus(account, accountId, channel)
    ));
  }

  return [];
}

function metadataChannelIds(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => typeof entry === 'string' ? entry : firstString(asRecord(entry)?.id, asRecord(entry)?.channelId))
      .filter((entry): entry is string => Boolean(entry));
  }
  return Object.keys(asRecord(value) ?? {});
}

function looksLikeChannelSnapshot(value: unknown): boolean {
  const entry = asRecord(value);
  return Boolean(entry && [
    'configured',
    'enabled',
    'running',
    'connected',
    'authenticated',
    'accounts',
    'probe',
  ].some((key) => key in entry));
}

const CHANNEL_STATUS_METADATA_KEYS = new Set([
  'ts',
  'partial',
  'warnings',
  'eventLoop',
  'channelOrder',
  'channelLabels',
  'channelDetailLabels',
  'channelSystemImages',
  'channelMeta',
  'channelDefaultAccountId',
  'channels',
  'channelAccounts',
]);

function legacyChannelIds(result: Record<string, unknown>): string[] {
  return Object.entries(result)
    .filter(([key, value]) => !CHANNEL_STATUS_METADATA_KEYS.has(key) && looksLikeChannelSnapshot(value))
    .map(([channelId]) => channelId);
}

function statusPayload(result: Record<string, unknown>): Record<string, unknown> {
  const candidates = [result.payload, result.data, result.result, result.status]
    .map(asRecord)
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
  return candidates.find((candidate) => (
    'channels' in candidate ||
    'channelAccounts' in candidate ||
    'channelOrder' in candidate ||
    metadataChannelIds(candidate.channelMeta).length > 0 ||
    legacyChannelIds(candidate).length > 0
  )) ?? result;
}

function supportedChannelIds(result: Record<string, unknown>): string[] {
  const ordered = Array.isArray(result.channelOrder) ? metadataChannelIds(result.channelOrder) : [];
  return Array.from(new Set([
    ...ordered,
    ...Object.keys(asRecord(result.channels) ?? {}),
    ...Object.keys(asRecord(result.channelAccounts) ?? {}),
    ...Object.keys(asRecord(result.channelLabels) ?? {}),
    ...Object.keys(asRecord(result.channelDetailLabels) ?? {}),
    ...Object.keys(asRecord(result.channelSystemImages) ?? {}),
    ...Object.keys(asRecord(result.channelDefaultAccountId) ?? {}),
    ...metadataChannelIds(result.channelMeta),
    ...legacyChannelIds(result),
  ]));
}

function channelMetadata(value: unknown, channelId: string): ChannelUiMeta | UnknownRecord | undefined {
  if (Array.isArray(value)) {
    return value
      .map(asRecord)
      .find((entry) => firstString(entry?.id, entry?.channelId) === channelId) as ChannelUiMeta | UnknownRecord | undefined;
  }
  const metadata = asRecord(value);
  if (!metadata) return undefined;
  const keyed = asRecord(metadata[channelId]);
  if (keyed) return keyed;
  return firstString(metadata.id, metadata.channelId) === channelId ? metadata : undefined;
}

function ownValue(record: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

export function normalizeOpenClawChannelsSnapshot(result: Record<string, unknown>): OpenClawChannelsSnapshot {
  const payload = statusPayload(result);
  const channels = asRecord(payload.channels) ?? {};
  const channelAccounts = asRecord(payload.channelAccounts) ?? {};
  const labels = asRecord(payload.channelLabels) ?? {};
  const detailLabels = asRecord(payload.channelDetailLabels) ?? {};
  const systemImages = asRecord(payload.channelSystemImages) ?? {};
  const defaultAccountIds = asRecord(payload.channelDefaultAccountId) ?? {};
  const diagnostics: OpenClawChannelsDiagnostics = {};

  for (const [key, value] of Object.entries(payload)) {
    if (!CHANNEL_STATUS_METADATA_KEYS.has(key) && !looksLikeChannelSnapshot(value)) {
      diagnostics[key] = value;
    }
  }
  if (payload.eventLoop !== undefined) diagnostics.eventLoop = payload.eventLoop as ChannelEventLoopHealth;

  const groupedChannels = supportedChannelIds(payload).map((channelId): OpenClawChannel => {
    const metadata = channelMetadata(payload.channelMeta, channelId);
    const rawChannelStatus = hasOwn(channels, channelId) ? channels[channelId] : ownValue(payload, channelId);
    const channelStatus = asRecord(rawChannelStatus);
    const defaultAccountId = firstString(defaultAccountIds[channelId], channelStatus?.defaultAccountId);
    return {
      channelId,
      label: firstString(labels[channelId], metadata?.label, channelStatus?.label),
      detailLabel: firstString(detailLabels[channelId], metadata?.detailLabel, channelStatus?.detailLabel),
      systemImage: firstString(systemImages[channelId], metadata?.systemImage, channelStatus?.systemImage),
      defaultAccountId,
      metadata,
      rawChannelStatus,
      accounts: normalizeAccounts(rawChannelStatus, ownValue(channelAccounts, channelId), defaultAccountId),
    };
  });

  const warnings = Array.isArray(payload.warnings)
    ? payload.warnings.filter((warning): warning is string => typeof warning === 'string')
    : undefined;
  return {
    observedAt: firstTimestamp(payload.ts, result.ts) ?? Date.now(),
    channels: groupedChannels,
    partial: typeof payload.partial === 'boolean' ? payload.partial : undefined,
    warnings,
    diagnostics: Object.keys(diagnostics).length > 0 ? diagnostics : undefined,
    source: result,
  };
}

function flatSummary(channel: OpenClawChannel, account: AgentChannelAccountStatus<unknown>, accountId?: string): AgentChannelSummary {
  return {
    channelId: channel.channelId,
    accountId: account.accountId ?? accountId,
    accountDisplayName: account.accountDisplayName,
    enabled: account.enabled,
    configured: account.configured,
    running: account.running,
    authenticated: account.authenticated,
    healthState: account.healthState,
    lastError: account.lastError,
    lastProbeAt: account.lastProbeAt,
  };
}

export function normalizeOpenClawChannelsStatus(result: Record<string, unknown>): AgentChannelSummary[] {
  return normalizeOpenClawChannelsSnapshot(result).channels
    .flatMap((channel) => {
      if (channel.accounts.length > 0) {
        return channel.accounts.map((account, index) => flatSummary(channel, account, String(index)));
      }
      return [flatSummary(channel, normalizeAccountStatus(channel.rawChannelStatus, undefined, undefined))];
    })
    .sort((a, b) => a.channelId.localeCompare(b.channelId) || (a.accountId ?? '').localeCompare(b.accountId ?? ''));
}

function cloneJsonValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map((entry) => cloneJsonValue(entry)) as T;
  const record = asRecord(value);
  if (!record) return value;
  return Object.fromEntries(
    Object.entries(record).map(([key, entry]) => [key, cloneJsonValue(entry)]),
  ) as T;
}

export class OpenClawChannelsProvider implements AgentChannelsProvider {
  readonly capabilities: AgentChannelsProviderCapabilities = {
    configure: true,
    logout: true,
    removeConfig: true,
    probe: true,
    multipleAccounts: true,
  };

  constructor(private readonly client: OpenClawChannelsClient) {}

  async read(options: AgentChannelReadOptions = {}): Promise<OpenClawChannelsSnapshot> {
    const result = await this.client.channelsStatus(options.probe ?? false, options.timeoutMs, options.channelId);
    return normalizeOpenClawChannelsSnapshot(result);
  }

  async list(options: AgentChannelListOptions = {}): Promise<AgentChannelSummary[]> {
    const result = await this.client.channelsStatus(options.probe ?? false, options.timeoutMs);
    return normalizeOpenClawChannelsStatus(result);
  }

  async readConfig(request: AgentChannelConfigurationReadRequest): Promise<AgentChannelConfigurationReadResult> {
    const config = await this.client.configGet();
    const channelConfig = asRecord(config.channels)?.[request.channelId];
    const accountConfigs = asRecord(asRecord(channelConfig)?.accounts);
    const hasAccountConfig = Boolean(
      request.accountId &&
      accountConfigs &&
      Object.prototype.hasOwnProperty.call(accountConfigs, request.accountId),
    );
    const selected = hasAccountConfig && request.accountId
      ? accountConfigs?.[request.accountId]
      : channelConfig;
    return {
      channelId: request.channelId,
      accountId: hasAccountConfig ? request.accountId : undefined,
      config: cloneJsonValue(selected),
    };
  }

  async update(request: AgentChannelUpdateRequest): Promise<void> {
    const channelConfig = request.accountId
      ? { accounts: { [request.accountId]: request.patch } }
      : request.patch;
    await this.client.configPatch({ channels: { [request.channelId]: channelConfig } });
  }

  async patchConfig(patch: Record<string, unknown>): Promise<void> {
    await this.client.configPatch(patch);
  }

  async configure(channelId: string, config: Record<string, unknown>, accountId?: string): Promise<void> {
    await this.update({ channelId, accountId, patch: config });
  }

  async configureTelegram(config: OpenClawTelegramConfigPatch, accountId?: string): Promise<void> {
    await this.update({ channelId: 'telegram', accountId, patch: config });
  }

  async configureWhatsapp(config: OpenClawWhatsAppConfigPatch, accountId?: string): Promise<void> {
    await this.update({ channelId: 'whatsapp', accountId, patch: config });
  }

  async logout(channelId: string, accountId?: string): Promise<void> {
    await this.client.channelsLogout(channelId, accountId);
  }

  async removeConfig(channelId: string, accountId?: string): Promise<void> {
    const channelConfig = accountId
      ? { accounts: { [accountId]: null } }
      : null;
    await this.client.configPatch({ channels: { [channelId]: channelConfig } });
  }
}
