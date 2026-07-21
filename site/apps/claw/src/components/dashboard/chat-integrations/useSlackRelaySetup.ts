"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import { getSlackInstallStatus, type SlackInstallStatus } from "@hypercli.com/sdk/agents";
import { configureHostedSlackRelayChannel, type AgentChannelsProvider } from "@hypercli.com/sdk/channels";

import { useAgentAuth } from "@/hooks/useAgentAuth";
import { SLACK_APP_HANDLE, SLACK_RELAY_BASE_URL } from "@/lib/api";

type SlackRelayState =
  | { mode: "prompt"; phase: "idle" | "checking"; installStatus: SlackInstallStatus | null; error: string | null }
  | { mode: "self-hosted" }
  | { mode: "hosted"; phase: "idle" | "checking" | "configuring"; installStatus: SlackInstallStatus | null; error: string | null; attached: boolean };

type SlackRelayAction =
  | { type: "choose-hosted" }
  | { type: "choose-self-hosted" }
  | { type: "check-start" }
  | { type: "check-success"; installStatus: SlackInstallStatus }
  | { type: "check-error"; error: string }
  | { type: "configure-start" }
  | { type: "configure-success"; installStatus: SlackInstallStatus }
  | { type: "configure-error"; error: string };

export interface SlackRelaySetupOptions {
  mode: "prompt" | "hosted" | "self-hosted";
  handle: string;
  hostedAvailable: boolean;
  connected: boolean | null;
  workspace: string | null;
  attached: boolean;
  checking: boolean;
  configuring: boolean;
  error: string | null;
  connectHref: string;
  onChooseHosted: () => void;
  onChooseSelfHosted: () => void;
  onBackToChoice: () => void;
  onRefreshHosted: () => void;
  onConfigureHosted: () => void;
  onRememberReturn?: () => void;
}

function reducer(state: SlackRelayState, action: SlackRelayAction): SlackRelayState {
  switch (action.type) {
    case "choose-hosted":
      return {
        mode: "hosted",
        phase: "idle",
        installStatus: state.mode === "self-hosted" ? null : state.installStatus,
        error: state.mode === "self-hosted" ? null : state.error,
        attached: false,
      };
    case "choose-self-hosted":
      return { mode: "self-hosted" };
    case "check-start":
      if (state.mode === "self-hosted") return state;
      return { ...state, phase: "checking", error: null };
    case "check-success":
      if (state.mode === "self-hosted") return state;
      return { ...state, phase: "idle", installStatus: action.installStatus, error: null };
    case "check-error":
      if (state.mode === "self-hosted") return state;
      return { ...state, phase: "idle", installStatus: null, error: action.error };
    case "configure-start":
      return { mode: "hosted", phase: "configuring", installStatus: state.mode === "hosted" ? state.installStatus : null, error: null, attached: state.mode === "hosted" ? state.attached : false };
    case "configure-success":
      return { mode: "hosted", phase: "idle", installStatus: action.installStatus, error: null, attached: true };
    case "configure-error":
      return { mode: "hosted", phase: "idle", installStatus: state.mode === "hosted" ? state.installStatus : null, error: action.error, attached: state.mode === "hosted" ? state.attached : false };
  }
}

export function useSlackRelaySetup({
  enabled,
  agentId,
  channelsProvider,
  onEnsureSlackSupport,
  onRefreshChannels,
}: {
  enabled: boolean;
  agentId?: string | null;
  channelsProvider?: AgentChannelsProvider | null;
  onEnsureSlackSupport?: () => Promise<unknown>;
  onRefreshChannels?: (probe?: boolean) => Promise<unknown>;
}): SlackRelaySetupOptions {
  const [state, dispatch] = useReducer(reducer, { mode: "prompt", phase: "idle", installStatus: null, error: null });
  const operationRef = useRef(0);
  const { getToken, isAuthenticated, isLoading: authLoading } = useAgentAuth();

  const refresh = useCallback(async (): Promise<SlackInstallStatus | null> => {
    const operationId = operationRef.current + 1;
    operationRef.current = operationId;
    dispatch({ type: "check-start" });
    if (!SLACK_RELAY_BASE_URL) {
      dispatch({ type: "check-error", error: "Slack relay is not configured for this environment." });
      return null;
    }
    if (!isAuthenticated) {
      dispatch({ type: "check-error", error: "Sign in before connecting Slack." });
      return null;
    }
    try {
      const status = await getSlackInstallStatus({ relayBaseUrl: SLACK_RELAY_BASE_URL, token: await getToken() });
      if (operationRef.current !== operationId) return null;
      dispatch({ type: "check-success", installStatus: status });
      return status;
    } catch (cause) {
      if (operationRef.current !== operationId) return null;
      dispatch({ type: "check-error", error: cause instanceof Error ? cause.message : "Could not check Slack installation." });
      return null;
    }
  }, [getToken, isAuthenticated]);

  useEffect(() => {
    if (!enabled || !SLACK_RELAY_BASE_URL || state.mode !== "prompt") return;
    if (state.phase === "checking" || state.installStatus || state.error) return;
    void refresh();
  }, [enabled, refresh, state]);

  const configure = useCallback(async () => {
    if (!agentId) {
      dispatch({ type: "configure-error", error: "Agent identity is unavailable." });
      return;
    }
    if (!channelsProvider?.configure) {
      dispatch({ type: "configure-error", error: "Agent gateway configuration is unavailable." });
      return;
    }
    const operationId = operationRef.current + 1;
    operationRef.current = operationId;
    dispatch({ type: "configure-start" });
    try {
      const result = await configureHostedSlackRelayChannel({
        relayBaseUrl: SLACK_RELAY_BASE_URL,
        token: await getToken(),
        agentId,
        channelsProvider,
        checkInstallStatus: getSlackInstallStatus,
      });
      if (operationRef.current !== operationId) return;
      dispatch({ type: "configure-success", installStatus: result.status });
      await onRefreshChannels?.(true);
    } catch (cause) {
      if (operationRef.current !== operationId) return;
      dispatch({ type: "configure-error", error: cause instanceof Error ? cause.message : "Could not configure hosted Slack relay." });
    }
  }, [agentId, channelsProvider, getToken, onRefreshChannels]);

  const installStatus = state.mode === "self-hosted" ? null : state.installStatus;
  return {
    mode: state.mode,
    handle: SLACK_APP_HANDLE,
    hostedAvailable: Boolean(SLACK_RELAY_BASE_URL),
    connected: installStatus?.connected ?? null,
    workspace: installStatus?.teamName || installStatus?.teamId || null,
    attached: state.mode === "hosted" ? state.attached : false,
    checking: (state.mode !== "self-hosted" && state.phase === "checking") || authLoading,
    configuring: state.mode === "hosted" && state.phase === "configuring",
    error: state.mode === "hosted" || state.mode === "prompt" ? state.error : null,
    connectHref: "/slack/start",
    onChooseHosted: () => {
      dispatch({ type: "choose-hosted" });
      void refresh();
    },
    onChooseSelfHosted: () => {
      operationRef.current += 1;
      dispatch({ type: "choose-self-hosted" });
      void onEnsureSlackSupport?.().then(() => onRefreshChannels?.(true)).catch(() => undefined);
    },
    onBackToChoice: () => undefined,
    onRefreshHosted: () => void refresh(),
    onConfigureHosted: () => void configure(),
  };
}
