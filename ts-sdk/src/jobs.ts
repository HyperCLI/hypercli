/**
 * Jobs API - GPU job management
 */
import type { HTTPClient } from './http.js';
import WebSocket from 'ws';
import {
  jobFromDict,
  jobListPageFromDict,
  jobMetricsFromDict,
  lifecycleEventFromDict,
  normalizeTags,
  type GPUMetrics,
  type Job,
  type JobLifecycleEvent,
  type JobListPage,
  type JobMetrics,
  type SystemMetrics,
} from './job-codecs.js';

function execArgv(command: unknown): string[] {
  if (!Array.isArray(command) || command.length === 0 || command.some((argument) => typeof argument !== 'string')) {
    throw new Error('exec command must be an argv list');
  }
  if (command[0].length === 0) {
    throw new Error('exec command executable must be nonempty');
  }
  if (command.some((argument) => argument.includes('\0'))) {
    throw new Error('exec command arguments must not contain NUL');
  }
  const encodedBytes = command.reduce(
    (total, argument) => total + new TextEncoder().encode(argument).byteLength,
    0,
  );
  if (encodedBytes > 65_536) {
    throw new Error('exec command exceeds 65536 UTF-8 bytes');
  }
  return [...command];
}

export type {
  GPUMetrics,
  Job,
  JobLifecycleEvent,
  JobListPage,
  JobMetrics,
  SystemMetrics,
} from './job-codecs.js';

export interface ExecResult {
  jobId: string;
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface CreateJobOptions {
  image: string;
  command?: string;
  gpuType?: string;
  gpuCount?: number;
  region?: string;
  constraints?: Record<string, string>;
  runtime?: number;
  interruptible?: boolean;
  env?: Record<string, string>;
  ports?: Record<string, number>;
  auth?: boolean;
  registryAuth?: {
    username: string;
    password: string;
  };
  tags?: Record<string, string> | string[];
  dockerfile?: string;
  dryRun?: boolean;
}

export interface ListJobsOptions {
  state?: string;
  tags?: Record<string, string> | string[];
  page?: number;
  pageSize?: number;
}

function execResultFromDict(data: any): ExecResult {
  return {
    jobId: data.job_id || '',
    stdout: data.stdout || '',
    stderr: data.stderr || '',
    exitCode: data.exit_code ?? -1,
  };
}

export class Jobs {
  constructor(private http: HTTPClient) {}

  private buildListParams(options: ListJobsOptions = {}): Record<string, string | number | string[]> {
    const params: Record<string, string | number | string[]> = {};
    if (options.state) {
      params.state = options.state;
    }
    const normalizedTags = normalizeTags(options.tags);
    if (normalizedTags && normalizedTags.length > 0) {
      params.tag = normalizedTags;
    }
    if (options.page !== undefined) {
      params.page = options.page;
    }
    if (options.pageSize !== undefined) {
      params.page_size = options.pageSize;
    }
    return params;
  }

  /**
   * List all jobs
   */
  async list(state?: string, tags?: Record<string, string> | string[]): Promise<Job[]>;
  async list(options?: ListJobsOptions): Promise<Job[]>;
  async list(stateOrOptions?: string | ListJobsOptions, tags?: Record<string, string> | string[]): Promise<Job[]> {
    let options: ListJobsOptions;
    if (typeof stateOrOptions === 'string') {
      options = { state: stateOrOptions, tags };
    } else if (stateOrOptions) {
      options = stateOrOptions;
    } else {
      options = tags ? { tags } : {};
    }
    return (await this.listPage(options)).jobs;
  }

  async listPage(options: ListJobsOptions = {}): Promise<JobListPage> {
    const data = await this.http.get('/api/jobs', this.buildListParams(options));
    if (typeof data === 'object' && data && Array.isArray(data.jobs)) {
      return jobListPageFromDict(data);
    }
    const jobs = (data || []).map(jobFromDict);
    return {
      jobs,
      totalCount: jobs.length,
      page: options.page ?? 1,
      pageSize: options.pageSize ?? (jobs.length || 50),
    };
  }

  /**
   * Get job details
   */
  async get(jobId: string): Promise<Job> {
    const data = await this.http.get(`/api/jobs/${jobId}`);
    return jobFromDict(data);
  }

