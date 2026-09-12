import type { RuntimeChatEvent, RuntimeChatMessage } from "./api";
import { diffPayloadsFromContent, diffPayloadsFromInput, type DiffPayload } from "./diff";

export interface ToolCallEntry {
  id: string;
  title: string;
  kind?: string;
  status: string;
  detail?: string;
  diffs?: DiffPayload[];
  durationMs?: number;
}

export interface PlanEntry {
  content: string;
  status?: string;
  priority?: string;
}

export interface MessageAttachment {
  name: string;
  mimeType: string;
  dataBase64: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  audioStatus?: "generating" | "playing" | "replayable";
  attachments?: MessageAttachment[];
  error?: boolean;
  thoughts: string[];
  toolCalls: ToolCallEntry[];
  plan: PlanEntry[];
  ts: number;
}

export interface RuntimeTraceFoldResult {
  messages: ChatMessage[];
  lastAction?: string;
}

const OPEN_TOOL_STATUSES = new Set(["pending", "in_progress"]);

export function settleOpenToolCalls(messages: ChatMessage[], status: "completed" | "interrupted"): ChatMessage[] {
  let changed = false;
  const next = messages.map((message) => {
    if (message.role !== "assistant" || !message.toolCalls.some((tool) => OPEN_TOOL_STATUSES.has(tool.status))) {
      return message;
    }
    changed = true;
    return {
      ...message,
      toolCalls: message.toolCalls.map((tool) =>
        OPEN_TOOL_STATUSES.has(tool.status) ? { ...tool, status } : tool,
      ),
    };
  });
  return changed ? next : messages;
}

let nextId = 0;
export const genId = () => `m${++nextId}`;

export function detailOf(rawInput: unknown): string | undefined {
  if (typeof rawInput === "string") return rawInput.trim() || undefined;
  if (Array.isArray(rawInput)) {
    const parts = rawInput.map((item) => detailOf(item)).filter((part): part is string => Boolean(part));
    return parts.join(" ") || undefined;
  }
  if (!rawInput || typeof rawInput !== "object") return undefined;
  const input = rawInput as Record<string, unknown>;
  const keys = Object.keys(input);
  if (keys.length === 0 || keys.every((key) => key === "cwd" || key === "workingDirectory" || key === "working_directory")) return undefined;
  const preferred =
    input.command ?? input.cmd ?? input.shell_command ?? input.filePath ?? input.file_path ?? input.path ?? input.pattern ?? input.url ??
    (typeof input.text === "string" && (input.type === "text" || !input.type) ? input.text : undefined);
  if (typeof preferred === "string") return preferred;
  if (Array.isArray(preferred)) {
    const parts = preferred.map((item) => detailOf(item)).filter((part): part is string => Boolean(part));
    return parts.join(" ") || undefined;
  }
  for (const key of ["input", "args", "arguments", "rawInput"]) {
    const nested = detailOf(input[key]);
    if (nested) return nested;
  }
  try {
    const json = JSON.stringify(rawInput);
    return json.length > 160 ? `${json.slice(0, 160)}...` : json;
  } catch {
    return undefined;
  }
}

export function toolDiffsOf(...sources: unknown[]): DiffPayload[] | undefined {
  for (const source of sources) {
    const fromInput = diffPayloadsFromInput(source);
    if (fromInput.length > 0) return fromInput;
    const fromContent = diffPayloadsFromContent(source);
    if (fromContent.length > 0) return fromContent;
  }
  return undefined;
}

export function mergeDiffs(existing: DiffPayload[] | undefined, incoming: DiffPayload[] | undefined): DiffPayload[] | undefined {
  if (!incoming || incoming.length === 0) return existing;
  if (!existing || existing.length === 0) return incoming;
  const merged = [...existing];
  for (const payload of incoming) {
    const index = payload.path ? merged.findIndex((item) => item.path === payload.path) : -1;
    if (index >= 0) merged[index] = payload;
    else merged.push(payload);
  }
  return merged;
}

export function imageMarkdownOf(content: unknown): string | undefined {
  if (Array.isArray(content)) {
    const parts = content.map((item) => imageMarkdownOf(item)).filter((part): part is string => Boolean(part));
    return parts.join("\n\n") || undefined;
  }
  if (!content || typeof content !== "object") return undefined;
  const block = content as { type?: unknown; data?: unknown; mimeType?: unknown; uri?: unknown };
  if (block.type !== "image") return undefined;
  if (typeof block.uri === "string" && block.uri) return `![image](${block.uri})`;
  if (typeof block.data === "string" && block.data) {
    const mime = typeof block.mimeType === "string" && block.mimeType ? block.mimeType : "image/png";
    return `![image](data:${mime};base64,${block.data})`;
  }
  return undefined;
}

