import {
  asRecord,
  asString,
  classifyTool,
  compareObserverEvents,
  describeSessionResolved,
  describeTurnStarted,
  extractBlockText,
  extractContentText,
  extractPlanText,
  extractPromptText,
  extractToolArgs,
  extractToolIdentity,
  extractToolResult,
  findBuzzToolName,
  friendlyTurnErrorCopy,
  isGenericToolTitle,
  normalizeToolStatus,
  observerEventKey,
  titleCase,
  unwrapObserverBatch,
} from "./normalize";
import type {
  ActivityRenderClass,
  BuzzActivityEvent,
  ObserverEvent,
  ToolStatus,
} from "./types";

const DEFAULT_CAP = 3000;
const CAP_TRIM_HEADROOM = 300;

interface PendingPermission {
  itemId: string;
  optionNames: Map<string, string>;
}

interface TurnLiveness {
  turnId: string | null;
  payload: unknown;
  timestamp: string;
}

function isTerminalToolStatus(status: ToolStatus): boolean {
  return status === "completed" || status === "failed";
}

function mergeToolStatus(existing: ToolStatus, next: ToolStatus): ToolStatus {
  if (isTerminalToolStatus(existing) && !isTerminalToolStatus(next)) {
    return existing;
  }
  return next;
}

function joinLifecycleText(existing: string, next: string): string {
  if (!existing) return next;
  if (!next) return existing;
  return `${existing}\n${next}`;
}

function jsonRpcId(value: unknown): string | null {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value))
    return JSON.stringify(value);
  return null;
}

function describePermissionRequest(payload: Record<string, unknown>): {
  title: string;
  text: string;
  optionNames: Map<string, string>;
} {
  const params = asRecord(payload.params);
  const title =
    asString(params.title) ??
    asString(params.message) ??
    asString(params.reason) ??
    "Permission requested";
  const toolCallId =
    asString(params.toolCallId) ?? asString(params.tool_call_id);
  const options = Array.isArray(params.options)
    ? params.options
        .map((option) => {
          const record = asRecord(option);
          return (
            asString(record.name) ??
            asString(record.kind) ??
            asString(record.optionId)
          );
        })
        .filter((option): option is string => Boolean(option))
    : [];
  const detail: string[] = [];
  if (title !== "Permission requested") detail.push(title);
  if (toolCallId) detail.push(`Tool call: ${toolCallId}`);
  if (options.length > 0) detail.push(`Options: ${options.join(", ")}`);

  const optionNames = new Map<string, string>();
  if (Array.isArray(params.options)) {
    for (const option of params.options) {
      const record = asRecord(option);
      const optionId = asString(record.optionId);
      const kind = asString(record.kind);
      if (optionId && kind) {
        optionNames.set(optionId, kind);
      }
    }
  }

  return { title, text: detail.join("\n"), optionNames };
}

function describePermissionOutcome(
  outcome: string,
  optionId: string | null,
  optionNames: Map<string, string>,
): string {
  if (outcome === "cancelled") {
    return "Cancelled";
  }
  if (outcome === "selected" && optionId) {
    const kind = optionNames.get(optionId) ?? optionId;
    const isDenial = kind.startsWith("reject");
    const verb = isDenial ? "Denied" : "Approved";
    return `${verb} (${kind})`;
  }
  return outcome;
}

function describeFreeformStatus(payload: Record<string, unknown>): {
  statusType: string;
  title: string;
  text: string;
} | null {
  const statusType = asString(payload.type) ?? asString(payload.status);
  const title =
    asString(payload.title) ?? (statusType ? titleCase(statusType) : null);
  const text = asString(payload.text) ?? asString(payload.message);
  if (!title || !text) return null;
  return { statusType: statusType ?? title.toLowerCase(), title, text };
}

export class BuzzActivityJournal {
  private readonly cap: number;
  private readonly lowWater: number;

  private frames: ObserverEvent[] = [];
  private frameKeys = new Set<string>();
  private eventsById = new Map<string, BuzzActivityEvent>();
  private order: string[] = [];
  private activeMessageKey = new Map<string, string>();
  private sealedKeys = new Set<string>();
  private continuationSeq = 0;
  private pendingPermissions = new Map<string, PendingPermission>();
  private toolMetaById = new Map<
    string,
    {
      title: string;
      toolName: string;
      buzzToolName: string | null;
      args: Record<string, unknown>;
    }
  >();
  private latestSessionId: string | null = null;
  private livenessByTurn = new Map<string, TurnLiveness>();
  private sessionConfig: Record<string, unknown> | null = null;

