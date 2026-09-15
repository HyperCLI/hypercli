const TERMINAL_JOB_STATES = new Set(['succeeded', 'failed', 'terminated', 'canceled', 'cancelled']);

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

export function jobFromDict(data: any): Job {
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

export function jobListPageFromDict(data: any, fallbackPage = 1, fallbackPageSize = 50): JobListPage {
  const jobs = Array.isArray(data?.jobs) ? data.jobs.map(jobFromDict) : [];
  return {
    jobs,
    totalCount: Number(data?.total_count ?? jobs.length),
    page: Number(data?.page ?? fallbackPage),
    pageSize: Number(data?.page_size ?? (jobs.length || fallbackPageSize)),
  };
}

export function lifecycleEventFromDict(data: any): JobLifecycleEvent {
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

export function gpuMetricsFromDict(data: any): GPUMetrics {
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

export function systemMetricsFromDict(data: any): SystemMetrics {
  return {
    cpuPercent: data.cpu_percent || 0,
    cpuCores: data.cpu_cores || 1,
    cpuUnixPercent: data.cpu_unix_percent || data.cpu_percent || 0,
    memoryUsed: data.memory_used_mb || 0,
    memoryLimit: data.memory_limit_mb || 0,
  };
}

export function jobMetricsFromDict(data: any): JobMetrics {
  return {
    gpus: (data.gpus || []).map(gpuMetricsFromDict),
    system: data.system ? systemMetricsFromDict(data.system) : null,
  };
}

export function normalizeTags(tags?: Record<string, string> | string[] | null): string[] | undefined {
  if (!tags) return undefined;
  if (Array.isArray(tags)) return [...tags];
  return Object.entries(tags).map(([key, value]) => `${key}=${value}`);
}
