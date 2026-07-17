import type {
  AgentConnectorDescriptor,
  AgentConnectorAuthorizationRequest,
  AgentConnectorAuthorizationResult,
  AgentConnectorListOptions,
  AgentConnectorRuntimeSetupResult,
  AgentConnectorSetupMode,
  AgentConnectorSetupRequest,
  AgentConnectorSetupState,
  AgentConnectorSetupStatus,
  AgentConnectorSetupStatusRequest,
  AgentConnectorsProvider,
  AgentRuntimeDescriptor,
} from '../connectors.js';
import { normalizeOpenClawChannelsStatus } from './channels.js';

interface OpenClawIntegrationStatusEntry {
  configured?: boolean;
  authenticated?: boolean;
  usable?: boolean;
}

interface OpenClawIntegrationStatusResult {
  integrations?: Record<string, OpenClawIntegrationStatusEntry>;
}

interface OpenClawIntegrationAuthStartResult {
  authId?: string;
  verificationUri?: string;
  url?: string;
  userCode?: string;
  expiresAt?: string | number;
  intervalMs?: number;
  scopes?: string[];
  instructions?: string;
}

interface OpenClawIntegrationAuthStatusResult {
  status?: string;
  connectionId?: string;
  accountId?: string;
  accountDisplayName?: string;
  scopes?: string[];
  error?: string;
}

const CONFIG_CHANNEL_CONNECTORS = new Set(['telegram', 'discord', 'slack', 'whatsapp']);

export interface OpenClawConnectorsClient {
  channelsStatus(probe?: boolean, timeoutMs?: number): Promise<Record<string, unknown>>;
  configPatch(patch: Record<string, unknown>): Promise<unknown>;
  integrationsStatus(params?: {
    integrationId?: string;
    probe?: boolean;
    timeoutMs?: number;
  }): Promise<OpenClawIntegrationStatusResult>;
  integrationsAuthStart(params: {
    integrationId: string;
    scopes?: string[];
    accountId?: string;
    force?: boolean;
  }): Promise<OpenClawIntegrationAuthStartResult>;
  integrationsAuthStatus(params: {
    authId: string;
    integrationId?: string;
    accountId?: string;
  }): Promise<OpenClawIntegrationAuthStatusResult>;
  runCommand?(command: string): Promise<void>;
}

const CONNECTOR_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SHORT_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{8}$/;

function preferredSetupModes(
  connectorId: string,
  modes: Set<AgentConnectorSetupMode>,
): AgentConnectorSetupMode[] {
  const preferred = connectorId === 'telegram' ? 'config' : 'managed-auth';
  return [preferred, preferred === 'config' ? 'managed-auth' : 'config']
    .filter((mode): mode is AgentConnectorSetupMode => modes.has(mode as AgentConnectorSetupMode));
}

export function normalizeOpenClawConnectors(
  channelsResult: Record<string, unknown>,
  integrationsResult: OpenClawIntegrationStatusResult,
): AgentConnectorDescriptor[] {
  const descriptors = new Map<string, {
    configured: boolean;
    authenticated: boolean;
    usable: boolean;
    modes: Set<AgentConnectorSetupMode>;
  }>();

  for (const channel of normalizeOpenClawChannelsStatus(channelsResult)) {
    const current = descriptors.get(channel.channelId) ?? {
      configured: false,
      authenticated: false,
      usable: false,
      modes: new Set<AgentConnectorSetupMode>(),
    };
    current.configured ||= channel.configured;
    current.authenticated ||= channel.authenticated === true || channel.running === true;
    current.usable ||= channel.configured && channel.running === true && channel.healthState !== 'unhealthy';
    current.modes.add('config');
    descriptors.set(channel.channelId, current);
  }

  for (const [connectorId, integration] of Object.entries(integrationsResult.integrations ?? {})) {
    const current = descriptors.get(connectorId) ?? {
      configured: false,
      authenticated: false,
      usable: false,
      modes: new Set<AgentConnectorSetupMode>(),
    };
    current.configured ||= integration.configured === true;
    current.authenticated ||= integration.authenticated === true;
    current.usable ||= integration.usable === true || (
      integration.configured === true &&
      integration.authenticated === true &&
      integration.usable !== false
    );
    current.modes.add('managed-auth');
    descriptors.set(connectorId, current);
  }

  return Array.from(descriptors, ([connectorId, descriptor]) => ({
    connectorId,
    configured: descriptor.configured,
    authenticated: descriptor.authenticated,
    usable: descriptor.usable,
    setupModes: preferredSetupModes(connectorId, descriptor.modes),
  })).sort((a, b) => a.connectorId.localeCompare(b.connectorId));
}

