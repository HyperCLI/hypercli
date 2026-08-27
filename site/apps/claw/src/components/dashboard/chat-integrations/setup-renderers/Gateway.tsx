import { ChannelChatConnectorCard } from "../ChannelChatConnectorCard";
import type { ClawIntegrationConnectId } from "../claw-ui-actions";
import { gatewayReconnect, openFullSetup, openIntegrationDetails } from "./types";
import type { IntegrationSetupRenderContext } from "./types";

type GatewayChannelId = "discord" | "whatsapp";

const GATEWAY_CHANNEL_IDS = new Set<ClawIntegrationConnectId>(["discord", "whatsapp"]);

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
      onRequestProductUse={context.onRequestProductUse}
    />
  );
}
