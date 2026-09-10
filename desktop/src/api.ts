import { invoke } from "@tauri-apps/api/core";
import { HyperCLI } from "../../ts-sdk/src/client.ts";
import {
  HermesAgent,
  OpenClawAgent,
  type Agent,
  type AgentFileEntry,
  type AgentLaunchConfig,
  type AgentLogsTokenResponse,
  type AgentProfileImageUploadResult,
  type AgentShellTokenResponse,
} from "../../ts-sdk/src/agents.ts";
import {
  OpenClawSessionClient,
  type AgentSessionClient,
  type AgentSessionMessage,
} from "../../ts-sdk/src/session.ts";
import { CodingAgentAcpClient, type CodingAgentAcpTarget } from "../../ts-sdk/src/acp.ts";
import { agentsBridgeWsBase, defaultHyperAcpWsUrl } from "../../ts-sdk/src/agent-urls.ts";
import type { HyperAgentUsageReport } from "../../ts-sdk/src/agent.ts";
import type { RoutineCreateOptions, RoutineUpdateOptions, Routine as SdkRoutine } from "../../ts-sdk/src/routines.ts";
import { HERMES_RUNTIMES, OPENCLAW_RUNTIMES } from "./agent-utils";
import { classifyConnectionError, clearConnectionIssue, httpStatusOf, reportConnectionError, type ConnectionIssue } from "./lib/connection-errors";
import { controlUiOriginsToWrite } from "./lib/origin-lock";
import { resolveCredentials, usingDevCredentials } from "./lib/credentials";
import { resolveEndpoints, type Endpoints } from "./lib/endpoints";

// ---------------------------------------------------------------------------
// SDK client. All backend HTTP+WS goes through ts-sdk; Rust keeps only
// credential discovery/persistence and OS integration.
// ---------------------------------------------------------------------------

export type { AcpCredentials } from "./lib/credentials";

let sdkPromise: Promise<HyperCLI> | null = null;

export function resetSdkClient() {
  sdkPromise = null;
}

function logSdkError(where: string, error: unknown, url?: string | null) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(`[hypercli] ${where} failed:`, message, error);
  // A blocked fetch has no console presence the user can reach in a packaged
  // webview, so every logged failure is also published to the error bar.
  reportConnectionError(error, { operation: where, url: url ?? AGENTS_API_BASE_HINT });
}

/** Best-effort host for classification when the failing URL isn't to hand. */
let AGENTS_API_BASE_HINT: string | null = null;

function hostHint(): string {
  if (!AGENTS_API_BASE_HINT) return "unknown";
  try {
    return new URL(AGENTS_API_BASE_HINT).host;
  } catch {
    return "unknown";
  }
}

export async function sdk(): Promise<HyperCLI> {
  if (!sdkPromise) {
    sdkPromise = (async () => {
      try {
        const creds = await acpCredentials();
        const endpoints = resolveEndpoints(creds);
        AGENTS_API_BASE_HINT = endpoints.httpBase;
        return new HyperCLI({
          apiKey: creds.token,
          agentApiKey: creds.token,
          agentsApiBaseUrl: endpoints.httpBase,
        });
      } catch (error) {
        logSdkError("sdk init", error);
        throw error;
      }
    })();
    sdkPromise.catch(() => {
      sdkPromise = null;
    });
  }
  return sdkPromise;
}

// ---------------------------------------------------------------------------
// Shared types (kept stable for the existing components).
// ---------------------------------------------------------------------------

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
  has_desktop?: boolean;
  launchConfig?: unknown;
  routes?: unknown;
}

export function agentSummary(agent: Agent): AgentSummary {
  return {
    id: agent.id,
    name: agent.displayName ?? agent.name ?? agent.id,
    handle: agent.handle,
    avatar_url: agent.avatarUrl,
    runtime: agent.runtime,
    // Normalised once, at the boundary: the SDK's predicates uppercase their
    // input, so every comparison downstream is correct by construction
    // (FSM.md — "state is normalised where it enters the app").
    state: String(agent.state ?? "").toUpperCase(),
    hostname: agent.hostname,
    launch_epoch: agent.launchEpoch,
    size: agent.requestedSize ?? null,
    has_desktop: agent.hasDesktop,
    launchConfig: agent.launchConfig ?? null,
    routes: agent.routes,
  };
}

