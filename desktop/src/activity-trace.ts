import { genId } from "./chat-trace";

export interface ActivityEntry {
  id: string;
  ts: number;
  kind: "tool" | "thinking" | "reply" | "usage" | "note";
  title: string;
  detail?: string;
  status?: string;
  durationMs?: number;
}

const ACTIVITY_ENTRY_LIMIT = 400;

const OPEN_STATUSES = new Set(["pending", "in_progress"]);
const DONE_STATUSES = new Set(["completed", "failed"]);

export function isOpenActivityStatus(status: string | undefined): boolean {
  return status != null && OPEN_STATUSES.has(status);
}

export function isDoneActivityStatus(status: string | undefined): boolean {
  return status != null && DONE_STATUSES.has(status);
}

export interface ToolCallStartInput {
  callId?: string;
  title: string;
  detail?: string;
  status?: string;
}

export interface ToolCallUpdateInput {
  callId?: string;
  status?: string;
  updateTs?: number;
  createTitle?: string;
}

export class ActivityTrace {
  private entries: ActivityEntry[] = [];
  private entryIdByCallId = new Map<string, string>();
  private callIdByEntryId = new Map<string, string>();
  private fallbackEntryIds = new Set<string>();
  private startedAtByCallId = new Map<string, number>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  clear(): void {
    this.entries = [];
    this.entryIdByCallId.clear();
    this.callIdByEntryId.clear();
    this.fallbackEntryIds.clear();
    this.startedAtByCallId.clear();
  }

  snapshot(): ActivityEntry[] {
    return [...this.entries];
  }

  toolStartedAt(callId: string | undefined): number | undefined {
    return callId ? this.startedAtByCallId.get(callId) : undefined;
  }

  private commit(entries: ActivityEntry[]): ActivityEntry[] {
    this.entries = entries.slice(-ACTIVITY_ENTRY_LIMIT);
    return this.snapshot();
  }

  addNote(entry: Omit<ActivityEntry, "id" | "ts">): ActivityEntry[] {
    return this.commit([...this.entries, { ...entry, id: genId(), ts: this.now() }]);
  }

  appendReplyText(text: string): ActivityEntry[] {
    if (!text.trim()) return this.snapshot();
    const last = this.entries[this.entries.length - 1];
    if (last && last.kind === "reply" && isOpenActivityStatus(last.status)) {
      const next = [...this.entries];
      next[next.length - 1] = {
        ...last,
        ts: this.now(),
        detail: `${last.detail ?? ""}${text}`,
      };
      return this.commit(next);
    }
    return this.addNote({ kind: "reply", title: "Reply", detail: text, status: "in_progress" });
  }

  completeOpenReplies(): ActivityEntry[] {
    if (!this.entries.some((entry) => entry.kind === "reply" && isOpenActivityStatus(entry.status))) {
      return this.snapshot();
    }
    return this.commit(
      this.entries.map((entry) =>
        entry.kind === "reply" && isOpenActivityStatus(entry.status)
          ? { ...entry, status: "completed" }
          : entry,
      ),
    );
  }

  appendThinkingChunk(text: string, replace = false): ActivityEntry[] {
    if (!text) return this.snapshot();
    this.completeOpenReplies();
    const last = this.entries[this.entries.length - 1];
    if (last && last.kind === "thinking") {
      const next = [...this.entries];
      next[next.length - 1] = {
        ...last,
        ts: this.now(),
        detail: replace ? text : `${last.detail ?? ""}${text}`,
      };
      return this.commit(next);
    }
    return this.addNote({ kind: "thinking", title: "Thinking", detail: text });
  }

  startToolCall(input: ToolCallStartInput): ActivityEntry[] {
    this.completeOpenReplies();
    const now = this.now();
    const provided = typeof input.callId === "string" && input.callId.trim().length > 0 ? input.callId : undefined;
    const callId = provided ?? `fallback:${genId()}`;
    const entryId = genId();
    this.entryIdByCallId.set(callId, entryId);
    this.callIdByEntryId.set(entryId, callId);
    if (!provided) this.fallbackEntryIds.add(entryId);
    this.startedAtByCallId.set(callId, now);
    const entry: ActivityEntry = {
      id: entryId,
      ts: now,
      kind: "tool",
      title: input.title,
      detail: input.detail,
      status: input.status ?? "pending",
    };
    return this.commit([...this.entries, entry]);
  }

  updateToolCall(input: ToolCallUpdateInput): ActivityEntry[] {
    const status = input.status;
    if (!status) return this.snapshot();
    const updateTs = input.updateTs ?? this.now();
    const callId = typeof input.callId === "string" && input.callId.trim() ? input.callId : undefined;
    let entryId = callId ? this.entryIdByCallId.get(callId) : undefined;

    if (!entryId && callId) {
      const candidate = this.oldestOpenTool(updateTs, (id) => this.fallbackEntryIds.has(id));
      if (candidate) {
        this.rekeyFallback(candidate, callId);
        entryId = candidate.entry.id;
      }
    }

    if (!entryId && isDoneActivityStatus(status)) {
      const candidate = this.oldestOpenTool(updateTs);
      if (candidate) entryId = candidate.entry.id;
    }

    if (!entryId) {
      if (!input.createTitle) return this.snapshot();
      return this.commit([
        ...this.entries,
        {
          id: genId(),
          ts: updateTs,
          kind: "tool",
          title: input.createTitle,
          status,
        },
      ]);
    }

    const startTs = this.startedAtByCallId.get(this.callIdByEntryId.get(entryId) ?? "");
    const durationMs = isDoneActivityStatus(status) && startTs != null ? updateTs - startTs : undefined;
    return this.commit(
      this.entries.map((entry) =>
        entry.id === entryId
          ? { ...entry, status, durationMs: durationMs ?? entry.durationMs }
          : entry,
      ),
    );
  }

  settleTurn(terminal: "completed" | "interrupted"): ActivityEntry[] {
    this.entryIdByCallId.clear();
    this.callIdByEntryId.clear();
    this.fallbackEntryIds.clear();
    this.startedAtByCallId.clear();
    if (!this.entries.some((entry) => isOpenActivityStatus(entry.status))) return this.snapshot();
    return this.commit(
      this.entries.map((entry) =>
        (entry.kind === "tool" || entry.kind === "reply") && isOpenActivityStatus(entry.status)
          ? { ...entry, status: terminal }
          : entry,
      ),
    );
  }

  private oldestOpenTool(updateTs: number, match?: (entryId: string) => boolean) {
    for (const entry of this.entries) {
      if (entry.kind !== "tool" || !isOpenActivityStatus(entry.status)) continue;
      if (entry.ts > updateTs) continue;
      if (match && !match(entry.id)) continue;
      return { entry, callId: this.callIdByEntryId.get(entry.id) };
    }
    return undefined;
  }

  private rekeyFallback(candidate: { entry: ActivityEntry; callId: string | undefined }, callId: string) {
    const previousCallId = candidate.callId;
    if (previousCallId) {
      this.entryIdByCallId.delete(previousCallId);
      const started = this.startedAtByCallId.get(previousCallId);
      this.startedAtByCallId.delete(previousCallId);
      if (started != null) this.startedAtByCallId.set(callId, started);
    }
    this.entryIdByCallId.set(callId, candidate.entry.id);
    this.callIdByEntryId.set(candidate.entry.id, callId);
    this.fallbackEntryIds.delete(candidate.entry.id);
  }
}
