/**
 * HTTP client utilities with retry logic
 */
import { APIError } from './errors.js';

export interface RequestOptions {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: any;
  params?: Record<string, string | number | Array<string | number>>;
  retries?: number;
  backoff?: number;
  timeout?: number;
  signal?: AbortSignal;
  retryStatuses?: readonly number[];
  rawBody?: boolean;
}

export type RequestOverrides = Pick<RequestOptions, 'retries' | 'backoff' | 'timeout' | 'signal' | 'retryStatuses'>;

const TRANSPORT_TIMEOUT_CODES = new Set([
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

function requestTimeoutError(timeout?: number, cause?: unknown): Error {
  const duration = timeout === undefined
    ? ""
    : ` after ${timeout % 1000 === 0 ? `${timeout / 1000} seconds` : `${timeout}ms`}`;
  const error = new Error(`Request timed out${duration}`);
  error.name = 'TimeoutError';
  if (cause !== undefined) Object.assign(error, { cause });
  return error;
}

function hasTransportTimeout(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 5; depth++) {
    if (!current || typeof current !== 'object') return false;
    const candidate = current as { code?: unknown; cause?: unknown };
    if (typeof candidate.code === 'string' && TRANSPORT_TIMEOUT_CODES.has(candidate.code)) return true;
    current = candidate.cause;
  }
  return false;
}

function waitForBackoff(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new Error('Request cancelled'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abortWait);
      resolve();
    }, delayMs);
    const abortWait = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abortWait);
      reject(signal?.reason ?? new Error('Request cancelled'));
    };
    signal?.addEventListener('abort', abortWait, { once: true });
  });
}

async function requestWithRetryHandled<T>(
  options: RequestOptions,
  handle: (response: Response, method?: string) => Promise<T>,
): Promise<T> {
  const {
    method,
    url,
    headers = {},
    body,
    params,
    retries = 3,
    backoff = 1.0,
    timeout = 30000,
    signal,
    retryStatuses = [],
    rawBody = false,
  } = options;

  // Build URL with query params
  let finalUrl = url;
  if (params) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        if (Array.isArray(value)) {
          for (const item of value) {
            if (item !== undefined && item !== null) {
              searchParams.append(key, String(item));
            }
          }
          continue;
        }
        searchParams.append(key, String(value));
      }
    }
    const queryString = searchParams.toString();
    if (queryString) {
      finalUrl = `${url}${url.includes('?') ? '&' : '?'}${queryString}`;
    }
  }

  let lastError: Error | undefined;

  for (let attempt = 0; attempt < retries; attempt++) {
    const controller = new AbortController();
    let abortSource: 'external' | 'timeout' | null = null;
    const abortRequest = () => {
      if (abortSource !== null) return;
      abortSource = 'external';
      controller.abort(signal?.reason);
    };
    const timeoutError = requestTimeoutError(timeout);
    const timeoutId = setTimeout(() => {
      if (abortSource !== null) return;
      abortSource = 'timeout';
      controller.abort(timeoutError);
    }, timeout);
    let responseReceived = false;
    let retry = false;
    try {
      if (signal?.aborted) abortRequest();
      signal?.addEventListener('abort', abortRequest, { once: true });

      const response = await fetch(finalUrl, {
        method,
        headers,
        body: body === undefined ? undefined : rawBody ? body : JSON.stringify(body),
        signal: controller.signal,
      });
      responseReceived = true;
      if (retryStatuses.includes(response.status) && attempt < retries - 1) {
        void response.body?.cancel().catch(() => undefined);
        retry = true;
      } else {
        return await handle(response, method);
      }
    } catch (error: any) {
      const transportTimedOut = hasTransportTimeout(error);
      const requestError = abortSource === 'timeout'
        ? timeoutError
        : transportTimedOut
          ? requestTimeoutError(undefined, error)
          : error;
      lastError = requestError;

      if (abortSource === 'external') throw signal?.reason ?? error;

      // Check if it's a transient error (network, timeout, etc.)
      const isTransient = !responseReceived && (
        abortSource === 'timeout' ||
        transportTimedOut ||
        error.name === 'AbortError' ||
        error.cause?.code === 'ECONNREFUSED' ||
        error.cause?.code === 'ECONNRESET' ||
        error.cause?.code === 'ETIMEDOUT'
      );

      if (isTransient && attempt < retries - 1) {
        retry = true;
      } else {
        throw requestError;
      }
    } finally {
      clearTimeout(timeoutId);
      signal?.removeEventListener('abort', abortRequest);
    }

    if (retry) {
      await waitForBackoff(backoff * (attempt + 1) * 1000, signal);
    }
  }

  throw lastError || new Error('Request failed');
}

/**
 * Make an HTTP request with retry logic for transient errors
 */
export async function requestWithRetry(options: RequestOptions): Promise<Response> {
  return requestWithRetryHandled(options, async (response) => response);
}

export async function responseAPIError(
  response: Response,
  method?: string,
  requestUrl?: string,
): Promise<APIError> {
  const fallback = response.statusText || 'Request failed';
  const url = response.url || requestUrl || undefined;
  let text: string;
  try {
    text = await response.text();
  } catch {
    return new APIError(response.status, fallback, method, url, '');
  }
  let detail = text || fallback;
  if (text) {
    try {
      const payload = JSON.parse(text) as { detail?: unknown };
      if (payload.detail !== undefined && payload.detail !== null) detail = String(payload.detail);
    } catch {
      // Plain-text error bodies are valid API responses.
    }
  }
  return new APIError(response.status, detail, method, url, text);
}

/**
 * Handle API response, raise on error
 */
