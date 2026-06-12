import type { ChatMessage } from "@/lib/openclaw-chat";

export const GITHUB_CLI_DEVICE_URL = "https://github.com/login/device";

export const GITHUB_AGENT_SETUP_PROMPT = [
  "Set up GitHub CLI authentication in this workspace.",
  "",
  "Use your shell/process tools. Do not ask me for a token. Do not use sudo.",
  "",
  "You are operating inside the agent workspace shell, not the user's local machine. Do not assume this is a Windows gateway, and do not use PowerShell, cmd.exe, winget, choco, or Windows paths.",
  "",
  "First check for GitHub CLI with:",
  "command -v gh && gh --version",
  "",
  "Before installing anything, verify the workspace OS with:",
  "uname -a",
  "test -r /etc/os-release && cat /etc/os-release",
  "",
  "If gh is missing, install GitHub CLI into ~/.local/bin from the official GitHub CLI release tarball and ensure ~/.local/bin is in PATH for future shells.",
  "",
  "Then run:",
  "gh auth login --web --git-protocol https --scopes repo,read:org,gist --skip-ssh-key",
  "",
  "When GitHub prints the device code, tell me the code and URL. After I authorize it in GitHub, verify with gh auth status and gh api user --jq .login.",
  "",
  "When you have the device code, include this exact marker on its own line:",
  "@@hypercli.ui-action/v1 integration.github.device-code <CODE> https://github.com/login/device",
  "",
  "When GitHub is ready, include this exact marker on its own line:",
  "@@hypercli.ui-action/v1 integration.github.ready <GITHUB_LOGIN>",
].join("\n");

export const GITHUB_AGENT_VERIFY_PROMPT = [
  "Check whether GitHub CLI authentication is ready in this workspace.",
  "",
  "Use your shell/process tools. Do not ask me for a token. Do not restart device authorization unless GitHub CLI reports there is no usable login.",
  "",
  "Run:",
  "gh auth status",
  "gh api user --jq .login",
  "",
  "When GitHub is ready, include this exact marker on its own line:",
  "@@hypercli.ui-action/v1 integration.github.ready <GITHUB_LOGIN>",
  "",
  "If GitHub is still waiting for authorization, include this exact marker on its own line:",
  "@@hypercli.ui-action/v1 integration.github.progress device-code \"Waiting for GitHub authorization\"",
  "",
  "If GitHub authorization expired, was denied, or failed for another unrecoverable reason, include this exact marker on its own line:",
  "@@hypercli.ui-action/v1 integration.github.failed \"<reason>\"",
].join("\n");

export type GitHubAgentSetupPhase = "idle" | "checking" | "installing" | "authenticating" | "device-code" | "ready" | "failed";

export interface GitHubAgentSetupStatus {
  phase: GitHubAgentSetupPhase;
  progressDetail?: string;
  userCode?: string;
  verificationUri?: string;
  accountDisplayName?: string;
  failedMessage?: string;
  recentCommands: Array<{ label: string; command: string; result?: string }>;
}

