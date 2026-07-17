export type AgentConnectorSetupMode = 'managed-auth' | 'config';
export type AgentConnectorAuthorizationProtocol = 'short-code';

export interface AgentRuntimeDescriptor {
  provider: string;
  version?: string;
  protocol?: string;
  image?: string;
  schemaVersion?: string;
  capabilities: readonly string[];
}

export interface AgentConnectorDescriptor {
  connectorId: string;
  configured: boolean;
  authenticated: boolean;
  usable: boolean;
  setupModes: AgentConnectorSetupMode[];
}

export interface AgentConnectorListOptions {
  connectorId?: string;
  probe?: boolean;
  timeoutMs?: number;
}

export interface AgentConnectorSetupRequest {
  connectorId: string;
  mode?: AgentConnectorSetupMode;
  accountId?: string;
  scopes?: string[];
  force?: boolean;
}

export interface AgentConnectorRuntimeSetupResult {
  connectorId: string;
  mode: AgentConnectorSetupMode;
  setupId?: string;
  instructions?: string;
  deviceUrl?: string;
  deviceCode?: string;
  expiresAt?: string | number;
  pollIntervalMs?: number;
  scopes?: string[];
  provenance: AgentRuntimeDescriptor;
}

export type AgentConnectorSetupState = 'pending' | 'complete' | 'failed' | 'unknown';

export interface AgentConnectorSetupStatus {
  connectorId: string;
  setupId: string;
  state: AgentConnectorSetupState;
  connectionId?: string;
  accountId?: string;
  accountDisplayName?: string;
  scopes?: string[];
  error?: string;
  provenance: AgentRuntimeDescriptor;
}

export interface AgentConnectorSetupStatusRequest {
  connectorId: string;
  setupId: string;
  accountId?: string;
}

export interface AgentConnectorAuthorizationRequest {
  connectorId: string;
  protocol: AgentConnectorAuthorizationProtocol;
  code: string;
  accountId?: string;
  notify?: boolean;
}

export interface AgentConnectorAuthorizationResult {
  connectorId: string;
  protocol: AgentConnectorAuthorizationProtocol;
  state: 'complete';
}

export interface AgentConnectorsProvider {
  readonly runtime: AgentRuntimeDescriptor;
  list(options?: AgentConnectorListOptions): Promise<AgentConnectorDescriptor[]>;
  startSetup(request: AgentConnectorSetupRequest): Promise<AgentConnectorRuntimeSetupResult>;
  pollSetup(request: AgentConnectorSetupStatusRequest): Promise<AgentConnectorSetupStatus>;
  configure(connectorId: string, config: Record<string, unknown>, accountId?: string): Promise<void>;
  approveAuthorization?(request: AgentConnectorAuthorizationRequest): Promise<AgentConnectorAuthorizationResult>;
}
