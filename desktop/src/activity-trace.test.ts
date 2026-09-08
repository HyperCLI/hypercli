import { describe, expect, it } from "vitest";
import { ActivityTrace, type ActivityEntry } from "./activity-trace";

function makeTrace(start = 1_000) {
  let tick = start;
  const trace = new ActivityTrace(() => tick);
  return {
    trace,
    advance: (ms: number) => {
      tick += ms;
    },
  };
}

function toolEntries(entries: ActivityEntry[]) {
  return entries.filter((entry) => entry.kind === "tool");
}

describe("ActivityTrace", () => {
  it("keeps interleaved thinking/tool/reply entries in arrival order", () => {
    const { trace } = makeTrace();
    trace.appendThinkingChunk("planning ");
    trace.appendReplyText("first ");
    trace.appendReplyText("half");
    trace.startToolCall({ callId: "b1", title: "bash", status: "in_progress" });
    trace.startToolCall({ callId: "b2", title: "bash", status: "in_progress" });
    trace.startToolCall({ callId: "b3", title: "bash", status: "in_progress" });
    trace.appendReplyText("done");

    const kinds = trace.snapshot().map((entry) => entry.kind);
    expect(kinds).toEqual(["thinking", "reply", "tool", "tool", "tool", "reply"]);
  });

  it("completes each tool individually when its own update arrives", () => {
    const { trace } = makeTrace();
    trace.startToolCall({ callId: "b1", title: "bash", status: "in_progress" });
    trace.startToolCall({ callId: "b2", title: "bash", status: "in_progress" });
    trace.startToolCall({ callId: "b3", title: "bash", status: "in_progress" });

    trace.updateToolCall({ callId: "b3", status: "completed" });
    let tools = toolEntries(trace.snapshot());
    expect(tools.map((tool) => tool.status)).toEqual(["in_progress", "in_progress", "completed"]);

    trace.updateToolCall({ callId: "b1", status: "failed" });
    trace.updateToolCall({ callId: "b2", status: "completed" });
    tools = toolEntries(trace.snapshot());
    expect(tools.map((tool) => tool.status)).toEqual(["failed", "completed", "completed"]);
  });

  it("unmapped done updates complete only the oldest still-open tool", () => {
    const { trace } = makeTrace();
    trace.startToolCall({ title: "bash", status: "in_progress" });
    trace.startToolCall({ title: "bash", status: "in_progress" });
    trace.startToolCall({ title: "bash", status: "in_progress" });

    trace.updateToolCall({ status: "completed" });
    let tools = toolEntries(trace.snapshot());
    expect(tools.map((tool) => tool.status)).toEqual(["completed", "in_progress", "in_progress"]);

    trace.updateToolCall({ status: "completed" });
    tools = toolEntries(trace.snapshot());
    expect(tools.map((tool) => tool.status)).toEqual(["completed", "completed", "in_progress"]);
  });

  it("never completes an entry that started after the update timestamp", () => {
    const { trace } = makeTrace(1_000);
    trace.startToolCall({ title: "early", status: "in_progress" });
    const entries = trace.snapshot();
    const started = entries[0].ts;

    trace.updateToolCall({ status: "completed", updateTs: started - 1 });
    expect(toolEntries(trace.snapshot())[0].status).toBe("in_progress");
  });

  it("rekeys a real id arriving later onto the fallback-started entry instead of duplicating it", () => {
    const { trace } = makeTrace();
    trace.startToolCall({ title: "bash", status: "in_progress" });
    trace.updateToolCall({ callId: "real-1", status: "in_progress" });
    expect(toolEntries(trace.snapshot())).toHaveLength(1);

    trace.updateToolCall({ callId: "real-1", status: "completed" });
    const tools = toolEntries(trace.snapshot());
    expect(tools).toHaveLength(1);
    expect(tools[0].status).toBe("completed");
  });

  it("settles every open entry on turn end", () => {
    const { trace } = makeTrace();
    trace.appendThinkingChunk("planning");
    trace.startToolCall({ callId: "b1", title: "bash", status: "in_progress" });
    trace.startToolCall({ title: "bash" });
    trace.appendReplyText("answer");

    trace.settleTurn("completed");
    const open = trace.snapshot().filter((entry) => entry.status === "pending" || entry.status === "in_progress");
    expect(open).toEqual([]);
  });

  it("marks open entries interrupted on abort and ignores late updates afterwards", () => {
    const { trace } = makeTrace();
    trace.startToolCall({ callId: "b1", title: "sleep", status: "in_progress" });
    trace.appendReplyText("partial");

    trace.settleTurn("interrupted");
    let entries = trace.snapshot();
    expect(entries.filter((entry) => entry.status === "interrupted")).toHaveLength(2);

    trace.updateToolCall({ callId: "b1", status: "completed" });
    entries = trace.snapshot();
    expect(toolEntries(entries)[0].status).toBe("interrupted");
    expect(toolEntries(entries)).toHaveLength(1);
  });

  it("re-closing a turn never completes a reply created later", () => {
    const { trace } = makeTrace();
    trace.appendReplyText("first");
    trace.appendThinkingChunk("next thought");
    expect(trace.snapshot().find((entry) => entry.kind === "reply")?.status).toBe("completed");

    trace.appendReplyText("second");
    const replies = trace.snapshot().filter((entry) => entry.kind === "reply");
    expect(replies).toHaveLength(2);
    expect(replies[0].status).toBe("completed");
    expect(replies[1].status).toBe("in_progress");
  });

  it("applies durationMs from the entry's own start time", () => {
    const { trace, advance } = makeTrace();
    trace.startToolCall({ callId: "b1", title: "bash", status: "in_progress" });
    advance(250);
    trace.startToolCall({ callId: "b2", title: "bash", status: "in_progress" });
    advance(750);
    trace.updateToolCall({ callId: "b1", status: "completed" });

    const tools = toolEntries(trace.snapshot());
    expect(tools[0].durationMs).toBe(1_000);
    expect(tools[1].durationMs).toBeUndefined();
  });
});
