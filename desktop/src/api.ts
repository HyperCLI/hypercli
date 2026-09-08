import { invoke } from "@tauri-apps/api/core";

export interface AgentSummary {
  id: string;
  name: string;
  handle: string | null;
  avatar_url: string | null;
  runtime: string | null;
  state: string;
  hostname: string | null;
  launch_epoch: number;
  size: string | null;
  hasDesktop?: boolean;
  has_desktop?: boolean;
  launch_config?: unknown;
  launchConfig?: unknown;
  routes?: unknown;
}

export interface AgentAvatarUploadResult {
  id: string;
  avatar_url: string | null;
  s3_key?: string | null;
}

export interface AuthStatus {
  signed_in: boolean;
  api_base: string;
}

export interface AcpCredentials {
  api_base: string;
  token: string;
}

export interface PlanSummary {
  name: string;
  agents: number;
  renews_at: string | null;
}

export interface AgentLogsToken {
  agent_id?: string;
  jwt: string;
  expires_at?: string | null;
  ws_url?: string;
  api_base?: string;
}

export interface AgentDesktopUrl {
  url: string;
  expires_at?: string | null;
}

export interface RuntimeChatMessage {
  role: string;
  text: string;
  thinking?: string;
  toolCalls?: RuntimeChatToolCall[];
  timestamp?: number;
  messageId?: string;
}

export interface RuntimeChatToolCall {
  id?: string;
  name: string;
  args?: unknown;
  result?: string;
}

export interface RuntimeChatEvent {
  type: "content" | "commentary" | "reasoning" | "thinking" | "tool_call" | "tool_result" | "done" | "error";
  text?: string;
  replace?: boolean;
  eventId?: string;
  messageId?: string;
  turnId?: string;
  runId?: string;
  sessionKey?: string;
  revision?: number | string;
  data?: Record<string, unknown>;
}

export interface AgentFileEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  size_formatted?: string;
  last_modified?: string;
}

export interface AgentFileBytes {
  bytes: number[];
}

export interface AgentExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function hasTauriInvoke() {
  const internals = (window as unknown as { __TAURI_INTERNALS__?: Record<string, unknown> })
    .__TAURI_INTERNALS__;
  return typeof internals?.invoke === "function";
}

