"use client";

import React from "react";
import { TabLoadingState } from "@/components/dashboard/agents/page-helpers";
import { getAgentGatewayPanelBootStatus } from "@/components/dashboard/agents/chat-boot-stage";
import type { LogsStatus } from "@/hooks/useAgentLogs";

interface AgentLogsPanelProps {
  status: LogsStatus;
  logs: string[];
  logBoxRef: React.RefObject<HTMLDivElement | null>;
}

export function AgentLogsPanel({ status, logs, logBoxRef }: AgentLogsPanelProps) {
  if (status !== "connected") {
    const connecting = status === "connecting" || status === "reconnecting";
    const loadingTitle = status === "reconnecting" ? "Reconnecting logs" : connecting ? "Connecting logs" : "Waiting for logs";
    const loadingDetail = status === "reconnecting"
      ? "Restoring the runtime log stream."
      : connecting
        ? "Opening the runtime log stream."
        : "Logs will attach when the runtime is ready.";
    const bootStatus = getAgentGatewayPanelBootStatus({
      connected: false,
      connecting,
      loadingTitle: "Loading logs",
      loadingDetail: "Preparing the runtime log stream.",
      connectingTitle: loadingTitle,
      connectingDetail: loadingDetail,
      waitingTitle: loadingTitle,
      waitingDetail: loadingDetail,
    });

    return (
      <TabLoadingState
        label={loadingTitle}
        detail={loadingDetail}
        bootStatus={bootStatus ?? undefined}
      />
    );
  }

  return (
    <div ref={logBoxRef} className="h-full overflow-auto bg-background p-4 font-mono text-xs leading-5 text-text-secondary">
      {logs.length === 0 && <div className="text-text-muted">Connected. Waiting for log lines.</div>}
      {logs.map((line, idx) => (
        <div key={`${idx}-${line.slice(0, 32)}`} className="whitespace-pre-wrap break-words">{line}</div>
      ))}
    </div>
  );
}
