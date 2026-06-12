import type { ChatMessage } from "@/lib/openclaw-chat";

export const TELEGRAM_AGENT_ALLOWLIST_DISPLAY_PROMPT = "Update Telegram allowlist settings.";

const TOKEN_SHAPED_RE = /\b\d{5,}:[A-Za-z0-9_-]{20,}\b/g;

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

function isTelegramConfigPromptContent(content: string): boolean {
  const trimmed = content.trim();
  return (
    trimmed === TELEGRAM_AGENT_ALLOWLIST_DISPLAY_PROMPT ||
    (trimmed.startsWith("Update Telegram allowlist settings in this workspace config.") && trimmed.includes("channels.telegram.allowFrom"))
  );
}

function isTelegramConfigAssistantContent(content: string): boolean {
  const redacted = content.replace(TOKEN_SHAPED_RE, "[redacted token]").trim();
  if (!redacted) return false;
  return /telegram/i.test(redacted) && /(?:allowFrom|dmPolicy|allowlist|openclaw\.json|gateway restarted|config updated)/i.test(redacted);
}

function isTelegramConfigToolCall(name: string, args: string, result = ""): boolean {
  const haystack = `${name}\n${args}\n${result}`.replace(TOKEN_SHAPED_RE, "[redacted token]");
  return /telegram/i.test(haystack) && /(?:allowFrom|dmPolicy|allowlist|openclaw\.json|gateway restart|channels\.telegram)/i.test(haystack);
}

export function shouldHideTelegramAgentConfigMessage(message: ChatMessage): boolean {
  if (message.role === "user") return isTelegramConfigPromptContent(message.content);
  if (message.role !== "assistant") return false;
  if (isTelegramConfigAssistantContent(message.content)) return true;
  return (message.toolCalls ?? []).some((toolCall) => isTelegramConfigToolCall(toolCall.name, toolCall.args, toolCall.result));
}
