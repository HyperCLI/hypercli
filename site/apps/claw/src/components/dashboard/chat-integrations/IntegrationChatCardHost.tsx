"use client";

import type { AgentGatewaySession } from "@/components/dashboard/agents/AgentGatewayProvider";
import type { GitHubAgentSetupStatus } from "@/lib/github-cli-workspace";
import type { ClawIntegrationConnectAction } from "./claw-ui-actions";
import { renderIntegrationSetup } from "./integration-setup-renderers";
import type { SlackRelaySetupOptions } from "./SlackChatConnectorCard";

type ChatSession = AgentGatewaySession;

interface IntegrationChatCardHostProps {
  action: ClawIntegrationConnectAction;
  chat: ChatSession;
  agentName?: string | null;
  agentSetupStatus?: GitHubAgentSetupStatus;
  onStartAgentGitHubSetup?: () => Promise<void> | void;
  onVerifyAgentGitHubSetup?: () => Promise<void> | void;
  onOpenIntegrationDetails?: (integrationId: ClawIntegrationConnectAction["integrationId"]) => void;
  onOpenFullSetup?: (integrationId: ClawIntegrationConnectAction["integrationId"]) => void;
  onDismiss?: () => void;
  directSetup?: boolean;
  slackRelaySetup?: SlackRelaySetupOptions;
}

export function IntegrationChatCardHost(props: IntegrationChatCardHostProps) {
  return <>{renderIntegrationSetup(props)}</>;
}
