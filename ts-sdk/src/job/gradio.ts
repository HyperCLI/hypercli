/**
 * Gradio job helpers for GPU workloads running Gradio-based services
 */
import type { HyperCLI } from '../client.js';
import type { Job } from '../jobs.js';
import { BaseJob } from './base.js';

export interface GradioJobOptions {
  image: string;
  gpuType?: string;
  gpuCount?: number;
  runtime?: number;
  lb?: number;
  auth?: boolean;
  [key: string]: any;
}

/**
 * Gradio-specific job with service connection helpers
 */
export class GradioJob extends BaseJob {
  static override DEFAULT_GPU_TYPE = 'l4';
  static override HEALTH_ENDPOINT = '/';
  static override HEALTH_TIMEOUT = 10000;
  static GRADIO_PORT = 7860;

  private _useLb: boolean;
  public useAuth: boolean;
  private _jobToken: string | null = null;

  constructor(
    client: HyperCLI,
    job: Job,
    useLb: boolean = false,
    useAuth: boolean = false
  ) {
    super(client, job);
    this._useLb = useLb;
    this.useAuth = useAuth;
  }

  get useLb(): boolean {
    return this._useLb;
  }

  set useLb(value: boolean) {
    this._useLb = value;
    this._baseUrl = null;
  }

  override get baseUrl(): string {
    if (!this._baseUrl && this.hostname) {
      if (this._useLb) {
        this._baseUrl = `https://${this.hostname}`;
      } else {
        this._baseUrl = `http://${this.hostname}:${GradioJob.GRADIO_PORT}`;
      }
    }
    return this._baseUrl || '';
  }

  override get authHeaders(): Record<string, string> {
    if (this.useAuth) {
      if (!this._jobToken) {
        // Note: This is async, but authHeaders is sync - need to call jobToken() first
        throw new Error('Job token not loaded. Call await job.jobToken() first.');
      }
      return { 'Authorization': `Bearer ${this._jobToken}` };
    }
    return super.authHeaders;
  }

  /**
   * Get the job-specific bearer token for Gradio API auth
   */
  async jobToken(): Promise<string> {
    if (!this._jobToken) {
      this._jobToken = await this.client.jobs.token(this.jobId);
    }
    return this._jobToken;
  }

  /**
   * Create a new Gradio job for a specific Docker image
   */
  static async createForService(
    client: HyperCLI,
    options: GradioJobOptions
  ): Promise<GradioJob> {
    const {
      image,
      gpuType,
      gpuCount = 1,
      runtime = 3600,
      lb,
      auth = true,
      ...kwargs
    } = options;

    const actualLb = lb ?? GradioJob.GRADIO_PORT;
    const ports: Record<string, number> = {};

    if (actualLb) {
      ports.lb = actualLb;
    } else {
      ports[String(GradioJob.GRADIO_PORT)] = GradioJob.GRADIO_PORT;
    }

    const job = await client.jobs.create({
      image,
      gpuType: gpuType || this.DEFAULT_GPU_TYPE,
      gpuCount,
      runtime,
      ports,
      auth,
      ...kwargs,
    });

    return new GradioJob(client, job, Boolean(actualLb), auth);
  }

  /**
   * Connect to this Gradio instance using gradio_client
   * 
   * Note: Requires `gradio_client` package to be installed separately.
   * This is a placeholder - actual implementation would use gradio_client.
   */
  async connect(): Promise<any> {
    throw new Error(
      'Gradio client not available in TypeScript. ' +
      'Use the REST API directly or implement a client.'
    );
  }
}
