export const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i;

export function extractImagePath(tc: { name: string; args: string; result?: string }): string | null {
  try {
    const args = JSON.parse(tc.args);
    const path = args.file_path || args.path || "";
    if (typeof path === "string" && IMAGE_EXTENSIONS.test(path)) return path;
  } catch { /* ignore */ }
  return null;
}

export function encodePath(path: string): string {
  return path.split("/").filter(Boolean).map((part) => encodeURIComponent(part)).join("/");
}

export function formatRelativeTime(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function formatTime(ts?: number): string {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function truncateToLines(text: string, maxLines: number): { preview: string; truncated: boolean } {
  const lines = text.split("\n").slice(0, maxLines);
  const preview = lines.join("\n").trim();
  return { preview, truncated: text.split("\n").length > maxLines || text.length > preview.length + 50 };
}

/** Extract a human-readable summary from a tool arg/result string (may be JSON). */
export function extractReadableSummary(raw: string, maxLen: number): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        const texts = parsed
          .filter((b: unknown) => (b as Record<string, unknown>)?.type === "text" && typeof (b as Record<string, unknown>)?.text === "string")
          .map((b: unknown) => (b as Record<string, string>).text);
        if (texts.length > 0) {
          const joined = texts.join(" ").trim();
          return joined.length > maxLen ? `${joined.slice(0, maxLen)}…` : joined;
        }
      }
      if (typeof parsed === "object" && parsed !== null) {
        if (typeof parsed.error === "string") {
          const msg = `Error: ${parsed.error}`;
          return msg.length > maxLen ? `${msg.slice(0, maxLen)}…` : msg;
        }
        if (parsed.ok === true) return "Success";
        if (parsed.ok === false) return "Failed";
      }
    } catch { /* fall through to raw slice */ }
  }
  return trimmed.length > maxLen ? `${trimmed.slice(0, maxLen)}…` : trimmed;
}

const TOOL_ARG_SUMMARY_KEYS = ["command", "cmd", "query", "url", "pattern", "glob", "name"];
const TOOL_PATH_KEYS = new Set(["path", "file_path", "filePath", "fullPath"]);

function parseJsonRecord(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function clipSummary(value: string, maxLen: number): string {
  const singleLine = value.replace(/\s+/g, " ").trim();
  return singleLine.length > maxLen ? `${singleLine.slice(0, maxLen).trimEnd()}…` : singleLine;
}

function scalarSummary(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function summarizeStructuredArgs(raw: string, maxLen: number): string {
  const trimmed = raw.trim();
  if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) return "";

  const record = parseJsonRecord(trimmed);
  if (!record) return "";

  try {
    for (const key of TOOL_ARG_SUMMARY_KEYS) {
      const value = scalarSummary(record[key]);
      if (!value) continue;
      if (key === "command" || key === "cmd") return clipSummary(`$ ${value}`, maxLen);
      return clipSummary(`${key}: ${value}`, maxLen);
    }

    for (const key of TOOL_PATH_KEYS) {
      if (scalarSummary(record[key])) return "path provided";
    }

    const entries = Object.entries(record)
      .filter(([key, value]) => !TOOL_PATH_KEYS.has(key) && scalarSummary(value))
      .slice(0, 2)
      .map(([key, value]) => `${key}: ${scalarSummary(value)}`);

    return entries.length > 0 ? clipSummary(entries.join(" · "), maxLen) : "";
  } catch {
    return "";
  }
}

function summarizeStructuredResult(raw: string, maxLen: number): string {
  const trimmed = raw.trim();
  if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) return "";

  const record = parseJsonRecord(trimmed);
  if (!record) return "";

  try {
    if (typeof record.error === "string" && record.error.trim()) return clipSummary(`Error: ${record.error}`, maxLen);
    if (record.ok === true) return "Success";
    if (record.ok === false) return "Failed";
    return "";
  } catch {
    return "";
  }
}

export function toolCallSummary(tc: { name: string; args: string; result?: string }): string {
  const argsSummary = summarizeStructuredArgs(tc.args, 120);
  if (argsSummary) return argsSummary;

  if (tc.result !== undefined) {
    return summarizeStructuredResult(tc.result, 100) || "Result ready";
  }

  return tc.args.trim() ? "Arguments ready" : "";
}

function argRecordForToolCall(tc: { args: string }): Record<string, unknown> | null {
  return parseJsonRecord(tc.args);
}

export function toolCallArgsLabel(tc: { args: string }): string {
  const record = argRecordForToolCall(tc);
  if (!record) return "Arguments";

  if (scalarSummary(record.command) || scalarSummary(record.cmd)) return "Command";
  if (scalarSummary(record.query)) return "Query";
  if (scalarSummary(record.url)) return "URL";
  if (scalarSummary(record.pattern) || scalarSummary(record.glob)) return "Pattern";
  if (Array.from(TOOL_PATH_KEYS).some((key) => scalarSummary(record[key]))) return "Path";
  return "Arguments";
}

export function toolCallResultLabel(tc: { args: string; result?: string }): string {
  const resultRecord = tc.result !== undefined ? parseJsonRecord(tc.result) : null;
  if (typeof resultRecord?.error === "string" && resultRecord.error.trim()) return "Error";

  const argsRecord = argRecordForToolCall(tc);
  if (!argsRecord) return "Result";

  if (scalarSummary(argsRecord.command) || scalarSummary(argsRecord.cmd)) return "Command output";
  if (scalarSummary(argsRecord.query)) return "Search results";
  if (scalarSummary(argsRecord.url)) return "Fetch result";
  return "Result";
}

export function formatToolDetail(raw: string, maxLen: number): { text: string; clipped: boolean } {
  const trimmed = raw.trim();
  if (!trimmed) return { text: "", clipped: false };

  let display = trimmed;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        const textBlocks = parsed
          .filter((entry: unknown) => (entry as Record<string, unknown>)?.type === "text" && typeof (entry as Record<string, unknown>)?.text === "string")
          .map((entry: unknown) => (entry as Record<string, string>).text.trim())
          .filter(Boolean);
        display = textBlocks.length > 0 ? textBlocks.join("\n\n") : JSON.stringify(parsed, null, 2);
      } else if (parsed && typeof parsed === "object") {
        const record = parsed as Record<string, unknown>;
        const command = scalarSummary(record.command) || scalarSummary(record.cmd);
        display = command || JSON.stringify(parsed, null, 2);
      } else {
        display = JSON.stringify(parsed, null, 2);
      }
    } catch {
      display = trimmed;
    }
  }

  if (display.length <= maxLen) return { text: display, clipped: false };
  return { text: `${display.slice(0, maxLen).trimEnd()}\n... clipped`, clipped: true };
}

export const THINKING_PREVIEW_LINES = 2;
