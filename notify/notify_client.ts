const DEFAULT_BASE_URL = String(process.env.NOTIFY_URL || "").trim();
const DEFAULT_API_KEY = String(process.env.NOTIFY_API_KEY || "").trim();
const DEFAULT_TIMEOUT_MS = Number(process.env.NOTIFY_TIMEOUT || "5") * 1000;

export type NotifyOptions = {
  severity?: "info" | "warning" | "error" | string;
  version?: "v1" | string;
  threadId?: string;
  media?: string;
  mediaFilename?: string;
  mediaUrl?: string;
  baseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
};

export type FetchLogsOptions = {
  baseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
  limit?: number;
};

function buildUrl(baseUrl: string, category: string): string {
  return `${String(baseUrl || "").replace(/\/+$/, "")}/${encodeURIComponent(category)}`;
}

function buildLogsUrl(baseUrl: string, limit: number): string {
  let rootUrl = String(baseUrl || "").replace(/\/+$/, "");
  if (rootUrl.endsWith("/notify")) {
    rootUrl = rootUrl.slice(0, -"/notify".length);
  }
  return `${rootUrl}/logs?limit=${limit}`;
}

function buildPayload(lines: string[], options: NotifyOptions = {}): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    lines,
    severity: options.severity ?? "info",
  };
  if (options.version !== undefined) payload.version = options.version;
  if (options.threadId !== undefined) payload.thread_id = options.threadId;
  if (options.media !== undefined) payload.media = options.media;
  if (options.mediaFilename !== undefined) payload.media_filename = options.mediaFilename;
  if (options.mediaUrl !== undefined) payload.media_url = options.mediaUrl;
  return payload;
}

function normalizeLines(lines: string[] | string): string[] {
  return Array.isArray(lines) ? lines : String(lines).split("\n");
}

function logBackgroundFailure(error: unknown): void {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.warn(`Background notify failed: ${message}`);
}