  constructor(options?: { cap?: number }) {
    this.cap = options?.cap ?? DEFAULT_CAP;
    this.lowWater = Math.max(1, this.cap - CAP_TRIM_HEADROOM);
  }

  append(frame: ObserverEvent): BuzzActivityEvent[] {
    const changed = new Map<string, BuzzActivityEvent>();
    for (const event of unwrapObserverBatch(frame)) {
      const key = observerEventKey(event);
      if (this.frameKeys.has(key)) continue;
      this.frameKeys.add(key);
      this.insertFrame(event);
      this.fold(event, changed);
    }
    this.trim();
    return [...changed.values()].filter((event) =>
      this.eventsById.has(event.id),
    );
  }

  appendAll(frames: ObserverEvent[]): BuzzActivityEvent[] {
    const changed = new Map<string, BuzzActivityEvent>();
    for (const frame of frames) {
      for (const event of unwrapObserverBatch(frame)) {
        const key = observerEventKey(event);
        if (this.frameKeys.has(key)) continue;
        this.frameKeys.add(key);
        this.insertFrame(event);
        this.fold(event, changed);
      }
    }
    this.trim();
    return [...changed.values()].filter((event) =>
      this.eventsById.has(event.id),
    );
  }

  events(): BuzzActivityEvent[] {
    return this.order
      .map((id) => this.eventsById.get(id))
      .filter((event): event is BuzzActivityEvent => Boolean(event));
  }

  rawEvents(): ObserverEvent[] {
    return [...this.frames];
  }

  getSessionConfig(): Record<string, unknown> | null {
    return this.sessionConfig;
  }

  getTurnLiveness(turnId: string): TurnLiveness | null {
    return this.livenessByTurn.get(turnId) ?? null;
  }

  reset(): void {
    this.frames = [];
    this.frameKeys = new Set();
    this.eventsById = new Map();
    this.order = [];
    this.activeMessageKey = new Map();
    this.sealedKeys = new Set();
    this.continuationSeq = 0;
    this.pendingPermissions = new Map();
    this.toolMetaById = new Map();
    this.latestSessionId = null;
    this.livenessByTurn = new Map();
    this.sessionConfig = null;
  }

  private insertFrame(event: ObserverEvent): void {
    const last = this.frames[this.frames.length - 1];
    if (!last || compareObserverEvents(event, last) >= 0) {
      this.frames.push(event);
      return;
    }
    let low = 0;
    let high = this.frames.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (compareObserverEvents(this.frames[mid], event) < 0) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    this.frames.splice(low, 0, event);
  }

  private trim(): void {
    if (this.frames.length <= this.cap) return;
    const removed = this.frames.slice(0, this.frames.length - this.lowWater);
    this.frames = this.frames.slice(this.frames.length - this.lowWater);
    for (const frame of removed) {
      this.frameKeys.delete(observerEventKey(frame));
    }
    while (this.order.length > this.lowWater) {
      const oldest = this.order.shift();
      if (oldest) this.eventsById.delete(oldest);
    }
  }

  private put(
    event: BuzzActivityEvent,
    changed: Map<string, BuzzActivityEvent>,
  ): void {
    const existing = this.eventsById.get(event.id);
    if (!existing) {
      this.eventsById.set(event.id, event);
      this.insertOrdered(event);
    } else {
      this.eventsById.set(event.id, event);
    }
    changed.set(event.id, event);
  }

  private insertOrdered(event: BuzzActivityEvent): void {
    const lastId = this.order[this.order.length - 1];
    const last = lastId ? this.eventsById.get(lastId) : undefined;
    if (!last || compareObserverEvents(event, last) >= 0) {
      this.order.push(event.id);
      return;
    }
    let low = 0;
    let high = this.order.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      const midEvent = this.eventsById.get(this.order[mid]);
      if (midEvent && compareObserverEvents(midEvent, event) <= 0) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    this.order.splice(low, 0, event.id);
  }

  private sealOpenMessages(): void {
    for (const [, currentKey] of this.activeMessageKey) {
      this.sealedKeys.add(currentKey);
    }
  }

