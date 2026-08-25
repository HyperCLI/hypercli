import type {
  ActivityRenderClass,
  ObserverEvent,
  ToolStatus,
} from "./types";

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

export function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

export function getToolString(
  record: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

export function getToolStringList(
  record: Record<string, unknown>,
  keys: string[],
): string[] {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return [value.trim()];
    }
    if (Array.isArray(value)) {
      return value.filter(
        (item): item is string =>
          typeof item === "string" && item.trim().length > 0,
      );
    }
  }
  return [];
}

// ---------------------------------------------------------------------------
// Observer frame plumbing (ported from observerRelayStore.ts)
// ---------------------------------------------------------------------------

export function compareObserverEvents(
  left: { timestamp: string; seq: number },
  right: { timestamp: string; seq: number },
): number {
  const leftTime = Date.parse(left.timestamp);
  const rightTime = Date.parse(right.timestamp);
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) {
    const timeDiff = leftTime - rightTime;
    if (timeDiff !== 0) {
      return timeDiff;
    }
  }
  return left.seq - right.seq;
}

export function observerEventKey(event: {
  timestamp: string;
  seq: number;
}): string {
  return `${event.timestamp.length}:${event.timestamp}:${event.seq}`;
}

const OBSERVER_BATCH_KIND = "batch";

export function unwrapObserverBatch(parsed: ObserverEvent): ObserverEvent[] {
  if (parsed.kind !== OBSERVER_BATCH_KIND) {
    return [parsed];
  }
  const payload = parsed.payload as { events?: unknown } | null;
  const events = Array.isArray(payload?.events)
    ? (payload.events as ObserverEvent[])
    : null;
  return events && events.length > 0 ? events : [parsed];
}

// ---------------------------------------------------------------------------
// Tool status / name normalization (ported from agentSessionToolCatalog.ts)
// ---------------------------------------------------------------------------

export function normalizeToolStatus(status: string): ToolStatus {
  const normalized = status.toLowerCase();
  if (
    normalized.includes("complete") ||
    normalized.includes("success") ||
    normalized === "done"
  ) {
    return "completed";
  }
  if (normalized.includes("fail") || normalized.includes("error")) {
    return "failed";
  }
  if (normalized.includes("pending")) {
    return "pending";
  }
  return "executing";
}

const BUZZ_READ_TOOLS = new Set([
  "get_messages",
  "get_channel_history",
  "get_thread",
  "search",
  "get_feed",
  "get_reactions",
  "list_channels",
  "get_channel",
  "get_users",
  "get_presence",
  "list_channel_members",
  "list_dms",
  "get_canvas",
  "list_workflows",
  "get_workflow_runs",
  "get_event",
  "get_user_notes",
  "get_contact_list",
]);

const BUZZ_WRITE_TOOLS = new Set([
  "send_message",
  "send_diff_message",
  "edit_message",
  "delete_message",
  "add_reaction",
  "remove_reaction",
  "join_channel",
  "leave_channel",
  "update_channel",
  "set_channel_topic",
  "set_channel_purpose",
  "open_dm",
  "set_profile",
  "set_presence",
  "trigger_workflow",
  "approve_step",
  "create_channel",
  "archive_channel",
  "unarchive_channel",
  "add_channel_member",
  "remove_channel_member",
  "add_dm_member",
  "hide_dm",
  "set_canvas",
  "create_workflow",
  "update_workflow",
  "delete_workflow",
  "set_channel_add_policy",
  "vote_on_post",
  "publish_note",
  "set_contact_list",
]);

const BUZZ_TOOL_NAMES = new Set([...BUZZ_READ_TOOLS, ...BUZZ_WRITE_TOOLS]);

const BUZZ_TOOL_NAMES_BY_LENGTH = [...BUZZ_TOOL_NAMES].sort(
  (left, right) => right.length - left.length,
);

const BUZZ_TOOL_TITLE_ALIASES: Array<[RegExp, string]> = [
  [/\bsending message to channel\b/, "send_message"],
  [/\bretrieving recent messages from channel\b/, "get_messages"],
  [/\bgetting channel details\b/, "get_channel"],
  [/\bgetting user information\b/, "get_users"],
  [/\bsearching relay history\b/, "search"],
  [/\bgetting thread\b/, "get_thread"],
  [/\badding reaction\b/, "add_reaction"],
  [/\bremoving reaction\b/, "remove_reaction"],
];

