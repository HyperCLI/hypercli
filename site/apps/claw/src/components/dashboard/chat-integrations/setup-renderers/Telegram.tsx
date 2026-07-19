import { TelegramChatConnectorCard } from "../TelegramChatConnectorCard";
import { gatewayReconnect } from "./types";
import type { IntegrationSetupRenderContext } from "./types";

export function renderTelegramSetup(context: IntegrationSetupRenderContext) {
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