  private upsertMessage(
    id: string,
    label: string,
    text: string,
    event: ObserverEvent,
    changed: Map<string, BuzzActivityEvent>,
    messageId: string | null = null,
  ): void {
    const currentKey = this.activeMessageKey.get(id);
    if (currentKey && !this.sealedKeys.has(currentKey)) {
      const existing = this.eventsById.get(currentKey);
      if (existing) {
        this.put(
          {
            ...existing,
            detail: (existing.detail ?? "") + text,
            messageId: messageId ?? existing.messageId,
            turnId: event.turnId ?? existing.turnId,
          },
          changed,
        );
        return;
      }
    }

    this.continuationSeq += 1;
    const newKey = currentKey ? `${id}:c${this.continuationSeq}` : id;
    this.put(
      {
        id: newKey,
        renderClass: "message",
        label,
        detail: text,
        messageId: messageId ?? undefined,
        turnId: event.turnId,
        timestamp: event.timestamp,
        seq: event.seq,
        raw: event,
      },
      changed,
    );
    this.activeMessageKey.set(id, newKey);
  }

  private upsertText(
    id: string,
    renderClass: ActivityRenderClass,
    label: string,
    text: string,
    event: ObserverEvent,
    changed: Map<string, BuzzActivityEvent>,
    extra?: Partial<BuzzActivityEvent>,
  ): void {
    const existing = this.eventsById.get(id);
    if (existing) {
      this.put(
        {
          ...existing,
          ...extra,
          renderClass,
          label,
          detail: joinLifecycleText(existing.detail ?? "", text),
          turnId: event.turnId ?? existing.turnId,
        },
        changed,
      );
      return;
    }
    this.sealOpenMessages();
    this.put(
      {
        id,
        renderClass,
        label,
        detail: text || undefined,
        turnId: event.turnId,
        timestamp: event.timestamp,
        seq: event.seq,
        raw: event,
        ...extra,
      },
      changed,
    );
  }

  private upsertAppended(
    id: string,
    renderClass: ActivityRenderClass,
    label: string,
    text: string,
    event: ObserverEvent,
    changed: Map<string, BuzzActivityEvent>,
  ): void {
    const existing = this.eventsById.get(id);
    if (existing) {
      this.put(
        {
          ...existing,
          detail: (existing.detail ?? "") + text,
          turnId: event.turnId ?? existing.turnId,
        },
        changed,
      );
      return;
    }
    this.sealOpenMessages();
    this.put(
      {
        id,
        renderClass,
        label,
        detail: text,
        turnId: event.turnId,
        timestamp: event.timestamp,
        seq: event.seq,
        raw: event,
      },
      changed,
    );
  }

  private replaceInPlace(
    id: string,
    renderClass: ActivityRenderClass,
    label: string,
    text: string,
    event: ObserverEvent,
    changed: Map<string, BuzzActivityEvent>,
  ): void {
    const existing = this.eventsById.get(id);
    if (existing) {
      this.put(
        {
          ...existing,
          renderClass,
          label,
          detail: text,
          turnId: event.turnId ?? existing.turnId,
        },
        changed,
      );
      return;
    }
    this.sealOpenMessages();
    this.put(
      {
        id,
        renderClass,
        label,
        detail: text,
        turnId: event.turnId,
        timestamp: event.timestamp,
        seq: event.seq,
        raw: event,
      },
      changed,
    );
  }