export function runtimeMessageToChat(message: RuntimeChatMessage): ChatMessage {
  if (/^tool/i.test(message.role)) {
    const failed = toolContentFailed(message.text);
    return {
      id: message.messageId ?? genId(),
      role: "assistant",
      text: "",
      thoughts: [],
      toolCalls: [{
        id: message.messageId ?? genId(),
        title: "tool result",
        status: failed ? "failed" : "completed",
        detail: toolContentDetail(message.text),
      }],
      plan: [],
      ts: message.timestamp ?? Date.now(),
    };
  }
  const role = message.role === "user" ? "user" : "assistant";
  return {
    id: message.messageId ?? genId(),
    role,
    text: message.text,
    thoughts: message.thinking ? [message.thinking] : [],
    toolCalls: (message.toolCalls ?? []).map((tool) => ({
      id: tool.id ?? genId(),
      title: tool.name,
      status: tool.result === undefined ? "in_progress" : "completed",
      detail: tool.result ?? detailOf(tool.args),
      diffs: toolDiffsOf(tool.args),
    })),
    plan: [],
    ts: message.timestamp ?? Date.now(),
  };
}

function runtimeToolId(event: RuntimeChatEvent) {
  const data = event.data ?? {};
  const id = data.toolCallId ?? data.tool_call_id ?? data.callId ?? data.call_id ?? data.id ?? event.eventId;
  if (typeof id === "string" && id) return id;
  const name = data.name ?? data.tool_name ?? data.title;
  return typeof name === "string" && name ? `tool:${name}` : genId();
}

function runtimeToolTitle(event: RuntimeChatEvent) {
  const data = event.data ?? {};
  const title = data.title ?? data.name ?? data.toolName ?? data.tool_name;
  return typeof title === "string" && title ? title : "Tool call";
}

function runtimeToolDetail(event: RuntimeChatEvent) {
  const data = event.data ?? {};
  const value = data.args ?? data.arguments ?? data.input ?? data.rawInput;
  return detailOf(value ?? data);
}

function runtimeToolDiffs(event: RuntimeChatEvent): DiffPayload[] | undefined {
  const data = event.data ?? {};
  return toolDiffsOf(
    data.args ?? data.arguments ?? data.input ?? data.rawInput,
    data.content,
    data.output ?? data.result,
  );
}

function runtimeToolResult(event: RuntimeChatEvent) {
  const data = event.data ?? {};
  const value = event.text ?? data.result ?? data.output ?? data.content ?? data.text ?? data.partialResult;
  if (typeof value === "string") return toolContentDetail(value);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.aggregated === "string") return record.aggregated;
    if (Array.isArray(record.content)) {
      const text = record.content
        .map((part) => {
          if (!part || typeof part !== "object") return "";
          const text = (part as Record<string, unknown>).text;
          return typeof text === "string" ? text : "";
        })
        .join("");
      if (text) return text;
    }
  }
  return detailOf(value);
}

export class ChatTraceFolder {
  private readonly toolStarts = new Map<string, number>();

  clear() {
    this.toolStarts.clear();
  }

