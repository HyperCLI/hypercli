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