  private upsertTool(
    id: string,
    toolCallId: string,
    title: string,
    toolName: string,
    buzzToolName: string | null,
    status: ToolStatus,
    args: Record<string, unknown>,
    result: string,
    isError: boolean,
    event: ObserverEvent,
    changed: Map<string, BuzzActivityEvent>,
  ): void {
    const existing = this.eventsById.get(id);
    const canonicalBuzzToolName =
      buzzToolName ?? findBuzzToolName(toolName, true);
    const meta = this.toolMetaById.get(id);
    if (existing && meta) {
      const updatedTitle = !isGenericToolTitle(title) ? title : meta.title;
      let updatedToolName = meta.toolName;
      let updatedBuzzToolName = meta.buzzToolName;
      if (canonicalBuzzToolName) {
        updatedBuzzToolName = canonicalBuzzToolName;
        updatedToolName = canonicalBuzzToolName;
      } else if (!meta.buzzToolName && !isGenericToolTitle(toolName)) {
        updatedToolName = toolName;
      }
      const mergedStatus = mergeToolStatus(
        existing.status ?? "executing",
        status,
      );
      const mergedIsError = isError || existing.isError === true;
      const updatedArgs = Object.keys(args).length > 0 ? args : meta.args;
      const updatedResult = result || (existing.detail ?? "");
      const classification = classifyTool({
        title: updatedTitle,
        toolName: updatedToolName,
        buzzToolName: updatedBuzzToolName,
        args: updatedArgs,
        result: updatedResult,
        isError: mergedIsError || mergedStatus === "failed",
      });
      this.toolMetaById.set(id, {
        title: updatedTitle,
        toolName: updatedToolName,
        buzzToolName: updatedBuzzToolName,
        args: updatedArgs,
      });
      this.put(
        {
          ...existing,
          renderClass: classification.renderClass,
          label: classification.label,
          preview: classification.preview ?? existing.preview,
          status: mergedStatus,
          isError: mergedIsError || undefined,
          detail: updatedResult || existing.detail,
          turnId: event.turnId ?? existing.turnId,
        },
        changed,
      );
      return;
    }

    const resolvedToolName = canonicalBuzzToolName ?? toolName;
    const classification = classifyTool({
      title,
      toolName: resolvedToolName,
      buzzToolName: canonicalBuzzToolName,
      args,
      result,
      isError: isError || status === "failed",
    });
    this.toolMetaById.set(id, {
      title,
      toolName: resolvedToolName,
      buzzToolName: canonicalBuzzToolName,
      args,
    });
    this.sealOpenMessages();
    this.put(
      {
        id,
        renderClass: classification.renderClass,
        label: classification.label,
        preview: classification.preview ?? undefined,
        detail: result || undefined,
        status,
        isError: isError || undefined,
        toolCallId,
        turnId: event.turnId,
        timestamp: event.timestamp,
        seq: event.seq,
        raw: event,
      },
      changed,
    );
  }

  private fold(
    event: ObserverEvent,
    changed: Map<string, BuzzActivityEvent>,
  ): void {
    if (event.sessionId && event.sessionId !== this.latestSessionId) {
      this.latestSessionId = event.sessionId;
    }

    const channelId = event.channelId ?? null;
    const ch = channelId ?? "global";
    const turnKey = event.turnId ?? event.seq;

    switch (event.kind) {
      case "turn_started":
        this.upsertText(
          `turn:${ch}:${turnKey}`,
          "status",
          "Turn started",
          describeTurnStarted(event.payload),
          event,
          changed,
          { status: "executing" },
        );
        return;
      case "turn_completed": {
        const id = `turn:${ch}:${turnKey}`;
        const existing = this.eventsById.get(id);
        if (existing) {
          this.put({ ...existing, status: "completed" }, changed);
        }
        return;
      }
      case "turn_liveness": {
        if (event.turnId) {
          this.livenessByTurn.set(event.turnId, {
            turnId: event.turnId,
            payload: event.payload,
            timestamp: event.timestamp,
          });
        }
        return;
      }
      case "session_resolved":
        this.upsertText(
          `session:${ch}:${turnKey}`,
          "status",
          "Session ready",
          describeSessionResolved(event.payload),
          event,
          changed,
        );
        return;
      case "acp_parse_error":
        this.upsertText(
          `parse-error:${ch}:${event.seq}`,
          "error",
          "Wire parse error",
          extractBlockText(event.payload),
          event,
          changed,
          { isError: true },
        );
        return;
      case "turn_error":
      case "agent_panic": {
        const payload = asRecord(event.payload);
        const outcome = asString(payload.outcome) ?? "error";
        const error = asString(payload.error) ?? "Unknown error";
        const displayError = friendlyTurnErrorCopy(error, payload.code);
        const label =
          event.kind === "agent_panic" ? "Agent error (crash)" : "Turn error";
        this.upsertText(
          `${event.kind}:${ch}:${turnKey}`,
          "error",
          label,
          `${outcome}: ${displayError}`,
          event,
          changed,
          { isError: true, status: "failed" },
        );
        return;
      }
      case "control_result": {
        const payload = asRecord(event.payload);
        const method =
          asString(payload.method) ??
          asString(payload.control) ??
          asString(payload.action) ??
          "control";
        const status =
          asString(payload.status) ?? asString(payload.outcome) ?? "unknown";
        const modelId =
          asString(payload.modelId) ??
          asString(payload.model) ??
          asString(payload.model_id);
        const label = method.includes("switch_model")
          ? `Model switch: ${status}${modelId ? ` ${modelId}` : ""}`
          : method.includes("cancel_turn")
            ? `Cancel: ${status}`
            : `${titleCase(method)}: ${status}`;
        this.upsertText(
          `control:${ch}:${event.seq}`,
          "status",
          label,
          "",
          event,
          changed,
        );
        return;
      }
      case "session_config_captured": {
        const payload = asRecord(event.payload);
        this.sessionConfig = payload;
        const model =
          asString(payload.modelId) ?? asString(payload.model) ?? null;
        const mode =
          asString(payload.modeId) ?? asString(payload.mode) ?? null;
        const detail = [
          model ? `Model: ${model}` : null,
          mode ? `Mode: ${mode}` : null,
        ]
          .filter((part): part is string => Boolean(part))
          .join(" ");
        this.upsertText(
          `session-config:${ch}:${event.seq}`,
          "status",
          "Session config captured",
          detail,
          event,
          changed,
        );
        return;
      }
      case "harness_started":
        this.upsertText(
          `harness:${ch}:${event.seq}`,
          "status",
          "Harness started",
          "",
          event,
          changed,
        );
        return;
      case "managed_agent_runtime_lifecycle": {
        const payload = asRecord(event.payload);
        const lifecycle =
          asString(payload.lifecycle) ??
          asString(payload.status) ??
          asString(payload.phase) ??
          "unknown";
        const labels: Record<string, string> = {
          listening: "Runtime listening",
          waking: "Runtime waking",
          ready: "Runtime ready",
          failed: "Runtime failed",
        };
        const label = labels[lifecycle] ?? `Runtime ${titleCase(lifecycle)}`;
        this.upsertText(
          `lifecycle:${ch}:${event.seq}`,
          lifecycle === "failed" ? "error" : "status",
          label,
          "",
          event,
          changed,
          lifecycle === "failed" ? { isError: true } : undefined,
        );
        return;
      }
      case "acp_read":
      case "acp_write":
        this.foldAcp(event, ch, changed);
        return;
      default:
        return;
    }
  }