export function isBuzzToolName(title: string): boolean {
  return BUZZ_TOOL_NAMES.has(normalizeToolName(title));
}

export function normalizeToolName(title: string): string {
  const knownName = findBuzzToolName(title, true);
  if (knownName) return knownName;

  const normalized = normalizeToolNameText(title).replace(/^buzz_/, "");
  return normalized.match(/[a-z][a-z0-9_]+/)?.[0] ?? normalized;
}

export function normalizeToolNameText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function findBuzzToolName(
  value: string,
  includeShortNames: boolean,
): string | null {
  const alias = findBuzzToolAlias(value);
  if (alias) return alias;

  const normalized = normalizeToolNameText(value);
  return (
    BUZZ_TOOL_NAMES_BY_LENGTH.find(
      (name) =>
        (includeShortNames || name.length >= 8) && normalized.includes(name),
    ) ?? null
  );
}

function findBuzzToolAlias(value: string): string | null {
  const normalizedPhrase = value
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
  return (
    BUZZ_TOOL_TITLE_ALIASES.find(([pattern]) =>
      pattern.test(normalizedPhrase),
    )?.[1] ?? null
  );
}

export function isGenericToolTitle(value: string): boolean {
  const normalized = normalizeToolNameText(value);
  return (
    normalized.length === 0 ||
    normalized === "tool" ||
    normalized === "tool_call" ||
    normalized === "mcp_tool_call" ||
    normalized === "unknown" ||
    normalized === "read" ||
    normalized === "write" ||
    normalized === "execute" ||
    normalized === "completed"
  );
}

export function formatToolTitle(
  toolName: string,
  fallbackTitle?: string,
): string {
  const name = normalizeToolName(toolName);
  if (BUZZ_READ_TOOLS.has(name) || BUZZ_WRITE_TOOLS.has(name)) {
    return name
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }
  if (fallbackTitle && !isGenericToolTitle(fallbackTitle)) {
    return fallbackTitle;
  }
  return toolName;
}

// ---------------------------------------------------------------------------
// Tool classification (ported from agentSessionToolClassifier.ts, without the
// desktop icon/action/tone metadata)
// ---------------------------------------------------------------------------

export interface ToolClassificationInput {
  title: string;
  toolName: string;
  buzzToolName: string | null;
  args: Record<string, unknown>;
  result: string;
  isError: boolean;
}

export interface BuzzToolClassification {
  renderClass: ActivityRenderClass;
  label: string;
  preview: string | null;
}

type ToolClassifierProvider = (
  input: ToolClassificationInput,
) => BuzzToolClassification | null;

const DEVELOPER_TOOL_BASES = new Set([
  "shell",
  "read_file",
  "view_image",
  "str_replace",
  "todo",
  "stop",
  "postcompact",
]);

const BUZZ_CLI_GROUPS = new Set([
  "messages",
  "channels",
  "dms",
  "reactions",
  "canvas",
  "feed",
  "users",
  "workflows",
  "social",
  "repos",
  "upload",
  "mem",
  "notes",
  "patches",
  "pr",
  "issues",
  "emoji",
  "pack",
]);

const providers: ToolClassifierProvider[] = [
  classifyLoadSkillTool,
  classifyDeveloperHarnessTool,
  classifyBuzzTool,
];

export function classifyTool(
  input: ToolClassificationInput,
): BuzzToolClassification {
  for (const provider of providers) {
    const descriptor = provider(input);
    if (descriptor) {
      return input.isError || descriptor.renderClass === "error"
        ? {
            ...descriptor,
            renderClass: "error",
            label: descriptor.label.endsWith("failed")
              ? descriptor.label
              : `${descriptor.label} failed`,
          }
        : descriptor;
    }
  }

  return genericDescriptor(input);
}

