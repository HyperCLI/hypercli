/**
 * Jobs API - GPU job management
 */
import type { HTTPClient } from './http.js';
import WebSocket from 'ws';

const TERMINAL_JOB_STATES = new Set(['succeeded', 'failed', 'terminated', 'canceled', 'cancelled']);

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

export interface Job {
  jobId: string;
  jobKey: string;
  state: string;
  gpuType: string;
  gpuCount: number;
  region: string;
  constraints: Record<string, string> | null;
  interruptible: boolean;
  pricePerHour: number;
  pricePerSecond: number;
  dockerImage: string;
  runtime: number;
  elapsed: number;
  timeLeft: number;
  hostname: string | null;
  coldBoot: boolean;
  createdAt: number | null;
  startedAt: number | null;
  completedAt: number | null;
  tags?: string[] | null;
}

export interface ExecResult {
  jobId: string;
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface JobLifecycleEvent {
  event: string;
  jobId?: string;
  state?: string;
  reason?: string;
  error?: string;
  instanceId?: string;
  runtime?: number;
  payload: Record<string, unknown>;
}

export interface GPUMetrics {
  index: number;
  name: string;
  utilization: number;
  memoryUsed: number;
  memoryTotal: number;
  temperature: number;
  powerDraw: number;
}

export interface SystemMetrics {
  cpuPercent: number;
  cpuCores: number;
  cpuUnixPercent: number;
  memoryUsed: number;
  memoryLimit: number;
}

export interface JobMetrics {
  gpus: GPUMetrics[];
  system: SystemMetrics | null;
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

export interface JobListPage {
  jobs: Job[];
  totalCount: number;
  page: number;
  pageSize: number;
}

function parseRuntimeSeconds(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(Math.trunc(parsed), 0);
}

function parseTimestampSeconds(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.getTime() / 1000 : null;
  }
  if (typeof value === 'string') {
    const direct = Number(value);
    if (Number.isFinite(direct)) {
      return direct;
    }
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed / 1000 : null;
  }
  return null;
}

function deriveRuntimeFields(data: any): { elapsed: number; timeLeft: number } {
  const runtimeSeconds = parseRuntimeSeconds(data?.runtime);
  if (runtimeSeconds === null) {
    return { elapsed: 0, timeLeft: 0 };
  }

  const state = String(data?.state ?? '').trim().toLowerCase();
  if (state === 'dry_run') {
    return { elapsed: 0, timeLeft: runtimeSeconds };
  }

  const startedAt = parseTimestampSeconds(data?.started_at);
  const createdAt = parseTimestampSeconds(data?.created_at);
  const completedAt = parseTimestampSeconds(data?.completed_at);

  let anchor = startedAt;
  if (anchor === null && (state === 'running' || completedAt !== null || TERMINAL_JOB_STATES.has(state))) {
    anchor = createdAt;
  }

  if (anchor === null) {
    return { elapsed: 0, timeLeft: runtimeSeconds };
  }

  const endTime = completedAt ?? (Date.now() / 1000);
  const elapsed = Math.max(Math.trunc(endTime - anchor), 0);
  if (completedAt !== null || TERMINAL_JOB_STATES.has(state)) {
    return { elapsed, timeLeft: 0 };
  }
  return { elapsed, timeLeft: Math.max(runtimeSeconds - elapsed, 0) };
}

function jobFromDict(data: any): Job {
  const { elapsed, timeLeft } = deriveRuntimeFields(data);
  return {
    jobId: data.job_id || '',
    jobKey: data.job_key || '',
    state: data.state || '',
    gpuType: data.gpu_type || '',
    gpuCount: data.gpu_count || 1,
    region: data.region || '',
    constraints: data.constraints || null,
    interruptible: data.interruptible !== false,
    pricePerHour: data.price_per_hour || 0,
    pricePerSecond: data.price_per_second || 0,
    dockerImage: data.docker_image || '',
    runtime: data.runtime || 0,
    elapsed,
    timeLeft,
    hostname: data.hostname || null,
    coldBoot: data.cold_boot ?? true,
    createdAt: data.created_at || null,
    startedAt: data.started_at || null,
    completedAt: data.completed_at || null,
    tags: data.tags || null,
  };
}

function normalizeTags(tags?: Record<string, string> | string[] | null): string[] | undefined {
  if (!tags) return undefined;
  if (Array.isArray(tags)) return [...tags];
  return Object.entries(tags).map(([key, value]) => `${key}=${value}`);
}

function jobListPageFromDict(data: any): JobListPage {
  const jobs = Array.isArray(data?.jobs) ? data.jobs.map(jobFromDict) : [];
  return {
    jobs,
    totalCount: Number(data?.total_count ?? jobs.length),
    page: Number(data?.page ?? 1),
    pageSize: Number(data?.page_size ?? (jobs.length || 50)),
  };
}

function execResultFromDict(data: any): ExecResult {
  return {
    jobId: data.job_id || '',
    stdout: data.stdout || '',
    stderr: data.stderr || '',
    exitCode: data.exit_code ?? -1,
  };
}

function lifecycleEventFromDict(data: any): JobLifecycleEvent {
  return {
    event: String(data?.event || ''),
    jobId: data?.job_id || undefined,
    state: data?.state || undefined,
    reason: data?.reason || undefined,
    error: data?.error || undefined,
    instanceId: data?.instance_id || undefined,
    runtime: typeof data?.runtime === 'number' ? data.runtime : undefined,
    payload: data && typeof data === 'object' ? { ...data } : {},
  };
}

function gpuMetricsFromDict(data: any): GPUMetrics {
  return {
    index: data.index || 0,
    name: data.name || '',
    utilization: data.utilization_gpu_percent || 0,
    memoryUsed: data.memory_used_mb || 0,
    memoryTotal: data.memory_total_mb || 0,
    temperature: data.temperature_c || 0,
    powerDraw: data.power_draw_w || 0,
  };
}

function systemMetricsFromDict(data: any): SystemMetrics {
  return {
    cpuPercent: data.cpu_percent || 0,
    cpuCores: data.cpu_cores || 1,
    cpuUnixPercent: data.cpu_unix_percent || data.cpu_percent || 0,
    memoryUsed: data.memory_used_mb || 0,
    memoryLimit: data.memory_limit_mb || 0,
  };
}

function jobMetricsFromDict(data: any): JobMetrics {
  return {
    gpus: (data.gpus || []).map(gpuMetricsFromDict),
    system: data.system ? systemMetricsFromDict(data.system) : null,
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