  /**
   * Create a new job
   */
  async create(options: CreateJobOptions): Promise<Job> {
    const {
      image,
      command,
      gpuType = 'l40s',
      gpuCount = 1,
      region,
      constraints,
      runtime,
      interruptible = true,
      env,
      ports,
      auth,
      registryAuth,
      tags,
      dockerfile,
      dryRun = false,
    } = options;

    const payload: any = {
      docker_image: image,
      gpu_type: gpuType,
      gpu_count: gpuCount,
      interruptible,
      command: command ? Buffer.from(command).toString('base64') : '',
    };

    if (region) payload.region = region;
    if (constraints) payload.constraints = constraints;
    if (runtime) payload.runtime = runtime;
    if (env) payload.env_vars = env;
    if (ports) payload.ports = ports;
    if (auth) payload.auth = auth;
    if (registryAuth) payload.registry_auth = registryAuth;
    const normalizedTags = normalizeTags(tags);
    if (normalizedTags) payload.tags = normalizedTags;
    if (dockerfile) payload.dockerfile = dockerfile;
    if (dryRun) payload.dry_run = true;

    const data = await this.http.post('/api/jobs', payload);
    return jobFromDict(data);
  }

  /**
   * Cancel a job
   */
  async cancel(jobId: string): Promise<any> {
    return await this.http.delete(`/api/jobs/${jobId}`);
  }

  /**
   * Extend job runtime
   */
  async extend(jobId: string, runtime: number): Promise<Job> {
    const data = await this.http.patch(`/api/jobs/${jobId}`, { runtime });
    return jobFromDict(data);
  }

  /**
   * Get job logs
   */
  async logs(jobId: string): Promise<string> {
    const data = await this.http.get(`/api/jobs/${jobId}/logs`);
    return data.logs || '';
  }

  /**
   * Get job GPU metrics
   */
  async metrics(jobId: string): Promise<JobMetrics> {
    const stream = this.metricsStream(jobId, { interval: 60 });
    const result = await stream.next();
    await stream.return(undefined).catch(() => undefined);
    if (result.done) throw new Error('metrics stream closed before first snapshot');
    return result.value;
  }

  async *metricsStream(
    jobId: string,
    options: { interval?: number } = {},
  ): AsyncGenerator<JobMetrics> {
    const interval = options.interval ?? 5;
    const job = await this.get(jobId);
    const wsBase = (this.http as any).baseUrl
      .replace('https://', 'wss://')
      .replace('http://', 'ws://')
      .replace(/\/api$/, '');
    const url = `${wsBase}/orchestra/ws/metrics/jobs/${encodeURIComponent(job.jobKey)}?interval=${encodeURIComponent(String(interval))}`;
    const ws = new WebSocket(url);

    const queue: JobMetrics[] = [];
    let done = false;
    let pending: ((value: IteratorResult<JobMetrics>) => void) | null = null;
    let rejectPending: ((error: Error) => void) | null = null;
    let failed: Error | null = null;

    ws.on('message', (data: Buffer) => {
      try {
        const parsed = JSON.parse(data.toString());
        if (parsed?.event === 'metrics_error') {
          throw new Error(String(parsed.detail || 'metrics stream failed'));
        }
        if (parsed?.event !== 'metrics_snapshot') return;
        const metrics = jobMetricsFromDict(parsed.data || {});
        if (pending) {
          pending({ done: false, value: metrics });
          pending = null;
          rejectPending = null;
        } else {
          queue.push(metrics);
        }
      } catch (error) {
        failed = error instanceof Error ? error : new Error('invalid metrics frame');
        done = true;
        if (rejectPending) {
          rejectPending(failed);
          pending = null;
          rejectPending = null;
        }
      }
    });
    ws.on('close', () => {
      done = true;
      if (pending) {
        pending({ done: true, value: undefined });
        pending = null;
        rejectPending = null;
      }
    });
    ws.on('error', (error: Error) => {
      failed = error;
      done = true;
      if (rejectPending) {
        rejectPending(error);
        pending = null;
        rejectPending = null;
      }
    });

    try {
      while (!done || queue.length > 0) {
        if (failed) throw failed;
        const metrics = queue.shift();
        if (metrics) {
          yield metrics;
          continue;
        }
        const result = await new Promise<IteratorResult<JobMetrics>>((resolve, reject) => {
          pending = resolve;
          rejectPending = reject;
        });
        if (result.done) break;
        yield result.value;
      }
    } finally {
      ws.close();
    }
  }

  /**
   * Get job auth token
   */
  async token(jobId: string): Promise<string> {
    const data = await this.http.get(`/api/jobs/${jobId}/token`);
    return data.token || '';
  }

  /**
   * Execute a command non-interactively on a running job container.
   */
  async exec(jobId: string, command: string[], timeout: number = 30): Promise<ExecResult> {
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 300) {
      throw new Error('timeout must be an integer from 1 through 300');
    }
    const data = await this.http.post(`/api/jobs/${jobId}/exec`, {
      command: execArgv(command),
      timeout,
    });
    return execResultFromDict(data);
  }