function classifyLoadSkillTool(
  input: ToolClassificationInput,
): BuzzToolClassification | null {
  const isLoadSkill = [input.toolName, input.title, input.buzzToolName].some(
    (value) => value && normalizeToolNameText(value) === "load_skill",
  );
  if (!isLoadSkill) return null;

  const skillRef = getToolString(input.args, ["name"]);
  const isSupportingFile = skillRef?.includes("/") ?? false;

  return {
    renderClass: "skill-read",
    label: isSupportingFile ? "Read skill file" : "Read skill",
    preview: skillRef,
  };
}

function classifyDeveloperHarnessTool(
  input: ToolClassificationInput,
): BuzzToolClassification | null {
  const kind = resolveDeveloperToolKind(input);
  if (!kind) return null;

  if (kind === "shell") {
    const command = getToolString(input.args, ["command"]);
    const buzzCli = command ? parseBuzzCliCommand(command) : null;
    if (buzzCli) {
      return buzzCli;
    }
    return {
      renderClass: "shell",
      label: "Ran command",
      preview: command,
    };
  }

  if (kind === "read_file") {
    return {
      renderClass: "file-read",
      label: "Read file",
      preview: getToolString(input.args, ["path"]),
    };
  }

  if (kind === "view_image") {
    const source = getToolString(input.args, ["source"]);
    return {
      renderClass: "image",
      label: "Viewed image",
      preview: source ? basenameOrUrl(source) : null,
    };
  }

  if (kind === "str_replace") {
    return {
      renderClass: "file-edit",
      label: "Edited file",
      preview: getToolString(input.args, ["path"]),
    };
  }

  if (kind === "todo") {
    return {
      renderClass: "plan",
      label: "Updated todos",
      preview: getTodoPreview(input.args),
    };
  }

  if (kind === "stop_hook") {
    return {
      renderClass: "suppressed",
      label: "Checked todos",
      preview: null,
    };
  }

  if (kind === "post_compact_hook") {
    return {
      renderClass: "status",
      label: "Context compacted",
      preview: null,
    };
  }

  return {
    renderClass: "generic",
    label: "Ran tool",
    preview: genericPreview(input),
  };
}

function classifyBuzzTool(
  input: ToolClassificationInput,
): BuzzToolClassification | null {
  const name = [input.buzzToolName, input.toolName, input.title].find(
    (value) => value && isBuzzToolName(value),
  );
  if (!name) return null;

  const operation = normalizeToolNameText(name);
  return {
    renderClass: isBuzzMessageSend(operation) ? "message" : "relay-op",
    label: formatToolTitle(name, input.title),
    preview: extractBuzzToolPreview(input.args),
  };
}

function genericDescriptor(
  input: ToolClassificationInput,
): BuzzToolClassification {
  const preview = genericPreview(input);
  return {
    renderClass: "generic",
    label: "Ran tool",
    preview,
  };
}

function resolveDeveloperToolKind(
  input: ToolClassificationInput,
):
  | "shell"
  | "read_file"
  | "view_image"
  | "str_replace"
  | "todo"
  | "stop_hook"
  | "post_compact_hook"
  | "dev_mcp"
  | null {
  for (const value of [input.toolName, input.title, input.buzzToolName]) {
    const kind = classifyDeveloperToolName(value);
    if (kind) return kind;
  }
  return null;
}

function classifyDeveloperToolName(value: string | null | undefined) {
  if (!value) return null;

  const normalized = normalizeToolNameText(value);
  const base = normalized.replace(/^buzz_dev_mcp_/, "");

  if (base === "shell" || normalized.endsWith("_shell")) return "shell";
  if (base === "read_file" || normalized.endsWith("_read_file"))
    return "read_file";
  if (base === "view_image" || normalized.endsWith("_view_image"))
    return "view_image";
  if (base === "str_replace" || normalized.endsWith("_str_replace"))
    return "str_replace";
  if (base === "todo") return "todo";
  if (base === "stop") return "stop_hook";
  if (base === "postcompact") return "post_compact_hook";
  if (DEVELOPER_TOOL_BASES.has(base) || normalized.includes("buzz_dev_mcp")) {
    return "dev_mcp";
  }
  return null;
}

