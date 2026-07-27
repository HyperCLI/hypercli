import { markShellPerformance, measureShellPerformance } from "./agent-shell-performance";

export type AgentShellTerminalRuntime = typeof import("./agent-shell-terminal-runtime");
export type AgentShellWebglRuntime = typeof import("./agent-shell-webgl-runtime");

let runtimePromise: Promise<AgentShellTerminalRuntime> | null = null;
let webglRuntimePromise: Promise<AgentShellWebglRuntime> | null = null;
let transportPreconnected = false;

function preconnectAgentShellTransport(): void {
  if (transportPreconnected || typeof document === "undefined") return;
  const configuredUrl = process.env.NEXT_PUBLIC_AGENTS_WS_URL;
  if (!configuredUrl) return;
  try {
    const url = new URL(configuredUrl, window.location.origin);
    if (url.protocol === "wss:") url.protocol = "https:";
    if (url.protocol === "ws:") url.protocol = "http:";
    if (url.protocol !== "http:" && url.protocol !== "https:") return;
    const link = document.createElement("link");
    link.rel = "preconnect";
    link.href = url.origin;
    link.crossOrigin = "anonymous";
    document.head.appendChild(link);
    transportPreconnected = true;
  } catch {
    // Invalid configuration will be reported by the connection attempt.
  }
}

export function loadAgentShellTerminalRuntime(): Promise<AgentShellTerminalRuntime> {
  preconnectAgentShellTransport();
  if (!runtimePromise) {
    runtimePromise = import("./agent-shell-terminal-runtime").catch((error) => {
      runtimePromise = null;
      throw error;
    });
  }
  return runtimePromise;
}

export function loadAgentShellWebglRuntime(): Promise<AgentShellWebglRuntime> {
  if (!webglRuntimePromise) {
    webglRuntimePromise = import("./agent-shell-webgl-runtime").catch((error) => {
      webglRuntimePromise = null;
      throw error;
    });
  }
  return webglRuntimePromise;
}

export function preloadAgentShellTerminalRuntime(): void {
  markShellPerformance("intent");
  void Promise.all([
    loadAgentShellTerminalRuntime(),
    loadAgentShellWebglRuntime().catch(() => null),
  ]).then(() => {
    markShellPerformance("runtime-ready");
    measureShellPerformance("intent-to-runtime", "intent", "runtime-ready");
  }).catch(() => undefined);
}