  foldRuntimeEvent(messages: ChatMessage[], event: RuntimeChatEvent): RuntimeTraceFoldResult {
    if (event.type === "done") {
      return { messages: settleOpenToolCalls(this.foldDoneToolMessages(messages, event), "completed") };
    }

    const next = [...messages];
    const openAssistant = (forceNew = false): ChatMessage => {
      const last = next[next.length - 1];
      if (last?.role === "assistant" && !forceNew) return last;
      const message: ChatMessage = {
        id: event.messageId ?? genId(),
        role: "assistant",
        text: "",
        thoughts: [],
        toolCalls: [],
        plan: [],
        ts: Date.now(),
      };
      next.push(message);
      return message;
    };
    const replaceLast = (message: ChatMessage) => {
      next[next.length - 1] = message;
    };

    if (event.type === "content" || event.type === "commentary") {
      const last = next[next.length - 1];
      const newSegment = last?.role === "assistant" && last.text.trim().length > 0 && last.toolCalls.length > 0;
      const current = openAssistant(newSegment);
      const text = event.text ?? "";
      replaceLast({ ...current, text: event.replace ? text : current.text + text });
      return { messages: next };
    }

    if (event.type === "error") {
      const text = event.text ?? "Runtime stream failed";
      next.push({
        id: event.messageId ?? genId(),
        role: "assistant",
        text,
        error: true,
        thoughts: [],
        toolCalls: [],
        plan: [],
        ts: Date.now(),
      });
      return { messages: next, lastAction: "Failed" };
    }

    if (event.type === "reasoning" || event.type === "thinking") {
      const lastBefore = next[next.length - 1];
      const newSegment = lastBefore?.role === "assistant" && lastBefore.text.trim().length > 0;
      const current = openAssistant(newSegment);
      const text = event.text ?? "";
      const thoughts = event.replace || current.thoughts.length === 0
        ? [text]
        : [...current.thoughts.slice(0, -1), current.thoughts[current.thoughts.length - 1] + text];
      replaceLast({ ...current, thoughts });
      return { messages: next };
    }

    if (event.type === "tool_call") {
      const id = runtimeToolId(event);
      const title = runtimeToolTitle(event);
      const lastBefore = next[next.length - 1];
      const newSegment = lastBefore?.role === "assistant" && lastBefore.text.trim().length > 0;
      const current = openAssistant(newSegment);
      const existing = current.toolCalls.find((tool) => tool.id === id);
      const detail = runtimeToolDetail(event);
      const diffs = runtimeToolDiffs(event);
      const tool: ToolCallEntry = existing
        ? { ...existing, title, detail: detail ?? existing.detail, status: "in_progress", diffs: mergeDiffs(existing.diffs, diffs) }
        : { id, title, detail, status: "in_progress", diffs };
      if (!existing) this.toolStarts.set(id, Date.now());
      replaceLast({
        ...current,
        toolCalls: existing
          ? current.toolCalls.map((item) => (item.id === id ? tool : item))
          : [...current.toolCalls, tool],
      });
      return { messages: next, lastAction: title };
    }

    if (event.type === "tool_result") {
      const id = runtimeToolId(event);
      const title = runtimeToolTitle(event);
      const current = openAssistant();
      const exact = current.toolCalls.find((tool) => tool.id === id);
      const openByName = exact
        ? null
        : current.toolCalls.filter((tool) => tool.title === title && OPEN_TOOL_STATUSES.has(tool.status));
      const resolvedId = exact?.id ?? openByName?.[0]?.id ?? id;
      const started = this.toolStarts.get(resolvedId) ?? this.toolStarts.get(id);
      const result = runtimeToolResult(event);
      const failed = event.data?.isError === true || event.data?.error === true;
      const hasResolved = current.toolCalls.some((tool) => tool.id === resolvedId);
      const diffs = runtimeToolDiffs(event);
      const completed: ToolCallEntry = {
        id: resolvedId,
        title,
        status: failed ? "failed" : "completed",
        detail: result,
        diffs,
        durationMs: started ? Date.now() - started : undefined,
      };
      replaceLast({
        ...current,
        toolCalls: hasResolved
          ? current.toolCalls.map((tool) =>
              tool.id === resolvedId
                ? { ...tool, status: completed.status, detail: result ?? tool.detail, diffs: mergeDiffs(tool.diffs, diffs), durationMs: completed.durationMs ?? tool.durationMs }
                : tool,
            )
          : [...current.toolCalls, completed],
      });
      return { messages: next, lastAction: title };
    }

    return { messages: next };
  }

  private foldDoneToolMessages(messages: ChatMessage[], event: RuntimeChatEvent) {
    const records = Array.isArray(event.data?.messages) ? event.data.messages : [];
    const toolMessages = records
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
      .filter((item) => /^tool/i.test(typeof item.role === "string" ? item.role : ""));
    if (toolMessages.length === 0) return messages;
    const next = [...messages];
    const last = next[next.length - 1];
    if (!last?.toolCalls.length) return messages;
    let toolCalls = last.toolCalls;
    for (const toolMessage of toolMessages) {
      const id = stringValue(toolMessage.tool_call_id ?? toolMessage.toolCallId ?? toolMessage.call_id ?? toolMessage.id);
      const title = stringValue(toolMessage.tool_name ?? toolMessage.toolName ?? toolMessage.name) ?? "Tool call";
      const detail = toolMessageDetail(toolMessage);
      const failed = Boolean(toolMessage.error) || toolContentFailed(String(toolMessage.content ?? ""));
      const index = id
        ? toolCalls.findIndex((tool) => tool.id === id)
        : toolCalls.findIndex((tool) => tool.title === title && (tool.status === "in_progress" || tool.status === "pending" || !tool.detail));
      if (index >= 0) {
        toolCalls = toolCalls.map((tool, i) => i === index ? {
          ...tool,
          title: tool.title || title,
          status: failed ? "failed" : "completed",
          detail: detail ?? tool.detail,
        } : tool);
      } else {
        toolCalls = [...toolCalls, {
          id: id ?? genId(),
          title,
          status: failed ? "failed" : "completed",
          detail,
        }];
      }
    }
    next[next.length - 1] = { ...last, toolCalls };
    return next;
  }
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function toolMessageDetail(message: Record<string, unknown>) {
  const content = message.content;
  if (typeof content !== "string") return detailOf(content);
  return toolContentDetail(content);
}

function toolContentDetail(content: string) {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    if (parsed && typeof parsed === "object" && Object.keys(parsed).length === 0) return undefined;
    const output = parsed.content ?? parsed.output ?? parsed.stdout ?? parsed.result ?? parsed.error;
    if (typeof output === "string") return output.trim() ? output : undefined;
  } catch {
    // Plain text tool content is already a useful detail.
  }
  return content;
}

function toolContentFailed(content: string) {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    if (parsed.error !== null && parsed.error !== undefined && parsed.error !== "") return true;
    const code = parsed.exit_code ?? parsed.exitCode;
    if (typeof code === "number") return code !== 0;
  } catch {
    // Fall through to plain-text heuristics.
  }
  return /\b(?:failed|cannot access|exited with code [1-9]|exit code [1-9])\b/i.test(content);
}
