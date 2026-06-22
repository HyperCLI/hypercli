"use client";

import type { AgentGatewaySession } from "@/components/dashboard/agents/AgentGatewayProvider";
import type { GitHubAgentSetupStatus } from "@/lib/github-cli-workspace";
import { GitHubChatConnectorCard } from "./GitHubChatConnectorCard";
import { TelegramChatConnectorCard } from "./TelegramChatConnectorCard";
import type { ClawIntegrationConnectAction } from "./claw-ui-actions";

type ChatSession = AgentGatewaySession;

interface IntegrationChatCardHostProps {
  action: ClawIntegrationConnectAction;
  chat: ChatSession;
  agentName?: string | null;
  agentSetupStatus?: GitHubAgentSetupStatus;
  onStartAgentGitHubSetup?: () => Promise<void> | void;
  onVerifyAgentGitHubSetup?: () => Promise<void> | void;
  onOpenFullSetup?: (integrationId: ClawIntegrationConnectAction["integrationId"]) => void;
  onDismiss?: () => void;
}

export function IntegrationChatCardHost({
  action,
  chat,
  agentName,
  agentSetupStatus,
  onStartAgentGitHubSetup,
  onVerifyAgentGitHubSetup,
  onOpenFullSetup,
  onDismiss,
}: IntegrationChatCardHostProps) {
  if (action.type !== "integration.connect") return null;

  if (action.integrationId === "github") {
    return (
      <GitHubChatConnectorCard
        connected={chat.connected}
        configSchema={chat.configSchema}
        onAuthStart={typeof chat.integrationsAuthStart === "function" ? chat.integrationsAuthStart : undefined}
        onAuthStatus={typeof chat.integrationsAuthStatus === "function" ? chat.integrationsAuthStatus : undefined}
        onIntegrationStatus={typeof chat.integrationsStatus === "function" ? chat.integrationsStatus : undefined}
        onDisconnect={typeof chat.integrationsDisconnect === "function" ? chat.integrationsDisconnect : undefined}
        agentSetupStatus={agentSetupStatus}
        onStartAgentGitHubSetup={onStartAgentGitHubSetup}
        onVerifyAgentGitHubSetup={onVerifyAgentGitHubSetup}
        onOpenFullSetup={onOpenFullSetup ? () => onOpenFullSetup(action.integrationId) : undefined}
        onDismiss={onDismiss}
      />
    );
  }

  if (action.integrationId === "telegram") {
    return (
      <TelegramChatConnectorCard
        connected={chat.connected}
        config={chat.config as Record<string, unknown> | null}
        configSchema={chat.configSchema}
        agentName={agentName}
        onSaveConfig={typeof chat.saveConfig === "function" ? chat.saveConfig : undefined}
        onChannelProbe={typeof chat.channelsStatus === "function" ? () => chat.channelsStatus(true) : undefined}
        onAgentConfigUpdate={typeof chat.sendMessage === "function"
          ? (prompt, displayContent) => chat.sendMessage(prompt, { displayContent })
          : undefined}
        onReconnectGateway={typeof chat.retryAndRefreshSessions === "function"
          ? chat.retryAndRefreshSessions
          : typeof chat.retry === "function"
            ? chat.retry
            : undefined}
        onOpenFullSetup={onOpenFullSetup ? () => onOpenFullSetup(action.integrationId) : undefined}
        onDismiss={onDismiss}
      />
    );
  }

  return null;
}
