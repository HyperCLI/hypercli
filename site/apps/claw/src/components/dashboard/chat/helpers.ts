import { isImageFileReference } from "@hypercli/shared-ui/files";

const TOOL_NAME_OVERRIDES: Record<string, string> = {
  bash: "Shell",
  exec: "Shell",
  fetch_url: "Fetch URL",
  file_read: "Read File",
  list_files: "List Files",
  memory_search: "Memory Search",
  read_file: "Read File",
  run_command: "Run Command",
  search_docs: "Docs Search",
  search_memory: "Memory Search",
  shell_exec: "Shell Exec",
  web_fetch: "Web Fetch",
  web_search: "Web Search",
  write_file: "Write File",
};

const TOOL_NAME_ACRONYMS = new Map([
  ["api", "API"],
  ["cli", "CLI"],
  ["csv", "CSV"],
  ["html", "HTML"],
  ["id", "ID"],
  ["json", "JSON"],
  ["pdf", "PDF"],
  ["sql", "SQL"],
  ["url", "URL"],
  ["xml", "XML"],
]);

export function formatToolName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "Tool";

  const normalized = trimmed
    .replace(/^(?:function|functions|tool|tools)\./i, "")
    .replace(/[:#].*$/, "");
  const override = TOOL_NAME_OVERRIDES[normalized] ?? TOOL_NAME_OVERRIDES[normalized.toLowerCase()];
  if (override) return override;

  const spaced = normalized
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!spaced) return trimmed;

  return spaced
    .split(" ")
    .map((word) => {
      const lower = word.toLowerCase();
      return TOOL_NAME_ACRONYMS.get(lower) ?? `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`;
    })
    .join(" ");
}

export function extractImagePath(tc: { name: string; args: string; result?: string }): string | null {
  try {
    const args = JSON.parse(tc.args);
    const path = args.file_path || args.path || "";
    if (typeof path === "string" && isImageFileReference(path)) return path;
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

export type ToolCallViewStatus = "running" | "done" | "failed" | "called";

export interface ToolCallViewSection {
  label: string;
  text: string;
  clipped: boolean;
  code: boolean;
}

export interface ToolCallView {
  displayName: string;
  rawName: string;
  title: string | undefined;
  status: ToolCallViewStatus;
  statusLabel: string;
  hasResult: boolean;
  isRunning: boolean;
  isFailed: boolean;
  summary: string;
  argsSection: ToolCallViewSection | null;
  resultSection: ToolCallViewSection | null;
  sections: ToolCallViewSection[];
}

export interface ToolCallStackView {
  status: ToolCallViewStatus;
  statusLabel: string;
  isRunning: boolean;
  isFailed: boolean;
  allReturned: boolean;
  pendingCount: number;
  returnedCount: number;
  failedCount: number;
  summary: string;
  progressText: string;
  progressPercent: number;
}

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

function asToolRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function parseJsonValue(raw: string): { value: unknown; prefixedError: boolean } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const errorMatch = trimmed.match(/^Error:\s*([\s\S]+)$/i);
  const candidate = errorMatch ? errorMatch[1].trim() : trimmed;
  if (!candidate.startsWith("{") && !candidate.startsWith("[")) return null;

  try {
    return { value: JSON.parse(candidate), prefixedError: Boolean(errorMatch) };
  } catch {
    return null;
  }
}

function extractContentBlockTexts(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => extractContentBlockTexts(entry));
  }

  const record = asToolRecord(value);
  if (!record) return [];

  const type = typeof record.type === "string" ? record.type.trim().toLowerCase() : "";
  if (type === "text" && typeof record.text === "string" && record.text.trim()) {
    return [record.text.trim()];
  }

  return extractContentBlockTexts(record.content);
}

function extractToolErrorMessage(value: unknown): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    const parsed = parseJsonValue(trimmed);
    if (parsed) return extractToolErrorMessage(parsed.value);
    const errorMatch = trimmed.match(/^Error:\s*(.+)$/is);
    return errorMatch?.[1]?.trim() ?? "";
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const message = extractToolErrorMessage(entry);
      if (message) return message;
    }
    return "";
  }

  const record = asToolRecord(value);
  if (!record) return "";

  const directError = scalarSummary(record.error);
  if (directError) return directError;

  const status = scalarSummary(record.status).toLowerCase();
  if (status === "error" || status === "failed") {
    const message = scalarSummary(record.message) || scalarSummary(record.detail);
    if (message) return message;
  }

  for (const text of extractContentBlockTexts(record)) {
    const message = extractToolErrorMessage(text);
    if (message) return message;
  }

  return "";
}