const DEVICE_CODE_RE = /\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/;
const DEVICE_URL_RE = /https:\/\/github\.com\/login\/device\b/;
const TOKEN_LIKE_PATTERN = /\b(?:gh[opsu]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g;
const PROGRESS_PHASES = new Set<GitHubAgentSetupPhase>(["checking", "installing", "authenticating", "device-code", "ready", "failed"]);
const GITHUB_SETUP_MARKER_RE = /@@hypercli\.ui-action\/v1\s+integration\.github\.(?:progress|device-code|ready|failed)\b/i;
const GITHUB_SETUP_DISPLAY_PROMPT = "Set up GitHub in this workspace.";
const GITHUB_VERIFY_DISPLAY_PROMPT = "Check GitHub connection in this workspace.";
const GITHUB_SETUP_CHATTER_PATTERNS = [
  /\bgh\s+is\s+missing\b/i,
  /\binstalling\b.{0,100}\bGitHub CLI\b/i,
  /\bofficial\s+GitHub CLI\s+release\b/i,
  /\bDebian\s+12\s+\(bookworm\)\s+x86_64\b/i,
  /\bAuthenticated!\b/i,
  /\bgh\s+auth\s+login\s+process\s+completed\s+successfully\b/i,
  /\bLet\s+me\s+verify\b/i,
  /\bstandard\s+checks\b/i,
  /\bgh\s+auth\s+status\b/i,
  /\bgh\s+api\s+user\s+--jq\s+\.login\b/i,
];

export function isManagedGitHubAuthUnsupportedError(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : String(cause ?? "");
  return /unknown method:\s*integrations\.auth\.start/i.test(message) || (/method not found/i.test(message) && /integrations\.auth\.start/i.test(message));
}

function sanitizeText(value: string): string {
  return value.replace(TOKEN_LIKE_PATTERN, "[redacted-token]").trim();
}

function commandLabel(name: string, args: string): string {
  const haystack = `${name} ${args}`.toLowerCase();
  if (haystack.includes("auth login")) return "Starting GitHub authorization";
  if (haystack.includes("auth status")) return "Checking GitHub auth";
  if (haystack.includes("api user")) return "Verifying GitHub account";
  if (haystack.includes("curl") || haystack.includes("tar") || haystack.includes(".local/bin") || haystack.includes("which gh")) return "Preparing GitHub CLI";
  return name || "Agent command";
}

function isGitHubRelevantTool(name: string, args: string, result = ""): boolean {
  const haystack = `${name}\n${args}\n${result}`.toLowerCase();
  return haystack.includes("github") || haystack.includes(" gh") || haystack.includes("gh ") || haystack.includes(".local/bin") || haystack.includes("login/device");
}

function isGitHubSetupToolCall(name: string, args: string, result = ""): boolean {
  const haystack = `${name}\n${args}\n${result}`.toLowerCase();
  if (haystack.includes("github.com/login/device") || DEVICE_CODE_RE.test(`${args}\n${result}`)) return true;
  if (/\bgh\s+auth\s+(?:login|status)\b/.test(haystack)) return true;
  if (/\bgh\s+api\s+user\b/.test(haystack)) return true;
  if (/\b(?:command\s+-v|which)\s+gh\b/.test(haystack) || /\bgh\s+--version\b/.test(haystack)) return true;
  if (haystack.includes("github.com/cli/cli") || haystack.includes("cli.github.com")) return true;
  if (haystack.includes("github cli") && /\b(?:install|download|release|tarball)\b/.test(haystack)) return true;
  if (haystack.includes(".local/bin") && /\bgh\b/.test(haystack)) return true;
  if (/\b(?:apt(?:-get)?|dnf|yum|apk)\s+[^\n]*\bgh\b/.test(haystack)) return true;
  return false;
}

function isGitHubSetupPromptContent(content: string): boolean {
  const trimmed = content.trim();
  return (
    trimmed === GITHUB_SETUP_DISPLAY_PROMPT ||
    trimmed === GITHUB_VERIFY_DISPLAY_PROMPT ||
    trimmed === GITHUB_AGENT_SETUP_PROMPT.trim() ||
    trimmed === GITHUB_AGENT_VERIFY_PROMPT.trim() ||
    (trimmed.startsWith("Check whether GitHub CLI authentication is ready in this workspace.") && trimmed.includes("gh auth status")) ||
    (trimmed.startsWith("Set up GitHub CLI authentication in this workspace.") && trimmed.includes("gh auth login --web"))
  );
}

function extractGitHubLoginFromText(text: string, args = ""): string | undefined {
  const directPatterns = [
    /gh\s+auth\s+login\s+process\s+completed\s+successfully\s+as\s+([^\s().,;:!]+)/i,
    /Authenticated!?.{0,120}\bas\s+([^\s().,;:!]+)/i,
    /Logged in to github\.com account\s+([^\s()]+)/i,
    /Logged in to github\.com as\s+([^\s()]+)/i,
    /Authenticated to github\.com as\s+([^\s()]+)/i,
    /"login"\s*:\s*"([A-Za-z0-9-]+)"/i,
  ];
  for (const pattern of directPatterns) {
    const login = text.match(pattern)?.[1];
    if (login) return login;
  }

  if (/\bgh\s+api\s+user\b/i.test(args)) {
    return text
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((line) => line.trim())
      .find((line) => /^[A-Za-z0-9-]+$/.test(line));
  }

  return undefined;
}

function isGitHubSetupAssistantContent(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) return false;
  if (GITHUB_SETUP_MARKER_RE.test(trimmed)) return true;
  if (DEVICE_URL_RE.test(trimmed) && DEVICE_CODE_RE.test(trimmed)) return true;
  if (/\bSet up GitHub CLI\b/i.test(trimmed) || /\bGitHub CLI authentication\b/i.test(trimmed)) return true;
  if (/\bGitHub setup\b.{0,120}\b(?:agent|workspace|device|auth|authorization)\b/i.test(trimmed)) return true;
  if (/\bLogged in to github\.com account\b/i.test(trimmed)) return true;
  if (/\bGitHub is ready in this workspace\b/i.test(trimmed)) return true;
  if (GITHUB_SETUP_CHATTER_PATTERNS.some((pattern) => pattern.test(trimmed))) return true;
  return false;
}

