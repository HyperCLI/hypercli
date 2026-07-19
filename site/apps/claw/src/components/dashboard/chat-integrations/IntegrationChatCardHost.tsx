"use client";

import type { AgentGatewaySession } from "@/components/dashboard/agents/AgentGatewayProvider";
import type { GitHubAgentSetupStatus } from "@/lib/github-cli-workspace";
import { ChannelChatConnectorCard } from "./ChannelChatConnectorCard";
import { GitHubChatConnectorCard } from "./GitHubChatConnectorCard";
import { SlackChatConnectorCard, type SlackRelaySetupOptions } from "./SlackChatConnectorCard";
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
  onOpenIntegrationDetails?: (integrationId: ClawIntegrationConnectAction["integrationId"]) => void;
  onOpenFullSetup?: (integrationId: ClawIntegrationConnectAction["integrationId"]) => void;
  onDismiss?: () => void;
  directSetup?: boolean;
  slackRelaySetup?: SlackRelaySetupOptions;
}

export function IntegrationChatCardHost({
  action,
  chat,
  agentName,
  agentSetupStatus,
  onStartAgentGitHubSetup,
  onVerifyAgentGitHubSetup,
  onOpenIntegrationDetails,
  onOpenFullSetup,
  onDismiss,
  directSetup = false,
  slackRelaySetup,
}: IntegrationChatCardHostProps) {
  if (action.type !== "integration.connect") return null;

  if (action.integrationId === "github") {
    return (
      <GitHubChatConnectorCard
        connected={chat.connected}
        connectorsProvider={chat.connectorsProvider}
        configSchema={chat.configSchema}
        onAuthStart={typeof chat.integrationsAuthStart === "function" ? chat.integrationsAuthStart : undefined}
        onAuthStatus={typeof chat.integrationsAuthStatus === "function" ? chat.integrationsAuthStatus : undefined}
        onIntegrationStatus={typeof chat.integrationsStatus === "function" ? chat.integrationsStatus : undefined}
        onDisconnect={typeof chat.integrationsDisconnect === "function" ? chat.integrationsDisconnect : undefined}
        agentSetupStatus={agentSetupStatus}
        onStartAgentGitHubSetup={onStartAgentGitHubSetup}
        onVerifyAgentGitHubSetup={onVerifyAgentGitHubSetup}
        cachedWorkflow={chat.connectorWorkflows?.github}
        onGenerateConnectorWorkflow={chat.generateConnectorWorkflow}
        onRunShellProposal={chat.runConnectorShellProposal}
        onOpenIntegrationDetails={onOpenIntegrationDetails ? () => onOpenIntegrationDetails(action.integrationId) : undefined}
        onOpenFullSetup={onOpenFullSetup ? () => onOpenFullSetup(action.integrationId) : undefined}
        onDismiss={onDismiss}
        directSetup={directSetup}
      />
    );
  }

  if (action.integrationId === "telegram") {
    return (
      <TelegramChatConnectorCard
        connected={chat.connected}
        connectorsProvider={chat.connectorsProvider}
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
        cachedWorkflow={chat.connectorWorkflows?.telegram}
        onGenerateConnectorWorkflow={chat.generateConnectorWorkflow}
        onRunShellProposal={chat.runConnectorShellProposal}
        onOpenIntegrationDetails={onOpenIntegrationDetails ? () => onOpenIntegrationDetails(action.integrationId) : undefined}
        onOpenFullSetup={onOpenFullSetup ? () => onOpenFullSetup(action.integrationId) : undefined}
        onDismiss={onDismiss}
        directSetup={directSetup}
      />
    );
  }

  if (action.integrationId === "slack") {
    if (slackRelaySetup) {
      return (
        <SlackChatConnectorCard
          connected={chat.connected}
          config={chat.config as Record<string, unknown> | null}
          connectorsProvider={chat.connectorsProvider}
          channelsProvider={chat.channelsProvider}
          onSaveConfig={typeof chat.saveConfig === "function" ? chat.saveConfig : undefined}
          onWebLoginStart={typeof chat.webLoginStart === "function" ? chat.webLoginStart : undefined}
          onWebLoginWait={typeof chat.webLoginWait === "function" ? chat.webLoginWait : undefined}
          cachedWorkflow={chat.connectorWorkflows?.slack}
          onGenerateConnectorWorkflow={chat.generateConnectorWorkflow}
          onRunShellProposal={chat.runConnectorShellProposal}
          onReconnectGateway={typeof chat.retryAndRefreshSessions === "function"
            ? chat.retryAndRefreshSessions
            : typeof chat.retry === "function"
              ? chat.retry
              : undefined}
          onOpenIntegrationDetails={onOpenIntegrationDetails ? () => onOpenIntegrationDetails(action.integrationId) : undefined}
          onOpenFullSetup={onOpenFullSetup ? () => onOpenFullSetup(action.integrationId) : undefined}
          onDismiss={onDismiss}
          slackRelaySetup={slackRelaySetup}
        />
      );
    }
  }

  if (action.integrationId === "discord" || action.integrationId === "slack" || action.integrationId === "whatsapp") {
    return (
      <ChannelChatConnectorCard
        channelId={action.integrationId}
        connected={chat.connected}
        config={chat.config as Record<string, unknown> | null}
        connectorsProvider={chat.connectorsProvider}
        channelsProvider={chat.channelsProvider}
        onSaveConfig={typeof chat.saveConfig === "function" ? chat.saveConfig : undefined}
        onEnsureWhatsAppSupport={action.integrationId === "whatsapp" && typeof chat.ensureWhatsAppSupport === "function"
          ? chat.ensureWhatsAppSupport
          : undefined}
        onWhatsAppPairingStart={action.integrationId === "whatsapp" && typeof chat.whatsAppPairingStart === "function"
          ? chat.whatsAppPairingStart
          : undefined}
        whatsAppPairingState={action.integrationId === "whatsapp" ? chat.whatsAppPairingState : undefined}
        onCancelWhatsAppPairing={action.integrationId === "whatsapp" && typeof chat.cancelWhatsAppPairing === "function"
          ? chat.cancelWhatsAppPairing
          : undefined}
        onWebLoginStart={typeof chat.webLoginStart === "function" ? chat.webLoginStart : undefined}
        onWebLoginWait={typeof chat.webLoginWait === "function" ? chat.webLoginWait : undefined}
        cachedWorkflow={chat.connectorWorkflows?.[action.integrationId]}
        onGenerateConnectorWorkflow={chat.generateConnectorWorkflow}
        onRunShellProposal={chat.runConnectorShellProposal}
        onReconnectGateway={typeof chat.retryAndRefreshSessions === "function"
          ? chat.retryAndRefreshSessions
          : typeof chat.retry === "function"
            ? chat.retry
            : undefined}
        onOpenIntegrationDetails={onOpenIntegrationDetails ? () => onOpenIntegrationDetails(action.integrationId) : undefined}
        onOpenFullSetup={onOpenFullSetup ? () => onOpenFullSetup(action.integrationId) : undefined}
        onDismiss={onDismiss}
        directSetup={directSetup}
      />
    );
  }

  return null;
}