export function parseBuzzCliCommand(
  command: string,
): BuzzToolClassification | null {
  const tokens = tokenizeShellCommand(command);
  const range = findBuzzCommand(tokens);
  if (!range) return null;

  const group = tokens[range.groupIndex];
  const verb = tokens[range.verbIndex] ?? "run";
  const isSend = group === "messages" && verb === "send";
  const preview = isSend
    ? extractBuzzCliInlineContent(tokens, range)
    : extractBuzzCliObjectPreview(tokens, range);
  return {
    renderClass: isSend ? "message" : "relay-op",
    label: titleForBuzzCli(group, verb),
    preview,
  };
}

function titleForBuzzCli(group: string, verb: string) {
  if (group === "messages" && verb === "send") return "Send Message";
  return [group, verb]
    .map((part) =>
      part
        .split(/[-_]+/)
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" "),
    )
    .filter(Boolean)
    .join(" ");
}

function extractBuzzCliInlineContent(
  tokens: string[],
  range: BuzzCommandRange,
): string | null {
  const content = getFlagValue(tokens, range.verbIndex + 1, "--content");
  if (!content || content === "-") return null;
  if (content.includes("$") || content.includes("`")) return null;
  return content;
}

function extractBuzzCliObjectPreview(
  tokens: string[],
  range: BuzzCommandRange,
): string | null {
  const flagPreview =
    getFlagValue(tokens, range.verbIndex + 1, "--channel") ??
    getFlagValue(tokens, range.verbIndex + 1, "--event") ??
    getFlagValue(tokens, range.verbIndex + 1, "--query") ??
    getFlagValue(tokens, range.verbIndex + 1, "--name") ??
    getFlagValue(tokens, range.verbIndex + 1, "--file");
  if (flagPreview) return flagPreview;

  const next = tokens[range.verbIndex + 1];
  return next && !isCommandSeparator(next) && !next.startsWith("-")
    ? next
    : null;
}

interface BuzzCommandRange {
  buzzIndex: number;
  groupIndex: number;
  verbIndex: number;
}

function findBuzzCommand(tokens: string[]): BuzzCommandRange | null {
  for (let i = 0; i < tokens.length; i++) {
    if (!isBuzzExecutable(tokens[i])) continue;

    for (let j = i + 1; j < tokens.length; j++) {
      if (isCommandSeparator(tokens[j])) break;
      if (tokens[j].startsWith("-")) {
        if (
          !tokens[j].includes("=") &&
          tokens[j + 1]?.startsWith("-") === false
        ) {
          j += 1;
        }
        continue;
      }
      if (!BUZZ_CLI_GROUPS.has(tokens[j])) continue;
      const verbIndex = j + 1;
      if (!tokens[verbIndex] || isCommandSeparator(tokens[verbIndex])) {
        return null;
      }
      return { buzzIndex: i, groupIndex: j, verbIndex };
    }
  }
  return null;
}

export function tokenizeShellCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaping = false;

  const pushCurrent = () => {
    if (current.length > 0) {
      tokens.push(current);
      current = "";
    }
  };

  for (const char of command) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }
    if (char === "\\" && quote !== "'") {
      escaping = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      pushCurrent();
      continue;
    }
    if (char === "|" || char === ";" || char === "&") {
      pushCurrent();
      tokens.push(char);
      continue;
    }
    current += char;
  }

  if (escaping) current += "\\";
  pushCurrent();
  return tokens;
}

function isBuzzExecutable(token: string) {
  return token === "buzz" || token.split(/[\\/]/).pop() === "buzz";
}

function isCommandSeparator(token: string) {
  return token === "|" || token === ";" || token === "&";
}

function getFlagValue(tokens: string[], start: number, flag: string) {
  for (let i = start; i < tokens.length; i++) {
    const token = tokens[i];
    if (isCommandSeparator(token)) return null;
    if (token === flag) {
      return tokens[i + 1] && !isCommandSeparator(tokens[i + 1])
        ? tokens[i + 1]
        : null;
    }
    if (token.startsWith(`${flag}=`)) return token.slice(flag.length + 1);
  }
  return null;
}

function extractBuzzToolPreview(args: Record<string, unknown>): string | null {
  const content = getToolString(args, ["content", "message", "text", "body"]);
  if (content) return content;
  const query = getToolString(args, ["query", "search"]);
  if (query) return query;
  const channelId = getToolString(args, ["channel_id", "channelId"]);
  if (channelId) return channelId;
  const workflowId = getToolString(args, ["workflow_id", "workflowId"]);
  if (workflowId) return workflowId;
  const pubkeys = getToolStringList(args, ["pubkeys", "pubkey"]);
  if (pubkeys.length === 1) return pubkeys[0];
  if (pubkeys.length > 1) return `${pubkeys.length} users`;
  return getToolString(args, ["event_id", "eventId", "name"]);
}