// The SDK's own wire type; the avatar endpoints speak snake_case natively.
export type AgentAvatarUploadResult = AgentProfileImageUploadResult;

export interface AuthStatus {
  signed_in: boolean;
  api_base: string;
}

export interface PlanSummary {
  name: string;
  agents: number;
  renews_at: string | null;
}

/**
 * The SDK's logs-token response plus the REST base the logs view needs. The
 * credential is always `token` — the SDK validator rejects anything else.
 */
export type AgentLogsToken = AgentLogsTokenResponse & { api_base?: string };

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

export type { AgentFileEntry };

// ---------------------------------------------------------------------------
// Auth — the only commands still owned by Rust (credential persistence).
// ---------------------------------------------------------------------------

export const authStatus = async (): Promise<AuthStatus> => {
  // A dev browser tab has no Tauri IPC but does have an injected key; reporting
  // it as signed out would send it to a sign-in screen it cannot complete, and
  // dev would once again fail to reproduce the app.
  if (usingDevCredentials()) {
    const creds = await resolveCredentials();
    return { signed_in: true, api_base: creds.api_base };
  }
  return invoke<AuthStatus>("auth_status");
};
export const saveApiKey = async (key: string) => {
  const status = await invoke<AuthStatus>("save_api_key", { key });
  resetSdkClient();
  return status;
};
export const logout = async () => {
  await invoke<void>("logout");
  resetSdkClient();
};
export const acpCredentials = resolveCredentials;

/**
 * Browser sign-in round trip. `startLogin` opens the system browser on the
 * desktop-login page (which redirects back to `hypercli://auth#token=…`);
 * Rust emits the token as an `auth-token` event; `mintApiKey` exchanges it
 * for a scoped, persisted machine key. The session token itself is never
 * stored.
 */
export const startLogin = () => invoke<void>("start_login");
export const mintApiKey = async ({ sessionToken }: { sessionToken: string }) => {
  const status = await invoke<AuthStatus>("mint_api_key", { sessionToken });
  resetSdkClient();
  return status;
};

/** WebSocket URLs must come from the real host, never the dev proxy. */
async function endpoints(): Promise<Endpoints> {
  return resolveEndpoints(await acpCredentials());
}

// ---------------------------------------------------------------------------
// Agent lifecycle — ts-sdk.
// ---------------------------------------------------------------------------

export async function listAgents(): Promise<AgentSummary[]> {
  const client = await sdk();
  try {
    const agents = await client.deployments.list();
    // The roster refetches constantly, so a success here is the clearest
    // signal that a previously reported connectivity problem is over.
    clearConnectionIssue(`blocked:${hostHint()}`);
    clearConnectionIssue("offline");
    return agents
      .map(agentSummary)
      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  } catch (error) {
    logSdkError("listAgents", error);
    throw error;
  }
}

