import type { ConnectorAuthorizationFlow } from "./ConnectorAuthorizationGuide";

export const TELEGRAM_PAIRING_AUTHORIZATION_FLOW: ConnectorAuthorizationFlow = {
  protocol: "short-code",
  visibleWhen: {
    all: [{ inputSlot: "telegram.dmPolicy", operator: "equals", value: "pairing" }],
  },
  identityLabel: "allowed user ID",
  identityRequirement: "optional",
  codeLength: 8,
  codePattern: /^[A-HJ-NP-Z2-9]{8}$/,
  expiresInMinutes: 60,
  firstEventProcessed: false,
};

export const SLACK_PAIRING_AUTHORIZATION_FLOW: ConnectorAuthorizationFlow = {
  protocol: "short-code",
  visibleWhen: {
    all: [{ inputSlot: "slack.dmPolicy", operator: "equals", value: "pairing" }],
  },
  identityLabel: "allowed Slack user ID",
  identityRequirement: "optional",
  codeLength: 8,
  codePattern: /^[A-HJ-NP-Z2-9]{8}$/,
  expiresInMinutes: 60,
  firstEventProcessed: false,
};
