import type { ReactNode } from "react";

import type { AgentGatewaySession } from "@/components/dashboard/agents/AgentGatewayProvider";
import type { GitHubAgentSetupStatus } from "@/lib/github-cli-workspace";
import type { SlackRelaySetupOptions } from "../SlackChatConnectorCard";
import type { ClawIntegrationConnectAction, ClawIntegrationConnectId } from "../claw-ui-actions";

type ChatSession = AgentGatewaySession;

export type SetupRenderer = (context: IntegrationSetupRenderContext) => ReactNode | null;

export interface IntegrationSetupRenderContext {
  action: ClawIntegrationConnectAction;
  chat: ChatSession;
  agentId?: string | null;
  agentName?: string | null;
  agentSetupStatus?: GitHubAgentSetupStatus;
  onStartAgentGitHubSetup?: () => Promise<void> | void;
  onVerifyAgentGitHubSetup?: () => Promise<void> | void;
  onOpenIntegrationDetails?: (integrationId: ClawIntegrationConnectId) => void;
  onOpenFullSetup?: (integrationId: ClawIntegrationConnectId) => void;
  onDismiss?: () => void;
  directSetup?: boolean;
  slackRelaySetup?: SlackRelaySetupOptions;
}

export function gatewayReconnect(chat: ChatSession) {
  return typeof chat.retryAndRefreshSessions === "function"
    ? chat.retryAndRefreshSessions
    : typeof chat.retry === "function"
      ? chat.retry
      : undefined;
}

export function openIntegrationDetails(context: IntegrationSetupRenderContext) {
  return context.onOpenIntegrationDetails
    ? () => context.onOpenIntegrationDetails?.(context.action.integrationId)
    : undefined;
}

export function openFullSetup(context: IntegrationSetupRenderContext) {
  return context.onOpenFullSetup
    ? () => context.onOpenFullSetup?.(context.action.integrationId)
    : undefined;
}
