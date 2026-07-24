import { GITHUB_CLI_DEVICE_URL, type GitHubAgentSetupPhase } from "@/lib/github-cli-workspace";

export type ClawIntegrationConnectId = "github" | "telegram" | "discord" | "slack" | "whatsapp";

export type ClawIntegrationConnectAction = {
  version: 1;
  type: "integration.connect";
  integrationId: ClawIntegrationConnectId;
};

export type ClawGitHubProgressAction = {
  version: 1;
  type: "integration.github.progress";
  phase: Exclude<GitHubAgentSetupPhase, "idle">;
  detail?: string;
};

export type ClawGitHubDeviceCodeAction = {
  version: 1;
  type: "integration.github.device-code";
  userCode: string;
  verificationUri: string;
};

export type ClawGitHubReadyAction = {
  version: 1;
  type: "integration.github.ready";
  accountDisplayName?: string;
};

export type ClawGitHubFailedAction = {
  version: 1;
  type: "integration.github.failed";
  reason: string;
};

export type ClawUiAction =
  | ClawIntegrationConnectAction
  | ClawGitHubProgressAction
  | ClawGitHubDeviceCodeAction
  | ClawGitHubReadyAction
  | ClawGitHubFailedAction;

export interface ParsedClawUiActions {
  displayContent: string;
  actions: ClawUiAction[];
}

const ACTION_BLOCK_RE = /```claw-ui-action\s*\r?\n([\s\S]*?)\r?\n```/g;
const ALLOWED_INTEGRATION_IDS = new Set<ClawIntegrationConnectId>(["github", "telegram", "discord", "slack", "whatsapp"]);
const SENTINEL_PREFIX = "@@hypercli.ui-action/v1";
const CONNECT_SENTINEL_RE = /^@@hypercli\.ui-action\/v1\s+integration\.connect\s+([a-z0-9-]+)\s*$/i;
const DEVICE_CODE_SENTINEL_RE = /^@@hypercli\.ui-action\/v1\s+integration\.github\.device-code\s+([A-Z0-9]{4}-[A-Z0-9]{4})(?:\s+(https:\/\/github\.com\/login\/device))?\s*$/i;
const PROGRESS_SENTINEL_RE = /^@@hypercli\.ui-action\/v1\s+integration\.github\.progress\s+([a-z-]+)(?:\s+"([^"]*)")?\s*$/i;
const READY_SENTINEL_RE = /^@@hypercli\.ui-action\/v1\s+integration\.github\.ready(?:\s+([^\s]+))?\s*$/i;
const FAILED_SENTINEL_RE = /^@@hypercli\.ui-action\/v1\s+integration\.github\.failed\s+(?:"([^"]*)"|(.+))\s*$/i;
const PROGRESS_PHASES = new Set<ClawGitHubProgressAction["phase"]>([
  "checking",
  "installing",
  "authenticating",
  "device-code",
  "ready",
  "failed",
]);

function normalizeAction(value: unknown): ClawUiAction | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.version !== 1) return null;
  if (record.type !== "integration.connect") return null;
  if (typeof record.integrationId !== "string") return null;
  const integrationId = record.integrationId.toLowerCase() as ClawIntegrationConnectId;
  if (!ALLOWED_INTEGRATION_IDS.has(integrationId)) return null;
  return {
    version: 1,
    type: "integration.connect",
    integrationId,
  };
}

function normalizeSentinelLine(line: string): ClawUiAction | null {
  const trimmed = line.trim();
  const connectMatch = trimmed.match(CONNECT_SENTINEL_RE);
  if (connectMatch) {
    const integrationId = connectMatch[1]?.toLowerCase() as ClawIntegrationConnectId | undefined;
    if (!integrationId || !ALLOWED_INTEGRATION_IDS.has(integrationId)) return null;
    return {
      version: 1,
      type: "integration.connect",
      integrationId,
    };
  }

  const progressMatch = trimmed.match(PROGRESS_SENTINEL_RE);
  if (progressMatch) {
    const phase = progressMatch[1]?.toLowerCase() as ClawGitHubProgressAction["phase"];
    if (!PROGRESS_PHASES.has(phase)) return null;
    return {
      version: 1,
      type: "integration.github.progress",
      phase,
      ...(progressMatch[2] ? { detail: progressMatch[2] } : {}),
    };
  }

  const deviceCodeMatch = trimmed.match(DEVICE_CODE_SENTINEL_RE);
  if (deviceCodeMatch?.[1]) {
    return {
      version: 1,
      type: "integration.github.device-code",
      userCode: deviceCodeMatch[1].toUpperCase(),
      verificationUri: deviceCodeMatch[2] ?? GITHUB_CLI_DEVICE_URL,
    };
  }

  const readyMatch = trimmed.match(READY_SENTINEL_RE);
  if (readyMatch) {
    return {
      version: 1,
      type: "integration.github.ready",
      ...(readyMatch[1] ? { accountDisplayName: readyMatch[1] } : {}),
    };
  }

  const failedMatch = trimmed.match(FAILED_SENTINEL_RE);
  if (failedMatch?.[1] || failedMatch?.[2]) {
    return {
      version: 1,
      type: "integration.github.failed",
      reason: failedMatch[1] ?? failedMatch[2],
    };
  }

  return null;
}

function parseSentinelActions(content: string, streaming: boolean): ParsedClawUiActions {
  const actions: ClawUiAction[] = [];
  const visibleLines: string[] = [];

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith(SENTINEL_PREFIX)) {
      const action = normalizeSentinelLine(trimmed);
      if (action) {
        actions.push(action);
        continue;
      }
      if (streaming) continue;
    }
    if (streaming && trimmed.startsWith("@@hypercli.") && SENTINEL_PREFIX.startsWith(trimmed)) {
      continue;
    }
    visibleLines.push(line);
  }

  return {
    displayContent: visibleLines.join("\n"),
    actions,
  };
}

function stripIncompleteActionBlock(content: string): string {
  const openingIndex = content.lastIndexOf("```claw-ui-action");
  if (openingIndex < 0) return content;
  const closingIndex = content.indexOf("```", openingIndex + "```claw-ui-action".length);
  return closingIndex < 0 ? content.slice(0, openingIndex) : content;
}

export function parseClawUiActionBlocks(
  content: string,
  role: string,
  options: { streaming?: boolean } = {},
): ParsedClawUiActions {
  const streaming = options.streaming === true;
  const containsPartialSentinel = streaming && content.split(/\r?\n/).some((line) => {
    const trimmed = line.trim();
    return trimmed.startsWith("@@hypercli.") && SENTINEL_PREFIX.startsWith(trimmed);
  });
  if (role !== "assistant" || (!content.includes("```claw-ui-action") && !content.includes(SENTINEL_PREFIX) && !containsPartialSentinel)) {
    return { displayContent: content, actions: [] };
  }

  const parsedSentinels = parseSentinelActions(content, streaming);
  const actions: ClawUiAction[] = [...parsedSentinels.actions];
  const contentWithoutPartialBlock = streaming
    ? stripIncompleteActionBlock(parsedSentinels.displayContent)
    : parsedSentinels.displayContent;
  const displayContent = contentWithoutPartialBlock.replace(ACTION_BLOCK_RE, (block, rawJson: string) => {
    try {
      const action = normalizeAction(JSON.parse(rawJson));
      if (!action) return block;
      actions.push(action);
      return "";
    } catch {
      return block;
    }
  });

  return {
    displayContent: displayContent.replace(/\n{3,}/g, "\n\n").trim(),
    actions,
  };
}
