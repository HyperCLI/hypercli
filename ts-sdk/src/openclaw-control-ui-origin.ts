/**
 * OpenClaw control-UI allowed-origin helpers.
 *
 * An OpenClaw agent records the browser origins allowed to drive its control
 * UI in the `OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN` launch env. With current
 * OpenClaw that env is a full replace for `gateway.controlUi.allowedOrigins`,
 * parsed comma-separated, and `'*'` is a wildcard covering every origin. The
 * SDK unconditionally writes `'*'` at create; these helpers exist only for
 * read-side consumers (desktop, console) that parse and display a stored
 * allow-list.
 *
 * Stored values predate a single canonical writer, so values also exist
 * space-separated or as JSON arrays; all shapes parse.
 */

/** The allow-anything value written when no explicit list was supplied. */
/**
 * Parse every stored shape of the allow-list into a trimmed, deduplicated
 * list. Accepts space- or comma-separated strings, JSON arrays, and raw
 * string arrays. Entries are passed through as-is; only empties drop. A
 * `'*'` anywhere collapses the list to `['*']`.
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
        const parsed: unknown = JSON.parse(candidate);
        return Array.isArray(parsed) ? parseControlUiAllowedOrigins(parsed) : [];
      } catch {
        return [];
      }
    }
    values = candidate.split(/[,\s]+/);
  } else {
    return [];
  }
  const origins = values
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (origins.includes('*')) return ['*'];
  return Array.from(new Set(origins));
}
