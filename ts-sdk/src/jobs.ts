/**
 * Jobs API - GPU job management
 */
import type { HTTPClient } from './http.js';

export interface Job {
  jobId: string;
  jobKey: string;
  state: string;
  gpuType: string;
  gpuCount: number;
  region: string;
  interruptible: boolean;
  pricePerHour: number;
  pricePerSecond: number;
  dockerImage: string;
  runtime: number;
  hostname: string | null;
  createdAt: number | null;
  startedAt: number | null;
  completedAt: number | null;
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
  runtime?: number;
  interruptible?: boolean;
  env?: Record<string, string>;
  ports?: Record<string, number>;
  auth?: boolean;
  registryAuth?: {
    username: string;
    password: string;
  };
}

function jobFromDict(data: any): Job {
  return {
    jobId: data.job_id || '',
    jobKey: data.job_key || '',
    state: data.state || '',
    gpuType: data.gpu_type || '',
    gpuCount: data.gpu_count || 1,
    region: data.region || '',
    interruptible: data.interruptible !== false,
    pricePerHour: data.price_per_hour || 0,
    pricePerSecond: data.price_per_second || 0,
    dockerImage: data.docker_image || '',
    runtime: data.runtime || 0,
    hostname: data.hostname || null,
    createdAt: data.created_at || null,
    startedAt: data.started_at || null,
    completedAt: data.completed_at || null,
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

  /**
   * List all jobs
   */
  async list(state?: string): Promise<Job[]> {
    const params: Record<string, string> = {};
    if (state) {
      params.state = state;
    }

    const data = await this.http.get('/api/jobs', params);
    // API returns {"jobs": [...], "total_count": ...}
    const jobs = typeof data === 'object' && data.jobs ? data.jobs : data;
    return (jobs || []).map(jobFromDict);
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
      runtime,
      interruptible = true,
      env,
      ports,
      auth,
      registryAuth,
    } = options;

    const payload: any = {
      docker_image: image,
      gpu_type: gpuType,
      gpu_count: gpuCount,
      interruptible,
      command: command ? Buffer.from(command).toString('base64') : '',
    };

    if (region) payload.region = region;
    if (runtime) payload.runtime = runtime;
    if (env) payload.env_vars = env;
    if (ports) payload.ports = ports;
    if (auth) payload.auth = auth;
    if (registryAuth) payload.registry_auth = registryAuth;

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
    const data = await this.http.get(`/api/jobs/${jobId}/metrics`);
    return jobMetricsFromDict(data);
  }

  /**
   * Get job auth token
   */
  async token(jobId: string): Promise<string> {
    const data = await this.http.get(`/api/jobs/${jobId}/token`);
    return data.token || '';
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
