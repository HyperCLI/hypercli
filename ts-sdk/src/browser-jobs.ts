import type { HTTPClient } from './http.js';
import {
  jobFromDict,
  jobListPageFromDict,
  jobMetricsFromDict,
  lifecycleEventFromDict,
  normalizeTags,
  type Job,
  type JobLifecycleEvent,
  type JobListPage,
  type JobMetrics,
} from './job-codecs.js';
import type { ListJobsOptions } from './jobs.js';

type BrowserWebSocket = {
  close: () => void;
  addEventListener?: (type: string, listener: (event: any) => void, options?: any) => void;
  removeEventListener?: (type: string, listener: (event: any) => void) => void;
  onmessage?: ((event: any) => void) | null;
  onclose?: ((event: any) => void) | null;
  onerror?: ((event: any) => void) | null;
};

type BrowserWebSocketConstructor = new (url: string) => BrowserWebSocket;

function getBrowserWebSocket(): BrowserWebSocketConstructor {
  const ctor = (globalThis as typeof globalThis & { WebSocket?: BrowserWebSocketConstructor }).WebSocket;
  if (!ctor) throw new Error('WebSocket is not available in this browser environment');
  return ctor;
}

function productWsBase(http: HTTPClient): string {
  return http.base
    .replace('https://', 'wss://')
    .replace('http://', 'ws://')
    .replace(/\/api$/, '');
}

function buildListParams(options: ListJobsOptions = {}): Record<string, string | number | string[]> {
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

function addSocketListener(socket: BrowserWebSocket, type: string, listener: (event: any) => void): () => void {
  if (socket.addEventListener) {
    socket.addEventListener(type, listener);
    return () => socket.removeEventListener?.(type, listener);
  }
  const key = `on${type}` as 'onmessage' | 'onclose' | 'onerror';
  const previous = socket[key];
  const wrapped = (event: any) => {
    previous?.(event);
    listener(event);
  };
  socket[key] = wrapped;
  return () => {
    if (socket[key] === wrapped) socket[key] = previous ?? null;
  };
}

function frameText(data: unknown): string {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  }
  throw new Error('unsupported WebSocket frame type');
}

async function* websocketJsonStream<T>(
  url: string,
  parseFrame: (frame: any) => T | undefined,
): AsyncGenerator<T> {
  const SocketCtor = getBrowserWebSocket();
  const socket = new SocketCtor(url);
  const queue: T[] = [];
  const cleanups: Array<() => void> = [];
  let done = false;
  let failed: Error | null = null;
  let pending: ((value: IteratorResult<T>) => void) | null = null;
  let rejectPending: ((error: Error) => void) | null = null;

  const resolveNext = (value: T) => {
    if (pending) {
      pending({ done: false, value });
      pending = null;
      rejectPending = null;
    } else {
      queue.push(value);
    }
  };

  const fail = (error: Error) => {
    failed = error;
    done = true;
    if (rejectPending) {
      rejectPending(error);
      pending = null;
      rejectPending = null;
    }
  };

  cleanups.push(addSocketListener(socket, 'message', (event) => {
    try {
      const parsed = JSON.parse(frameText(event.data));
      const value = parseFrame(parsed);
      if (value !== undefined) resolveNext(value);
    } catch (error) {
      fail(error instanceof Error ? error : new Error('invalid WebSocket frame'));
    }
  }));
  cleanups.push(addSocketListener(socket, 'close', () => {
    done = true;
    if (pending) {
      pending({ done: true, value: undefined });
      pending = null;
      rejectPending = null;
    }
  }));
  cleanups.push(addSocketListener(socket, 'error', () => {
    fail(new Error('WebSocket connection failed'));
  }));

  try {
    while (!done || queue.length > 0) {
      if (failed) throw failed;
      const value = queue.shift();
      if (value) {
        yield value;
        continue;
      }
      const result = await new Promise<IteratorResult<T>>((resolve, reject) => {
        pending = resolve;
        rejectPending = reject;
      });
      if (result.done) break;
      yield result.value;
    }
  } finally {
    for (const cleanup of cleanups) cleanup();
    socket.close();
  }
}

/**
 * Browser-safe GPU jobs API. It intentionally omits Node-only exec/shell
 * helpers, but keeps REST job operations and lifecycle/metrics WebSockets.
 */
export class BrowserJobs {
  constructor(private http: HTTPClient) {}

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
    const data = await this.http.get('/api/jobs', buildListParams(options));
    if (typeof data === 'object' && data && Array.isArray(data.jobs)) {
      return jobListPageFromDict(data, options.page ?? 1, options.pageSize ?? 50);
    }
    const jobs = (data || []).map(jobFromDict);
    return {
      jobs,
      totalCount: jobs.length,
      page: options.page ?? 1,
      pageSize: options.pageSize ?? (jobs.length || 50),
    };
  }

  async get(jobId: string): Promise<Job> {
    const data = await this.http.get(`/api/jobs/${jobId}`);
    return jobFromDict(data);
  }

  async cancel(jobId: string): Promise<any> {
    return await this.http.delete(`/api/jobs/${jobId}`);
  }

  async extend(jobId: string, runtime: number): Promise<Job> {
    const data = await this.http.patch(`/api/jobs/${jobId}`, { runtime });
    return jobFromDict(data);
  }

  async logs(jobId: string): Promise<string> {
    const data = await this.http.get(`/api/jobs/${jobId}/logs`);
    return data.logs || '';
  }

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
    const url = `${productWsBase(this.http)}/orchestra/ws/metrics/jobs/${encodeURIComponent(job.jobKey)}?interval=${encodeURIComponent(String(interval))}`;

    yield* websocketJsonStream(url, (parsed) => {
      if (parsed?.event === 'metrics_error') {
        throw new Error(String(parsed.detail || 'metrics stream failed'));
      }
      if (parsed?.event !== 'metrics_snapshot') return undefined;
      return jobMetricsFromDict(parsed.data || {});
    });
  }

  async *lifecycleStream(jobId: string): AsyncGenerator<JobLifecycleEvent> {
    const job = await this.get(jobId);
    const url = `${productWsBase(this.http)}/orchestra/ws/lifecycle/${encodeURIComponent(job.jobKey)}`;
    yield* websocketJsonStream(url, lifecycleEventFromDict);
  }
}