export async function startAgent(id: string): Promise<AgentSummary> {
  const client = await sdk();
  const agent = await client.deployments.get(id);
  const runtime = agent.runtime ?? "";
  if (OPENCLAW_RUNTIMES.has(runtime)) {
    let gatewayToken: string | null = null;
    try {
      const secret = await client.deployments.secret(id, "OPENCLAW_GATEWAY_TOKEN");
      const value = secret.value.trim();
      if (value) gatewayToken = value;
    } catch (error) {
      // Only a genuine not-found means "no secret yet" (older OpenClaw agents
      // predate it). Anything else must abort the start: minting a fresh token
      // over an unread, possibly healthy one would invalidate every live
      // gateway session.
      if (httpStatusOf(error) !== 404) throw error;
    }
    if (!gatewayToken) {
      gatewayToken = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
      await client.deployments.setSecret(id, "OPENCLAW_GATEWAY_TOKEN", gatewayToken);
    }
    // START takes a *complete replacement* launch config, which the
    // owner-facing projection can never be (`secrets`/`registry_auth` are
    // redacted). `storedLaunchConfig` is the typed producer the SDK ships for
    // exactly this round trip.
    const stored = await client.deployments.storedLaunchConfig(id);
    const launchConfig: Omit<AgentLaunchConfig, "config"> = {
      ...stored,
      env: {
        ...stored.env,
        // Every origin this app can legitimately have, merged with whatever is
        // already recorded. Writing just our own origin (as this once did)
        // evicts whoever started the agent last -- dev locks out the packaged
        // app and vice versa. The shared parser accepts a space-separated list.
        OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN: controlUiOriginsToWrite(agent.launchConfig),
      },
    };
    const started = await client.deployments.startOpenClaw(id, { gatewayToken, launchConfig });
    return agentSummary(started);
  }
  if (HERMES_RUNTIMES.has(runtime)) {
    const launchConfig = await client.deployments.storedLaunchConfig(id);
    return agentSummary(await client.deployments.startHermesAgent(id, { launchConfig }));
  }
  return agentSummary(await client.deployments.start(id));
}

export async function stopAgent(id: string): Promise<AgentSummary> {
  const client = await sdk();
  return agentSummary(await client.deployments.stop(id));
}

export interface CreateAgentOptions {
  image?: string | null;
  buzzPrivateKeyNsec?: string | null;
  buzzRelayUrl?: string | null;
}

export async function createAgent(
  name: string,
  runtime: string,
  size?: string,
  options: CreateAgentOptions = {},
): Promise<AgentSummary> {
  const client = await sdk();
  const sizeOpt = size as "small" | "medium" | "large" | undefined;
  const shared = { name, ...(sizeOpt ? { size: sizeOpt } : {}), ...(options.image ? { image: options.image } : {}) };
  if (runtime === "openclaw") {
    return agentSummary(await client.deployments.createOpenClaw({ ...shared }));
  }
  if (runtime === "openclaw-pro") {
    return agentSummary(await client.deployments.createOpenClawPro({ ...shared }));
  }
  if (runtime === "hermes-agent") {
    return agentSummary(await client.deployments.createHermesAgent({ ...shared }));
  }
  if (runtime === "buzz-agent") {
    const nsec = options.buzzPrivateKeyNsec?.trim();
    if (!nsec) throw new Error("Buzz Agent requires an nsec private key.");
    return agentSummary(
      await client.deployments.createBuzzAgent({
        ...shared,
        buzz: {
          privateKeyNsec: nsec,
          relayUrl: options.buzzRelayUrl?.trim() || "wss://relay.buzz.hypercli.com",
          displayName: name,
          sessionTitle: name,
        },
      }),
    );
  }
  if (runtime === "opencode") return agentSummary(await client.deployments.createOpenCode({ ...shared }));
  if (runtime === "codex") return agentSummary(await client.deployments.createCodex({ ...shared }));
  if (runtime === "claude-code") return agentSummary(await client.deployments.createClaudeCode({ ...shared }));
  if (runtime === "goose") return agentSummary(await client.deployments.createGoose({ ...shared }));
  if (runtime === "kimi-code") return agentSummary(await client.deployments.createKimiCode({ ...shared }));
  throw new Error(`Unknown runtime: ${runtime}`);
}

export const archiveAgent = async (id: string) => agentSummary(await (await sdk()).deployments.archive(id));
export const restoreAgent = async (id: string) => agentSummary(await (await sdk()).deployments.restore(id));
export const deleteAgent = async (id: string) => {
  await (await sdk()).deployments.delete(id);
};

/**
 * Watches deployment transitions and fires `onUpdate` (debounced) so the
 * roster refetches without a poll. Replaces the old Rust-side watcher.
 * Returns an unsubscribe function.
 *
 * The subscription itself is `Deployments.subscribe()`: it mints the events
 * token, dials the returned `ws_url` with `?token=` (HANDOFF's 403 trap —
 * fixed SDK-side), and owns the ready handshake, the reconnect loop and its
 * backoff (AGENTS.md rule 15: the app composes that, it does not rebuild it).
 * Only a *fatal* exit (a rejected token mint, e.g. a 401 key) escapes, and the
 * caller degrades the session machine on it.
 */
