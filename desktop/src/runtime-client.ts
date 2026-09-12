/**
 * What chat each runtime family supports, and how it is carried.
 *
 * This used to gate on whether Tauri IPC was present — a proxy for "are we in
 * the packaged app", which mattered when runtime streaming existed only inside
 * the Vite dev bridge. Streaming now runs in the webview, the same in dev and
 * packaged, so the host is irrelevant: what decides chat is the runtime, and
 * whether the SDK has a canonical session client for it.
 *
 * Both OpenClaw and Hermes do (`AgentSessionClient`, ts-sdk session.ts):
 * OpenClaw over its pooled WebSocket gateway, Hermes over its HTTP/SSE API.
 * `src/api.ts` performs the connect per call; this module is only the
 * family → transport table plus the chat convenience wrappers.
 */
import {
  runtimeChatAbort,
  runtimeHistory,
  runtimeHistoryForSession,
  streamRuntimeMessage,
  type AgentSummary,
  type RuntimeChatEvent,
  type RuntimeChatMessage,
} from "./api";
import { runtimeFamily, type RuntimeFamily } from "./agent-utils";

/** How a family's chat is carried, when it has one. */
export type RuntimeChatTransport =
  /** The ACP bridge WebSocket, driven by useAgentChat directly. */
  | "acp"
  /** A canonical SDK session (`OpenClawSessionClient` / `HermesSessionClient`). */
  | "session"
  | "none";

export interface RuntimeChatCapability {
  transport: RuntimeChatTransport;
  /** Null when chat works; otherwise why it doesn't, in the user's words. */
  unavailable: string | null;
}

const CAPABILITIES: Record<RuntimeFamily, RuntimeChatCapability> = {
  acp: { transport: "acp", unavailable: null },
  openclaw: { transport: "session", unavailable: null },
  // `HermesAgent.connect()` returns a `HermesSessionClient` over the agent's
  // HTTP/SSE API server (`agents.ts:3484`): history and streaming exist.
  hermes: { transport: "session", unavailable: null },
  generic: { transport: "none", unavailable: "This runtime doesn't expose chat." },
};

export function runtimeChatCapability(agent: AgentSummary | null): RuntimeChatCapability {
  return CAPABILITIES[runtimeFamily(agent?.runtime ?? null)];
}

export function canRuntimeChat(agent: AgentSummary): boolean {
  return runtimeChatCapability(agent).unavailable === null;
}

/**
 * True when the family's chat is backed by addressable, listable sessions —
 * ACP over the bridge (`listSessions`) or a canonical SDK session client
 * (`sessionsList` / `sessionsCreate`). The sidebar's session picker and its
 * session sweep both gate on this, so a new session-capable family joins the
 * picker UX from the capability table above and nowhere else.
 */
export function canPickChatSession(agent: AgentSummary): boolean {
  return runtimeChatCapability(agent).transport !== "none";
}

export function runtimeChatHistory(
  agent: AgentSummary,
  sessionKey?: string | null,
): Promise<RuntimeChatMessage[]> {
  if (runtimeChatCapability(agent).transport !== "session") return Promise.resolve([]);
  return sessionKey ? runtimeHistoryForSession(agent.id, sessionKey) : runtimeHistory(agent.id);
}

export function streamRuntimeChatMessage(
  agent: AgentSummary,
  text: string,
  onEvent: (event: RuntimeChatEvent) => void,
  sessionKey?: string | null,
): Promise<void> {
  const { transport, unavailable } = runtimeChatCapability(agent);
  if (transport !== "session") {
    return Promise.reject(new Error(unavailable ?? "This runtime does not expose streaming chat."));
  }
  return streamRuntimeMessage(agent.id, text, onEvent, sessionKey);
}

/**
 * Abort the run a runtime send is streaming. Identity comes from the stream
 * itself: Hermes aborts by run id, OpenClaw by session key (+ run id when
 * known). Called from Stop; a stream that never reported a run id had nothing
 * to abort, so a Hermes reject there is swallowed by the caller.
 */
export function abortRuntimeChat(
  agent: AgentSummary,
  sessionKey?: string,
  runId?: string,
): Promise<void> {
  const { transport } = runtimeChatCapability(agent);
  if (transport !== "session") return Promise.resolve();
  return runtimeChatAbort(agent.id, sessionKey, runId);
}
