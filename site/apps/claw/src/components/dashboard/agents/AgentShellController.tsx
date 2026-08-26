"use client";

import React, { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef } from "react";
import type { Deployments } from "@hypercli.com/sdk/agents";

import { useAgentShell, type ShellStatus } from "@/hooks/useAgentShell";
import { useAgentShellTerminal } from "@/hooks/useAgentShellTerminal";
import { AgentTerminalPanel } from "./AgentTerminalPanel";

export interface AgentShellControllerHandle {
  reconnect: () => void;
}

interface AgentShellControllerProps {
  deployments: Deployments | null;
  agentId: string | null;
  visible: boolean;
  prewarm?: boolean;
  getDeployments?: (signal: AbortSignal) => Promise<Deployments | null>;
  onStatusChange?: (status: ShellStatus) => void;
  onRequestProductUse?: () => boolean;
}

export const AgentShellController = React.memo(React.forwardRef<AgentShellControllerHandle, AgentShellControllerProps>(
  function AgentShellController({
    deployments,
    agentId,
    visible,
    prewarm = false,
    getDeployments,
    onStatusChange,
    onRequestProductUse,
  }, ref) {
    const shellOutputHandlerRef = useRef<(text: string) => void>(() => undefined);
    const handleShellData = useCallback((text: string) => {
      shellOutputHandlerRef.current(text);
    }, []);
    const handleShellInputRejected = useCallback(() => {
      shellOutputHandlerRef.current("\r\n[Input was not sent because the shell is busy. Try again.]\r\n");
    }, []);
    const {
      status,
      send,
      resize,
      reconnect,
    } = useAgentShell(deployments, {
      agentId,
      enabled: true,
      reconnectEnabled: visible || prewarm,
      onData: handleShellData,
      onInputRejected: handleShellInputRejected,
      getDeployments,
    });
    const handleShellInput = useCallback((data: string) => {
      if (onRequestProductUse && !onRequestProductUse()) return;
      send(data);
    }, [onRequestProductUse, send]);
    const {
      shellBoxRef,
      writeOutput,
      terminalReady,
      terminalError,
      retryTerminal,
    } = useAgentShellTerminal({
      agentId,
      status,
      visible,
      prewarm,
      onInput: handleShellInput,
      onResize: resize,
    });

    useLayoutEffect(() => {
      shellOutputHandlerRef.current = writeOutput;
    }, [writeOutput]);

    const handleReconnect = useCallback(() => {
      if (onRequestProductUse && !onRequestProductUse()) return;
      if (terminalError) retryTerminal();
      if (status !== "connected") reconnect();
    }, [onRequestProductUse, reconnect, retryTerminal, status, terminalError]);

    useImperativeHandle(ref, () => ({ reconnect: handleReconnect }), [handleReconnect]);

    const reportedStatus: ShellStatus = terminalError
      ? "disconnected"
      : status === "connected" && !terminalReady
        ? "connecting"
        : status;

    useEffect(() => {
      if (visible) onStatusChange?.(reportedStatus);
    }, [onStatusChange, reportedStatus, visible]);

    useEffect(() => () => {
      onStatusChange?.("disconnected");
    }, [onStatusChange]);

    return (
      <AgentTerminalPanel
        status={status}
        terminalReady={terminalReady}
        terminalError={terminalError}
        shellBoxRef={shellBoxRef}
        visible={visible}
      />
    );
  },
));
