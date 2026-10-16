import type { AgentLogCapture } from '@hypercli.com/sdk';

/** The original SDK snapshot stays intact for JSON. */
type Capture = Pick<AgentLogCapture, 'source' | 'generation' | 'file_generation' | 'launch_epoch'
  | 'content_base64' | 'truncated' | 'unavailable' | 'assignment_id' | 'capture' | 'diagnostics_dropped'>;

/** No offsets are provided by the capture protocol: overlapping tails are not deltas. */
export function capturedLogRenderer(write: (text: string) => void, info: (text: string) => void) {
  const previous = new Map<string, Capture>();
  return (snapshot: { unavailable: string | null; captures: Capture[] }) => {
    if (snapshot.unavailable) info(`runner logs unavailable: ${snapshot.unavailable}`);
    const present = new Set<string>();
    for (const capture of snapshot.captures) {
      const key = `${capture.source}/${capture.generation}`;
      present.add(key);
      const old = previous.get(key);
      previous.set(key, capture);
      if (capture.capture?.dropped_bytes && capture.capture.dropped_bytes !== old?.capture?.dropped_bytes) {
        info(`${key}: capture dropped ${capture.capture.dropped_bytes} bytes; continuity unavailable`);
      }
      if (capture.diagnostics_dropped && capture.diagnostics_dropped !== old?.diagnostics_dropped) {
        info(`${key}: ${capture.diagnostics_dropped} diagnostics dropped`);
      }
      if (capture.unavailable) {
        if (old?.unavailable !== capture.unavailable) info(`${key}: unavailable (${capture.unavailable})`);
        continue;
      }
      const bytes = Buffer.from(capture.content_base64 ?? '', 'base64');
      const sameFile = old && capture.file_generation !== null && old.file_generation === capture.file_generation
        && old.assignment_id === capture.assignment_id && old.launch_epoch === capture.launch_epoch && !old.unavailable;
      if (sameFile && old.content_base64 === capture.content_base64 && old.truncated === capture.truncated) continue;
      if (!old || !sameFile) {
        info(`${key}: ${old ? 'replacement generation' : 'captured snapshot'}${capture.truncated ? ' (truncated)' : ''}`);
        if (bytes.length) write(bytes.toString('utf8'));
        else info(`${key}: empty capture`);
        continue;
      }
      const prior = Buffer.from(old.content_base64 ?? '', 'base64');
      if (!old.truncated && !capture.truncated && bytes.subarray(0, prior.length).equals(prior)) {
        const suffix = bytes.subarray(prior.length);
        if (suffix.length) write(suffix.toString('utf8'));
      } else {
        info(`${key}: bounded snapshot replaced; continuity unavailable (use --json --follow for replacement snapshots)`);
      }
    }
    for (const key of previous.keys()) if (!present.has(key)) previous.delete(key);
  };
}
