import type { ChatMessage } from "@/lib/openclaw-chat";

export const TELEGRAM_AGENT_ALLOWLIST_DISPLAY_PROMPT = "Update Telegram allowlist settings.";
export const TELEGRAM_AGENT_ACCESS_DISPLAY_PROMPT = "Update Telegram access settings.";

const TOKEN_SHAPED_RE = /\b\d{5,}:[A-Za-z0-9_-]{20,}\b/g;
const TELEGRAM_CONFIG_TARGET_RE = /\bchannels\.telegram(?:\.(?:enabled|botToken|dmPolicy|allowFrom|groupPolicy|groupAllowFrom|groups))?\b/i;
const TELEGRAM_CONFIG_ASSISTANT_UPDATE_RE = /\b(?:applied|changed|configured|edited|patched|removed|saved|updated|wrote|written)\b/i;
const TELEGRAM_CONFIG_TOOL_UPDATE_RE = /\b(?:apply|applied|change|changed|configure|configured|edit|edited|patch|patched|remove|removed|save|saved|set|update|updated|write|writes|writing|wrote|written)\b|\bjson\.dump\b|\bsetdefault\b/i;
const TELEGRAM_CONFIG_STATUS_PATTERNS = [
  /^(?:The\s+)?Telegram\s+(?:allowlist|access settings|config(?:uration)?)\s+(?:(?:was|were|has been|have been)\s+)?(?:updated|configured|saved|applied)(?:\s+successfully)?[.!]?$/i,
  /^(?:Successfully\s+)?(?:Updated|Configured|Saved|Applied)\s+(?:the\s+)?Telegram\s+(?:allowlist|access settings|config(?:uration)?)(?:\s+successfully)?[.!]?$/i,
  /^(?:I(?:'ll| will)|Let me)\s+(?:update|configure)\s+(?:the\s+)?Telegram\s+(?:allowlist|access settings|config(?:uration)?)\b/i,
  /^Telegram gateway\s+(?:was\s+)?restarted[.!]?$/i,
  /\bgateway\s+(?:was\s+)?restarted\b.{0,100}\bTelegram\s+(?:config|configuration|settings)\b/i,
  /\bTelegram\s+(?:config|configuration|settings)\b.{0,100}\bgateway\s+(?:was\s+)?restarted\b/i,
];

export function buildTelegramAgentAllowlistPrompt(userIds: string[], requireMention: boolean): string {
  const safeIds = userIds.filter((id) => /^\d+$/.test(id));
  return [
    "Update Telegram allowlist settings in this workspace config.",
    "",
    "Use your file/process tools. This is a config-only update; do not ask for, print, replace, or expose the Telegram bot token.",
    "Preserve the existing channels.telegram.botToken exactly as-is.",
    "Do not paste openclaw.json contents into chat.",
    "",
    "Apply these changes to the active OpenClaw config, usually /home/node/.openclaw/openclaw.json:",
    "- channels.telegram.enabled = true",
    "- channels.telegram.dmPolicy = \"allowlist\"",
    `- channels.telegram.allowFrom = ${JSON.stringify(safeIds)}`,
    `- channels.telegram.groups[\"*\"].requireMention = ${requireMention ? "true" : "false"}`,
    "",
    "Reply with one short sentence. Do not include config contents, file contents, command output, or secrets.",
  ].join("\n");
}

interface TelegramAgentAccessSettings {
  dmPolicy: "runtime-default" | "allowlist" | "pairing" | "open" | "disabled";
  allowFrom: string[];
  groupPolicy: "runtime-default" | "allowlist" | "open" | "disabled";
  groupAllowFrom: string[];
  groupIds: string[];
  mentionChoice: "runtime-default" | "required" | "not-required";
}

export function buildTelegramAgentAccessPrompt(settings: TelegramAgentAccessSettings): string {
  const allowFrom = settings.allowFrom.filter((id) => /^\d+$/.test(id));
  const effectiveAllowFrom = settings.dmPolicy === "open" ? Array.from(new Set(["*", ...allowFrom])) : allowFrom;
  const groupAllowFrom = settings.groupAllowFrom.filter((id) => id === "*" || /^\d+$/.test(id));
  const groupIds = settings.groupIds.filter((id) => id === "*" || /^-?\d+$/.test(id));
  const groups = Object.fromEntries(groupIds.map((groupId) => [groupId, {
    ...(settings.mentionChoice === "required" ? { requireMention: true } : {}),
    ...(settings.mentionChoice === "not-required" ? { requireMention: false } : {}),
  }]));
  return [
    "Update Telegram access settings in this workspace config.",
    "",
    "Use your file/process tools. This is a config-only update; do not ask for, print, replace, or expose the Telegram bot token.",
    "Preserve the existing channels.telegram.botToken exactly as-is.",
    "Do not paste openclaw.json contents into chat.",
    "",
    "Apply only these selected access settings to the active OpenClaw config, usually /home/node/.openclaw/openclaw.json:",
    "- channels.telegram.enabled = true",
    settings.dmPolicy === "runtime-default"
      ? "- remove channels.telegram.dmPolicy so the runtime default applies"
      : `- channels.telegram.dmPolicy = ${JSON.stringify(settings.dmPolicy)}`,
    effectiveAllowFrom.length > 0
      ? `- channels.telegram.allowFrom = ${JSON.stringify(effectiveAllowFrom)}`
      : "- remove channels.telegram.allowFrom",
    settings.groupPolicy === "runtime-default"
      ? "- remove channels.telegram.groupPolicy so the runtime default applies"
      : `- channels.telegram.groupPolicy = ${JSON.stringify(settings.groupPolicy)}`,
    groupAllowFrom.length > 0
      ? `- channels.telegram.groupAllowFrom = ${JSON.stringify(groupAllowFrom)}`
      : "- remove channels.telegram.groupAllowFrom",
    groupIds.length > 0
      ? `- channels.telegram.groups = ${JSON.stringify(groups)}`
      : "- remove channels.telegram.groups",
    "",
    "Reply with one short sentence. Do not include config contents, file contents, command output, or secrets.",
  ].join("\n");
}

function isTelegramConfigPromptContent(content: string): boolean {
  const trimmed = content.trim();
  return (
    trimmed === TELEGRAM_AGENT_ALLOWLIST_DISPLAY_PROMPT ||
    trimmed === TELEGRAM_AGENT_ACCESS_DISPLAY_PROMPT ||
    (trimmed.startsWith("Update Telegram access settings in this workspace config.") && trimmed.includes("channels.telegram")) ||
    (trimmed.startsWith("Update Telegram allowlist settings in this workspace config.") && trimmed.includes("channels.telegram.allowFrom"))
  );
}

function isTelegramConfigAssistantContent(content: string): boolean {
  const redacted = content.replace(TOKEN_SHAPED_RE, "[redacted token]").trim();
  if (!redacted) return false;
  if (isTelegramConfigPromptContent(redacted)) return true;
  if (TELEGRAM_CONFIG_STATUS_PATTERNS.some((pattern) => pattern.test(redacted))) return true;
  const hasConfigTarget = TELEGRAM_CONFIG_TARGET_RE.test(redacted)
    || (/openclaw\.json/i.test(redacted) && /\bTelegram\b/i.test(redacted));
  return hasConfigTarget && TELEGRAM_CONFIG_ASSISTANT_UPDATE_RE.test(redacted);
}

function isTelegramConfigToolCall(name: string, args: string, result = ""): boolean {
  const haystack = `${name}\n${args}\n${result}`.replace(TOKEN_SHAPED_RE, "[redacted token]");
  if (/\bTelegram\b/i.test(haystack) && /\bgateway\s+(?:restart|restarted)\b/i.test(haystack)) return true;
  const hasConfigTarget = TELEGRAM_CONFIG_TARGET_RE.test(haystack)
    || (/openclaw\.json/i.test(haystack) && /\bTelegram\b/i.test(haystack));
  return hasConfigTarget && TELEGRAM_CONFIG_TOOL_UPDATE_RE.test(haystack);
}

export function shouldHideTelegramAgentConfigMessage(message: ChatMessage): boolean {
  if (message.role === "user") return isTelegramConfigPromptContent(message.content);
  if (message.role !== "assistant") return false;
  if (isTelegramConfigAssistantContent(message.content)) return true;
  return (message.toolCalls ?? []).some((toolCall) => isTelegramConfigToolCall(toolCall.name, toolCall.args, toolCall.result));
}
