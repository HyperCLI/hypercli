/**
 * x402 pay-per-use client for launching jobs and flow renders without a full API account.
 *
 * Requires the `@x402/client` and `@x402/evm` packages for payment signing.
 * Install with: npm install @x402/client @x402/evm
 */
import { DEFAULT_API_URL } from './config.js';
import { APIError } from './errors.js';
import type { Job } from './jobs.js';
import type { Render } from './renders.js';

const TERMINAL_JOB_STATES = new Set(['succeeded', 'failed', 'terminated', 'canceled', 'cancelled']);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface X402Signer {
  address: string;
  signTypedData: (params: {
    domain: Record<string, unknown>;
    types: Record<string, unknown>;
    primaryType: string;
    message: Record<string, unknown>;
  }) => Promise<string>;
}

export interface X402JobLaunch {
  job: Job;
  accessKey: string;
  statusUrl: string;
  logsUrl: string;
  cancelUrl: string;
}

export interface X402FlowCreate {
  render: Render;
  accessKey: string;
  statusUrl: string;
  cancelUrl: string;
}

export interface FlowCatalogItem {
  flowType: string;
  priceUsd: number;
  template?: string | null;
  type: string;
  regions?: Record<string, string> | null;
  interruptible?: boolean | null;
}

export interface X402CreateJobOptions {
  amount: number;
  signer: X402Signer;
  image: string;
  command?: string;
  gpuType?: string;
  gpuCount?: number;
  region?: string;
  constraints?: Record<string, string>;
  interruptible?: boolean;
  env?: Record<string, string>;
  ports?: Record<string, number>;
  auth?: boolean;
  registryAuth?: { username: string; password: string };
}

export interface X402CreateFlowOptions {
  flowType: string;
  amount: number;
  signer: X402Signer;
  params?: Record<string, any>;
  notifyUrl?: string;
}

