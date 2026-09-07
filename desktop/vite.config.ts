import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { defineConfig, type Plugin } from "vite";
import NodeWebSocket, { WebSocketServer } from "ws";
import { HTTPClient } from "../ts-sdk/dist/http.js";
import {
  DEFAULT_CODING_AGENT_IMAGES,
  Deployments,
  HermesAgent,
  OpenClawAgent,
  type AgentLaunchConfig,
  defaultHyperAcpWsUrl,
} from "../ts-sdk/dist/agents.js";
import type { AgentSessionClient } from "../ts-sdk/dist/session.js";

const API_KEY_KEYS = ["HYPER_AGENTS_API_KEY", "HYPER_API_KEY", "HYPERCLI_API_KEY"];
const API_BASE_KEYS = ["AGENTS_API_BASE_URL", "HYPER_API_BASE", "HYPERCLI_API_URL"];
const DEFAULT_API_BASE = "https://api.hypercli.com/agents";
const ACP_CREATE_METHODS = {
  opencode: "createOpenCode",
  "claude-code": "createClaudeCode",
  codex: "createCodex",
  goose: "createGoose",
  "kimi-code": "createKimiCode",
  "buzz-agent": "createBuzzAgent",
} as const;
const ACP_RUNTIME_HARNESSES: Record<keyof typeof ACP_CREATE_METHODS, { command: string; args: string[] }> = {
  "buzz-agent": { command: "/usr/local/bin/hyper-acp", args: ["plugin", "buzz"] },
  opencode: { command: "/usr/local/bin/opencode", args: ["acp"] },
  codex: { command: "/usr/local/bin/codex-acp", args: [] },
  "claude-code": { command: "/usr/local/bin/claude-agent-acp", args: [] },
  goose: { command: "/usr/local/bin/goose", args: ["acp"] },
  "kimi-code": { command: "/usr/local/bin/kimi", args: ["acp"] },
};

const runtimeAgentCache = new Map<string, OpenClawAgent | HermesAgent>();
const runtimeSessionCache = new Map<string, Promise<AgentSessionClient>>();

function localConfig() {
  const values = new Map<string, string>();
  try {
    const body = readFileSync(join(homedir(), ".hypercli", "config"), "utf8");
    for (const raw of body.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const index = line.indexOf("=");
      if (index === -1) continue;
      values.set(line.slice(0, index).trim(), line.slice(index + 1).trim());
    }
  } catch {
    // Missing config is reported as signed_out by the dev bridge.
  }
  const env = process.env as Record<string, string | undefined>;
  const first = (keys: string[]) =>
    keys.map((key) => env[key] || values.get(key)).find((value) => value?.trim());
  return {
    token: first(API_KEY_KEYS)?.trim() ?? "",
    apiBase: normalizeAgentsApiBase(first(API_BASE_KEYS)?.trim() ?? DEFAULT_API_BASE),
  };
}

function normalizeAgentsApiBase(value: string) {
  const withProtocol = /^https?:\/\//.test(value) ? value : `https://${value}`;
  const url = new URL(withProtocol);
  url.pathname = url.pathname.replace(/\/+$/, "");
  if (!url.pathname || url.pathname === "/") url.pathname = "/agents";
  if (url.pathname.endsWith("/api")) url.pathname = `${url.pathname.slice(0, -4)}/agents`;
  return url.toString().replace(/\/+$/, "");
}

