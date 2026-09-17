/**
 * Async log streaming for jobs using WebSocket
 */
import WebSocket from 'ws';
import type { HyperCLI } from './client.js';
import { getWsUrl, WS_LOGS_PATH } from './config.js';

// Default limits to prevent memory blowup
const DEFAULT_MAX_INITIAL_LINES = 1000;
const DEFAULT_MAX_BUFFER = 5000;

/**
 * Fetch logs via REST API (one-time call)
 */
export async function fetchLogs(
  client: HyperCLI,
  jobId: string,
  tail?: number
): Promise<string[]> {
  try {
    const logs = await client.jobs.logs(jobId);
    if (!logs) {
      return [];
    }
    const lines = logs.trim().split('\n');
    if (tail && lines.length > tail) {
      return lines.slice(-tail);
    }
    return lines;
  } catch {
    return [];
  }
}

/**
 * Async log streamer - WebSocket streaming with optional initial fetch
 */
export class LogStream {
  private ws: WebSocket | null = null;
  private buffer: string[] = [];
  private initialFetched = false;
  private connected = false;
  private closed = false;

  constructor(
    private client: HyperCLI,
    private jobId: string,
    private jobKey?: string,
    private fetchInitial: boolean = true,
    private maxInitialLines: number = DEFAULT_MAX_INITIAL_LINES,
    private maxBuffer: number = DEFAULT_MAX_BUFFER
  ) {}

  get status(): 'disconnected' | 'connecting' | 'connected' | 'closed' {
    if (this.closed) return 'closed';
    if (this.connected) return 'connected';
    if (this.ws) return 'connecting';
    return 'disconnected';
  }

  /**
   * Connect to log stream. Returns initial logs if fetchInitial=true.
   */
  async connect(): Promise<string[]> {
    if (this.closed) {
      throw new Error('LogStream is closed');
    }

    const initialLines: string[] = [];

    // Fetch initial logs ONCE (bounded)
    if (this.fetchInitial && !this.initialFetched) {
      const logs = await fetchLogs(this.client, this.jobId, this.maxInitialLines);
      for (const line of logs) {
        this.buffer.push(line);
        if (this.buffer.length > this.maxBuffer) {
          this.buffer.shift(); // Remove oldest
        }
      }
      initialLines.push(...logs);
      this.initialFetched = true;
    }

    // Get job_key if not provided
    if (!this.jobKey) {
      const job = await this.client.jobs.get(this.jobId);
      this.jobKey = job.jobKey;
    }

    // Connect WebSocket
    if (this.jobKey && !this.ws) {
      const wsUrl = getWsUrl();
      const fullUrl = `${wsUrl}${WS_LOGS_PATH}/${this.jobKey}`;

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('WebSocket connection timeout'));
        }, 30000);

        this.ws = new WebSocket(fullUrl);

        this.ws.on('open', () => {
          clearTimeout(timeout);
          this.connected = true;
          resolve();
        });

        this.ws.on('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });
    }

    return initialLines;
  }

  /**
   * Close the WebSocket connection
   */
  async close(): Promise<void> {
    this.closed = true;
    this.connected = false;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Get current buffer contents (bounded, oldest may be dropped)
   */
  getBuffer(): string[] {
    return [...this.buffer];
  }

  /**
   * Clear the buffer
   */
  clearBuffer(): void {
    this.buffer = [];
  }

  /**
   * Async iterate over NEW log lines from WebSocket
   */
  async *[Symbol.asyncIterator](): AsyncGenerator<string> {
    if (!this.ws) {
      throw new Error('Not connected. Call connect() first.');
    }

    const messageQueue: string[] = [];
    let resolveNext: ((value: IteratorResult<string>) => void) | null = null;
    let rejectNext: ((error: Error) => void) | null = null;

    this.ws.on('message', (data: Buffer) => {
      if (this.closed) return;

      try {
        const message = JSON.parse(data.toString());
        if (message.event === 'log' && message.log) {
          for (const line of message.log.split('\n')) {
            if (line) {
              this.buffer.push(line);
              if (this.buffer.length > this.maxBuffer) {
                this.buffer.shift();
              }

              if (resolveNext) {
                resolveNext({ done: false, value: line });
                resolveNext = null;
              } else {
                messageQueue.push(line);
              }
            }
          }
        }
      } catch {
        // Ignore JSON parse errors
      }
    });

    this.ws.on('close', () => {
      this.connected = false;
      if (resolveNext) {
        resolveNext({ done: true, value: undefined });
        resolveNext = null;
      }
    });

    this.ws.on('error', (error: Error) => {
      if (rejectNext) {
        rejectNext(error);
        rejectNext = null;
      }
    });

    while (!this.closed) {
      if (messageQueue.length > 0) {
        yield messageQueue.shift()!;
      } else {
        // Wait for next message
        const result = await new Promise<IteratorResult<string>>((resolve, reject) => {
          resolveNext = resolve;
          rejectNext = reject;
        });

        if (result.done) {
          break;
        }

        yield result.value;
      }
    }
  }
}

/**
 * Stream logs until job reaches a terminal state
 */
export async function streamLogs(
  client: HyperCLI,
  jobId: string,
  onLine: (line: string) => void,
  options?: {
    untilState?: Set<string>;
    pollStateInterval?: number;
    fetchInitial?: boolean;
    fetchFinal?: boolean;
    maxInitialLines?: number;
  }
): Promise<void> {
  const {
    untilState = new Set(['succeeded', 'failed', 'canceled', 'terminated']),
    pollStateInterval = 2000,
    fetchInitial = true,
    fetchFinal = true,
    maxInitialLines = DEFAULT_MAX_INITIAL_LINES,
  } = options || {};

  let job = await client.jobs.get(jobId);

  // Wait for job to be assigned/running
  while (job.state === 'pending' || job.state === 'queued') {
    await new Promise(resolve => setTimeout(resolve, pollStateInterval));
    job = await client.jobs.get(jobId);
  }

  // Check for immediate terminal state
  if (untilState.has(job.state)) {
    if (fetchFinal) {
      const logs = await fetchLogs(client, jobId, maxInitialLines);
      for (const line of logs) {
        onLine(line);
      }
    }
    return;
  }

  // Fetch initial logs if running
  if (fetchInitial && job.state === 'running') {
    const logs = await fetchLogs(client, jobId, maxInitialLines);
    for (const line of logs) {
      onLine(line);
    }
  }

  // Connect WebSocket
  if (job.jobKey) {
    const stream = new LogStream(client, jobId, job.jobKey, false);
    await stream.connect();

    try {
      // Stream logs while checking job state periodically
      const checkInterval = setInterval(async () => {
        job = await client.jobs.get(jobId);
        if (untilState.has(job.state)) {
          await stream.close();
        }
      }, pollStateInterval);

      for await (const line of stream) {
        onLine(line);
      }

      clearInterval(checkInterval);
    } finally {
      await stream.close();
    }
  }

  // Fetch final logs
  if (fetchFinal) {
    await new Promise(resolve => setTimeout(resolve, 500));
    const logs = await fetchLogs(client, jobId, maxInitialLines);
    for (const line of logs) {
      onLine(line);
    }
  }
}