  private foldAcp(
    event: ObserverEvent,
    ch: string,
    changed: Map<string, BuzzActivityEvent>,
  ): void {
    const payload = asRecord(event.payload);
    const method = asString(payload.method);

    if (method === "session/request_permission" && event.kind === "acp_read") {
      const request = describePermissionRequest(payload);
      const itemId = `permission:${ch}:${event.turnId ?? event.seq}`;
      this.upsertText(
        itemId,
        "permission",
        "Permission requested",
        request.text,
        event,
        changed,
        { preview: request.title, status: "pending" },
      );
      const requestId = jsonRpcId(payload.id);
      if (requestId) {
        this.pendingPermissions.set(requestId, {
          itemId,
          optionNames: request.optionNames,
        });
      }
      return;
    }

    if (event.kind === "acp_write" && !method) {
      const responseId = jsonRpcId(payload.id);
      const result = asRecord(asRecord(payload.result).outcome);
      const outcomeKind = asString(result.outcome);
      const pending = responseId
        ? this.pendingPermissions.get(responseId)
        : undefined;
      if (pending && outcomeKind && responseId) {
        const optionId = asString(result.optionId) ?? null;
        const outcomeText = describePermissionOutcome(
          outcomeKind,
          optionId,
          pending.optionNames,
        );
        const existing = this.eventsById.get(pending.itemId);
        if (existing) {
          this.put(
            {
              ...existing,
              detail: joinLifecycleText(existing.detail ?? "", outcomeText),
              status: "completed",
            },
            changed,
          );
          this.pendingPermissions.delete(responseId);
        }
      }
      return;
    }

    if (
      event.kind === "acp_write" &&
      (method === "session/prompt" ||
        method === "_goose/unstable/session/steer")
    ) {
      const promptText = extractPromptText(payload);
      if (promptText) {
        const prefix = method === "session/prompt" ? "prompt" : "steer";
        this.upsertMessage(
          `${prefix}:${ch}:${event.turnId ?? event.seq}`,
          "User",
          promptText,
          event,
          changed,
        );
      }
      return;
    }

    if (event.kind !== "acp_read" || method !== "session/update") {
      return;
    }

    const params = asRecord(payload.params);
    const update = asRecord(params.update);
    const updateType = asString(update.sessionUpdate) ?? "unknown";
    const turnKey = event.turnId ?? event.sessionId ?? "unknown";
    const messageId = asString(update.messageId);

    switch (updateType) {
      case "agent_message_chunk":
        this.upsertMessage(
          `assistant:${ch}:${messageId ?? turnKey}`,
          "Assistant",
          extractContentText(update.content),
          event,
          changed,
          messageId,
        );
        return;
      case "user_message_chunk": {
        const steerKey = `steer:${ch}:${event.turnId ?? event.seq}`;
        if (this.eventsById.has(steerKey)) return;
        this.upsertMessage(
          `user:${ch}:${messageId ?? turnKey}`,
          "User",
          extractContentText(update.content),
          event,
          changed,
          messageId,
        );
        return;
      }
      case "agent_thought_chunk":
        this.upsertAppended(
          `thinking:${ch}:${messageId ?? turnKey}`,
          "thought",
          "Thinking",
          extractContentText(update.content),
          event,
          changed,
        );
        return;
      case "tool_call": {
        const toolCallId = asString(update.toolCallId) ?? `tool:${event.seq}`;
        const identity = extractToolIdentity(update);
        this.upsertTool(
          `tool:${ch}:${toolCallId}`,
          toolCallId,
          identity.title,
          identity.toolName,
          identity.buzzToolName,
          normalizeToolStatus(asString(update.status) ?? "executing"),
          extractToolArgs(update),
          extractToolResult(update),
          false,
          event,
          changed,
        );
        return;
      }
      case "tool_call_update": {
        const toolCallId = asString(update.toolCallId) ?? `tool:${event.seq}`;
        const status = normalizeToolStatus(
          asString(update.status) ?? "completed",
        );
        const identity = extractToolIdentity(update);
        this.upsertTool(
          `tool:${ch}:${toolCallId}`,
          toolCallId,
          identity.title,
          identity.toolName,
          identity.buzzToolName,
          status,
          extractToolArgs(update),
          extractToolResult(update),
          status === "failed",
          event,
          changed,
        );
        return;
      }
      case "plan":
        this.replaceInPlace(
          `plan:${ch}:${turnKey}`,
          "plan",
          "Plan",
          extractPlanText(update),
          event,
          changed,
        );
        return;
      case "current_mode_update": {
        const mode = asString(update.currentModeId) ?? "";
        if (mode) {
          this.replaceInPlace(
            `mode:${ch}:${turnKey}`,
            "status",
            `Mode: ${mode}`,
            "",
            event,
            changed,
          );
        }
        return;
      }
      case "usage_update": {
        const used = typeof update.used === "number" ? update.used : null;
        const size = typeof update.size === "number" ? update.size : null;
        if (used !== null && size !== null) {
          const costRecord = asRecord(update.cost);
          const costAmount =
            typeof costRecord.amount === "number" ? costRecord.amount : null;
          const costCurrency = asString(costRecord.currency);
          const costStr =
            costAmount !== null && costCurrency
              ? ` ($${costAmount.toFixed(4)} ${costCurrency})`
              : "";
          this.replaceInPlace(
            `usage:${ch}:${turnKey}`,
            "status",
            "Usage",
            `Tokens: ${used}/${size}${costStr}`,
            event,
            changed,
          );
        }
        return;
      }
      case "available_commands_update": {
        const commands = Array.isArray(update.availableCommands)
          ? update.availableCommands
          : [];
        this.replaceInPlace(
          `commands:${ch}:${turnKey}`,
          "status",
          "Commands",
          `Commands available: ${commands.length}`,
          event,
          changed,
        );
        return;
      }
      case "config_option_update": {
        const options = Array.isArray(update.configOptions)
          ? (update.configOptions as Array<Record<string, unknown>>)
          : [];
        const optionText = options
          .map((option) => {
            const name = asString(option.name) ?? asString(option.id) ?? "?";
            const value =
              asString(option.currentValue) ??
              (typeof option.value === "boolean" ? String(option.value) : null) ??
              "";
            return value ? `${name} = ${value}` : name;
          })
          .join(", ");
        if (optionText) {
          this.replaceInPlace(
            `config:${ch}:${turnKey}`,
            "status",
            "Config",
            optionText,
            event,
            changed,
          );
        }
        return;
      }
      default: {
        const status = describeFreeformStatus(payload);
        if (status) {
          this.upsertText(
            `status:${ch}:${event.turnId ?? event.seq}:${status.statusType}`,
            "status",
            status.title,
            status.text,
            event,
            changed,
          );
        }
        return;
      }
    }
  }
}