function devBridge(): Plugin {
  return {
    name: "desktop-ng-dev-bridge",
    apply: "serve",
    configureServer(server) {
      const acpProxy = new WebSocketServer({ noServer: true });
      server.httpServer?.on("upgrade", (req, socket, head) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        if (url.pathname !== "/__desktop_ng/acp") return;
        acpProxy.handleUpgrade(req, socket, head, (client) => {
          proxyAcpWebSocket(client, url.searchParams.get("agent_id") ?? "");
        });
      });
      server.middlewares.use("/__desktop_ng/stream", async (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end("Method not allowed");
          return;
        }
        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(Buffer.from(chunk));
          const { command, args = {} } = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (command !== "runtime_message_stream") throw new Error(`${command} is not streamable`);
          res.statusCode = 200;
          res.setHeader("content-type", "application/x-ndjson");
          res.setHeader("cache-control", "no-cache");
          await streamRuntimeMessage(args as Record<string, unknown>, (event) => {
            res.write(`${JSON.stringify(event)}\n`);
          });
          res.end();
        } catch (error) {
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader("content-type", "application/x-ndjson");
          }
          res.write(`${JSON.stringify({ type: "error", text: error instanceof Error ? error.message : String(error) })}\n`);
          res.end();
        }
      });
      server.middlewares.use("/__desktop_ng/invoke", async (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end("Method not allowed");
          return;
        }
        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(Buffer.from(chunk));
          const { command, args = {} } = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          const result = await handleDevCommand(command, args as Record<string, unknown>);
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ ok: true, result }));
        } catch (error) {
          res.statusCode = 500;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
        }
      });
    },
  };
}

function proxyAcpWebSocket(client: NodeWebSocket, agentId: string) {
  const config = localConfig();
  if (!config.token) {
    client.close(4401, "No HyperCLI credential found");
    return;
  }
  if (!agentId) {
    client.close(1008, "Missing agent_id");
    return;
  }

  const target = new URL(defaultHyperAcpWsUrl(config.apiBase));
  target.searchParams.set("agent_id", agentId);
  const upstream = new NodeWebSocket(target, {
    headers: { authorization: `Bearer ${config.token}` },
  });
  const pending: Array<{ data: NodeWebSocket.RawData; isBinary: boolean }> = [];
  let upstreamOpen = false;

  client.on("message", (data, isBinary) => {
    if (upstreamOpen) {
      sendFrame(upstream, data, isBinary);
    } else {
      pending.push({ data, isBinary });
    }
  });
  upstream.on("open", () => {
    upstreamOpen = true;
    for (const { data, isBinary } of pending.splice(0)) sendFrame(upstream, data, isBinary);
  });
  upstream.on("message", (data, isBinary) => {
    if (client.readyState === NodeWebSocket.OPEN) sendFrame(client, data, isBinary);
  });
  upstream.on("close", (code, reason) => {
    if (client.readyState === NodeWebSocket.OPEN) client.close(closeCode(code), reason.toString());
  });
  client.on("close", () => {
    if (upstream.readyState === NodeWebSocket.OPEN || upstream.readyState === NodeWebSocket.CONNECTING) {
      upstream.close();
    }
  });
  upstream.on("error", (error) => {
    if (client.readyState === NodeWebSocket.OPEN) client.close(1011, error.message.slice(0, 120));
  });
}

function sendFrame(socket: NodeWebSocket, data: NodeWebSocket.RawData, isBinary: boolean) {
  socket.send(isBinary ? data : data.toString(), { binary: isBinary });
}

function closeCode(code: number) {
  if (code === 1005 || code === 1006 || code === 1015) return 1011;
  return code;
}

async function streamRuntimeMessage(
  args: Record<string, unknown>,
  emit: (event: Record<string, unknown>) => void,
) {
  const config = localConfig();
  if (!config.token) throw new Error("No HyperCLI credential found in ~/.hypercli/config");
  const id = requiredId(args);
  const text = typeof args.text === "string" ? args.text.trim() : "";
  if (!text) throw new Error("Message is empty");
  const { agent, session, sessionKey } = await runtimeSessionForAgent(config, id);
  try {
    for await (const event of session.chatSend(text, sessionKey)) {
      emit(event as unknown as Record<string, unknown>);
    }
  } catch (error) {
    forgetRuntimeSession(config, agent.id, agent.runtime);
    throw error;
  }
}

