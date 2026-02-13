/**
 * Base job class for GPU workloads
 */
import type { HyperCLI } from '../client.js';
import type { Job } from '../jobs.js';
import { findJob } from '../jobs.js';
import { requestWithRetry } from '../http.js';

export interface BaseJobOptions {
  image?: string;
  gpuType?: string;
  gpuCount?: number;
  runtime?: number;
  [key: string]: any;
}

/**
 * Base class for managed GPU jobs with lifecycle helpers
 */
export class BaseJob {
  static DEFAULT_IMAGE: string = '';
  static DEFAULT_GPU_TYPE: string = 'l40s';
  static HEALTH_ENDPOINT: string = '/';
  static HEALTH_TIMEOUT: number = 5000;

  protected _baseUrl: string | null = null;

  constructor(
    public client: HyperCLI,
    public job: Job
  ) {}

  get jobId(): string {
    return this.job.jobId;
  }

  get hostname(): string | null {
    return this.job.hostname;
  }

  get baseUrl(): string {
    if (!this._baseUrl && this.hostname) {
      this._baseUrl = `http://${this.hostname}`;
    }
    return this._baseUrl || '';
  }

  get authHeaders(): Record<string, string> {
    return { 'Authorization': `Bearer ${this.client.apiKey}` };
  }

  /**
   * Find an existing running job, optionally filtering by image
   */
  static async getRunning<T extends typeof BaseJob>(
    this: T,
    client: HyperCLI,
    imageFilter?: string
  ): Promise<InstanceType<T> | null> {
    const jobs = await client.jobs.list('running');
    for (const job of jobs) {
      if (imageFilter && !job.dockerImage.includes(imageFilter)) {
        continue;
      }
      return new this(client, job) as InstanceType<T>;
    }
    return null;
  }

  /**
   * Get a job by ID, hostname, or IP address
   */
  static async getByInstance<T extends typeof BaseJob>(
    this: T,
    client: HyperCLI,
    instance: string,
    state: string = 'running'
  ): Promise<InstanceType<T>> {
    const job = await findJob(client.jobs, instance, state);
    if (!job) {
      throw new Error(`No job found matching: ${instance}`);
    }
    return new this(client, job) as InstanceType<T>;
  }

  /**
   * Create a new job
   */
  static async create<T extends typeof BaseJob>(
    this: T,
    client: HyperCLI,
    options: BaseJobOptions = {}
  ): Promise<InstanceType<T>> {
    const {
      image,
      gpuType,
      gpuCount = 1,
      runtime = 3600,
      ...kwargs
    } = options;

    const job = await client.jobs.create({
      image: image || this.DEFAULT_IMAGE,
      gpuType: gpuType || this.DEFAULT_GPU_TYPE,
      gpuCount,
      runtime,
      ...kwargs,
    });

    return new this(client, job) as InstanceType<T>;
  }

  /**
   * Get existing running job or create new one
   */
  static async getOrCreate<T extends typeof BaseJob>(
    this: T,
    client: HyperCLI,
    options: BaseJobOptions & { reuse?: boolean } = {}
  ): Promise<InstanceType<T>> {
    const { reuse = true, image, ...restOptions } = options;

    if (reuse) {
      const existing = await this.getRunning(client, image || this.DEFAULT_IMAGE);
      if (existing) {
        return existing as InstanceType<T>;
      }
    }

    return this.create(client, { image, ...restOptions });
  }

  /**
   * Refresh job state from API
   */
  async refresh(): Promise<this> {
    this.job = await this.client.jobs.get(this.jobId);
    this._baseUrl = null;
    return this;
  }

  /**
   * Wait for job to reach running state via API polling
   */
  async waitForRunning(timeout: number = 300000, pollInterval: number = 5000): Promise<boolean> {
    const start = Date.now();

    while (Date.now() - start < timeout) {
      await this.refresh();
      if (this.job.state === 'running' && this.hostname) {
        return true;
      }
      if (['failed', 'cancelled', 'completed', 'terminated'].includes(this.job.state)) {
        return false;
      }
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    return false;
  }

  /**
   * Alias for waitForRunning
   */
  async waitForHostname(timeout: number = 300000, pollInterval: number = 5000): Promise<boolean> {
    return this.waitForRunning(timeout, pollInterval);
  }

  /**
   * Check if the service is responding
   */
  async checkHealth(): Promise<boolean> {
    if (!this.baseUrl || this.job.state !== 'running') {
      return false;
    }

    try {
      const Constructor = this.constructor as typeof BaseJob;
      const response = await requestWithRetry({
        method: 'GET',
        url: `${this.baseUrl}${Constructor.HEALTH_ENDPOINT}`,
        headers: this.authHeaders,
        timeout: Constructor.HEALTH_TIMEOUT,
        retries: 3,
      });
      return response.status === 200;
    } catch {
      return false;
    }
  }

  /**
   * Wait for an EXISTING running job to respond to health checks
   */
  async waitExisting(timeout: number = 15000): Promise<boolean> {
    await this.refresh();
    if (this.job.state !== 'running' || !this.hostname) {
      return false;
    }

    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (await this.checkHealth()) {
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    return false;
  }

  /**
   * Wait for a NEW job to be ready (running state + health check passing)
   */
  async waitReady(
    timeout: number = 300000,
    pollInterval: number = 5000,
    dnsDelay: number = 15000
  ): Promise<boolean> {
    const start = Date.now();

    // Wait for running state via API
    await this.refresh();
    if (['failed', 'cancelled', 'completed', 'terminated'].includes(this.job.state)) {
      return false;
    }

    if (this.job.state !== 'running' || !this.hostname) {
      if (!await this.waitForRunning(timeout, pollInterval)) {
        return false;
      }
    }

    // DNS propagation delay
    if (dnsDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, dnsDelay));
    }

    // Job is running, check health
    const elapsed = Date.now() - start;
    const remaining = timeout - elapsed;

    while (remaining > 0) {
      if (await this.checkHealth()) {
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
      const newRemaining = timeout - (Date.now() - start);
      if (newRemaining <= 0) break;
    }

    return false;
  }

  /**
   * Cancel the job
   */
  async shutdown(): Promise<any> {
    return await this.client.jobs.cancel(this.jobId);
  }

  /**
   * Extend job runtime
   */
  async extend(runtime: number): Promise<this> {
    this.job = await this.client.jobs.extend(this.jobId, runtime);
    return this;
  }
}
