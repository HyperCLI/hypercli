import type { AgentState } from "@/app/dashboard/agents/types";
import type { AgentLifecycleStage } from "@/components/dashboard/AgentLifecycleSteps";

export type AgentChatBootStatus =
  | {
      status: "loading";
      phase: "creating" | "restoring" | "booting" | "stopping" | "archiving" | "gateway" | "workspace";
      title: string;
      detail: string;
      tone: "starting" | "connecting" | "loading";
      stage: AgentLifecycleStage;
    }
  | {
      status: "error";
      phase: "error";
      title: string;
      detail: string;
      technicalDetail?: string;
      stage: AgentLifecycleStage;
    }
  | { status: "ready" }
  | { status: "stopped" };

export type AgentBootDisplayStatus = Extract<AgentChatBootStatus, { status: "loading" | "error" }>;

const LOADING_PHASE_ORDER: Record<Extract<AgentChatBootStatus, { status: "loading" }>["phase"], number> = {
  creating: 0,
  restoring: 1,
  booting: 2,
  gateway: 3,
  workspace: 4,
  stopping: 5,
  archiving: 6,
};

interface AgentChatBootStatusInput {
  agentState: AgentState | null;
  isSelectedRunning: boolean;
  gatewayConnected: boolean;
  ready: boolean;
  connected: boolean;
  connecting: boolean;
  hydrating: boolean;
  error?: string | null;
}

export function getAgentChatBootStatus({
  agentState,
  isSelectedRunning,
  gatewayConnected,
  ready,
  connected,
  connecting,
  hydrating,
  error,
}: AgentChatBootStatusInput): AgentChatBootStatus {
  if (agentState === "CREATING") {
    return {
      status: "loading",
      phase: "creating",
      title: "Creating agent",
      detail: "Preparing persistent storage and admitting the runtime.",
      tone: "starting",
      stage: "runtime",
    };
  }

  if (agentState === "RESTORING") {
    return {
      status: "loading",
      phase: "restoring",
      title: "Restoring files",
      detail: "Restoring the agent home directory before boot.",
      tone: "starting",
      stage: "runtime",
    };
  }

  if (agentState === "STARTING") {
    return {
      status: "loading",
      phase: "booting",
      title: "Booting agent",
      detail: "Starting the container and OpenClaw services.",
      tone: "starting",
      stage: "agent",
    };
  }

  if (agentState === "FAILED") {
    return {
      status: "error",
      phase: "error",
      title: "Review this agent before restarting",
      detail: "Clean up the interrupted launch, then start the agent again.",
      stage: "runtime",
    };
  }

  if (agentState === "STOPPING") {
    return {
      status: "loading",
      phase: "stopping",
      title: "Stopping agent",
      detail: "Stopping the runtime and cleaning up the workspace.",
      tone: "loading",
      stage: "complete",
    };
  }

  if (agentState === "ARCHIVING") {
    return {
      status: "loading",
      phase: "archiving",
      title: "Archiving agent",
      detail: "Verifying the cold archive before releasing runtime resources.",
      tone: "loading",
      stage: "complete",
    };
  }

  if (error && isSelectedRunning) {
    return {
      status: "error",
      phase: "error",
      title: "Try again to reconnect",
      detail: "The agent connection was interrupted. Your saved conversation is still available.",
      technicalDetail: error,
      stage: gatewayConnected ? "complete" : "gateway",
    };
  }

  if (hydrating || (gatewayConnected && !ready && !error)) {
    return {
      status: "loading",
      phase: "workspace",
      title: "Loading workspace",
      detail: "Fetching messages, files, and config.",
      tone: "loading",
      stage: "complete",
    };
  }

  if (connecting) {
    return {
      status: "loading",
      phase: "gateway",
      title: "Connecting gateway",
      detail: "Opening the agent session.",
      tone: "connecting",
      stage: "gateway",
    };
  }

  if (connected) {
    return { status: "ready" };
  }

  if (isSelectedRunning) {
    return {
      status: "loading",
      phase: "gateway",
      title: "Waiting for gateway",
      detail: "The runtime is up. Reconnecting to the agent session.",
      tone: "connecting",
      stage: "gateway",
    };
  }

  return { status: "stopped" };
}

export function stabilizeAgentChatBootStatus(
  current: AgentChatBootStatus,
  next: AgentChatBootStatus,
): AgentChatBootStatus {
  if (current.status === "loading" && next.status === "loading") {
    return LOADING_PHASE_ORDER[next.phase] < LOADING_PHASE_ORDER[current.phase] ? current : next;
  }

  return next;
}

export function getAgentGatewayPanelBootStatus({
  connected,
  connecting,
  loading = false,
  error = null,
  loadingTitle,
  loadingDetail,
  connectingTitle = "Connecting gateway",
  connectingDetail,
  waitingTitle = "Waiting for gateway",
  waitingDetail,
  errorTitle = "Try again to reconnect",
  errorDetail = "The connection was interrupted. Your saved work is still available.",
}: {
  connected: boolean;
  connecting?: boolean;
  loading?: boolean;
  error?: string | null;
  loadingTitle: string;
  loadingDetail: string;
  connectingTitle?: string;
  connectingDetail: string;
  waitingTitle?: string;
  waitingDetail: string;
  errorTitle?: string;
  errorDetail?: string;
}): AgentBootDisplayStatus | null {
  if (error) {
    return {
      status: "error",
      phase: "error",
      title: errorTitle,
      detail: errorDetail,
      technicalDetail: error,
      stage: connected ? "complete" : "gateway",
    };
  }

  if (loading) {
    return {
      status: "loading",
      phase: "workspace",
      title: loadingTitle,
      detail: loadingDetail,
      tone: "loading",
      stage: "complete",
    };
  }

  if (connecting) {
    return {
      status: "loading",
      phase: "gateway",
      title: connectingTitle,
      detail: connectingDetail,
      tone: "connecting",
      stage: "gateway",
    };
  }

  if (!connected) {
    return {
      status: "loading",
      phase: "gateway",
      title: waitingTitle,
      detail: waitingDetail,
      tone: "connecting",
      stage: "gateway",
    };
  }

  return null;
}