export function shouldHideGitHubAgentSetupMessage(message: ChatMessage): boolean {
  if (message.role === "user") {
    return isGitHubSetupPromptContent(message.content);
  }

  if (message.role !== "assistant") {
    return false;
  }

  if (isGitHubSetupAssistantContent(message.content)) return true;
  return (message.toolCalls ?? []).some((toolCall) => isGitHubSetupToolCall(toolCall.name, toolCall.args, toolCall.result));
}

function phaseFromCommands(commands: GitHubAgentSetupStatus["recentCommands"]): GitHubAgentSetupPhase {
  const joined = commands.map((item) => `${item.command}\n${item.result ?? ""}`).join("\n").toLowerCase();
  if (joined.includes("auth login")) return "authenticating";
  if (joined.includes("curl") || joined.includes("tar") || joined.includes(".local/bin")) return "installing";
  if (joined.includes("which gh") || joined.includes("gh --version") || joined.includes("auth status")) return "checking";
  return "idle";
}

export function extractGitHubAgentSetupStatus(messages: ChatMessage[]): GitHubAgentSetupStatus {
  const recentCommands: GitHubAgentSetupStatus["recentCommands"] = [];
  let userCode: string | undefined;
  let verificationUri: string | undefined;
  let accountDisplayName: string | undefined;
  let failedMessage: string | undefined;
  let explicitPhase: GitHubAgentSetupPhase | undefined;
  let progressDetail: string | undefined;

  for (const message of messages) {
    if (message.role === "assistant") {
      const content = message.content;
      const deviceMarker = content.match(/@@hypercli\.ui-action\/v1\s+integration\.github\.device-code\s+([A-Z0-9]{4}-[A-Z0-9]{4})(?:\s+(https:\/\/github\.com\/login\/device))?/i);
      const readyMarker = content.match(/@@hypercli\.ui-action\/v1\s+integration\.github\.ready\s+([^\s]+)/i);
      const failedMarker = content.match(/@@hypercli\.ui-action\/v1\s+integration\.github\.failed\s+(?:"([^"]*)"|(.+))/i);
      const progressMarker = content.match(/@@hypercli\.ui-action\/v1\s+integration\.github\.progress\s+([a-z-]+)(?:\s+"([^"]*)")?/i);
      const naturalCode = content.match(DEVICE_CODE_RE)?.[0];
      const naturalUrl = content.match(DEVICE_URL_RE)?.[0];
      const naturalReady = content.match(/(?:authenticated|logged in|ready).{0,80}\bas\s+([A-Za-z0-9-]+)/i)?.[1] ?? extractGitHubLoginFromText(content);

      if (progressMarker?.[1]) {
        const phase = progressMarker[1].toLowerCase() as GitHubAgentSetupPhase;
        if (PROGRESS_PHASES.has(phase)) explicitPhase = phase;
        if (progressMarker[2]) progressDetail = sanitizeText(progressMarker[2]);
      }

      if (deviceMarker?.[1] || naturalCode) userCode = deviceMarker?.[1] ?? naturalCode;
      if (deviceMarker?.[2] || naturalUrl) verificationUri = deviceMarker?.[2] ?? naturalUrl;
      if (readyMarker?.[1] || naturalReady) accountDisplayName = readyMarker?.[1] ?? naturalReady;
      if (failedMarker?.[1] || failedMarker?.[2]) failedMessage = sanitizeText(failedMarker[1] ?? failedMarker[2]);
    }

    for (const toolCall of message.toolCalls ?? []) {
      if (!isGitHubRelevantTool(toolCall.name, toolCall.args, toolCall.result)) continue;
      const toolText = `${toolCall.args}\n${toolCall.result ?? ""}`;
      const toolCode = toolText.match(DEVICE_CODE_RE)?.[0];
      const toolUrl = toolText.match(DEVICE_URL_RE)?.[0];
      const toolReady = extractGitHubLoginFromText(toolText, toolCall.args);
      if (toolCode) userCode = toolCode;
      if (toolUrl) verificationUri = toolUrl;
      if (toolReady) accountDisplayName = toolReady;
      recentCommands.push({
        label: commandLabel(toolCall.name, toolCall.args),
        command: sanitizeText(toolCall.args).slice(0, 500),
        result: toolCall.result ? sanitizeText(toolCall.result).slice(-1000) : undefined,
      });
    }
  }

  const phase: GitHubAgentSetupPhase = failedMessage
    ? "failed"
    : accountDisplayName
      ? "ready"
      : userCode
        ? "device-code"
        : explicitPhase ?? phaseFromCommands(recentCommands);

  return {
    phase,
    progressDetail,
    userCode,
    verificationUri: verificationUri ?? (userCode ? GITHUB_CLI_DEVICE_URL : undefined),
    accountDisplayName,
    failedMessage,
    recentCommands: recentCommands.slice(-8),
  };
}