export interface X402PostOptions {
  headers?: Record<string, string>;
  query?: Record<string, string | number>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function jobFromX402(data: any): Job {
  const job = data.job ?? {};
  const { elapsed, timeLeft } = deriveRuntimeFields(job);
  return {
    jobId: job.job_id || '',
    jobKey: job.job_key || '',
    state: job.state || '',
    gpuType: job.gpu_type || '',
    gpuCount: job.gpu_count || 0,
    region: job.region || '',
    constraints: job.constraints || null,
    interruptible: job.interruptible ?? true,
    pricePerHour: job.price_per_hour || 0,
    pricePerSecond: job.price_per_second || 0,
    dockerImage: job.docker_image || '',
    runtime: job.runtime || 0,
    elapsed,
    timeLeft,
    hostname: job.hostname || null,
    coldBoot: job.cold_boot ?? true,
    tags: job.tags || null,
    createdAt: job.created_at || null,
    startedAt: job.started_at || null,
    completedAt: job.completed_at || null,
  };
}

function renderFromX402(data: any): Render {
  const render = data.render ?? {};
  return {
    renderId: render.id || render.render_id || '',
    state: render.state || '',
    template: render.template || render.meta?.template || null,
    renderType: render.type || render.render_type || null,
    tags: Array.isArray(render.tags) ? render.tags : null,
    resultUrl: render.result_url || null,
    error: render.error || null,
    createdAt: render.created_at || null,
    startedAt: render.started_at || null,
    completedAt: render.completed_at || null,
  };
}

function catalogItemFromDict(data: any): FlowCatalogItem {
  return {
    flowType: String(data.flow_type ?? data.name ?? ''),
    priceUsd: Number(data.price_usd ?? 0),
    template: data.template ?? null,
    type: String(data.type ?? 'comfyui'),
    regions: typeof data.regions === 'object' && data.regions ? data.regions : null,
    interruptible: data.interruptible ?? null,
  };
}

async function jsonGet(baseUrl: string, path: string, timeout: number): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(`${baseUrl}${path}`, { signal: controller.signal });
    if (response.status >= 400) {
      const text = await response.text().catch(() => '');
      throw new APIError(response.status, text || `HTTP ${response.status}`);
    }
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Perform an x402 POST: send request, handle 402 payment challenge, retry with payment.
 *
 * This requires the `@x402/client` and `@x402/evm` packages.
 * The signer must implement `signTypedData` (e.g., a viem WalletClient or ethers Signer).
 */
export async function x402Post(
  baseUrl: string,
  path: string,
  payload: Record<string, any>,
  signer: X402Signer,
  timeout: number,
  options: X402PostOptions = {},
): Promise<any> {
  let x402ClientClass: any;
  let ExactEvmScheme: any;
  try {
    // Dynamic import to keep x402 deps optional
    // @ts-ignore — optional peer dependency
    const clientMod = await import('@x402/client');
    // @ts-ignore — optional peer dependency
    const evmMod = await import('@x402/evm');
    x402ClientClass = clientMod.x402Client ?? clientMod.default;
    ExactEvmScheme = evmMod.ExactEvmScheme;
  } catch {
    throw new Error(
      'x402 dependencies missing. Install with: npm install @x402/client @x402/evm'
    );
  }

  const client = new x402ClientClass();
  client.register('eip155:*', new ExactEvmScheme(signer));

  const endpointUrl = new URL(`${baseUrl}${path}`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== null) {
      endpointUrl.searchParams.set(key, String(value));
    }
  }
  const endpoint = endpointUrl.toString();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers ?? {}),
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    let response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (response.status === 402) {
      const responseHeaders = Object.fromEntries(response.headers.entries());
      const body = await response.arrayBuffer();
      const paymentHeaders = await client.handlePaymentRequired(responseHeaders, new Uint8Array(body));

      const retryHeaders = {
        ...headers,
        ...paymentHeaders,
        'Access-Control-Expose-Headers': 'PAYMENT-RESPONSE,X-PAYMENT-RESPONSE',
      };

      response = await fetch(endpoint, {
        method: 'POST',
        headers: retryHeaders,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    }

    if (response.status >= 400) {
      const text = await response.text().catch(() => '');
      let detail = text;
      try {
        const parsed = JSON.parse(text);
        detail = parsed.detail ?? parsed.message ?? text;
      } catch { /* use raw text */ }
      throw new APIError(response.status, String(detail));
    }

    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class X402Client {
  private readonly apiUrl: string;
  private readonly timeout: number;

  constructor(apiUrl?: string, timeout = 30_000) {
    this.apiUrl = (apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, '');
    this.timeout = timeout;
  }

  /**
   * Fetch the public flow catalog (available flow types and prices).
   */
  async getFlowCatalog(): Promise<FlowCatalogItem[]> {
    const data = await jsonGet(this.apiUrl, '/flows', this.timeout);

    let rows: any[] = [];
    if (Array.isArray(data)) {
      rows = data;
    } else if (data?.flows && Array.isArray(data.flows)) {
      rows = data.flows;
    }

    return rows
      .filter((row: any) => row && typeof row === 'object')
      .map(catalogItemFromDict)
      .filter((item) => item.flowType);
  }

  /**
   * Get the price for a specific flow type.
   */
  async getFlowPrice(flowType: string): Promise<number> {
    if (!flowType) throw new Error('flowType is required');
    const catalog = await this.getFlowCatalog();
    const item = catalog.find((i) => i.flowType === flowType);
    if (!item) throw new APIError(404, `Flow ${flowType} not found in flow catalog`);
    if (item.priceUsd <= 0) throw new APIError(500, `Flow ${flowType} has invalid configured price`);
    return item.priceUsd;
  }

  /**
   * Launch a GPU job paid via x402 (USDC on Base chain).
   */
  async createJob(options: X402CreateJobOptions): Promise<X402JobLaunch> {
    const {
      amount, signer, image, command, gpuType = 'l40s', gpuCount = 1,
      region, constraints, interruptible = true, env, ports, auth, registryAuth,
    } = options;

    if (amount <= 0) throw new Error('amount must be greater than 0');

    const jobPayload: Record<string, any> = {
      docker_image: image,
      gpu_type: gpuType,
      gpu_count: gpuCount,
      interruptible,
      command: command ? btoa(command) : '',
    };
    if (region) jobPayload.region = region;
    if (constraints) jobPayload.constraints = constraints;
    if (env) jobPayload.env_vars = env;
    if (ports) jobPayload.ports = ports;
    if (auth) jobPayload.auth = auth;
    if (registryAuth) jobPayload.registry_auth = registryAuth;

    const data = await x402Post(this.apiUrl, '/api/x402/job', { amount, job: jobPayload }, signer, this.timeout);

    return {
      job: jobFromX402(data),
      accessKey: data.access_key ?? '',
      statusUrl: data.status_url ?? '',
      logsUrl: data.logs_url ?? '',
      cancelUrl: data.cancel_url ?? '',
    };
  }

  /**
   * Create a flow render paid via x402 (USDC on Base chain).
   */
  async createFlow(options: X402CreateFlowOptions): Promise<X402FlowCreate> {
    const { flowType, amount, signer, params, notifyUrl } = options;

    if (amount <= 0) throw new Error('amount must be greater than 0');
    if (!flowType) throw new Error('flowType is required');
    if (/[^a-zA-Z0-9_-]/.test(flowType)) throw new Error('flowType contains invalid characters');

    const payload: Record<string, any> = { ...(params ?? {}) };
    if (notifyUrl) payload.notify_url = notifyUrl;

    const data = await x402Post(this.apiUrl, `/api/x402/flow/${flowType}`, payload, signer, this.timeout);

    return {
      render: renderFromX402(data),
      accessKey: data.access_key ?? '',
      statusUrl: data.status_url ?? '',
      cancelUrl: data.cancel_url ?? '',
    };
  }
}
