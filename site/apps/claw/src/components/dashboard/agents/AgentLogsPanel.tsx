"use client";

import React from "react";
import { TabLoadingState } from "@/components/dashboard/agents/page-helpers";

interface AgentLogsPanelProps {
  status: "connected" | "connecting" | "disconnected";
  logs: string[];
  logBoxRef: React.RefObject<HTMLDivElement | null>;
}

export function AgentLogsPanel({ status, logs, logBoxRef }: AgentLogsPanelProps) {
  if (status !== "connected") {
    return <TabLoadingState label={status === "connecting" ? "Connecting logs" : "Preparing logs"} />;
  }

  return (
    <div ref={logBoxRef} className="h-full overflow-auto bg-[#0c1016] p-4 font-mono text-xs leading-5 text-[#d8dde7]">
      {logs.length === 0 && <div className="text-[#8b95a6]">Connected. Waiting for log stream...</div>}
      {logs.map((line, idx) => (
        <div key={`${idx}-${line.slice(0, 32)}`} className="whitespace-pre-wrap break-words">{line}</div>
      ))}
    </div>
  );
}
