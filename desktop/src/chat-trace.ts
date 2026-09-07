import type { RuntimeChatEvent, RuntimeChatMessage } from "./api";

export interface ToolCallEntry {
  id: string;
  title: string;
  kind?: string;
  status: string;
  detail?: string;
  durationMs?: number;
}

export interface PlanEntry {
  content: string;
  status?: string;
  priority?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  thoughts: string[];
  toolCalls: ToolCallEntry[];
  plan: PlanEntry[];
  ts: number;
}

export interface RuntimeTraceFoldResult {
  messages: ChatMessage[];
  lastAction?: string;
}

let nextId = 0;
export const genId = () => `m${++nextId}`;

export function detailOf(rawInput: unknown): string | undefined {
  if (!rawInput || typeof rawInput !== "object") return undefined;
  const input = rawInput as Record<string, unknown>;
  const preferred =
    input.command ?? input.cmd ?? input.path ?? input.file_path ?? input.pattern ?? input.url;
  if (typeof preferred === "string") return preferred;
  if (Array.isArray(preferred)) return preferred.join(" ");
  try {
    const json = JSON.stringify(rawInput);
    return json.length > 160 ? `${json.slice(0, 160)}...` : json;
  } catch {
    return undefined;
  }
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
    })),
    plan: [],
    ts: message.timestamp ?? Date.now(),
  };
}

function runtimeToolId(event: RuntimeChatEvent) {
  const data = event.data ?? {};
  const id = data.toolCallId ?? data.tool_call_id ?? data.callId ?? data.call_id ?? data.id ?? event.eventId;
  return typeof id === "string" && id ? id : genId();
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

function runtimeToolResult(event: RuntimeChatEvent) {
  const data = event.data ?? {};
  const value = event.text ?? data.result ?? data.output ?? data.content ?? data.text ?? data.partialResult;
  if (typeof value === "string") return value;
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
    if (event.type === "done") return { messages: this.foldDoneToolMessages(messages, event) };

    const next = [...messages];
    const openAssistant = (): ChatMessage => {
      const last = next[next.length - 1];
      if (last?.role === "assistant") return last;
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
      const current = openAssistant();
      const text = event.text ?? "";
      replaceLast({ ...current, text: event.replace ? text : current.text + text });
      return { messages: next };
    }

    if (event.type === "error") {
      const current = openAssistant();
      const text = event.text ?? "Runtime stream failed";
      replaceLast({
        ...current,
        text: current.text.trim() ? `${current.text}\n\n${text}` : text,
        toolCalls: current.toolCalls.map((tool) =>
          tool.status === "in_progress" || tool.status === "pending"
            ? { ...tool, status: "failed", detail: tool.detail ?? text }
            : tool,
        ),
      });
      return { messages: next, lastAction: "Failed" };
    }

    if (event.type === "reasoning" || event.type === "thinking") {
      const current = openAssistant();
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
      const current = openAssistant();
      const existing = current.toolCalls.find((tool) => tool.id === id);
      const detail = runtimeToolDetail(event);
      const tool: ToolCallEntry = existing
        ? { ...existing, title, detail: detail ?? existing.detail, status: "in_progress" }
        : { id, title, detail, status: "in_progress" };
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
      const pendingByName = exact
        ? null
        : current.toolCalls.filter((tool) => tool.title === title && tool.status !== "completed");
      const resolvedId = exact?.id ?? (pendingByName?.length === 1 ? pendingByName[0].id : id);
      const started = this.toolStarts.get(resolvedId) ?? this.toolStarts.get(id);
      const result = runtimeToolResult(event);
      const failed = event.data?.isError === true || event.data?.error === true;
      const hasResolved = current.toolCalls.some((tool) => tool.id === resolvedId);
      const completed: ToolCallEntry = {
        id: resolvedId,
        title,
        status: failed ? "failed" : "completed",
        detail: result,
        durationMs: started ? Date.now() - started : undefined,
      };
      replaceLast({
        ...current,
        toolCalls: hasResolved
          ? current.toolCalls.map((tool) =>
              tool.id === resolvedId
                ? { ...tool, status: completed.status, detail: result ?? tool.detail, durationMs: completed.durationMs ?? tool.durationMs }
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
    const output = parsed.output ?? parsed.stdout ?? parsed.result ?? parsed.error;
    if (typeof output === "string") return output;
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
