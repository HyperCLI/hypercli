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

export function toolCallSummary(tc: { name: string; args: string; result?: string }): string {
  if (tc.result) return extractReadableSummary(tc.result, 60);
  return extractReadableSummary(tc.args, 60);
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
