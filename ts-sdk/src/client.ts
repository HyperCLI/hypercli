/**
 * Main HyperCLI client
 */
import { HTTPClient } from './http.js';
import {
  getAgentApiKey,
  getAgentsApiBaseUrl,
  getAgentsApiBaseUrlFromProductBase,
  getAgentsWsUrl,
  getAgentsWsUrlFromProductBase,
  getApiKey,
  getApiUrl,
} from './config.js';
import { Billing } from './billing.js';
import { Jobs } from './jobs.js';
import { UserAPI } from './user.js';
import { Instances } from './instances.js';
import { Renders } from './renders.js';
import { Files } from './files.js';
import { VoiceAPI } from './voice.js';
import { HyperAgent } from './agent.js';
import { KeysAPI } from './keys.js';
import { Deployments } from './agents.js';

function deriveAgentsApiBase(apiUrl: string, agentDev: boolean): string {
  return agentDev ? getAgentsApiBaseUrl(true) : getAgentsApiBaseUrlFromProductBase(apiUrl);
}

function deriveAgentsWsUrl(apiUrl: string, agentDev: boolean): string {
  return agentDev ? getAgentsWsUrl(true) : getAgentsWsUrlFromProductBase(apiUrl);
}

export interface HyperCLIOptions {
  apiKey?: string;
  apiUrl?: string;
  agentApiKey?: string;
  agentDev?: boolean;
  agentsApiBaseUrl?: string;
  agentsWsUrl?: string;
  timeout?: number;
}

/**
 * HyperCLI API Client
 * 
 * @example
 * ```typescript
 * import { HyperCLI } from '@hypercli/sdk';
 * 
 * const client = new HyperCLI(); // Uses HYPER_API_KEY from env or ~/.hypercli/config
 * // or
 * const client = new HyperCLI({ apiKey: 'your_key' });
 * 
 * // Billing
 * const balance = await client.billing.balance();
 * console.log(`Balance: $${balance.total}`);
 * 
 * // Jobs
 * const job = await client.jobs.create({
 *   image: 'nvidia/cuda:12.0',
 *   gpuType: 'l40s',
 *   command: 'python train.py',
 * });
 * console.log(`Job: ${job.jobId}`);
 * 
 * // User
 * const user = await client.user.get();
 * ```
 */
export class HyperCLI {
  private _apiKey: string;
  private _apiUrl: string;
  private _http: HTTPClient;

  public readonly billing: Billing;
  public readonly jobs: Jobs;
  public readonly user: UserAPI;
  public readonly instances: Instances;
  public readonly renders: Renders;
  public readonly files: Files;
  public readonly voice: VoiceAPI;
  public readonly keys: KeysAPI;
  public readonly agent: HyperAgent;
  public readonly deployments: Deployments;

  constructor(options: HyperCLIOptions = {}) {
    // Handle explicit undefined vs explicitly passed empty string
    const productApiKey = options.apiKey !== undefined ? options.apiKey : (getApiKey() || '');
    const resolvedAgentApiKey = options.agentApiKey !== undefined ? options.agentApiKey : (getAgentApiKey() || '');
    this._apiKey = productApiKey || resolvedAgentApiKey;
    
    if (!this._apiKey) {
      throw new Error(
        'API key required. Set HYPER_API_KEY/HYPERCLI_API_KEY or HYPER_AGENTS_API_KEY, ' +
        'create ~/.hypercli/config, or pass apiKey parameter.'
      );
    }

    this._apiUrl = options.apiUrl || getApiUrl();
    this._http = new HTTPClient(this._apiUrl, this._apiKey, options.timeout);
    const resolvedAgentsApiBase =
      options.agentsApiBaseUrl ||
      (options.apiUrl ? deriveAgentsApiBase(this._apiUrl, Boolean(options.agentDev)) : getAgentsApiBaseUrl(Boolean(options.agentDev)));
    const resolvedAgentsWsUrl =
      options.agentsWsUrl ||
      (options.apiUrl ? deriveAgentsWsUrl(this._apiUrl, Boolean(options.agentDev)) : getAgentsWsUrl(Boolean(options.agentDev)));
    // API namespaces
    this.billing = new Billing(this._http);
    this.jobs = new Jobs(this._http);
    this.user = new UserAPI(this._http);
    this.instances = new Instances(this._http);
    this.renders = new Renders(this._http);
    this.files = new Files(this._http);
    this.voice = new VoiceAPI(this._http);
    this.keys = new KeysAPI(this._http);

    this.agent = new HyperAgent(
      this._http,
      resolvedAgentApiKey,
      options.agentDev,
      resolvedAgentsApiBase,
    );
    this.deployments = new Deployments(
      this._http,
      resolvedAgentApiKey,
      resolvedAgentsApiBase,
      resolvedAgentsWsUrl,
    );
  }

  get apiUrl(): string {
    return this._apiUrl;
  }

  get apiKey(): string {
    return this._apiKey;
  }
}