async function handleResponse<T = any>(response: Response, method?: string): Promise<T> {
  if (response.status >= 400) {
    throw await responseAPIError(response, method);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

async function handleBytesResponse(response: Response, method?: string): Promise<Uint8Array> {
  if (response.status >= 400) {
    throw await responseAPIError(response, method);
  }

  return new Uint8Array(await response.arrayBuffer());
}

/**
 * HTTP Client for making authenticated requests to the API
 */
export class HTTPClient {
  private baseUrl: string;
  private apiKey: string;
  private timeout: number;

  constructor(baseUrl: string, apiKey: string, timeout: number = 30000) {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.apiKey = apiKey;
    this.timeout = timeout;
  }

  get base(): string {
    return this.baseUrl;
  }

  get credential(): string {
    return this.apiKey;
  }

  private get headers(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  async get<T = any>(
    path: string,
    params?: Record<string, string | number | Array<string | number>>,
    options: RequestOverrides = {},
  ): Promise<T> {
    return requestWithRetryHandled({
      method: 'GET',
      url: `${this.baseUrl}${path}`,
      headers: this.headers,
      params,
      timeout: options.timeout ?? this.timeout,
      retries: options.retries,
      backoff: options.backoff,
      signal: options.signal,
      retryStatuses: options.retryStatuses,
    }, handleResponse<T>);
  }

  async getWithHeaders<T = any>(
    path: string,
    params?: Record<string, string | number | Array<string | number>>,
    headers?: Record<string, string>,
  ): Promise<T> {
    return requestWithRetryHandled({
      method: 'GET',
      url: `${this.baseUrl}${path}`,
      headers: { ...this.headers, ...(headers ?? {}) },
      params,
      timeout: this.timeout,
    }, handleResponse<T>);
  }

  async post<T = any>(path: string, body?: any, options: RequestOverrides = {}): Promise<T> {
    return requestWithRetryHandled({
      method: 'POST',
      url: `${this.baseUrl}${path}`,
      headers: this.headers,
      body,
      timeout: options.timeout ?? this.timeout,
      retries: options.retries,
      backoff: options.backoff,
      signal: options.signal,
      retryStatuses: options.retryStatuses,
    }, handleResponse<T>);
  }

  async postBytes(path: string, body?: any, options: RequestOverrides = {}): Promise<Uint8Array> {
    return requestWithRetryHandled({
      method: 'POST',
      url: `${this.baseUrl}${path}`,
      headers: this.headers,
      body,
      timeout: options.timeout ?? this.timeout,
      retries: options.retries,
      backoff: options.backoff,
      signal: options.signal,
      retryStatuses: options.retryStatuses,
    }, handleBytesResponse);
  }

  async postRaw<T = any>(
    path: string,
    body: any,
    contentType: string,
    options: RequestOverrides = {},
  ): Promise<T> {
    return requestWithRetryHandled({
      method: 'POST',
      url: `${this.baseUrl}${path}`,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': contentType,
      },
      body,
      rawBody: true,
      timeout: options.timeout ?? this.timeout,
      retries: options.retries,
      backoff: options.backoff,
      signal: options.signal,
      retryStatuses: options.retryStatuses,
    }, handleResponse<T>);
  }

  async patch<T = any>(path: string, body?: any): Promise<T> {
    return requestWithRetryHandled({
      method: 'PATCH',
      url: `${this.baseUrl}${path}`,
      headers: this.headers,
      body,
      timeout: this.timeout,
    }, handleResponse<T>);
  }

  async put<T = any>(path: string, body?: any): Promise<T> {
    return requestWithRetryHandled({
      method: 'PUT',
      url: `${this.baseUrl}${path}`,
      headers: this.headers,
      body,
      timeout: this.timeout,
    }, handleResponse<T>);
  }

  async delete<T = any>(path: string): Promise<T> {
    return requestWithRetryHandled({
      method: 'DELETE',
      url: `${this.baseUrl}${path}`,
      headers: this.headers,
      timeout: this.timeout,
    }, handleResponse<T>);
  }

  /**
   * POST with multipart form data for file uploads
   */
  async postMultipart<T = any>(
    path: string,
    files: Record<string, { filename: string; content: Buffer; contentType: string }>,
    params?: Record<string, string>
  ): Promise<T> {
    const formData = new FormData();
    
    for (const [fieldName, file] of Object.entries(files)) {
      const blob = new Blob([file.content], { type: file.contentType });
      formData.append(fieldName, blob, file.filename);
    }

    // Build URL with params
    let url = `${this.baseUrl}${path}`;
    if (params) {
      const searchParams = new URLSearchParams(params);
      const queryString = searchParams.toString();
      if (queryString) {
        url = `${url}?${queryString}`;
      }
    }

    // Don't set Content-Type for multipart - fetch will set it with boundary
    const headers = {
      'Authorization': `Bearer ${this.apiKey}`,
    };

    return requestWithRetryHandled({
      method: 'POST',
      url,
      headers,
      body: formData as any,
      rawBody: true,
      timeout: this.timeout,
    }, handleResponse<T>);
  }

  /**
   * Streaming POST for SSE responses
   */
  async *streamPost(path: string, body?: any): AsyncGenerator<string> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: this.headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new APIError(response.status, text, 'POST', response.url || `${this.baseUrl}${path}`, text);
    }

    if (!response.body) {
      throw new Error('Response body is null');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim()) {
            yield line;
          }
        }
      }

      // Yield any remaining content in buffer
      if (buffer.trim()) {
        yield buffer;
      }
    } finally {
      reader.releaseLock();
    }
  }
}