function looksCodeLikeDetail(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return (
    /^[{[]/.test(trimmed) ||
    /^[$>]\s/.test(trimmed) ||
    /(?:^|\n)\s*(?:total\s+\d+|PASS\b|FAIL\b|Traceback\b|[-dl][rwx-]{9}\b)/.test(trimmed)
  );
}

function formatContentBlockText(text: string): { text: string; code: boolean } {
  const parsed = parseJsonValue(text);
  if (parsed) {
    const formatted = formatParsedToolValue(parsed.value, parsed.prefixedError);
    if (formatted) return formatted;
    return { text: JSON.stringify(parsed.value, null, 2), code: true };
  }
  return { text: text.trim(), code: looksCodeLikeDetail(text) };
}

function formatParsedToolValue(value: unknown, prefixedError = false): { text: string; code: boolean } | null {
  const errorMessage = extractToolErrorMessage(value);
  if (errorMessage) return { text: `Error: ${errorMessage}`, code: false };

  const contentTexts = extractContentBlockTexts(value).map(formatContentBlockText).filter((entry) => entry.text);
  if (contentTexts.length > 0) {
    return {
      text: contentTexts.map((entry) => entry.text).join("\n\n"),
      code: contentTexts.every((entry) => entry.code),
    };
  }

  const record = asToolRecord(value);
  if (!record) return null;

  const command = scalarSummary(record.command) || scalarSummary(record.cmd);
  if (command) return { text: command, code: true };

  for (const key of ["query", "url", "name"] as const) {
    const scalar = scalarSummary(record[key]);
    if (scalar) return { text: scalar, code: false };
  }

  for (const key of ["pattern", "glob"] as const) {
    const scalar = scalarSummary(record[key]);
    if (scalar) return { text: scalar, code: true };
  }

  for (const key of TOOL_PATH_KEYS) {
    const scalar = scalarSummary(record[key]);
    if (scalar) return { text: scalar, code: true };
  }

  if (record.ok === true) return { text: "Success", code: false };
  if (record.ok === false || prefixedError) return { text: "Error", code: false };

  return null;
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
      if (key === "query" || key === "url" || key === "name") return clipSummary(value, maxLen);
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
  if (!trimmed) return "";

  const parsed = parseJsonValue(trimmed);
  if (!parsed) return /^Error:\s*/i.test(trimmed) ? clipSummary(trimmed, maxLen) : "";

  try {
    const errorMessage = extractToolErrorMessage(parsed.value);
    if (errorMessage) return clipSummary(`Error: ${errorMessage}`, maxLen);
    const record = asToolRecord(parsed.value);
    if (!record) return "";
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
  const result = tc.result?.trim() ?? "";
  const parsedResult = result ? parseJsonValue(result) : null;
  if (result.startsWith("Error:") || parsedResult?.prefixedError || (parsedResult && extractToolErrorMessage(parsedResult.value))) return "Error";

  const argsRecord = argRecordForToolCall(tc);
  if (!argsRecord) return "Result";

  if (scalarSummary(argsRecord.command) || scalarSummary(argsRecord.cmd)) return "Command output";
  if (scalarSummary(argsRecord.query)) return "Search results";
  if (scalarSummary(argsRecord.url)) return "Fetch result";
  return "Result";
}

export function formatToolDetail(raw: string, maxLen: number): { text: string; clipped: boolean; code: boolean } {
  const trimmed = raw.trim();
  if (!trimmed) return { text: "", clipped: false, code: false };

  let display = trimmed;
  let code = looksCodeLikeDetail(trimmed);
  const parsed = parseJsonValue(trimmed);
  if (parsed) {
    const formatted = formatParsedToolValue(parsed.value, parsed.prefixedError);
    if (formatted) {
      display = formatted.text;
      code = formatted.code;
    } else {
      display = JSON.stringify(parsed.value, null, 2);
      code = true;
    }
  }

  if (display.length <= maxLen) return { text: display, clipped: false, code };
  return { text: `${display.slice(0, maxLen).trimEnd()}\n... clipped`, clipped: true, code };
}

export function isToolCallFailed(tc: { result?: string }): boolean {
  const result = tc.result?.trim() ?? "";
  if (!result) return false;
  if (/^Error(?:\b|:)/i.test(result)) return true;

  const parsed = parseJsonValue(result);
  if (!parsed) return false;
  if (parsed.prefixedError) return true;
  if (extractToolErrorMessage(parsed.value)) return true;

  const record = asToolRecord(parsed.value);
  const status = scalarSummary(record?.status).toLowerCase();
  return record?.ok === false || status === "error" || status === "failed";
}

function toolCallStatusLabel(status: ToolCallViewStatus): string {
  if (status === "running") return "Running";
  if (status === "done") return "Done";
  if (status === "failed") return "Failed";
  return "Called";
}

export function buildToolCallView(
  tc: { id?: string; name: string; args: string; result?: string },
  options: { isStreaming?: boolean; pendingTimedOut?: boolean; argsMaxLen?: number; resultMaxLen?: number } = {},
): ToolCallView {
  const hasResult = tc.result !== undefined;
  const isRunning = !hasResult && options.isStreaming === true && options.pendingTimedOut !== true;
  const isFailed = hasResult && isToolCallFailed(tc);
  const status: ToolCallViewStatus = isRunning ? "running" : isFailed ? "failed" : hasResult ? "done" : "called";
  const displayName = formatToolName(tc.name);
  const argsDetail = formatToolDetail(tc.args, options.argsMaxLen ?? 280);
  const resultDetail = tc.result !== undefined ? formatToolDetail(tc.result, options.resultMaxLen ?? 520) : null;
  const argsSection = argsDetail.text
    ? { label: toolCallArgsLabel(tc), ...argsDetail }
    : null;
  const resultSection = resultDetail?.text
    ? { label: toolCallResultLabel(tc), ...resultDetail }
    : null;
  const sections = [argsSection, resultSection].filter((section): section is ToolCallViewSection => Boolean(section));

  return {
    displayName,
    rawName: tc.name,
    title: displayName === tc.name ? undefined : tc.name,
    status,
    statusLabel: toolCallStatusLabel(status),
    hasResult,
    isRunning,
    isFailed,
    summary: toolCallSummary(tc),
    argsSection,
    resultSection,
    sections,
  };
}

function toolNamesSummary(toolCalls: Array<{ name: string }>): string {
  const names = Array.from(new Set(toolCalls.map((tc) => formatToolName(tc.name)).filter(Boolean)));
  if (names.length === 0) return "";
  const visible = names.slice(0, 3).join(", ");
  return names.length > 3 ? `${visible} +${names.length - 3}` : visible;
}

export function buildToolCallStackView(
  toolCalls: Array<{ id?: string; name: string; args: string; result?: string }>,
  options: { isStreaming?: boolean; pendingTimedOut?: boolean } = {},
): ToolCallStackView {
  const pendingCount = toolCalls.filter((tc) => tc.result === undefined).length;
  const returnedCount = toolCalls.length - pendingCount;
  const failedCount = toolCalls.filter(isToolCallFailed).length;
  const isRunning = pendingCount > 0 && options.isStreaming === true && options.pendingTimedOut !== true;
  const isFailed = failedCount > 0;
  const allReturned = returnedCount === toolCalls.length;
  const status: ToolCallViewStatus = isRunning ? "running" : isFailed ? "failed" : allReturned ? "done" : "called";
  const progressText = allReturned
    ? (failedCount > 0 ? `${failedCount} failed` : "")
    : `${returnedCount}/${toolCalls.length} returned`;

  return {
    status,
    statusLabel: toolCallStatusLabel(status),
    isRunning,
    isFailed,
    allReturned,
    pendingCount,
    returnedCount,
    failedCount,
    summary: toolNamesSummary(toolCalls),
    progressText,
    progressPercent: toolCalls.length === 0 ? 0 : Math.round((returnedCount / toolCalls.length) * 100),
  };
}

export const THINKING_PREVIEW_LINES = 2;
