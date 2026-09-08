import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { defineConfig, type Plugin } from "vite";
import NodeWebSocket, { WebSocketServer } from "ws";
import { HTTPClient } from "../ts-sdk/src/http.ts";
import {
  DEFAULT_CODING_AGENT_IMAGES,
  Deployments,
  HermesAgent,
  OpenClawAgent,
  type AgentLaunchConfig,
  defaultHyperAcpWsUrl,
} from "../ts-sdk/src/agents.ts";
import { agentsBridgeWsBase } from "../ts-sdk/src/agent-urls.ts";
import type { AgentSessionClient } from "../ts-sdk/src/session.ts";

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
      const shellProxy = new WebSocketServer({ noServer: true });
      const logsProxy = new WebSocketServer({ noServer: true });
      server.httpServer?.on("upgrade", (req, socket, head) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        if (url.pathname === "/__desktop_ng/shell") {
          shellProxy.handleUpgrade(req, socket, head, (client) => {
            proxyShellWebSocket(client, url.searchParams.get("agent_id") ?? "");
          });
          return;
        }
        if (url.pathname === "/__desktop_ng/logs") {
          logsProxy.handleUpgrade(req, socket, head, (client) => {
            proxyLogsWebSocket(client, url.searchParams.get("agent_id") ?? "");
          });
        }
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

async function proxyShellWebSocket(client: NodeWebSocket, agentId: string) {
  const config = localConfig();
  if (!config.token) {
    client.close(4401, "No HyperCLI credential found");
    return;
  }
  if (!agentId) {
    client.close(1008, "Missing agent_id");
    return;
  }

  let upstream: NodeWebSocket | null = null;
  try {
    upstream = await withSdkNodeWebSocket(() => deploymentsClient(config).shellConnect(agentId)) as NodeWebSocket;
  } catch (error) {
    client.close(1011, (error instanceof Error ? error.message : String(error)).slice(0, 120));
    return;
  }

  const closeBoth = (code?: number, reason?: string) => {
    if (client.readyState === NodeWebSocket.OPEN) client.close(closeCode(code ?? 1000), reason);
    if (upstream && upstream.readyState === NodeWebSocket.OPEN) upstream.close(code, reason);
  };

  upstream.onmessage = (event) => {
    if (client.readyState !== NodeWebSocket.OPEN) return;
    client.send(event.data as NodeWebSocket.RawData);
  };
  upstream.onclose = (event) => closeBoth(event.code, event.reason);
  upstream.onerror = () => closeBoth(1011, "Shell transport error");
  client.on("message", (data, isBinary) => {
    if (upstream?.readyState === NodeWebSocket.OPEN) {
      upstream.send(isBinary ? data : data.toString());
    }
  });
  client.on("close", (code, reason) => {
    if (upstream?.readyState === NodeWebSocket.OPEN) upstream.close(closeCode(code), reason.toString());
  });
}

async function proxyLogsWebSocket(client: NodeWebSocket, agentId: string) {
  const config = localConfig();
  if (!config.token) {
    client.close(4401, "No HyperCLI credential found");
    return;
  }
  if (!agentId) {
    client.close(1008, "Missing agent_id");
    return;
  }

  let upstream: NodeWebSocket | null = null;
  try {
    const tokenData = await deploymentsClient(config).logsToken(agentId) as Record<string, unknown>;
    const wsUrl = typeof tokenData.ws_url === "string"
      ? tokenData.ws_url
      : `${agentsWsBase(config.apiBase)}/logs/${agentId}`;
    const target = new URL(wsUrl);
    target.searchParams.set("token", String(tokenData.token ?? tokenData.jwt ?? ""));
    target.searchParams.set("tail_lines", "0");
    upstream = new NodeWebSocket(target);
  } catch (error) {
    client.close(1011, (error instanceof Error ? error.message : String(error)).slice(0, 120));
    return;
  }

  const closeBoth = (code?: number, reason?: string) => {
    if (client.readyState === NodeWebSocket.OPEN) client.close(closeCode(code ?? 1000), reason);
    if (upstream && upstream.readyState === NodeWebSocket.OPEN) upstream.close(code, reason);
  };
  upstream.onmessage = (event) => {
    if (client.readyState === NodeWebSocket.OPEN) client.send(event.data as NodeWebSocket.RawData);
  };
  upstream.onclose = (event) => closeBoth(event.code, event.reason);
  upstream.onerror = () => closeBoth(1011, "Log transport error");
  client.on("close", (code, reason) => {
    if (upstream?.readyState === NodeWebSocket.OPEN) upstream.close(closeCode(code), reason.toString());
  });
}

const agentsWsBase = agentsBridgeWsBase;

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
  const requestedSessionKey = typeof args.sessionKey === "string" && args.sessionKey.trim() ? args.sessionKey.trim() : undefined;
  const { agent, session, sessionKey } = await runtimeSessionForAgent(config, id, requestedSessionKey);
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
  if (command === "acp_list_sessions") {
    // The ACP hub shares one upstream connection across chat and session commands.
    const id = requiredId(args);
    const agent = await deploymentsClient(config).get(id);
    if (typeof agent.acpConnect !== "function") {
      throw new Error(`Agent ${id} does not support ACP sessions`);
    }
    const client = await agent.acpConnect({ cwd: "/home/node" });
    try {
      const response = (await client.listSessions()) as {
        sessions?: Array<{ sessionId: string; title?: string | null; cwd?: string | null; updatedAt?: string | null }>;
        nextCursor?: string | null;
      };
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
  if (command === "runtime_list_sessions") {
    const { session } = await runtimeSessionForAgent(config, requiredId(args));
    const sessions = await session.sessionsList();
    return {
      sessions: sessions
        .filter((item) => item.key && !(session.runtimeKind === "openclaw" && item.key === "main"))
        .map((item) => runtimeSessionSummary(session.runtimeKind, item)),
      next_cursor: null,
    };
  }
  if (command === "runtime_create_session") {
    const { session } = await runtimeSessionForAgent(config, requiredId(args));
    const title = typeof args.title === "string" && args.title.trim() ? args.title.trim() : "New session";
    const created = await session.sessionsCreate({ label: title });
    return runtimeSessionSummary(session.runtimeKind, created);
  }
  if (command === "runtime_rename_session") {
    const sessionKey = typeof args.sessionKey === "string" && args.sessionKey.trim() ? args.sessionKey.trim() : "";
    const title = typeof args.title === "string" && args.title.trim() ? args.title.trim() : "";
    if (!sessionKey) throw new Error("Missing session key");
    if (!title) throw new Error("Missing session title");
    const { session } = await runtimeSessionForAgent(config, requiredId(args), sessionKey);
    const renamed = await session.sessionsPatch({ key: sessionKey, label: title });
    return runtimeSessionSummary(session.runtimeKind, renamed);
  }
  if (command === "agent_logs_token") {
    const token = await api(config, `deployments/${requiredId(args)}/logs/token`, { method: "POST" });
    return { ...token, api_base: config.apiBase };
  }
  if (command === "agent_desktop_url") {
    const id = requiredId(args);
    const token = await deploymentsClient(config).refreshToken(id);
    const jwt = (token.jwt ?? token.token ?? "").trim();
    if (!jwt) throw new Error("Desktop token is missing");
    const agent = agentSummary(await deploymentsClient(config).get(id));
    const route = desktopRouteFromSummary(agent);
    if (!route) throw new Error("Desktop route is not enabled for this agent");
    if (agent.state !== "RUNNING") throw new Error("Start the agent to open its desktop");
    const host = typeof agent.hostname === "string" && agent.hostname ? agent.hostname : null;
    if (!host) throw new Error("Agent hostname is unavailable");
    const prefix = typeof route.prefix === "string" ? route.prefix : "desktop";
    const base = prefix === "" ? `https://${host}` : `https://${prefix}-${host}`;
    const auth = new URL("/_jwt_auth", base);
    auth.searchParams.set("jwt", jwt);
    auth.searchParams.set("redirect", "vnc.html?autoconnect=true&resize=scale");
    return { url: auth.toString(), expires_at: token.expires_at ?? null };
  }
  if (command === "upload_agent_avatar") {
    const content = Array.isArray(args.content) ? Uint8Array.from(args.content as number[]) : null;
    if (!content) throw new Error("Avatar image is missing");
    const contentType = typeof args.contentType === "string" && args.contentType.trim()
      ? args.contentType.trim()
      : "image/png";
    return deploymentsClient(config).uploadProfileImage(requiredId(args), content, contentType);
  }
  if (command === "delete_agent_avatar") {
    return deploymentsClient(config).deleteProfileImage(requiredId(args));
  }
  if (command === "plan_summary") return api(config, "plans/current");
  if (command === "usage_summary") {
    const days = Math.min(90, Math.max(1, typeof args.days === "number" && Number.isFinite(args.days) ? Math.floor(args.days) : 7));
    const [history, keys, agents] = await Promise.allSettled([
      api(config, `usage/history?days=${days}`) as Promise<{ history?: unknown[] }>,
      api(config, `usage/keys?days=${days}`) as Promise<{ keys?: unknown[] }>,
      api(config, `usage/agents?days=${days}`) as Promise<{ agents?: unknown[]; unattributed?: unknown }>,
    ]);
    return {
      days,
      history: history.status === "fulfilled" ? history.value?.history ?? [] : null,
      keys: keys.status === "fulfilled" ? keys.value?.keys ?? [] : null,
      agents: agents.status === "fulfilled" ? agents.value?.agents ?? [] : null,
      unattributed: agents.status === "fulfilled" ? agents.value?.unattributed ?? null : null,
    };
  }
  if (command === "routines_list") {
    const agentId = typeof args.agentId === "string" && args.agentId.trim()
      ? `?agent_id=${encodeURIComponent(args.agentId.trim())}`
      : "";
    const payload = await routinesApi(config, `routines${agentId}`) as Record<string, unknown> | unknown[] | null;
    if (Array.isArray(payload)) return payload;
    return Array.isArray(payload?.routines) ? payload.routines : [];
  }
  if (command === "routines_create") {
    const agentId = typeof args.agentId === "string" ? args.agentId.trim() : "";
    const cron = typeof args.cron === "string" ? args.cron.trim() : "";
    const runAt = typeof args.runAt === "string" ? args.runAt.trim() : "";
    const name = typeof args.name === "string" ? args.name.trim() : "";
    const prompt = typeof args.prompt === "string" ? args.prompt : "";
    if (!agentId) throw new Error("Missing agent id");
    if (!cron && !runAt) throw new Error("Missing schedule (cron or run_at)");
    if (!prompt.trim()) throw new Error("Missing prompt");
    return routinesApi(config, "routines", {
      method: "POST",
      body: JSON.stringify({
        agent_id: agentId,
        prompt,
        enabled: typeof args.enabled === "boolean" ? args.enabled : true,
        ...(cron ? { cron } : {}),
        ...(runAt ? { run_at: runAt } : {}),
        ...(name ? { name } : {}),
      }),
    });
  }
  if (command === "routines_update") {
    const patch: Record<string, unknown> = {};
    if (typeof args.cron === "string") patch.cron = args.cron.trim() ? args.cron : null;
    if (typeof args.runAt === "string") patch.run_at = args.runAt.trim() ? args.runAt : null;
    if (typeof args.name === "string") patch.name = args.name.trim() ? args.name : null;
    if (typeof args.prompt === "string") patch.prompt = args.prompt;
    if (typeof args.enabled === "boolean") patch.enabled = args.enabled;
    if (Object.keys(patch).length === 0) throw new Error("Nothing to update");
    return routinesApi(config, `routines/${requiredId(args)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  }
  if (command === "routines_delete") {
    return routinesApi(config, `routines/${requiredId(args)}`, { method: "DELETE" });
  }
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
          env: { HYPER_ACP_PERMISSION_MODE: "default" },
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
    const requestedSessionKey = typeof args.sessionKey === "string" && args.sessionKey.trim() ? args.sessionKey.trim() : undefined;
    const { agent, session, sessionKey } = await runtimeSessionForAgent(config, requiredId(args), requestedSessionKey);
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
  if (command === "agent_file_read") {
    const path = typeof args.path === "string" ? args.path : "";
    if (!path) throw new Error("File path is required");
    const agent = await deploymentsClient(config).get(requiredId(args));
    return agent.fileRead(path, { maxBytes: 500_000 });
  }
  if (command === "agent_file_read_bytes") {
    const path = typeof args.path === "string" ? args.path : "";
    if (!path) throw new Error("File path is required");
    const agent = await deploymentsClient(config).get(requiredId(args));
    const bytes = await agent.fileReadBytes(path, { maxBytes: 20_000_000 });
    return { bytes: Array.from(bytes) };
  }
  if (command === "agent_file_write") {
    const path = typeof args.path === "string" ? args.path : "";
    if (!path) throw new Error("File path is required");
    const bytes = Array.isArray(args.bytes) ? Uint8Array.from(args.bytes as number[]) : null;
    if (!bytes) throw new Error("File bytes are required");
    const agent = await deploymentsClient(config).get(requiredId(args));
    await agent.fileWriteBytes(path, bytes);
    return null;
  }
  if (command === "agent_exec") {
    const commandText = typeof args.command === "string" ? args.command.trim() : "";
    if (!commandText) throw new Error("Command is empty");
    const timeout = typeof args.timeout === "number" ? args.timeout : 30;
    const agent = await deploymentsClient(config).get(requiredId(args));
    return withSdkNodeWebSocket(() => agent.exec(["sh", "-lc", commandText], { timeout }));
  }
  if (command === "stop_agent") return agentSummary(await api(config, `deployments/${requiredId(args)}/stop`, { method: "POST" }));
  if (command === "archive_agent") return agentSummary(await api(config, `deployments/${requiredId(args)}/archive`, { method: "POST" }));
  if (command === "restore_agent") return agentSummary(await api(config, `deployments/${requiredId(args)}/restore`, { method: "POST" }));
  if (command === "delete_agent") return api(config, `deployments/${requiredId(args)}`, { method: "DELETE" });
  if (command === "set_agent_desktop_enabled") {
    const id = requiredId(args);
    const enabled = args.enabled === true;
    const client = deploymentsClient(config);
    const agent = await client.get(id);
    await agent.setEnv("HYPER_DESKTOP_ENABLED", enabled ? "1" : "0");
    if (enabled) {
      await client.setRoute(id, "desktop", { port: 3000, auth: true, prefix: "desktop" });
    } else {
      await client.removeRoute(id, "desktop");
    }
    return agentSummary(await client.get(id));
  }
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
    launch_config: item.launch_config ?? item.launchConfig ?? null,
    routes: (item as { routes?: unknown }).routes ?? (item.launch_config as { routes?: unknown } | undefined)?.routes ?? (item.launchConfig as { routes?: unknown } | undefined)?.routes ?? null,
    has_desktop: agentSummaryHasDesktop(item),
    size: typeof item.requested_size === "string"
      ? item.requested_size
      : typeof item.requestedSize === "string"
        ? item.requestedSize
        : typeof item.size === "string" ? item.size : null,
  };
}

function agentSummaryHasDesktop(item: Record<string, unknown>) {
  const launchConfig = item.launch_config ?? item.launchConfig;
  const env = launchConfig && typeof launchConfig === "object" && !Array.isArray(launchConfig)
    ? (launchConfig as Record<string, unknown>).env
    : null;
  const desktopEnv = env && typeof env === "object" && !Array.isArray(env)
    ? (env as Record<string, unknown>).HYPER_DESKTOP_ENABLED
    : undefined;
  if (typeof desktopEnv === "string" && ["0", "false", "no", "off"].includes(desktopEnv.trim().toLowerCase())) return false;
  if (typeof desktopEnv === "string" && ["1", "true", "yes", "on"].includes(desktopEnv.trim().toLowerCase())) return true;
  const routes = (item as { routes?: unknown }).routes ?? (launchConfig as { routes?: unknown } | null)?.routes;
  if (!routes || typeof routes !== "object" || Array.isArray(routes)) return item.hasDesktop === true || item.has_desktop === true;
  return Boolean((routes as Record<string, unknown>).desktop)
    || Object.values(routes).some((route) => route && typeof route === "object" && !Array.isArray(route) && (route as Record<string, unknown>).prefix === "desktop");
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
    delete env.HYPER_ACP_AUTO_APPROVE_PERMISSION;
    env.HYPER_ACP_PERMISSION_MODE ??= "default";
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
    "HYPER_ACP_AUTO_APPROVE_PERMISSION",
  ]) {
    delete env[key];
  }
  env.HYPER_ACP_PERMISSION_MODE ??= "default";
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
  requestedSessionKey?: string,
) {
  const agent = await cachedRuntimeAgent(config, id);
  const session = await cachedRuntimeSession(config, agent);
  const sessionKey = requestedSessionKey ?? await ensureRuntimeSessionKey(session);
  return { agent, session, sessionKey };
}

function runtimeSessionSummary(runtime: "openclaw" | "hermes", item: { key: string; label?: string | null; model?: string | null; updatedAt?: unknown; updated_at?: unknown; lastActive?: unknown; last_active?: unknown }) {
  const updated = item.updatedAt ?? item.updated_at ?? item.lastActive ?? item.last_active;
  return {
    session_id: item.key,
    title: item.label ?? null,
    cwd: item.model ?? null,
    updated_at: typeof updated === "string" ? updated : null,
    runtime,
  };
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
  return withSdkNodeWebSocket(() =>
    agent.connectSession({
      clientId: "desktop-ng",
      clientMode: "webchat",
      origin: "http://localhost:1420",
    }),
  );
}

async function withSdkNodeWebSocket<T>(operation: () => Promise<T>): Promise<T> {
  const previousWebSocket = globalThis.WebSocket;
  try {
    // Node 22 exposes undici's browser-shaped WebSocket globally; the SDK's
    // Node path uses the ws package, which is the transport we exercise here.
    (globalThis as typeof globalThis & { WebSocket?: typeof globalThis.WebSocket }).WebSocket = undefined;
    return await operation();
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

function desktopRouteFromSummary(agent: Record<string, unknown>): Record<string, unknown> | null {
  const launch = agent.launch_config && typeof agent.launch_config === "object"
    ? agent.launch_config as Record<string, unknown>
    : null;
  const routes = (launch?.routes && typeof launch.routes === "object" ? launch.routes : agent.routes && typeof agent.routes === "object" ? agent.routes : null) as Record<string, unknown> | null;
  if (!routes) return null;
  if (routes.desktop && typeof routes.desktop === "object") return routes.desktop as Record<string, unknown>;
  for (const route of Object.values(routes)) {
    if (route && typeof route === "object" && (route as Record<string, unknown>).prefix === "desktop") {
      return route as Record<string, unknown>;
    }
  }
  return null;
}

// Routines live at the agents API host root (`/routines`), while
// config.apiBase points at `…/agents`; strip that suffix to reach the root.
function routinesApi(
  config: { apiBase: string; token: string },
  path: string,
  init: RequestInit = {},
) {
  return api({ ...config, apiBase: config.apiBase.replace(/\/agents$/, "") }, path, init);
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
  resolve: {
    alias: [
      // Client bundle: the SDK's ACP client picks `NodeWebSocket ??
      // globalThis.WebSocket`; aliasing ws to a native-WebSocket shim keeps
      // the native fallback. The devBridge plugin runs in Vite's Node config
      // context (bundled before aliases apply), so it keeps the real ws.
      { find: /^ws$/, replacement: join(__dirname, "src/ws-browser-shim.ts") },
    ],
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    target: "es2022",
  },
});