async function handleDevCommand(command: string, args: Record<string, unknown>) {
  const config = localConfig();
  if (command === "auth_status") {
    return { signed_in: Boolean(config.token), api_base: config.apiBase };
  }
  if (!config.token) throw new Error("No HyperCLI credential found in ~/.hypercli/config");
  if (command === "list_agents") return api(config, "deployments").then((page) => (page.items ?? []).map(agentSummary));
  if (command === "acp_credentials") return { api_base: config.apiBase, token: config.token };
  if (command === "agent_logs_token") {
    const token = await api(config, `deployments/${requiredId(args)}/logs/token`, { method: "POST" });
    return { ...token, api_base: config.apiBase };
  }
  if (command === "plan_summary") return api(config, "plans/current");
  if (command === "create_agent") {
    const name = typeof args.name === "string" && args.name.trim() ? args.name.trim() : "New agent";
    const runtime = typeof args.runtime === "string" && args.runtime.trim() ? args.runtime.trim() : "opencode";
    const size = typeof args.size === "string" && args.size.trim() ? args.size.trim() : await defaultAgentSize(config);
    const image = typeof args.image === "string" && args.image.trim() ? args.image.trim() : undefined;
    const buzzPrivateKeyNsec = typeof args.buzzPrivateKeyNsec === "string" ? args.buzzPrivateKeyNsec.trim() : "";
    const buzzRelayUrl = typeof args.buzzRelayUrl === "string" && args.buzzRelayUrl.trim() ? args.buzzRelayUrl.trim() : "wss://relay.buzz.hypercli.com";
    const deployments = deploymentsClient(config);
    if (runtime === "openclaw") return agentSummary(await deployments.createOpenClaw({ name, size, image }));
    if (runtime === "openclaw-pro") return agentSummary(await deployments.createOpenClawPro({ name, size, image }));
    if (runtime === "hermes-agent") return agentSummary(await deployments.createHermesAgent({ name, size, image }));
    if (runtime in ACP_CREATE_METHODS) {
      const method = ACP_CREATE_METHODS[runtime as keyof typeof ACP_CREATE_METHODS];
      const runtimeImage = DEFAULT_CODING_AGENT_IMAGES[runtime as keyof typeof ACP_CREATE_METHODS];
      const acpRuntime = runtime as keyof typeof ACP_CREATE_METHODS;
      const systemPrompt = agentSystemPrompt({ name, runtime: acpRuntime });
      if (acpRuntime === "buzz-agent") {
        if (!buzzPrivateKeyNsec) throw new Error("Buzz Agent requires an nsec private key.");
        return agentSummary(await deployments[method]({
          name,
          size,
          image: image ?? runtimeImage,
          buzz: {
            privateKeyNsec: buzzPrivateKeyNsec,
            relayUrl: buzzRelayUrl,
            displayName: name,
            sessionTitle: name,
            systemPrompt,
          },
        }));
      }
      return agentSummary(await deployments[method]({
        name,
        size,
        image: image ?? runtimeImage,
        command: ["/usr/local/bin/hyper-acp"],
        env: vanillaAcpEnv(config, ACP_RUNTIME_HARNESSES[acpRuntime], systemPrompt),
        routes: {},
        restart: false,
      }));
    }
    return agentSummary(await deployments.create({ name, runtime: runtime as never, size, image }));
  }
  if (command === "start_agent") {
    const id = requiredId(args);
    const deployments = deploymentsClient(config);
    const agent = await deployments.get(id);
    if (agent.runtime === "openclaw" || agent.runtime === "openclaw-pro") {
      let gatewayToken: string | undefined;
      try {
        const secret = await deployments.secret(id, "OPENCLAW_GATEWAY_TOKEN");
        const value = String(secret.value ?? "").trim();
        if (value) gatewayToken = value;
      } catch {
        // Older broken OpenClaw agents may not have the gateway secret yet.
      }
      if (!gatewayToken) {
        gatewayToken = randomBytes(32).toString("hex");
        await deployments.setSecret(id, "OPENCLAW_GATEWAY_TOKEN", gatewayToken);
      }
      return agentSummary(await deployments.startOpenClaw(id, {
        gatewayToken,
        launchConfig: {
          ...agent.launchConfig,
          env: {
            ...(agent.launchConfig?.env ?? {}),
            OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN: "http://localhost:1420",
          },
        },
      }));
    }
    if (agent.runtime && agent.runtime in ACP_CREATE_METHODS) {
      const runtime = agent.runtime as keyof typeof ACP_CREATE_METHODS;
      const launchConfig = await deployments.storedLaunchConfig(id);
      return agentSummary(await deployments.start(id, {
        launchConfig: hostedAcpLaunchConfig(config, runtime, launchConfig, agent),
      }));
    }
    return agentSummary(await deployments.start(id));
  }
  if (command === "runtime_history") {
    const { agent, session, sessionKey } = await runtimeSessionForAgent(config, requiredId(args));
    try {
      const messages = await session.chatHistory(sessionKey, 50);
      return messages
        .filter((message) => message.text?.trim())
        .map((message) => ({
          role: message.role,
          text: message.text,
          ...(message.thinking ? { thinking: message.thinking } : {}),
          ...(Array.isArray(message.toolCalls) ? { toolCalls: message.toolCalls } : {}),
          ...(message.timestamp ? { timestamp: message.timestamp } : {}),
          ...(message.messageId ? { messageId: message.messageId } : {}),
        }));
    } catch (error) {
      forgetRuntimeSession(config, agent.id, agent.runtime);
      throw error;
    }
  }
  if (command === "agent_files") {
    const path = typeof args.path === "string" ? args.path : "";
    const agent = await deploymentsClient(config).get(requiredId(args));
    return agent.filesList(path);
  }
  if (command === "agent_exec") {
    const commandText = typeof args.command === "string" ? args.command.trim() : "";
    if (!commandText) throw new Error("Command is empty");
    const timeout = typeof args.timeout === "number" ? args.timeout : 30;
    const agent = await deploymentsClient(config).get(requiredId(args));
    return agent.exec(["sh", "-lc", commandText], { timeout });
  }
  if (command === "stop_agent") return agentSummary(await api(config, `deployments/${requiredId(args)}/stop`, { method: "POST" }));
  if (command === "archive_agent") return agentSummary(await api(config, `deployments/${requiredId(args)}/archive`, { method: "POST" }));
  if (command === "restore_agent") return agentSummary(await api(config, `deployments/${requiredId(args)}/restore`, { method: "POST" }));
  if (command === "delete_agent") return api(config, `deployments/${requiredId(args)}`, { method: "DELETE" });
  throw new Error(`${command} is only available in the Tauri app`);
}

