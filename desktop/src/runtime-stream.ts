/**
 * One runtime (OpenClaw/Hermes) chat send, gated on the mount that started it.
 *
 * Chat is a per-agent mount (`useAgentChat`); a send streams events back over
 * seconds. Switching agents mid-stream must not fold agent A's events into
 * agent B's transcript, so the sink checks a generation guard before touching
 * the transcript. The guard is a callback, not a captured boolean, because the
 * stream outlives the synchronous moment it was created in.
 *
 * The sink also tracks the identity the stream reports (`sessionKey`, `runId`)
 * so a Stop click can name exactly what to abort — Hermes cannot abort without
 * a run id, and guessing one is worse than knowing there was none.
 */
import type { RuntimeChatEvent } from "./api";

export interface RuntimeStreamSink {
  /** Session the send is streaming into; updated if the stream refines it. */
  sessionKey: string;
  /** Latest run id the stream reported, if it ever did. */
  runId: string | undefined;
  /** Fold one event, unless the mount that started this send has moved on. */
  onEvent(event: RuntimeChatEvent): void;
}

export function runtimeStreamSink(
  sessionKey: string,
  isCurrent: () => boolean,
  fold: (event: RuntimeChatEvent) => void,
): RuntimeStreamSink {
  const sink: RuntimeStreamSink = {
    sessionKey,
    runId: undefined,
    onEvent(event) {
      if (!isCurrent()) return;
      if (typeof event.runId === "string" && event.runId) sink.runId = event.runId;
      if (typeof event.sessionKey === "string" && event.sessionKey) sink.sessionKey = event.sessionKey;
      fold(event);
    },
  };
  return sink;
}