function genericPreview(input: ToolClassificationInput): string | null {
  return (
    getToolString(input.args, [
      "command",
      "path",
      "source",
      "query",
      "name",
      "content",
      "message",
    ]) ?? (input.title ? input.title : null)
  );
}

function isBuzzMessageSend(operation: string) {
  return operation === "send_message" || operation === "messages_send";
}

function basenameOrUrl(source: string): string {
  const trimmed = source.trim();
  if (
    trimmed.startsWith("data:image/") ||
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://")
  ) {
    return trimmed;
  }
  return trimmed.split(/[/\\]/).pop() ?? trimmed;
}

function getTodoPreview(args: Record<string, unknown>): string | null {
  const todos = args.todos;
  if (!Array.isArray(todos)) return "todo list";
  if (todos.length === 0) return "empty list";
  const first = todos[0];
  const firstText =
    first && typeof first === "object"
      ? getToolString(asRecord(first), ["text"])
      : null;
  if (firstText)
    return todos.length > 1 ? `${firstText} (+${todos.length - 1})` : firstText;
  return `${todos.length} item${todos.length === 1 ? "" : "s"}`;
}

// ---------------------------------------------------------------------------
// Payload extraction helpers (ported from agentSessionTranscriptHelpers.ts)
// ---------------------------------------------------------------------------

export function extractPromptText(payload: Record<string, unknown>): string {
  const params = asRecord(payload.params);
  const prompt = params.prompt;
  if (!Array.isArray(prompt)) return "";
  return prompt.map(extractBlockText).filter(Boolean).join("\n");
}

export function extractContentText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(extractBlockText).join("\n");
  return extractBlockText(value);
}

export function extractBlockText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(extractBlockText).join("\n");
  const record = asRecord(value);
  const nestedContent = record.content;
  const rawOutput = record.rawOutput;
  const nestedText =
    nestedContent && typeof nestedContent === "object"
      ? extractBlockText(nestedContent)
      : "";
  const rawOutputText =
    rawOutput === undefined || rawOutput === null
      ? ""
      : typeof rawOutput === "string"
        ? rawOutput
        : JSON.stringify(rawOutput, null, 2);
  const directText = asString(record.text) ?? asString(record.content);
  return directText || nestedText || rawOutputText || "";
}

export function extractPlanText(update: Record<string, unknown>): string {
  if (Array.isArray(update.entries)) {
    return update.entries
      .map((entry) => formatPlanEntry(asRecord(entry)))
      .filter(Boolean)
      .join("\n");
  }
  const contentText = extractContentText(update.content);
  return contentText || JSON.stringify(update, null, 2);
}

function formatPlanEntry(entry: Record<string, unknown>): string {
  const content = asString(entry.content);
  if (!content) return "";
  const checkbox = entry.status === "completed" ? "[x]" : "[ ]";
  const suffix = entry.status === "in_progress" ? " (in progress)" : "";
  return `- ${checkbox} ${content}${suffix}`;
}

export function extractToolArgs(
  update: Record<string, unknown>,
): Record<string, unknown> {
  const candidates = [
    update.args,
    update.arguments,
    update.input,
    update.rawInput,
  ];
  for (const candidate of candidates) {
    if (
      candidate &&
      typeof candidate === "object" &&
      !Array.isArray(candidate)
    ) {
      return candidate as Record<string, unknown>;
    }
  }
  return {};
}

export function extractToolIdentity(update: Record<string, unknown>): {
  title: string;
  toolName: string;
  buzzToolName: string | null;
} {
  const candidates = collectToolNameCandidates(update);
  const knownName = candidates
    .map((candidate) => findBuzzToolName(candidate, true))
    .find((candidate): candidate is string => Boolean(candidate));
  const firstSpecific = candidates.find(
    (candidate) => !isGenericToolTitle(candidate),
  );
  const title =
    asString(update.title) ?? knownName ?? firstSpecific ?? "Tool call";
  return {
    title,
    toolName: knownName ?? normalizeToolName(firstSpecific ?? title),
    buzzToolName: knownName ?? null,
  };
}

