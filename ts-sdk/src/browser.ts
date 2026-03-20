import { Billing } from './billing.js';
export {
  GatewayClient,
  type GatewayOptions,
  type GatewayEvent,
  type ChatEvent,
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
} from './gateway.js';
import { HTTPClient } from './http.js';
import { Instances } from './instances.js';
import { KeysAPI } from './keys.js';
import { UserAPI } from './user.js';

export interface BrowserHyperCLIOptions {
  apiUrl: string;
  token: string;
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
  public readonly user: UserAPI;
  public readonly instances: Instances;
  public readonly keys: KeysAPI;

  constructor(options: BrowserHyperCLIOptions) {
    const apiUrl = normalizeApiUrl(options.apiUrl);
    this.http = new HTTPClient(apiUrl, options.token, options.timeout);

    this.billing = new Billing(this.http);
    this.user = new UserAPI(this.http);
    this.instances = new Instances(this.http);
    this.keys = new KeysAPI(this.http);
  }
}
