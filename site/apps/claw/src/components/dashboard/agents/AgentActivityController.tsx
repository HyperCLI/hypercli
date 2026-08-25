"use client";

import React, { useCallback, useEffect, useImperativeHandle, useRef } from "react";
import type { Deployments } from "@hypercli.com/sdk/agents";

import { useAgentActivity, type ActivityStatus } from "@/hooks/useAgentActivity";
import { AgentActivityPanel } from "./AgentActivityPanel";

export interface AgentActivityControllerHandle {
  reconnect: () => void;
}

interface AgentActivityControllerProps {
  deployments: Deployments | null;
  agentId: string | null;
  visible: boolean;
  onStatusChange?: (status: ActivityStatus) => void;
  onPopOut?: () => void;
}

export const AgentActivityController = React.memo(React.forwardRef<AgentActivityControllerHandle, AgentActivityControllerProps>(
  function AgentActivityController({ deployments, agentId, visible, onStatusChange, onPopOut }, ref) {
    const activityBoxRef = useRef<HTMLDivElement | null>(null);
    const { events, status, error, reconnect } = useAgentActivity(deployments, agentId, visible && Boolean(agentId));
    const handleReconnect = useCallback(() => reconnect(), [reconnect]);

    useImperativeHandle(ref, () => ({ reconnect: handleReconnect }), [handleReconnect]);

    useEffect(() => {
      onStatusChange?.(status);
    }, [onStatusChange, status]);

    useEffect(() => () => {
      onStatusChange?.("disconnected");
    }, [onStatusChange]);

    useEffect(() => {
      if (activityBoxRef.current) activityBoxRef.current.scrollTop = activityBoxRef.current.scrollHeight;
    }, [events]);

    return (
      <AgentActivityPanel
        status={status}
        events={events}
        error={error}
        activityBoxRef={activityBoxRef}
        onReconnect={handleReconnect}
        onPopOut={onPopOut}
      />
    );
  },
));