function agentSummary(value: unknown) {
  const item = value as Record<string, unknown>;
  return {
    id: String(item.id ?? ""),
    name: String(item.name ?? ""),
    handle: typeof item.handle === "string" ? item.handle : null,
    avatar_url: typeof item.avatar_url === "string"
      ? item.avatar_url
      : typeof item.avatarUrl === "string" ? item.avatarUrl : null,
    runtime: typeof item.runtime === "string" ? item.runtime : null,
    state: String(item.state ?? ""),
    hostname: typeof item.hostname === "string" ? item.hostname : null,
    launch_epoch: Number(item.launch_epoch ?? item.launchEpoch ?? 0),
    size: typeof item.requested_size === "string"
      ? item.requested_size
      : typeof item.requestedSize === "string"
        ? item.requestedSize
        : typeof item.size === "string" ? item.size : null,
  };
}

function hostedAcpLaunchConfig(
  config: { apiBase: string },
  runtime: keyof typeof ACP_CREATE_METHODS,
  launchConfig: AgentLaunchConfig,
  agent?: { name?: string | null; runtime?: string | null; hostname?: string | null },
): AgentLaunchConfig {
  if (runtime === "buzz-agent") {
    const env = {
      ...(launchConfig.env ?? {}),
      BUZZ_ACP_DISPLAY_NAME: launchConfig.env?.BUZZ_ACP_DISPLAY_NAME ?? "HyperCLI agent",
      BUZZ_ACP_SYSTEM_PROMPT: launchConfig.env?.BUZZ_ACP_SYSTEM_PROMPT ?? agentSystemPrompt(agent ?? { runtime }),
    };
    return {
      ...launchConfig,
      env,
      image: launchConfig.image ?? DEFAULT_CODING_AGENT_IMAGES[runtime],
      routes: {},
      command: ["/usr/local/bin/hyper-acp", "plugin", "buzz"],
      restart: false,
    };
  }

  const env = { ...(launchConfig.env ?? {}) };
  for (const key of [
    "BUZZ_ACP_AGENT_COMMAND",
    "BUZZ_ACP_AGENT_ARGS",
    "BUZZ_ACP_MCP_COMMAND",
    "BUZZ_ACP_LAZY_POOL",
    "BUZZ_ACP_RELAY_OBSERVER",
    "BUZZ_ACP_AGENTS",
    "BUZZ_ACP_MULTIPLE_EVENT_HANDLING",
    "BUZZ_ACP_DEDUP",
    "BUZZ_ACP_SESSION_TITLE",
    "BUZZ_RELAY_URL",
    "HYPER_ACP_WS_URL",
    "HYPER_ACP_WS_LISTEN",
    "HYPER_ACP_LOG",
    "HYPER_ACP_WS_TOKEN",
    "HYPER_ACP_AGENT_COMMAND",
    "HYPER_ACP_AGENT_ARGS",
  ]) {
    delete env[key];
  }
  if (runtime === "claude-code") env.CLAUDE_CODE_EXECUTABLE = "/usr/local/bin/claude";
  return {
    ...launchConfig,
    env: {
      ...env,
      ...vanillaAcpEnv(config, ACP_RUNTIME_HARNESSES[runtime], agentSystemPrompt(agent ?? { runtime })),
    },
    image: launchConfig.image ?? DEFAULT_CODING_AGENT_IMAGES[runtime],
    routes: {},
    command: ["/usr/local/bin/hyper-acp"],
    restart: false,
  };
}