  /**
   * Connect to a job shell via director WebSocket proxy.
   */
  async shellConnect(jobId: string, shell: string = '/bin/bash'): Promise<WebSocket> {
    const job = await this.get(jobId);
    const wsBase = (this.http as any).baseUrl
      .replace('https://', 'wss://')
      .replace('http://', 'ws://')
      .replace(/\/api$/, '');
    const url = `${wsBase}/orchestra/ws/shell/${jobId}?token=${encodeURIComponent(job.jobKey)}&shell=${encodeURIComponent(shell)}`;

    return await new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(url);
      const onError = (err: Error) => reject(err);
      ws.once('error', onError);
      ws.once('open', () => {
        ws.off('error', onError);
        resolve(ws);
      });
    });
  }

  /**
   * Stream job-scoped lifecycle events. Treat events as wakeups; call get()
   * when an authoritative job snapshot is required.
   */
  async *lifecycleStream(jobId: string): AsyncGenerator<JobLifecycleEvent> {
    const job = await this.get(jobId);
    const wsBase = (this.http as any).baseUrl
      .replace('https://', 'wss://')
      .replace('http://', 'ws://')
      .replace(/\/api$/, '');
    const url = `${wsBase}/orchestra/ws/lifecycle/${encodeURIComponent(job.jobKey)}`;

    const ws = new WebSocket(url);
    const queue: JobLifecycleEvent[] = [];
    let done = false;
    let pending: ((value: IteratorResult<JobLifecycleEvent>) => void) | null = null;
    let rejectPending: ((error: Error) => void) | null = null;
    let failed: Error | null = null;

    ws.on('message', (data: Buffer) => {
      try {
        const parsed = JSON.parse(data.toString());
        const event = lifecycleEventFromDict(parsed);
        if (pending) {
          pending({ done: false, value: event });
          pending = null;
          rejectPending = null;
        } else {
          queue.push(event);
        }
      } catch {
        // Ignore malformed frames.
      }
    });
    ws.on('close', () => {
      done = true;
      if (pending) {
        pending({ done: true, value: undefined });
        pending = null;
        rejectPending = null;
      }
    });
    ws.on('error', (error: Error) => {
      failed = error;
      done = true;
      if (rejectPending) {
        rejectPending(error);
        pending = null;
        rejectPending = null;
      }
    });

    try {
      while (!done || queue.length > 0) {
        if (failed) throw failed;
        const event = queue.shift();
        if (event) {
          yield event;
          continue;
        }
        const result = await new Promise<IteratorResult<JobLifecycleEvent>>((resolve, reject) => {
          pending = resolve;
          rejectPending = reject;
        });
        if (result.done) break;
        yield result.value;
      }
    } finally {
      ws.close();
    }
  }
}

// Utility functions for finding jobs

/**
 * Check if string looks like a UUID (job ID)
 */
export function isUuid(s: string): boolean {
  return s.includes('-') && s.length > 30;
}

/**
 * Find job by UUID via direct API call
 */
export async function findById(jobs: Jobs, jobId: string): Promise<Job | null> {
  try {
    return await jobs.get(jobId);
  } catch {
    return null;
  }
}

/**
 * Find job by hostname (exact or prefix match)
 */
export function findByHostname(jobList: Job[], hostname: string): Job | null {
  for (const job of jobList) {
    if (job.hostname && (job.hostname === hostname || job.hostname.startsWith(hostname))) {
      return job;
    }
  }
  return null;
}

/**
 * Find job by IP address (extracted from hostname)
 */
export async function findByIp(jobList: Job[], ip: string): Promise<Job | null> {
  const dns = await import('dns').then(m => m.promises);

  for (const job of jobList) {
    if (!job.hostname) continue;

    try {
      const addresses = await dns.resolve4(job.hostname);
      if (addresses.includes(ip)) {
        return job;
      }
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Find a job by UUID, hostname, or IP address
 */
export async function findJob(
  jobs: Jobs,
  identifier: string,
  state?: string
): Promise<Job | null> {
  // Try UUID first (direct API call)
  if (isUuid(identifier)) {
    return await findById(jobs, identifier);
  }

  // Get job list for hostname/IP search
  const jobList = await jobs.list(state);

  // Try hostname match
  const byHostname = findByHostname(jobList, identifier);
  if (byHostname) {
    return byHostname;
  }

  // Try IP match (slower, requires DNS lookup)
  return await findByIp(jobList, identifier);
}
