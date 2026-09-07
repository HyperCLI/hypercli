import {
  runtimeHistory,
  streamRuntimeMessage,
  type AgentSummary,
  type RuntimeChatEvent,
  type RuntimeChatMessage,
} from "./api";
import { type RuntimeFamily, runtimeFamily } from "./agent-utils";

export interface RuntimeSession {
  readonly family: RuntimeFamily;
  readonly canChat: boolean;
  history(): Promise<RuntimeChatMessage[]>;
  streamMessage(text: string, onEvent: (event: RuntimeChatEvent) => void): Promise<void>;
}

function hasTauriInvoke() {
  const internals = (window as unknown as { __TAURI_INTERNALS__?: Record<string, unknown> })
    .__TAURI_INTERNALS__;
  return typeof internals?.invoke === "function";
}

abstract class BaseRuntimeSession implements RuntimeSession {
  abstract readonly family: RuntimeFamily;
  abstract readonly canChat: boolean;

  constructor(protected readonly agent: AgentSummary) {}

  async history(): Promise<RuntimeChatMessage[]> {
    return [];
  }

  async streamMessage(_text: string, _onEvent: (event: RuntimeChatEvent) => void): Promise<void> {
    throw new Error("This runtime does not expose streaming chat yet.");
  }

}

class OpenClawRuntimeSession extends BaseRuntimeSession {
  readonly family = "openclaw" as const;

  get canChat() {
    return !hasTauriInvoke();
  }

  streamMessage(text: string, onEvent: (event: RuntimeChatEvent) => void): Promise<void> {
    if (!this.canChat) throw new Error("OpenClaw chat is not wired in the packaged app yet.");
    return streamRuntimeMessage(this.agent.id, text, onEvent);
  }

  history(): Promise<RuntimeChatMessage[]> {
    if (!this.canChat) return Promise.resolve([]);
    return runtimeHistory(this.agent.id);
  }
}

class HermesRuntimeSession extends BaseRuntimeSession {
  readonly family = "hermes" as const;

  get canChat() {
    return !hasTauriInvoke();
  }

  streamMessage(text: string, onEvent: (event: RuntimeChatEvent) => void): Promise<void> {
    if (!this.canChat) throw new Error("Hermes chat is not wired in the packaged app yet.");
    return streamRuntimeMessage(this.agent.id, text, onEvent);
  }

  history(): Promise<RuntimeChatMessage[]> {
    if (!this.canChat) return Promise.resolve([]);
    return runtimeHistory(this.agent.id);
  }

}

class UnsupportedRuntimeSession extends BaseRuntimeSession {
  readonly family = "generic" as const;
  readonly canChat = false;

}

export function runtimeSession(agent: AgentSummary): RuntimeSession {
  const family = runtimeFamily(agent.runtime);
  if (family === "openclaw") return new OpenClawRuntimeSession(agent);
  if (family === "hermes") return new HermesRuntimeSession(agent);
  return new UnsupportedRuntimeSession(agent);
}

export function canRuntimeChat(agent: AgentSummary): boolean {
  return runtimeSession(agent).canChat;
}

export function streamRuntimeChatMessage(
  agent: AgentSummary,
  text: string,
  onEvent: (event: RuntimeChatEvent) => void,
): Promise<void> {
  return runtimeSession(agent).streamMessage(text, onEvent);
}

export function runtimeChatHistory(agent: AgentSummary): Promise<RuntimeChatMessage[]> {
  return runtimeSession(agent).history();
}
