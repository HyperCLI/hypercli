"use client";

import type { ReactNode } from "react";

import type { AgentGatewaySession } from "@/components/dashboard/agents/AgentGatewayProvider";
import type { GitHubAgentSetupStatus } from "@/lib/github-cli-workspace";
import { ChannelChatConnectorCard } from "./ChannelChatConnectorCard";
import { GitHubChatConnectorCard } from "./GitHubChatConnectorCard";
import { SlackChatConnectorCard, type SlackRelaySetupOptions } from "./SlackChatConnectorCard";
import { TelegramChatConnectorCard } from "./TelegramChatConnectorCard";
import type { ClawIntegrationConnectAction, ClawIntegrationConnectId } from "./claw-ui-actions";

type ChatSession = AgentGatewaySession;
type GatewayChannelId = "discord" | "slack" | "whatsapp";
type SetupRenderer = (context: IntegrationSetupRenderContext) => ReactNode | null;

export interface IntegrationSetupRenderContext {
  action: ClawIntegrationConnectAction;
  chat: ChatSession;
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

const GATEWAY_CHANNEL_IDS = new Set<ClawIntegrationConnectId>(["discord", "slack", "whatsapp"]);

function gatewayReconnect(chat: ChatSession) {
  return typeof chat.retryAndRefreshSessions === "function"
    ? chat.retryAndRefreshSessions
    : typeof chat.retry === "function"
      ? chat.retry
      : undefined;
}

function openIntegrationDetails(context: IntegrationSetupRenderContext) {
  return context.onOpenIntegrationDetails
    ? () => context.onOpenIntegrationDetails?.(context.action.integrationId)
    : undefined;
}

function openFullSetup(context: IntegrationSetupRenderContext) {
  return context.onOpenFullSetup
    ? () => context.onOpenFullSetup?.(context.action.integrationId)
    : undefined;
}

function renderGitHubSetup(context: IntegrationSetupRenderContext) {
  const { action, chat } = context;
  return (
    <GitHubChatConnectorCard
      connected={chat.connected}
      connectorsProvider={chat.connectorsProvider}
      configSchema={chat.configSchema}
      onAuthStart={typeof chat.integrationsAuthStart === "function" ? chat.integrationsAuthStart : undefined}
      onAuthStatus={typeof chat.integrationsAuthStatus === "function" ? chat.integrationsAuthStatus : undefined}
      onIntegrationStatus={typeof chat.integrationsStatus === "function" ? chat.integrationsStatus : undefined}
      onDisconnect={typeof chat.integrationsDisconnect === "function" ? chat.integrationsDisconnect : undefined}
      agentSetupStatus={context.agentSetupStatus}
      onStartAgentGitHubSetup={context.onStartAgentGitHubSetup}
      onVerifyAgentGitHubSetup={context.onVerifyAgentGitHubSetup}
      cachedWorkflow={chat.connectorWorkflows?.github}
      onGenerateConnectorWorkflow={chat.generateConnectorWorkflow}
      onRunShellProposal={chat.runConnectorShellProposal}
      onOpenIntegrationDetails={context.onOpenIntegrationDetails ? () => context.onOpenIntegrationDetails?.(action.integrationId) : undefined}
      onOpenFullSetup={context.onOpenFullSetup ? () => context.onOpenFullSetup?.(action.integrationId) : undefined}
      onDismiss={context.onDismiss}
      directSetup={context.directSetup ?? false}
    />
  );
}

function renderTelegramSetup(context: IntegrationSetupRenderContext) {
  const { action, chat } = context;
  return (
    <TelegramChatConnectorCard
      connected={chat.connected}
      connectorsProvider={chat.connectorsProvider}
      config={chat.config as Record<string, unknown> | null}
      configSchema={chat.configSchema}
      agentName={context.agentName}
      onSaveConfig={typeof chat.saveConfig === "function" ? chat.saveConfig : undefined}
      onChannelProbe={typeof chat.channelsStatus === "function" ? () => chat.channelsStatus(true) : undefined}
      onAgentConfigUpdate={typeof chat.sendMessage === "function"
        ? (prompt, displayContent) => chat.sendMessage(prompt, { displayContent })
        : undefined}
      onReconnectGateway={gatewayReconnect(chat)}
      cachedWorkflow={chat.connectorWorkflows?.telegram}
      onGenerateConnectorWorkflow={chat.generateConnectorWorkflow}
      onRunShellProposal={chat.runConnectorShellProposal}
      onOpenIntegrationDetails={context.onOpenIntegrationDetails ? () => context.onOpenIntegrationDetails?.(action.integrationId) : undefined}
      onOpenFullSetup={context.onOpenFullSetup ? () => context.onOpenFullSetup?.(action.integrationId) : undefined}
      onDismiss={context.onDismiss}
      directSetup={context.directSetup ?? false}
    />
  );
}

function renderSlackSetup(context: IntegrationSetupRenderContext) {
  const { chat, slackRelaySetup } = context;
  if (!slackRelaySetup) return null;
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
      onReconnectGateway={gatewayReconnect(chat)}
      onOpenIntegrationDetails={openIntegrationDetails(context)}
      onOpenFullSetup={openFullSetup(context)}
      onDismiss={context.onDismiss}
      slackRelaySetup={slackRelaySetup}
    />
  );
}