function setupState(value: string | undefined): AgentConnectorSetupState {
  const status = value?.trim().toLowerCase();
  if (status && ['authorized', 'connected', 'complete', 'completed', 'success'].includes(status)) return 'complete';
  if (status && ['failed', 'error', 'expired', 'denied', 'cancelled', 'canceled'].includes(status)) return 'failed';
  if (status && ['pending', 'waiting', 'started', 'authorizing'].includes(status)) return 'pending';
  return 'unknown';
}

function isUnsupportedMethodError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /unknown method|method not found|not implemented|unsupported/i.test(message);
}

export class OpenClawConnectorsProvider implements AgentConnectorsProvider {
  constructor(
    private readonly client: OpenClawConnectorsClient,
    readonly runtime: AgentRuntimeDescriptor,
  ) {}

  async list(options: AgentConnectorListOptions = {}): Promise<AgentConnectorDescriptor[]> {
    const channels = await this.client.channelsStatus(options.probe ?? false, options.timeoutMs).catch((error: unknown) => {
      if (isUnsupportedMethodError(error)) return {};
      throw error;
    });
    const skipManagedStatus = Boolean(options.connectorId && CONFIG_CHANNEL_CONNECTORS.has(options.connectorId));
    const integrations = skipManagedStatus
      ? {}
      : await this.client.integrationsStatus({
          integrationId: options.connectorId,
          probe: options.probe,
          timeoutMs: options.timeoutMs,
        }).catch((error: unknown) => {
          if (isUnsupportedMethodError(error)) return {};
          throw error;
        });
    const connectors = normalizeOpenClawConnectors(channels, integrations);
    return options.connectorId
      ? connectors.filter((connector) => connector.connectorId === options.connectorId)
      : connectors;
  }

  async startSetup(request: AgentConnectorSetupRequest): Promise<AgentConnectorRuntimeSetupResult> {
    let mode = request.mode;
    if (!mode) {
      if (request.connectorId === 'github') mode = 'managed-auth';
      else if (request.connectorId === 'telegram') mode = 'config';
      else mode = (await this.list()).find((connector) => connector.connectorId === request.connectorId)?.setupModes[0];
    }
    if (!mode) throw new Error(`No setup mode is available for ${request.connectorId}.`);
    if (mode === 'config') {
      return {
        connectorId: request.connectorId,
        mode,
        provenance: this.runtime,
      };
    }

    const result = await this.client.integrationsAuthStart({
      integrationId: request.connectorId,
      scopes: request.scopes,
      accountId: request.accountId,
      force: request.force,
    });
    return {
      connectorId: request.connectorId,
      mode,
      setupId: result.authId,
      instructions: result.instructions,
      deviceUrl: result.verificationUri ?? result.url,
      deviceCode: result.userCode,
      expiresAt: result.expiresAt,
      pollIntervalMs: result.intervalMs,
      scopes: result.scopes ?? request.scopes,
      provenance: this.runtime,
    };
  }

  async pollSetup(request: AgentConnectorSetupStatusRequest): Promise<AgentConnectorSetupStatus> {
    const result = await this.client.integrationsAuthStatus({
      authId: request.setupId,
      integrationId: request.connectorId,
      accountId: request.accountId,
    });
    return {
      connectorId: request.connectorId,
      setupId: request.setupId,
      state: result.connectionId ? 'complete' : setupState(result.status),
      connectionId: result.connectionId,
      accountId: result.accountId,
      accountDisplayName: result.accountDisplayName,
      scopes: result.scopes,
      error: result.error,
      provenance: this.runtime,
    };
  }

  async configure(connectorId: string, config: Record<string, unknown>, accountId?: string): Promise<void> {
    const connectorConfig = accountId ? { accounts: { [accountId]: config } } : config;
    await this.client.configPatch({ channels: { [connectorId]: connectorConfig } });
  }

  async approveAuthorization(request: AgentConnectorAuthorizationRequest): Promise<AgentConnectorAuthorizationResult> {
    if (request.protocol !== 'short-code') throw new Error(`Unsupported connector authorization protocol: ${request.protocol}.`);
    if (!CONNECTOR_ID_PATTERN.test(request.connectorId)) throw new Error('Connector id is invalid.');
    const code = request.code.trim().toUpperCase();
    if (!SHORT_CODE_PATTERN.test(code)) throw new Error('Connector authorization code is invalid.');
    if (request.accountId !== undefined && !CONNECTOR_ID_PATTERN.test(request.accountId)) throw new Error('Connector account id is invalid.');
    if (!this.client.runCommand) throw new Error('Connector authorization is unavailable in this workspace.');

    const accountArgument = request.accountId ? ` --account ${request.accountId}` : '';
    const notifyArgument = request.notify ? ' --notify' : '';
    await this.client.runCommand(`openclaw pairing approve ${request.connectorId} ${code}${accountArgument}${notifyArgument}`);
    return {
      connectorId: request.connectorId,
      protocol: request.protocol,
      state: 'complete',
    };
  }
}
