/**
 * Main HyperCLI client
 */
import { HTTPClient } from './http.js';
import { getApiKey, getApiUrl } from './config.js';
import { Billing } from './billing.js';
import { Jobs } from './jobs.js';
import { UserAPI } from './user.js';
import { Instances } from './instances.js';
import { Renders } from './renders.js';
import { Files } from './files.js';
import { Claw } from './claw.js';
import { KeysAPI } from './keys.js';

export interface HyperCLIOptions {
  apiKey?: string;
  apiUrl?: string;
  clawApiKey?: string;
  clawDev?: boolean;
  timeout?: number;
}

/**
 * HyperCLI API Client
 * 
 * @example
 * ```typescript
 * import { HyperCLI } from '@hypercli/sdk';
 * 
 * const client = new HyperCLI(); // Uses HYPERCLI_API_KEY from env or ~/.hypercli/config
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
  public readonly keys: KeysAPI;
  public readonly claw: Claw;

  constructor(options: HyperCLIOptions = {}) {
    // Handle explicit undefined vs explicitly passed empty string
    this._apiKey = options.apiKey !== undefined ? options.apiKey : (getApiKey() || '');
    
    if (!this._apiKey) {
      throw new Error(
        'API key required. Set HYPERCLI_API_KEY env var, ' +
        'create ~/.hypercli/config, or pass apiKey parameter.'
      );
    }

    this._apiUrl = options.apiUrl || getApiUrl();
    this._http = new HTTPClient(this._apiUrl, this._apiKey, options.timeout);

    // API namespaces
    this.billing = new Billing(this._http);
    this.jobs = new Jobs(this._http);
    this.user = new UserAPI(this._http);
    this.instances = new Instances(this._http);
    this.renders = new Renders(this._http);
    this.files = new Files(this._http);
    this.keys = new KeysAPI(this._http);
    this.claw = new Claw(this._http, options.clawApiKey, options.clawDev);
  }

  get apiUrl(): string {
    return this._apiUrl;
  }

  get apiKey(): string {
    return this._apiKey;
  }
}