async function command<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  if (hasTauriInvoke()) {
    try {
      return await invoke<T>(name, args);
    } catch (e) {
      throw new Error(`${name} failed in Tauri: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  let response: Response;
  try {
    response = await fetch("/__desktop_ng/invoke", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command: name, args }),
    });
  } catch (e) {
    throw new Error(`${name} bridge request failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  const payload = (await response.json()) as { ok: boolean; result?: T; error?: string };
  if (!response.ok || !payload.ok) throw new Error(payload.error ?? `Command failed: ${name}`);
  return payload.result as T;
}

export const authStatus = () => command<AuthStatus>("auth_status");
export const saveApiKey = (key: string) =>
  command<AuthStatus>("save_api_key", { key });
export const logout = () => command<void>("logout");
export const listAgents = () => command<AgentSummary[]>("list_agents");
export const startAgent = (id: string) =>
  command<AgentSummary>("start_agent", { id });
export const stopAgent = (id: string) =>
  command<AgentSummary>("stop_agent", { id });
export const createAgent = (
  name: string,
  runtime: string,
  size?: string,
  options: { image?: string | null; buzzPrivateKeyNsec?: string | null; buzzRelayUrl?: string | null } = {},
) => command<AgentSummary>("create_agent", { name, runtime, size, ...options });
export const archiveAgent = (id: string) =>
  command<AgentSummary>("archive_agent", { id });
export const restoreAgent = (id: string) =>
  command<AgentSummary>("restore_agent", { id });
export const deleteAgent = (id: string) => command<void>("delete_agent", { id });
export const setAgentDesktopEnabled = (id: string, enabled: boolean) =>
  command<AgentSummary>("set_agent_desktop_enabled", { id, enabled });
export const uploadAgentAvatar = async (id: string, file: File) => {
  const content = Array.from(new Uint8Array(await file.arrayBuffer()));
  return command<AgentAvatarUploadResult>("upload_agent_avatar", {
    id,
    content,
    contentType: file.type || "image/png",
  });
};
export const deleteAgentAvatar = (id: string) =>
  command<AgentAvatarUploadResult>("delete_agent_avatar", { id });
export const acpCredentials = () => command<AcpCredentials>("acp_credentials");
export const runtimeHistory = (id: string) =>
  command<RuntimeChatMessage[]>("runtime_history", { id });
export const runtimeHistoryForSession = (id: string, sessionKey: string) =>
  command<RuntimeChatMessage[]>("runtime_history", { id, sessionKey });
export async function streamRuntimeMessage(
  id: string,
  text: string,
  onEvent: (event: RuntimeChatEvent) => void,
  sessionKey?: string | null,
) {
  if (hasTauriInvoke()) throw new Error("Runtime streaming is not wired in the packaged app yet.");
  const response = await fetch("/__desktop_ng/stream", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ command: "runtime_message_stream", args: { id, text, sessionKey } }),
  });
  if (!response.body) throw new Error(await response.text().catch(() => response.statusText));
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as RuntimeChatEvent;
      onEvent(event);
    }
    if (done) break;
  }
  if (buffer.trim()) {
    const event = JSON.parse(buffer) as RuntimeChatEvent;
    onEvent(event);
  }
}
export const agentLogsToken = (id: string) =>
  command<AgentLogsToken>("agent_logs_token", { id });
export const agentDesktopUrl = (id: string) =>
  command<AgentDesktopUrl>("agent_desktop_url", { id });
export const agentFiles = (id: string, path = "") =>
  command<AgentFileEntry[]>("agent_files", { id, path });
export const agentFileRead = (id: string, path: string) =>
  command<string>("agent_file_read", { id, path });
export const agentFileReadBytes = (id: string, path: string) =>
  command<AgentFileBytes>("agent_file_read_bytes", { id, path });
export const agentExec = (id: string, commandText: string, timeout = 30) =>
  command<AgentExecResult>("agent_exec", { id, command: commandText, timeout });
export function agentShellUrl(id: string) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const params = new URLSearchParams({ agent_id: id });
  return `${protocol}//${window.location.host}/__desktop_ng/shell?${params}`;
}
export function agentLogsUrl(id: string) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const params = new URLSearchParams({ agent_id: id });
  return `${protocol}//${window.location.host}/__desktop_ng/logs?${params}`;
}
export const planSummary = () => command<PlanSummary>("plan_summary");

export interface AcpSessionInfo {
  session_id: string;
  title: string | null;
  cwd: string | null;
  updated_at: string | null;
}

export interface AcpSessionList {
  sessions: AcpSessionInfo[];
  next_cursor: string | null;
}

export const listAcpSessions = (id: string) =>
  command<AcpSessionList>("acp_list_sessions", { id });

export type RuntimeSessionKind = "openclaw" | "hermes";

export interface RuntimeSessionInfo {
  session_id: string;
  title: string | null;
  cwd: string | null;
  updated_at: string | null;
  runtime: RuntimeSessionKind;
}

export interface RuntimeSessionList {
  sessions: RuntimeSessionInfo[];
  next_cursor: string | null;
}

export const listRuntimeSessions = (id: string) =>
  command<RuntimeSessionList>("runtime_list_sessions", { id });
export const createRuntimeSession = (id: string, title?: string) =>
  command<RuntimeSessionInfo>("runtime_create_session", { id, title });
export const renameRuntimeSession = (id: string, sessionKey: string, title: string) =>
  command<RuntimeSessionInfo>("runtime_rename_session", { id, sessionKey, title });