export async function send(category: string, lines: string[] | string, options: NotifyOptions = {}): Promise<any | null> {
  const baseUrl = String(options.baseUrl ?? DEFAULT_BASE_URL).trim();
  const apiKey = String(options.apiKey ?? DEFAULT_API_KEY).trim();
  if (!baseUrl || !apiKey) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(buildUrl(baseUrl, category), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-BACKEND-API-KEY": apiKey,
      },
      body: JSON.stringify(buildPayload(normalizeLines(lines), options)),
      signal: controller.signal,
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : {};
    if (!response.ok) {
      throw new Error(`Notify failed: HTTP ${response.status} ${text}`);
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

export async function error(lines: string[] | string, options: NotifyOptions = {}): Promise<any | null> {
  return send("error", lines, { ...options, severity: options.severity ?? "error" });
}

export async function warning(lines: string[] | string, options: NotifyOptions = {}): Promise<any | null> {
  return send("warning", lines, { ...options, severity: options.severity ?? "warning" });
}

export async function info(lines: string[] | string, options: NotifyOptions = {}): Promise<any | null> {
  return send("info", lines, { ...options, severity: options.severity ?? "info" });
}

export function sendBackground(category: string, lines: string[] | string, options: NotifyOptions = {}): void {
  void send(category, lines, options).catch(logBackgroundFailure);
}

export function errorBackground(lines: string[] | string, options: NotifyOptions = {}): void {
  sendBackground("error", lines, { ...options, severity: options.severity ?? "error" });
}

export function warningBackground(lines: string[] | string, options: NotifyOptions = {}): void {
  sendBackground("warning", lines, { ...options, severity: options.severity ?? "warning" });
}

export function infoBackground(lines: string[] | string, options: NotifyOptions = {}): void {
  sendBackground("info", lines, { ...options, severity: options.severity ?? "info" });
}

export async function fetchLogs(options: FetchLogsOptions = {}): Promise<any | null> {
  const baseUrl = String(options.baseUrl ?? DEFAULT_BASE_URL).trim();
  const apiKey = String(options.apiKey ?? DEFAULT_API_KEY).trim();
  if (!baseUrl || !apiKey) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const limit = options.limit ?? 100;
  try {
    const response = await fetch(buildLogsUrl(baseUrl, limit), {
      method: "GET",
      headers: {
        "X-BACKEND-API-KEY": apiKey,
      },
      signal: controller.signal,
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : {};
    if (!response.ok) {
      throw new Error(`Fetch logs failed: HTTP ${response.status} ${text}`);
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

export const notify = {
  send,
  sendBackground,
  error,
  errorBackground,
  warning,
  warningBackground,
  info,
  infoBackground,
  fetchLogs,
};

function consumeOption(argv: string[], index: number): [string, number] {
  const value = argv[index + 1];
  if (value === undefined) {
    throw new Error(`missing value for ${argv[index]}`);
  }
  return [value, index + 2];
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === "send") {
    if (rest.length < 2) {
      throw new Error("usage: notify_client.ts send <category> <line> [line ...] [--severity <level>]");
    }

    const category = rest[0];
    const lines: string[] = [];
    const options: NotifyOptions = {};
    let i = 1;
    while (i < rest.length) {
      const token = rest[i];
      if (!token.startsWith("--")) {
        lines.push(token);
        i += 1;
        continue;
      }
      switch (token) {
        case "--severity":
          [options.severity, i] = consumeOption(rest, i);
          break;
        case "--version":
          [options.version, i] = consumeOption(rest, i);
          break;
        case "--thread-id":
          [options.threadId, i] = consumeOption(rest, i);
          break;
        case "--media":
          [options.media, i] = consumeOption(rest, i);
          break;
        case "--media-filename":
          [options.mediaFilename, i] = consumeOption(rest, i);
          break;
        case "--media-url":
          [options.mediaUrl, i] = consumeOption(rest, i);
          break;
        case "--base-url":
          [options.baseUrl, i] = consumeOption(rest, i);
          break;
        case "--api-key":
          [options.apiKey, i] = consumeOption(rest, i);
          break;
        case "--timeout-ms": {
          const rawTimeout: string | undefined = consumeOption(rest, i)[0];
          options.timeoutMs = Number(rawTimeout);
          if (!Number.isFinite(options.timeoutMs)) {
            throw new Error("--timeout-ms must be numeric");
          }
          i += 2;
          break;
        }
        default:
          throw new Error(`unknown option: ${token}`);
      }
    }
    if (lines.length === 0) {
      throw new Error("send requires at least one line");
    }
    const result = await send(category, lines.length === 1 ? lines[0] : lines, options);
    console.log(JSON.stringify(result ?? {}, null, 0));
    return 0;
  }

  if (command === "logs") {
    const options: FetchLogsOptions = {};
    let i = 0;
    while (i < rest.length) {
      const token = rest[i];
      switch (token) {
        case "--limit": {
          const rawLimit: string | undefined = consumeOption(rest, i)[0];
          options.limit = Number(rawLimit);
          if (!Number.isFinite(options.limit)) {
            throw new Error("--limit must be numeric");
          }
          i += 2;
          break;
        }
        case "--base-url":
          [options.baseUrl, i] = consumeOption(rest, i);
          break;
        case "--api-key":
          [options.apiKey, i] = consumeOption(rest, i);
          break;
        case "--timeout-ms": {
          const rawTimeout: string | undefined = consumeOption(rest, i)[0];
          options.timeoutMs = Number(rawTimeout);
          if (!Number.isFinite(options.timeoutMs)) {
            throw new Error("--timeout-ms must be numeric");
          }
          i += 2;
          break;
        }
        default:
          throw new Error(`unknown option: ${token}`);
      }
    }
    const result = await fetchLogs(options);
    console.log(JSON.stringify(result ?? {}, null, 0));
    return 0;
  }

  throw new Error("usage: notify_client.ts <send|logs> ...");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(message);
      process.exit(1);
    },
  );
}
