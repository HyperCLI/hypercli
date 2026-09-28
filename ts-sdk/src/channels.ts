export type AgentChannelHealthState = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

export interface AgentChannelSummary {
  channelId: string;
  accountId?: string;
  accountDisplayName?: string;
  enabled?: boolean;
  configured: boolean;
  running?: boolean;
  authenticated?: boolean;
  healthState: AgentChannelHealthState;
  lastError?: string;
  lastProbeAt?: string | number;
}

export interface AgentChannelAccountStatus<TRawRuntimeStatus = unknown> {
  accountId?: string;
  accountDisplayName?: string;
  enabled?: boolean;
  configured: boolean;
  running?: boolean;
  authenticated?: boolean;
  healthState: AgentChannelHealthState;
  /** Runtime-specific reason retained alongside the portable health category. */
  healthReason?: string;
  lastError?: string;
  lastProbeAt?: string | number;
  rawRuntimeStatus: TRawRuntimeStatus;
}

export interface AgentChannel<
  TRawChannelStatus = unknown,
  TRawAccountStatus = unknown,
  TMetadata = unknown,
> {
  channelId: string;
  label?: string;
  detailLabel?: string;
  systemImage?: string;
  defaultAccountId?: string;
  metadata?: TMetadata;
  rawChannelStatus: TRawChannelStatus;
  accounts: AgentChannelAccountStatus<TRawAccountStatus>[];
}

export type AgentChannelGroup<
  TRawChannelStatus = unknown,
  TRawAccountStatus = unknown,
  TMetadata = unknown,
> = AgentChannel<TRawChannelStatus, TRawAccountStatus, TMetadata>;

export interface AgentChannelsSnapshot<
  TRawChannelStatus = unknown,
  TRawAccountStatus = unknown,
  TMetadata = unknown,
  TDiagnostics = unknown,
  TSource = unknown,
> {
  observedAt: string | number;
  channels: AgentChannel<TRawChannelStatus, TRawAccountStatus, TMetadata>[];
  partial?: boolean;
  warnings?: string[];
  diagnostics?: TDiagnostics;
  source?: TSource;
}

export interface AgentChannelsProviderCapabilities {
  configure: boolean;
  logout: boolean;
  removeConfig: boolean;
  probe: boolean;
  multipleAccounts: boolean;
}

export interface AgentChannelListOptions {
  probe?: boolean;
  timeoutMs?: number;
}

export interface AgentChannelReadOptions extends AgentChannelListOptions {
  channelId?: string;
}

export interface AgentChannelConfigurationReadRequest {
  channelId: string;
  accountId?: string;
}

export interface AgentChannelConfigurationReadResult<TConfiguration = unknown> {
  channelId: string;
  accountId?: string;
  config: TConfiguration | undefined;
}

export interface AgentChannelUpdateRequest<TPatch extends Record<string, unknown> = Record<string, unknown>> {
  channelId: string;
  accountId?: string;
  patch: TPatch;
}

export interface AgentChannelsProvider {
  readonly capabilities: AgentChannelsProviderCapabilities;
  list(options?: AgentChannelListOptions): Promise<AgentChannelSummary[]>;
  read?(options?: AgentChannelReadOptions): Promise<AgentChannelsSnapshot>;
  readConfig?(request: AgentChannelConfigurationReadRequest): Promise<AgentChannelConfigurationReadResult>;
  patchConfig?(patch: Record<string, unknown>): Promise<void>;
  update?(request: AgentChannelUpdateRequest): Promise<void>;
  configure?(channelId: string, config: Record<string, unknown>, accountId?: string): Promise<void>;
  logout?(channelId: string, accountId?: string): Promise<void>;
  removeConfig?(channelId: string, accountId?: string): Promise<void>;
}

export interface SlackInstallStatusLike {
  connected: boolean;
  teamId?: string | null;
  teamName?: string | null;
  botUserId?: string | null;
  installerUserId?: string | null;
  updatedAt?: string | null;
}

export interface SlackInstallStatusCheckOptions {
  relayBaseUrl: string;
  token: string;
}

export function normalizeSlackRelayBaseUrl(relayBaseUrl: string): string {
  const normalized = relayBaseUrl.trim();
  if (!normalized) throw new Error('Slack relay base URL is required');
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error('Slack relay base URL is invalid');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Slack relay base URL must use http or https');
  }
  const host = url.hostname.toLowerCase();
  if (host === 'api.agents.hypercli.com') {
    url.hostname = 'api.hypercli.com';
  } else if (host === 'api.agents.dev.hypercli.com') {
    url.hostname = 'api.dev.hypercli.com';
  }
  url.pathname = '';
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/+$/, '');
}
