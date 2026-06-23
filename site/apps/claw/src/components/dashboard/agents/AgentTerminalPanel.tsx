"use client";

import React from "react";
import { TabLoadingState } from "@/components/dashboard/agents/page-helpers";
import { getAgentGatewayPanelBootStatus } from "@/components/dashboard/agents/chat-boot-stage";
import type { ShellStatus } from "@/hooks/useAgentShell";

interface AgentTerminalPanelProps {
  status: ShellStatus;
  shellBoxRef: React.Ref<HTMLDivElement>;
  visible?: boolean;
}

export function AgentTerminalPanel({ status, shellBoxRef, visible = true }: AgentTerminalPanelProps) {
  const connecting = status === "connecting" || status === "reconnecting";
  const loadingTitle = status === "reconnecting" ? "Reconnecting shell" : connecting ? "Connecting shell" : "Waiting for shell";
  const loadingDetail = status === "reconnecting"
    ? "Restoring the terminal session."
    : connecting
      ? "Opening a terminal session."
      : "The terminal will attach when the runtime is ready.";
  const bootStatus = status === "connected" ? null : getAgentGatewayPanelBootStatus({
    connected: false,
    connecting,
    loadingTitle: "Loading shell",
    loadingDetail: "Preparing the terminal session.",
    connectingTitle: loadingTitle,
    connectingDetail: loadingDetail,
    waitingTitle: loadingTitle,
    waitingDetail: loadingDetail,
  });

  return (
    <div
      className={`${visible ? "relative z-10 h-full" : "pointer-events-none absolute inset-0 h-full opacity-0"} bg-background p-4`}
      aria-hidden={!visible}
    >
      <div ref={shellBoxRef} className={`h-full w-full ${status === "connected" ? "" : "invisible"}`} />
      {status !== "connected" && (
        <div className="absolute inset-0 p-4">
          <TabLoadingState
            label={loadingTitle}
            detail={loadingDetail}
            bootStatus={bootStatus ?? undefined}
          />
        </div>
      )}
    </div>
  );
}
