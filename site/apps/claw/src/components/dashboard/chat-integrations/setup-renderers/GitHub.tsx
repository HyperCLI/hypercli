import { GitHubChatConnectorCard } from "../GitHubChatConnectorCard";
import type { IntegrationSetupRenderContext } from "./types";

export function renderGitHubSetup(context: IntegrationSetupRenderContext) {
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