const INTEGRATION_SETUP_OVERRIDES: Partial<Record<ClawIntegrationConnectId, SetupRenderer>> = {
  github: renderGitHubSetup,
  telegram: renderTelegramSetup,
  slack: renderSlackSetup,
};

export function renderGatewayDefinedChannelSetup(context: IntegrationSetupRenderContext) {
  const { action, chat } = context;
  if (!GATEWAY_CHANNEL_IDS.has(action.integrationId)) return null;
  const channelId = action.integrationId as GatewayChannelId;
  return (
    <ChannelChatConnectorCard
      channelId={channelId}
      connected={chat.connected}
      config={chat.config as Record<string, unknown> | null}
      connectorsProvider={chat.connectorsProvider}
      channelsProvider={chat.channelsProvider}
      onSaveConfig={typeof chat.saveConfig === "function" ? chat.saveConfig : undefined}
      onEnsureWhatsAppSupport={channelId === "whatsapp" && typeof chat.ensureWhatsAppSupport === "function"
        ? chat.ensureWhatsAppSupport
        : undefined}
      onWhatsAppPairingStart={channelId === "whatsapp" && typeof chat.whatsAppPairingStart === "function"
        ? chat.whatsAppPairingStart
        : undefined}
      whatsAppPairingState={channelId === "whatsapp" ? chat.whatsAppPairingState : undefined}
      onCancelWhatsAppPairing={channelId === "whatsapp" && typeof chat.cancelWhatsAppPairing === "function"
        ? chat.cancelWhatsAppPairing
        : undefined}
      onWebLoginStart={typeof chat.webLoginStart === "function" ? chat.webLoginStart : undefined}
      onWebLoginWait={typeof chat.webLoginWait === "function" ? chat.webLoginWait : undefined}
      cachedWorkflow={chat.connectorWorkflows?.[channelId]}
      onGenerateConnectorWorkflow={chat.generateConnectorWorkflow}
      onRunShellProposal={chat.runConnectorShellProposal}
      onReconnectGateway={gatewayReconnect(chat)}
      onOpenIntegrationDetails={openIntegrationDetails(context)}
      onOpenFullSetup={openFullSetup(context)}
      onDismiss={context.onDismiss}
      directSetup={context.directSetup ?? false}
    />
  );
}

export function renderIntegrationSetup(context: IntegrationSetupRenderContext) {
  if (context.action.type !== "integration.connect") return null;
  const override = INTEGRATION_SETUP_OVERRIDES[context.action.integrationId];
  return override?.(context) ?? renderGatewayDefinedChannelSetup(context);
}
