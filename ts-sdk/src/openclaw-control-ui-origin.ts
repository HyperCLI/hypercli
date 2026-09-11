/**
 * OpenClaw control-UI allowed-origin helpers.
 *
 * An OpenClaw agent records the browser origins allowed to drive its control
 * UI in the `OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN` launch env. Stored values
 * predate a single canonical writer, so the value exists in three shapes:
 * space-separated, comma-separated, and JSON array. Everything here is pure
 * parsing and normalization: callers decide which sources to merge and when
 * to write the result.
 *
 * Failure policy: these helpers never throw. Anything that cannot be proven
 * to be a safe origin (unparseable input, an out-of-allowlist scheme such as
 * `ftp:` or `javascript:`, credentials in the URL, a bare hostname fragment)
 * is dropped from the merged result rather than written back as garbage.
 */

export const OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN_ENV = 'OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN';

/**
 * Schemes a control UI can legitimately be served from. `tauri:` is the
 * packaged desktop shell; `data:`/`javascript:`/unknown schemes are rejected
 * outright rather than reflected into an allow-list.
 */
const CONTROL_UI_ORIGIN_ALLOWED_SCHEMES = new Set(['http:', 'https:', 'tauri:']);

/**
 * Normalize one origin candidate, or `null` when it is not expressible.
 *
 * http(s) origins canonicalize through `URL.origin` (strips paths, queries,
 * fragments, default ports). `tauri:` has no meaningful `origin`
 * (`URL.origin` reports the string `null`), so it is rendered as
 * `scheme://host` with the host lowercased — the gateway lowercases before
 * exact-matching, so `tauri://LOCALHOST` must normalize to the same string.
 * Userinfo is rejected in every scheme.
 */
export function normalizeControlUiOrigin(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const candidate = value.trim();
  if (!candidate) return null;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (!CONTROL_UI_ORIGIN_ALLOWED_SCHEMES.has(url.protocol) || !url.hostname) return null;
  if (url.username || url.password) return null;
  if (url.protocol === 'http:' || url.protocol === 'https:') return url.origin;
  return `${url.protocol}//${url.host.toLowerCase()}`;
}

/**
 * Parse every stored shape of the allow-list into a normalized, deduplicated
 * list. Accepts space- or comma-separated strings, JSON arrays, and raw
 * string arrays.
 */
export function parseControlUiAllowedOrigins(value: unknown): string[] {
  let values: unknown[];
  if (Array.isArray(value)) {
    values = value;
  } else if (typeof value === 'string') {
    const candidate = value.trim();
    if (!candidate) return [];
    if (candidate.startsWith('[')) {
      try {
        return parseControlUiAllowedOrigins(JSON.parse(candidate));
      } catch {
        return [];
      }
    }
    values = candidate.split(/[,\s]+/);
  } else {
    return [];
  }
  const origins = values
    .map(normalizeControlUiOrigin)
    .filter((origin): origin is string => origin !== null);
  return Array.from(new Set(origins));
}

/**
 * Union of several origin sources. Each source may be a raw env string (any
 * stored shape) or an already-split list of candidates; results are
 * normalized, unexpressible entries dropped, and deduplicated in first-seen
 * order. Callers control priority by ordering the sources.
 */
export function mergeControlUiAllowedOrigins(
  ...sources: Array<string | string[] | undefined | null>
): string[] {
  const merged = sources
    .filter((source): source is string | string[] => source !== undefined && source !== null)
    .flatMap(parseControlUiAllowedOrigins);
  return Array.from(new Set(merged));
}