function collectToolNameCandidates(update: Record<string, unknown>): string[] {
  const args = extractToolArgs(update);
  const tool = asRecord(update.tool);
  const input = asRecord(update.input);
  const rawInput = asRecord(update.rawInput);
  const candidates = [
    update.toolName,
    update.tool_name,
    update.name,
    update.title,
    update.kind,
    tool.name,
    tool.toolName,
    args.toolName,
    args.tool_name,
    args.name,
    args.method,
    input.toolName,
    input.tool_name,
    input.name,
    rawInput.toolName,
    rawInput.tool_name,
    rawInput.name,
  ];

  return candidates.flatMap((candidate) => {
    const value = asString(candidate);
    return value ? [value] : [];
  });
}

export function extractToolResult(update: Record<string, unknown>): string {
  const contentText = extractContentText(update.content);
  if (contentText) return contentText;
  return extractBlockText(update.rawOutput);
}

export function extractTriggeringEventIds(payload: unknown): string[] {
  const record = asRecord(payload);
  return Array.isArray(record.triggeringEventIds)
    ? record.triggeringEventIds.filter(
        (id): id is string => typeof id === "string",
      )
    : [];
}

export function describeTurnStarted(payload: unknown): string {
  const ids = extractTriggeringEventIds(payload);
  return ids.length > 0
    ? `Triggered by ${ids.length === 1 ? "1 event" : `${ids.length} events`}.`
    : "";
}

export function describeSessionResolved(payload: unknown): string {
  const record = asRecord(payload);
  const isNewSession = record.isNewSession === true;
  return isNewSession ? "New session created." : "";
}

// ---------------------------------------------------------------------------
// Friendly turn error copy (ported from lib/friendlyAgentLastError.ts)
// ---------------------------------------------------------------------------

export const RELAY_MESH_DENIED_COPY =
  "Community access denied this agent — check its community membership.";

export const MODEL_NOT_FOUND_COPY =
  "The configured model is not available — open agent settings and select a different one from the dropdown.";

export const CLI_ACP_INTERNAL_ERROR_COPY =
  "The agent's harness reported an internal error. For Codex agents this can mean the configured model isn't supported by your installed codex-acp — check the model in `~/.codex/config.toml` or upgrade the adapter (`brew upgrade codex-acp`).";

const EMBEDDED_CODE_RE = /^Agent reported error \(code (-?\d+)\): /;
const BARE_INTERNAL_ERROR = "Internal error";

function recoverEmbeddedCode(trimmed: string): {
  code: number;
  remainder: string;
} | null {
  const match = EMBEDDED_CODE_RE.exec(trimmed);
  if (!match) return null;
  return {
    code: Number(match[1]),
    remainder: trimmed.slice(match[0].length),
  };
}

export function friendlyAgentLastError(
  raw: string | null,
  code?: number | null,
): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  const embedded = recoverEmbeddedCode(trimmed);
  const effectiveCode = Number.isFinite(code)
    ? (code as number)
    : (embedded?.code ?? null);
  if (effectiveCode != null) {
    switch (effectiveCode) {
      case -32001:
        return RELAY_MESH_DENIED_COPY;
      case -32002:
        return MODEL_NOT_FOUND_COPY;
      case -32603: {
        const remainder = embedded?.remainder ?? trimmed;
        if (remainder === BARE_INTERNAL_ERROR) {
          return CLI_ACP_INTERNAL_ERROR_COPY;
        }
        return remainder;
      }
    }
    return trimmed;
  }

  if (
    trimmed.startsWith("Agent reported error: llm auth:") ||
    trimmed.startsWith("llm auth:")
  ) {
    return RELAY_MESH_DENIED_COPY;
  }

  return trimmed;
}

export function friendlyTurnErrorCopy(raw: string, code: unknown): string {
  const numeric = code == null ? null : Number(code);
  const safe = Number.isFinite(numeric) ? (numeric as number) : null;
  return friendlyAgentLastError(raw, safe) ?? raw;
}
