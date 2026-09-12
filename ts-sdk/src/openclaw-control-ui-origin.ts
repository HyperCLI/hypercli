/**
 * OpenClaw control-UI allowed-origin helpers.
 *
 * An OpenClaw agent records the browser origins allowed to drive its control
 * UI in the `OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN` launch env. With current
 * OpenClaw that env is a full replace for `gateway.controlUi.allowedOrigins`,
 * parsed comma-separated, and `'*'` is a wildcard covering every origin.
 * The SDK therefore defaults the env to `'*'`, and any explicit value is
 * passed through verbatim — this is a user-controlled setting, so entries
 * are split and trimmed but never scheme-validated or dropped.
 *
 * Stored values predate a single canonical writer, so values also exist
 * space-separated or as JSON arrays; all shapes parse.
 */

export const OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN_ENV = 'OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN';

/** The allow-anything value written when no explicit list was supplied. */
export const CONTROL_UI_ALLOWED_ORIGIN_WILDCARD = '*';

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
  if (origins.includes(CONTROL_UI_ALLOWED_ORIGIN_WILDCARD)) return [CONTROL_UI_ALLOWED_ORIGIN_WILDCARD];
  return Array.from(new Set(origins));
}

/**
 * Union of several origin sources. Each source may be a raw env string (any
 * stored shape) or an already-split list of candidates; results are
 * deduplicated in first-seen order. Callers control priority by ordering
 * the sources. A `'*'` in any source collapses the union to `['*']`.
 */
export function mergeControlUiAllowedOrigins(
  ...sources: Array<string | string[] | undefined | null>
): string[] {
  const merged = sources
    .filter((source): source is string | string[] => source !== undefined && source !== null)
    .flatMap(parseControlUiAllowedOrigins);
  if (merged.includes(CONTROL_UI_ALLOWED_ORIGIN_WILDCARD)) return [CONTROL_UI_ALLOWED_ORIGIN_WILDCARD];
  return Array.from(new Set(merged));
}
