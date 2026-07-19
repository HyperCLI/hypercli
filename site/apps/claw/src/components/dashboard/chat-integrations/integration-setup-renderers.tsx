"use client";

import { renderGatewayDefinedChannelSetup } from "./setup-renderers/Gateway";
import { renderGitHubSetup } from "./setup-renderers/GitHub";
import { renderSlackSetup } from "./setup-renderers/Slack";
import { renderTelegramSetup } from "./setup-renderers/Telegram";
import type { IntegrationSetupRenderContext, SetupRenderer } from "./setup-renderers/types";
import type { ClawIntegrationConnectId } from "./claw-ui-actions";

export type { IntegrationSetupRenderContext } from "./setup-renderers/types";
export { renderGatewayDefinedChannelSetup } from "./setup-renderers/Gateway";

const INTEGRATION_SETUP_OVERRIDES: Partial<Record<ClawIntegrationConnectId, SetupRenderer>> = {
  github: renderGitHubSetup,
  telegram: renderTelegramSetup,
  slack: renderSlackSetup,
};

export function renderIntegrationSetup(context: IntegrationSetupRenderContext) {
  if (context.action.type !== "integration.connect") return null;
  const override = INTEGRATION_SETUP_OVERRIDES[context.action.integrationId];
  return override?.(context) ?? renderGatewayDefinedChannelSetup(context);
}
