import { SlackChatConnectorCard } from "../SlackChatConnectorCard";
import { gatewayReconnect, openFullSetup, openIntegrationDetails } from "./types";
import type { IntegrationSetupRenderContext } from "./types";

export function renderSlackSetup(context: IntegrationSetupRenderContext) {
  const { chat, slackRelaySetup } = context;
  return (
    <SlackChatConnectorCard
      agentId={context.agentId}
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
      onEnsureSlackSupport={chat.ensureSlackSupport}
      onRefreshChannels={chat.refreshReportedChannels}
      onOpenIntegrationDetails={openIntegrationDetails(context)}
      onOpenFullSetup={openFullSetup(context)}
      onDismiss={context.onDismiss}
      slackRelaySetup={slackRelaySetup}
    />
  );
}