function vanillaAcpEnv(
  config: { apiBase: string },
  harness: { command: string; args: string[] },
  systemPrompt: string,
) {
  return {
    HYPER_ACP_WS_URL: defaultHyperAcpWsUrl(config.apiBase),
    HYPER_ACP_AGENT_COMMAND: harness.command,
    HYPER_ACP_AGENT_ARGS: harness.args.join(" "),
    HYPER_ACP_SYSTEM_PROMPT: systemPrompt,
  };
}

function agentSystemPrompt(agent: { name?: string | null; runtime?: string | null; hostname?: string | null }) {
  return [
    "You are a HyperCLI hosted agent running in HyperCLI Desktop.",
    agent.name ? `Agent name: ${agent.name}.` : null,
    agent.runtime ? `Runtime: ${agent.runtime}.` : null,
    agent.hostname ? `Hostname: ${agent.hostname}.` : null,
    "You have a persistent cloud workspace at /home/node.",
    "When asked who you are, answer as this HyperCLI agent, not only as the underlying runtime CLI.",
  ].filter(Boolean).join("\n");
}

async function cachedRuntimeAgent(
  config: { apiBase: string; token: string },
  id: string,
  fresh?: OpenClawAgent | HermesAgent,
) {
  const key = runtimeCacheKey(config, id);
  const cached = runtimeAgentCache.get(key);
  if (cached && (!fresh || cached.launchEpoch === fresh.launchEpoch)) return cached;
  const agent = fresh ?? await deploymentsClient(config).get(id);
  if (!(agent instanceof OpenClawAgent) && !(agent instanceof HermesAgent)) {
    throw new Error(`Runtime history is not wired for ${agent.runtime ?? "this agent"}`);
  }
  runtimeAgentCache.set(key, agent);
  return agent;
}

function runtimeCacheKey(config: { apiBase: string }, id: string, runtime?: string | null) {
  return `${config.apiBase}:${runtime ?? "agent"}:${id}`;
}

async function runtimeSessionForAgent(
  config: { apiBase: string; token: string },
  id: string,
) {
  const agent = await cachedRuntimeAgent(config, id);
  const session = await cachedRuntimeSession(config, agent);
  const sessionKey = await ensureRuntimeSessionKey(session);
  return { agent, session, sessionKey };
}

async function cachedRuntimeSession(
  config: { apiBase: string; token: string },
  agent: OpenClawAgent | HermesAgent,
) {
  const key = runtimeCacheKey(config, agent.id, agent.runtime);
  let promise = runtimeSessionCache.get(key);
  if (!promise) {
    promise = openRuntimeSession(agent).catch((error) => {
      runtimeSessionCache.delete(key);
      throw error;
    });
    runtimeSessionCache.set(key, promise);
  }
  return promise;
}