export function subscribeAgentUpdates(
  onUpdate: () => void,
  onConnected?: () => void,
  onFatal?: (issue: ConnectionIssue) => void,
): () => void {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const fire = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      onUpdate();
    }, 500);
  };

  void (async () => {
    try {
      const client = await sdk();
      if (controller.signal.aborted) return;
      await client.deployments.subscribe(() => fire(), {
        signal: controller.signal,
        // A fresh connection may have missed transitions while it was down. It
        // is also the only proof the live channel is open, which is a different
        // fact from "a roster GET succeeded" — see `SOCKET_UP` in lib/fsm.ts.
        onReady: () => {
          onConnected?.();
          fire();
        },
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      onFatal?.(classifyConnectionError(error, { operation: "Live agent updates", url: null }));
    }
  })();

  return () => {
    controller.abort();
    if (timer) clearTimeout(timer);
  };
}

export async function setAgentDesktopEnabled(id: string, enabled: boolean): Promise<AgentSummary> {
  const client = await sdk();
  await client.deployments.setEnv(id, "HYPER_DESKTOP_ENABLED", enabled ? "1" : "0");
  if (enabled) {
    await client.deployments.setRoute(id, "desktop", { port: 3000, auth: true, prefix: "desktop" });
  } else {
    await client.deployments.removeRoute(id, "desktop");
  }
  return agentSummary(await client.deployments.get(id));
}

export async function uploadAgentAvatar(id: string, file: File): Promise<AgentAvatarUploadResult> {
  const client = await sdk();
  const bytes = new Uint8Array(await file.arrayBuffer());
  return client.deployments.uploadProfileImage(
    id,
    bytes,
    file.type || "image/png",
  );
}

export async function deleteAgentAvatar(id: string): Promise<AgentAvatarUploadResult> {
  const client = await sdk();
  return client.deployments.deleteProfileImage(id);
}

// ---------------------------------------------------------------------------
// Plans & usage — ts-sdk HyperAgent control plane.
// ---------------------------------------------------------------------------

const TIER_ORDER = ["large", "medium", "small"] as const;

/**
 * Largest tier with a free slot on the user's current plan, per the SDK's
 * plan catalog (no hardcoded fallback: unavailable catalog → undefined,
 * which lets the backend apply its default).
 */
export async function largestAvailableAgentSize(): Promise<"small" | "medium" | "large" | undefined> {
  try {
    const client = await sdk();
    const inventory = (await client.agent.currentPlan()).slotInventory ?? {};
    for (const tier of TIER_ORDER) {
      if ((inventory[tier]?.available ?? 0) > 0) return tier;
    }
  } catch {
    // Catalog unavailable — leave the choice to the backend default.
  }
  return undefined;
}

export async function planSummary(): Promise<PlanSummary> {  const client = await sdk();
  const plan = await client.agent.currentPlan();
  const renews = plan.agentSlots
    .map((slot) => slot.expiresAt)
    .filter((d): d is Date => d instanceof Date && !Number.isNaN(d.getTime()))
    .sort((a, b) => a.getTime() - b.getTime())[0];
  return {
    name: plan.name || plan.id,
    agents: plan.agents ?? 0,
    renews_at: renews ? renews.toISOString() : null,
  };
}

export interface UsageMetrics {
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  requests: number;
}

export interface UsageDay extends UsageMetrics {
  date: string;
}

export interface UsageKeyEntry extends UsageMetrics {
  key_hash: string;
  name: string;
}

export interface UsageAgentEntry extends UsageMetrics {
  agent_id: string;
  name: string;
  managed: boolean;
  avatar_url: string | null;
}

export interface UsageSummary {
  days: number;
  history: UsageDay[] | null;
  keys: UsageKeyEntry[] | null;
  agents: UsageAgentEntry[] | null;
  unattributed: UsageMetrics | null;
}

const toMetrics = (m: {
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  requests: number;
}): UsageMetrics => ({
  total_tokens: m.totalTokens,
  prompt_tokens: m.promptTokens,
  completion_tokens: m.completionTokens,
  requests: m.requests,
});

export async function usageSummary(days = 7): Promise<UsageSummary> {
  const client = await sdk();
  const report: HyperAgentUsageReport = await client.agent.usageReport(days);
  return {
    days: report.days,
    history: report.history
      ? report.history.map((d) => ({ date: d.date, ...toMetrics(d) }))
      : null,
    keys: report.keys
      ? report.keys.map((k) => ({ key_hash: k.keyHash, name: k.name, ...toMetrics(k) }))
      : null,
    agents: report.agents
      ? report.agents.map((a) => ({
          agent_id: a.agentId,
          name: a.name,
          managed: a.managed,
          avatar_url: a.avatarUrl,
          ...toMetrics(a),
        }))
      : null,
    unattributed: report.unattributed ? toMetrics(report.unattributed) : null,
  };
}

// ---------------------------------------------------------------------------
// Routines — ts-sdk RoutinesAPI (desktop wire speaks snake_case).
// ---------------------------------------------------------------------------

export interface Routine {
  id: string;
  user_id: string | null;
  agent_id: string | null;
  name?: string | null;
  cron?: string | null;
  prompt: string;
  enabled: boolean;
  run_at?: string | null;
  session_id?: string | null;
  next_run_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

function routineFromSdk(r: SdkRoutine): Routine {
  return {
    id: r.id,
    user_id: r.userId || null,
    agent_id: r.agentId || null,
    name: r.name,
    cron: r.cron,
    prompt: r.prompt,
    enabled: r.enabled,
    run_at: r.runAt,
    session_id: r.sessionId,
    next_run_at: r.nextRunAt,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  };
}

export type RoutineCreateInput = Pick<
  RoutineCreateOptions,
  "agentId" | "prompt" | "cron" | "runAt" | "name" | "sessionId" | "enabled"
>;

export type RoutineUpdatePatch = Pick<RoutineUpdateOptions, "prompt" | "cron" | "name" | "sessionId" | "enabled"> & {
  runAt?: string;
};

export const routinesList = async (agentId?: string) =>
  (await (await sdk()).routines.list(agentId ? { agentId } : {})).map(routineFromSdk);
export const routinesCreate = async (input: RoutineCreateInput) =>
  routineFromSdk(await (await sdk()).routines.create(input));
export const routinesUpdate = async (id: string, patch: RoutineUpdatePatch) =>
  routineFromSdk(await (await sdk()).routines.update(id, patch));
export const routinesDelete = async (id: string) => {
  await (await sdk()).routines.delete(id);
};

// ---------------------------------------------------------------------------
// Logs / shell / desktop URLs.
// ---------------------------------------------------------------------------

const agentWsBase = agentsBridgeWsBase;

export const agentLogsToken = async (id: string): Promise<AgentLogsToken> => {
  const client = await sdk();
  const ends = await endpoints();
  const token = await client.deployments.logsToken(id);
  return { ...token, api_base: ends.apiBase };
};

export type AgentShellToken = AgentShellTokenResponse;

export const agentShellToken = async (id: string, shell?: string): Promise<AgentShellToken> => {
  const client = await sdk();
  return client.deployments.shellToken(id, shell);
};

export async function agentDesktopUrl(id: string): Promise<AgentDesktopUrl> {
  const client = await sdk();
  const { url, expiresAt } = await client.deployments.desktopUrl(id);
  return { url, expires_at: expiresAt ? expiresAt.toISOString() : null };
}

// ---------------------------------------------------------------------------
// ACP sessions & chat — direct WS through ts-sdk (no CORS on WebSocket).
// ---------------------------------------------------------------------------

// One derivation shared by chat, the sessions sweep, dev, and packaged: the
// backend ACP bridge accepts the credential as a ?token= query param, so both
// modes dial it directly with a native WebSocket — no tunnel, no proxy.
export async function acpConnectTarget(agentId: string): Promise<CodingAgentAcpTarget> {
  const creds = await acpCredentials();
  const url = new URL(defaultHyperAcpWsUrl(resolveEndpoints(creds).apiBase));
  url.searchParams.set("agent_id", agentId);
  url.searchParams.set("token", creds.token);
  return { url: url.toString(), token: "" };
}

export async function agentLogsUrl(id: string) {
  const [ends, token] = await Promise.all([endpoints(), agentLogsToken(id)]);
  const base = token.ws_url?.trim()
    ? token.ws_url
    : `${agentWsBase(ends.apiBase)}/logs/${id}`;
  const url = new URL(base);
  url.searchParams.set("token", token.token);
  if (!url.searchParams.has("container")) url.searchParams.set("container", "reef");
  if (!url.searchParams.has("tail_lines")) url.searchParams.set("tail_lines", "100");
  return url.toString();
}

export async function agentShellUrl(id: string) {
  const token = await agentShellToken(id);
  const url = new URL(token.ws_url);
  url.searchParams.set("token", token.token);
  url.searchParams.set("shell", token.shell || "/bin/bash");
  return url.toString();
}

// Exactly one interactive shell per agent: claimAgentShellSocket supersedes
// any previous socket for the same agent, so remounts and reconnect races can
// never stack shells.
const agentShellSockets = new Map<string, WebSocket>();

export function claimAgentShellSocket(id: string, socket: WebSocket): void {
  const previous = agentShellSockets.get(id);
  if (previous && previous !== socket && previous.readyState !== WebSocket.CLOSED) {
    try {
      previous.close(1000, "Superseded by a new shell");
    } catch {
      // Ignore close races; the old socket is dead either way.
    }
  }
  agentShellSockets.set(id, socket);
}

export function releaseAgentShellSocket(id: string, socket: WebSocket): void {
  if (agentShellSockets.get(id) === socket) agentShellSockets.delete(id);
}

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

/**
 * Session listing for runtime-family agents (OpenClaw, Hermes). The canonical
 * source is the runtime's own session client — for OpenClaw that is the
 * gateway `sessions.list`, which also carries titles (`label` falls back to
 * the gateway displayName in the SDK mapping).
 */
export async function listRuntimeSessions(id: string): Promise<AcpSessionList> {
  const sessions = await withRuntimeSession(id, (session) => session.sessionsList());
  return {
    sessions: sessions.map((s) => ({
      session_id: s.key,
      title: s.label ?? null,
      cwd: null,
      updated_at: null,
    })),
    next_cursor: null,
  };
}

export async function listAcpSessions(id: string): Promise<AcpSessionList> {
  const client = await CodingAgentAcpClient.connect(await acpConnectTarget(id), {
    clientInfo: { name: "hypercli-desktop-ng", version: "0.1.0" },
  });
  try {
    const response = await client.listSessions();
    return {
      sessions: (response.sessions ?? []).map((session) => ({
        session_id: session.sessionId,
        title: session.title ?? null,
        cwd: session.cwd ?? null,
        updated_at: session.updatedAt ?? null,
      })),
      next_cursor: response.nextCursor ?? null,
    };
  } finally {
    client.close();
  }
}

// ---------------------------------------------------------------------------
// Agent files — ts-sdk (Reef-backed).
// ---------------------------------------------------------------------------

export const agentFiles = async (id: string, path = ""): Promise<AgentFileEntry[]> =>
  (await sdk()).deployments.filesList(id, path);

export const agentFileRead = async (id: string, path: string): Promise<string> =>
  (await sdk()).deployments.fileRead(id, path, { maxBytes: 500_000 });

export const agentFileReadBytes = async (id: string, path: string): Promise<Uint8Array<ArrayBuffer>> =>
  // The SDK builds this from `response.arrayBuffer()`, so the backing store is
  // always a plain ArrayBuffer and never shared. Narrowing it here lets callers
  // hand the bytes straight to Blob without re-copying them.
  (await (await sdk()).deployments.fileReadBytes(id, path)) as Uint8Array<ArrayBuffer>;

export const agentFileWrite = async (id: string, path: string, bytes: Uint8Array) => {
  await (await sdk()).deployments.fileWriteBytes(id, path, bytes);
};

// ---------------------------------------------------------------------------
// Runtime (OpenClaw/Hermes) chat — the SDK's agent classes own the session.
// ---------------------------------------------------------------------------

/**
 * The canonical session client for a runtime-family agent.
 *
 * Both return `AgentSessionClient`s (`chatHistory` / `chatSend` /
 * `sessionsList`, …), but their lifetimes differ, which is why this helper
 * takes the operation instead of handing the client out:
 *
 * - **OpenClaw** sessions run over the *pooled* deployment-scoped gateway
 *   (`acquireConnectedGateway` — one socket per
 *   `${id}:${launchEpoch}:${gatewayUrl}`, not one per history load and per
 *   send). The pool owns the socket; the caller releases its lease. Calling
 *   `close()` on the session would close the shared socket out from under
 *   every other lease holder.
 * - **Hermes** sessions are a stateless HTTP/SSE client from
 *   `HermesAgent.connect()` — nothing to pool, fine to close.
 *
 * Never hold the returned `Agent`s as state (HANDOFF traps): they are built
 * fresh per response and carry redacted credentials; each call re-`get`s.
 */
async function withRuntimeSession<T>(
  id: string,
  fn: (session: AgentSessionClient) => Promise<T>,
): Promise<T> {
  const client = await sdk();
  const agent = await client.deployments.get(id);
  if (agent instanceof OpenClawAgent) {
    const lease = await agent.acquireConnectedGateway();
    try {
      // The client is already connected (the lease awaited its hello), so the
      // canonical view needs no `connect()` of its own.
      return await fn(new OpenClawSessionClient(lease.client));
    } finally {
      lease.release();
    }
  }
  if (agent instanceof HermesAgent) {
    const session = await agent.connect();
    try {
      return await fn(session);
    } finally {
      session.close();
    }
  }
  throw new Error(`Runtime "${agent.runtime ?? "unknown"}" does not expose chat sessions.`);
}

function toRuntimeChatMessage(message: AgentSessionMessage): RuntimeChatMessage {
  return {
    role: message.role,
    text: message.text,
    ...(message.thinking ? { thinking: message.thinking } : {}),
    ...(message.toolCalls ? { toolCalls: message.toolCalls } : {}),
    ...(message.timestamp !== undefined ? { timestamp: message.timestamp } : {}),
    ...(message.messageId ? { messageId: message.messageId } : {}),
  };
}

export async function runtimeHistory(id: string): Promise<RuntimeChatMessage[]> {
  return runtimeHistoryForSession(id, "main");
}

export async function runtimeHistoryForSession(id: string, sessionKey: string): Promise<RuntimeChatMessage[]> {
  const rows = await withRuntimeSession(id, (session) =>
    session.chatHistory(sessionKey, 200),
  );
  return rows.map(toRuntimeChatMessage);
}

export async function streamRuntimeMessage(
  id: string,
  text: string,
  onEvent: (event: RuntimeChatEvent) => void,
  sessionKey?: string | null,
) {
  const key = sessionKey ?? "main";
  await withRuntimeSession(id, async (session) => {
    for await (const event of session.chatSend(text, key)) {
      onEvent(event);
    }
  });
}

/**
 * Abort an in-flight runtime chat run. `sessionKey`/`runId` come from the
 * stream itself (`RuntimeChatEvent.sessionKey`/`runId`); Hermes cannot abort
 * without a run id, so when the stream never reported one there was nothing to
 * stop and this simply no-ops at the caller.
 */
export async function runtimeChatAbort(id: string, sessionKey?: string, runId?: string): Promise<void> {
  await withRuntimeSession(id, (session) => session.chatAbort(sessionKey, runId));
}
