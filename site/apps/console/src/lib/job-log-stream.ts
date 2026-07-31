export const JOB_LOG_RECONNECT_BASE_MS = 750;
export const JOB_LOG_RECONNECT_MAX_MS = 15_000;
export const JOB_LOG_RECONNECT_MAX_ATTEMPTS = 8;

export type ParsedJobLogEvent =
  | { type: 'log'; log: string }
  | { type: 'snapshot'; logs: string }
  | null;

export function buildJobLogsWsUrl(rawBase: string, jobKey: string): string {
  const normalizedBase = rawBase.trim().replace(/\/+$/, '');
  if (!normalizedBase) return '';

  const wsBase = normalizedBase
    .replace(/^https:\/\//i, 'wss://')
    .replace(/^http:\/\//i, 'ws://');

  if (wsBase.endsWith('/ws/logs')) return `${wsBase}/${jobKey}`;
  if (wsBase.endsWith('/ws')) return `${wsBase}/logs/${jobKey}`;
  if (wsBase.endsWith('/orchestra/ws')) return `${wsBase}/logs/${jobKey}`;
  return `${wsBase}/ws/logs/${jobKey}`;
}

export function getJobLogReconnectDelayMs(
  attempt: number,
  random: () => number = Math.random,
): number {
  const exponentialDelay = Math.min(
    JOB_LOG_RECONNECT_BASE_MS * (2 ** Math.max(0, attempt)),
    JOB_LOG_RECONNECT_MAX_MS,
  );
  // Keep retries from synchronizing after a rollout while bounding the jitter.
  const jitterMultiplier = 0.8 + (Math.min(1, Math.max(0, random())) * 0.4);
  return Math.min(
    JOB_LOG_RECONNECT_MAX_MS,
    Math.round(exponentialDelay * jitterMultiplier),
  );
}

export function parseJobLogEvent(payload: string): ParsedJobLogEvent {
  const data: unknown = JSON.parse(payload);
  if (!data || typeof data !== 'object') return null;

  const event = data as { event?: unknown; log?: unknown; logs?: unknown };
  if (event.event === 'log_snapshot' && typeof event.logs === 'string') {
    return { type: 'snapshot', logs: event.logs };
  }
  if (event.event === 'log' && typeof event.log === 'string') {
    return { type: 'log', log: event.log };
  }
  return null;
}

export function combineJobLogs(snapshot: string, liveLines: string[]): string {
  return liveLines.reduce((combined, line) => {
    if (!combined) return line;
    return `${combined}${combined.endsWith('\n') ? '' : '\n'}${line}`;
  }, snapshot);
}

function suffixPrefixOverlap(left: string, right: string): number {
  // Log snapshots can be large. Containment above handles full snapshots; this
  // bounded scan is only for rolling-window/tail overlap.
  const maxOverlap = Math.min(left.length, right.length, 64 * 1024);
  const prefix = right.slice(0, maxOverlap);
  const failure = new Array<number>(prefix.length).fill(0);
  for (let index = 1, matched = 0; index < prefix.length; index += 1) {
    while (matched > 0 && prefix[index] !== prefix[matched]) {
      matched = failure[matched - 1];
    }
    if (prefix[index] === prefix[matched]) {
      matched += 1;
    }
    failure[index] = matched;
  }

  let matched = 0;
  const suffix = left.slice(-maxOverlap);
  for (let index = 0; index < suffix.length; index += 1) {
    while (matched > 0 && suffix[index] !== prefix[matched]) {
      matched = failure[matched - 1];
    }
    if (suffix[index] === prefix[matched]) {
      matched += 1;
    }
    if (matched === prefix.length && index < suffix.length - 1) {
      matched = failure[matched - 1];
    }
  }
  return matched;
}

/**
 * Merge a REST log snapshot with the tail already displayed in the browser.
 *
 * Older Directors do not replay a snapshot on WebSocket connect, and their
 * REST persistence may lag the live socket. Containment and overlap checks
 * preserve that newer live tail without duplicating it. The explicit
 * log_snapshot event remains authoritative and does not use this merge.
 */
export function reconcileJobLogSnapshots(displayed: string, restSnapshot: string): string {
  const current = displayed.replace(/\r\n/g, '\n');
  const incoming = restSnapshot.replace(/\r\n/g, '\n');

  if (!current) return incoming;
  if (!incoming) return current;
  if (incoming.includes(current)) return incoming;
  if (current.includes(incoming)) return current;

  const appendOverlap = suffixPrefixOverlap(current, incoming);
  const prependOverlap = suffixPrefixOverlap(incoming, current);
  if (appendOverlap >= prependOverlap && appendOverlap > 0) {
    return current + incoming.slice(appendOverlap);
  }
  if (prependOverlap > 0) {
    return incoming + current.slice(prependOverlap);
  }

  // REST is normally the historical side of the stream. If bounded buffers
  // have no overlap, keep both and put the persisted snapshot first so no live
  // lines disappear during a staggered rollout.
  return combineJobLogs(incoming, [current]);
}

export function shouldStreamJobLogs(state: string | null | undefined): boolean {
  return state === 'assigned' || state === 'running';
}