function forgetRuntimeSession(config: { apiBase: string }, id: string, runtime?: string | null) {
  const key = runtimeCacheKey(config, id, runtime);
  runtimeSessionCache.get(key)?.then((session) => session.close()).catch(() => {});
  runtimeSessionCache.delete(key);
}

async function openRuntimeSession(agent: OpenClawAgent | HermesAgent): Promise<AgentSessionClient> {
  if (agent instanceof HermesAgent) return agent.connect({ timeoutMs: 60_000 });
  const previousWebSocket = globalThis.WebSocket;
  try {
    // Node 22 exposes undici's WebSocket globally; the OpenClaw SDK's Node
    // gateway path is more reliable with the ws package it loads itself.
    (globalThis as typeof globalThis & { WebSocket?: typeof globalThis.WebSocket }).WebSocket = undefined;
    return await agent.connectSession({
      clientId: "desktop-ng",
      clientMode: "webchat",
      origin: "http://localhost:1420",
    });
  } finally {
    (globalThis as typeof globalThis & { WebSocket?: typeof globalThis.WebSocket }).WebSocket = previousWebSocket;
  }
}

async function ensureRuntimeSessionKey(session: AgentSessionClient) {
  if (session.runtimeKind === "openclaw") return "main";
  const existing = await session.sessionsList();
  if (existing.some((item) => item.key === "main")) return "main";
  try {
    await session.sessionsCreate({ key: "main", label: "Main" });
  } catch {
    const refreshed = await session.sessionsList();
    if (!refreshed.some((item) => item.key === "main")) throw new Error("Could not create Hermes main session");
  }
  return "main";
}

async function defaultAgentSize(config: { apiBase: string; token: string }) {
  const plan = await api(config, "plans/current").catch(() => null) as Record<string, unknown> | null;
  const inventory = plan?.slot_inventory;
  if (inventory && typeof inventory === "object" && !Array.isArray(inventory)) {
    for (const size of ["large", "medium", "small"]) {
      const row = (inventory as Record<string, unknown>)[size];
      const available = row && typeof row === "object" ? Number((row as Record<string, unknown>).available ?? 0) : 0;
      if (available > 0) return size;
    }
  }
  const max = typeof plan?.max_agent_size === "string" ? plan.max_agent_size : "";
  if (["large", "medium", "small"].includes(max)) return max;
  return "small";
}

function deploymentsClient(config: { apiBase: string; token: string }) {
  return new Deployments(new HTTPClient(config.apiBase, config.token), config.token, config.apiBase);
}

function requiredId(args: Record<string, unknown>) {
  if (typeof args.id !== "string" || !args.id) throw new Error("Missing id");
  return args.id;
}

async function api(
  config: { apiBase: string; token: string },
  path: string,
  init: RequestInit = {},
) {
  const response = await fetch(`${config.apiBase}/${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${config.token}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) throw new Error(await responseErrorMessage(response));
  if (response.status === 204) return null;
  return response.json();
}

async function responseErrorMessage(response: Response) {
  const fallback = `${response.status} ${response.statusText}`;
  try {
    const payload = await response.clone().json() as Record<string, unknown>;
    const detail = payload.detail ?? payload.error ?? payload.message;
    if (typeof detail === "string" && detail.trim()) return `${fallback}: ${detail}`;
    if (Array.isArray(detail)) return `${fallback}: ${detail.map(formatDetail).join("; ")}`;
    if (detail && typeof detail === "object") return `${fallback}: ${formatDetail(detail)}`;
    return `${fallback}: ${JSON.stringify(payload)}`;
  } catch {
    const text = await response.text().catch(() => "");
    return text.trim() ? `${fallback}: ${text.trim()}` : fallback;
  }
}

function formatDetail(value: unknown): string {
  if (!value || typeof value !== "object") return String(value);
  const record = value as Record<string, unknown>;
  const loc = Array.isArray(record.loc) ? `${record.loc.join(".")}: ` : "";
  const msg = typeof record.msg === "string" ? record.msg : JSON.stringify(record);
  return `${loc}${msg}`;
}

export default defineConfig({
  plugins: [devBridge(), react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    target: "es2022",
  },
});
