"use client";

import React, { useCallback, useEffect, useImperativeHandle, useRef } from "react";
import type { Deployments } from "@hypercli.com/sdk/agents";

import { useAgentLogs, type LogsStatus } from "@/hooks/useAgentLogs";
import { AgentLogsPanel } from "./AgentLogsPanel";

export interface AgentLogsControllerHandle {
  reconnect: () => void;
}

interface AgentLogsControllerProps {
  deployments: Deployments | null;
  agentId: string | null;
  onStatusChange?: (status: LogsStatus) => void;
}

export const AgentLogsController = React.memo(React.forwardRef<AgentLogsControllerHandle, AgentLogsControllerProps>(
  function AgentLogsController({ deployments, agentId, onStatusChange }, ref) {
    const logBoxRef = useRef<HTMLDivElement | null>(null);
    const { logs, status, reconnect } = useAgentLogs(deployments, agentId, Boolean(agentId));
    const handleReconnect = useCallback(() => reconnect(), [reconnect]);

    useImperativeHandle(ref, () => ({ reconnect: handleReconnect }), [handleReconnect]);

    useEffect(() => {
      onStatusChange?.(status);
    }, [onStatusChange, status]);

    useEffect(() => () => {
      onStatusChange?.("disconnected");
    }, [onStatusChange]);

    useEffect(() => {
      if (logBoxRef.current) logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
    }, [logs]);

    return <AgentLogsPanel status={status} logs={logs} logBoxRef={logBoxRef} />;
  },
));
