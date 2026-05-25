"use client";

import React from "react";
import { TabLoadingState } from "@/components/dashboard/agents/page-helpers";
import { getAgentGatewayPanelBootStatus } from "@/components/dashboard/agents/chat-boot-stage";
import type { ShellStatus } from "@/hooks/useAgentShell";

interface AgentTerminalPanelProps {
  status: ShellStatus;
  shellBoxRef: React.RefObject<HTMLDivElement | null>;
}

export function AgentTerminalPanel({ status, shellBoxRef }: AgentTerminalPanelProps) {
  const connecting = status === "connecting" || status === "reconnecting";
  const bootStatus = status === "connected" ? null : getAgentGatewayPanelBootStatus({
    connected: false,
    connecting,
    loadingTitle: "Loading shell",
    loadingDetail: "Preparing the shell stream.",
    connectingDetail: status === "reconnecting" ? "Reopening the shell stream." : "Opening the shell stream.",
    waitingDetail: "Shell attaches after the runtime is reachable.",
  });

  return (
    <div className="relative h-full bg-[#0c1016] p-4">
      <div ref={shellBoxRef} className={`h-full w-full ${status === "connected" ? "" : "invisible"}`} />
      {status !== "connected" && (
        <div className="absolute inset-0 p-4">
          <TabLoadingState
            label={status === "reconnecting" ? "Reconnecting gateway" : connecting ? "Connecting gateway" : "Waiting for gateway"}
            detail={status === "reconnecting" ? "Reopening the shell stream." : connecting ? "Opening the shell stream." : "Shell attaches after the runtime is reachable."}
            bootStatus={bootStatus ?? undefined}
          />
        </div>
      )}
    </div>
  );
}
