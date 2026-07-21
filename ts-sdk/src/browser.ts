import { Billing } from './billing.js';
import {
  getAgentsApiBaseUrl,
  getAgentsApiBaseUrlFromProductBase,
} from './config.js';
export {
  GatewayClient,
  type GatewayOptions,
  type GatewayEvent,
  type ChatEvent,
  type GatewayEphemeralChatSession,
  type ChatAttachment,
  type BrowserChatAttachment,
  type GatewayChatAttachmentPayload,
  type GatewayChatToolCall,
  type GatewayChatMessageSummary,
  type GatewayEventHandler,
  normalizeChatAttachments,
  extractGatewayChatThinking,
  extractGatewayChatMediaUrls,
  extractGatewayChatToolCalls,
  normalizeGatewayChatMessage,
} from './openclaw/gateway.js';
import { HTTPClient } from './http.js';
import { Instances } from './instances.js';
import { KeysAPI } from './keys.js';
import { HyperAgent } from './agent.js';
import { UserAPI } from './user.js';
import { VoiceAPI } from './voice.js';
import { WorkspacesAPI } from './workspaces.js';
export {
  API_KEY_BASELINE_FAMILIES,
  type ApiKeyBaselineFamily,
  type ApiKeyBaselineValue,
} from './keys.js';

export interface BrowserHyperCLIOptions {
  apiUrl: string;
  token: string;
  agentApiKey?: string;
  agentDev?: boolean;
  agentsApiBaseUrl?: string;
  timeout?: number;
}

function normalizeApiUrl(apiUrl: string): string {
  const trimmed = apiUrl.trim().replace(/\/+$/, '');
  return trimmed.endsWith('/api') ? trimmed.slice(0, -4) : trimmed;
}

/**
 * Browser-safe HyperCLI client for JWT-authenticated frontend apps.
 */
export class BrowserHyperCLI {
  private readonly http: HTTPClient;

  public readonly billing: Billing;
  public readonly agent: HyperAgent;
  public readonly user: UserAPI;
  public readonly instances: Instances;
  public readonly keys: KeysAPI;
  public readonly voice: VoiceAPI;
  public readonly workspaces: WorkspacesAPI;

  constructor(options: BrowserHyperCLIOptions) {
    const apiUrl = normalizeApiUrl(options.apiUrl);
    this.http = new HTTPClient(apiUrl, options.token, options.timeout);

    this.billing = new Billing(this.http);
    const agentsApiBaseUrl =
      options.agentsApiBaseUrl ||
      (options.agentDev ? getAgentsApiBaseUrl(true) : getAgentsApiBaseUrlFromProductBase(apiUrl));
    this.agent = new HyperAgent(
      this.http,
      options.agentApiKey ?? options.token,
      Boolean(options.agentDev),
      agentsApiBaseUrl,
    );
    this.user = new UserAPI(this.http);
    this.instances = new Instances(this.http);
    this.keys = new KeysAPI(this.http);
    this.voice = new VoiceAPI(this.http);
    this.workspaces = new WorkspacesAPI(options.agentApiKey ?? options.token, {
      agentsApiBase: agentsApiBaseUrl,
      timeout: options.timeout,
    });
  }
}
