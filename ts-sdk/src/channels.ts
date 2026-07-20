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

export interface HostedSlackRelayChannelConfigOptions {
  relayBaseUrl: string;
  agentId?: string | null;
  gatewayId?: string | null;
  botTokenEnv?: string | null;
  authTokenEnv?: string | null;
}

export interface HostedSlackRelayChannelConfig {
  [key: string]: unknown;
  enabled: true;
  mode: 'relay';
  botToken: {
    source: 'env';
    provider: 'default';
    id: string;
  };
  relay: {
    url: string;
    authToken: {
      source: 'env';
      provider: 'default';
      id: string;
    };
    gatewayId: string;
  };
  allowFrom?: string[];
}

export interface ConfigureHostedSlackRelayChannelOptions extends HostedSlackRelayChannelConfigOptions {
  token: string;
  checkInstallStatus: (options: SlackInstallStatusCheckOptions) => Promise<SlackInstallStatusLike>;
  apply?: (config: HostedSlackRelayChannelConfig) => Promise<void>;
  channelsProvider?: Pick<AgentChannelsProvider, 'configure'> | null;
}

export interface ConfigureHostedSlackRelayChannelResult {
  status: SlackInstallStatusLike;
  config: HostedSlackRelayChannelConfig;
}

export function buildSlackRelayWebSocketUrl(relayBaseUrl: string): string {
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
  url.protocol = url.protocol === 'http:' ? 'ws:' : 'wss:';
  url.pathname = '/slack/ws';
  url.search = '';
  url.hash = '';
  return url.toString();
}

export function buildSlackRelayApiUrl(relayBaseUrl: string): string {
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
  url.pathname = '/slack/api/';
  url.search = '';
  url.hash = '';
  return url.toString();
}

export function buildHostedSlackRelayChannelConfig(options: HostedSlackRelayChannelConfigOptions): HostedSlackRelayChannelConfig {
  const gatewayId = options.gatewayId?.trim() || (options.agentId?.trim() ? `agent:${options.agentId.trim()}` : '');
  if (!gatewayId) throw new Error('Slack relay gateway id requires an agent id');
  return {
    enabled: true,
    mode: 'relay',
    botToken: {
      source: 'env',
      provider: 'default',
      id: options.botTokenEnv?.trim() || 'SLACK_BOT_TOKEN',
    },
    relay: {
      url: buildSlackRelayWebSocketUrl(options.relayBaseUrl),
      authToken: {
        source: 'env',
        provider: 'default',
        id: options.authTokenEnv?.trim() || 'HYPER_AGENTS_API_KEY',
      },
      gatewayId,
    },
  };
}

export async function configureHostedSlackRelayChannel(
  options: ConfigureHostedSlackRelayChannelOptions,
): Promise<ConfigureHostedSlackRelayChannelResult> {
  const status = await options.checkInstallStatus({
    relayBaseUrl: options.relayBaseUrl,
    token: options.token,
  });
  if (!status.connected) throw new Error('Connect Slack before using the hosted app.');

  const config = buildHostedSlackRelayChannelConfig(options);
  const installerUserId = status.installerUserId?.trim();
  if (installerUserId) config.allowFrom = [installerUserId];
  if (options.apply) {
    await options.apply(config);
  } else if (options.channelsProvider?.configure) {
    await options.channelsProvider.configure('slack', config);
  } else {
    throw new Error('Slack relay configuration target is required');
  }
  return { status, config };
}
