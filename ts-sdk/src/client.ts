/**
 * Main HyperCLI client
 */
import { HTTPClient } from './http.js';
import {
  getAgentApiKey,
  getAgentsApiBaseUrl,
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
import { ModelsAPI } from './models.js';
import { WorkspacesAPI } from './workspaces.js';
import { RoutinesAPI } from './routines.js';
import { RunnersAPI } from './runners.js';
import { SessionsAPI } from './sessions.js';
import { MemoryAPI } from './memory.js';
import { IntegrationsAPI } from './integrations.js';
import { defaultAgentsWsUrl, resolveAgentsApiBase } from './agent-urls.js';

export interface HyperCLIOptions {
  apiKey?: string;
  apiUrl?: string;
  agentApiKey?: string;
  agentDev?: boolean;
  agentsApiBaseUrl?: string;
  agentsWsUrl?: string;
  timeout?: number;
}

export interface SystemStatus {
  ok: boolean;
  checkedAt: string;
  models: Record<string, boolean>;
  clusters: Record<string, boolean>;
}

function systemStatusFromDict(data: any): SystemStatus {
  return {
    ok: Boolean(data?.ok),
    checkedAt: data?.checked_at || data?.checkedAt || '',
    models: data?.models || {},
    clusters: data?.clusters || {},
  };
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
  private _agentsHttp: HTTPClient;

  public readonly billing: Billing;
  public readonly jobs: Jobs;
  public readonly user: UserAPI;
  public readonly instances: Instances;
  public readonly renders: Renders;
  public readonly files: Files;
  public readonly voice: VoiceAPI;
  public readonly keys: KeysAPI;
  public readonly models: ModelsAPI;
  public readonly workspaces: WorkspacesAPI;
  public readonly routines: RoutinesAPI;
  public readonly runners: RunnersAPI;
  /** §15 session read surface (catalog + history); the `/ws/acp` proxy is the write path. */
  public readonly sessions: SessionsAPI;
  public readonly memory: MemoryAPI;
  public readonly integrations: IntegrationsAPI;
  public readonly agent: HyperAgent;
  public readonly deployments: Deployments;

  constructor(options: HyperCLIOptions = {}) {
    // Handle explicit undefined vs explicitly passed empty string
    const productApiKey = options.apiKey !== undefined ? options.apiKey : (getApiKey() || '');
    const resolvedAgentApiKey = options.agentApiKey !== undefined
      ? options.agentApiKey
      : options.apiKey !== undefined
        ? options.apiKey
        : (getAgentApiKey() || '');
    this._apiKey = productApiKey || resolvedAgentApiKey;

    if (!this._apiKey) {
      throw new Error(
        'API key required. Set HYPER_API_KEY or HYPER_AGENTS_API_KEY, ' +
        'create ~/.hypercli/config, or pass apiKey parameter.'
      );
    }

    this._apiUrl = options.apiUrl || getApiUrl();
    this._http = new HTTPClient(this._apiUrl, this._apiKey, options.timeout);
    const resolvedAgentsApiBase = resolveAgentsApiBase(
      options.agentsApiBaseUrl ||
      getAgentsApiBaseUrl(Boolean(options.agentDev), this._apiUrl), true);
    const resolvedAgentsWsUrl =
      options.agentsWsUrl ||
      defaultAgentsWsUrl(resolvedAgentsApiBase);
    this._agentsHttp = new HTTPClient(resolvedAgentsApiBase, this._apiKey, options.timeout);
    // API namespaces
    this.billing = new Billing(this._http);
    this.jobs = new Jobs(this._http);
    this.user = new UserAPI(this._http, this._http, this._agentsHttp);
    this.instances = new Instances(this._http);
    this.renders = new Renders(this._http);
    this.files = new Files(this._http);
    this.voice = new VoiceAPI(this._agentsHttp);
    this.keys = new KeysAPI(this._http);
    this.models = new ModelsAPI(this._http);
    this.workspaces = new WorkspacesAPI(this._apiKey, {
      agentsApiBase: resolvedAgentsApiBase,
      timeout: options.timeout,
    });
    this.routines = new RoutinesAPI(this._apiKey, {
      agentsApiBase: resolvedAgentsApiBase,
      timeout: options.timeout,
    });
    this.runners = new RunnersAPI(this._apiKey, {
      agentsApiBase: resolvedAgentsApiBase,
      timeout: options.timeout,
    });
    this.sessions = new SessionsAPI(this._agentsHttp);
    this.memory = new MemoryAPI(this._agentsHttp);
    this.integrations = new IntegrationsAPI(this._apiKey, {
      agentsApiBase: resolvedAgentsApiBase,
      timeout: options.timeout,
    });

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
      options.timeout,
    );
  }

  get apiUrl(): string {
    return this._apiUrl;
  }

  get apiKey(): string {
    return this._apiKey;
  }

  async status(): Promise<SystemStatus> {
    const payload = await this._agentsHttp.get('/status');
    return systemStatusFromDict(payload);
  }
}
