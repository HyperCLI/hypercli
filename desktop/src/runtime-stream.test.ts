/**
 * The runtime chat stream's generation guard (useAgentChat's runtime send
 * path). Switching agents mid-stream must not leak the old agent's events
 * into the new agent's transcript, and Stop needs the run identity the
 * stream itself reported.
 */
import { describe, expect, it, vi } from "vitest";
import { runtimeStreamSink } from "./runtime-stream";

describe("runtimeStreamSink", () => {
  it("folds events while its mount generation is current", () => {
    const fold = vi.fn();
    const sink = runtimeStreamSink("main", () => true, fold);
    sink.onEvent({ type: "content", text: "hello" });
    sink.onEvent({ type: "done" });
    expect(fold).toHaveBeenCalledTimes(2);
  });

  it("drops events once the mount generation has advanced", () => {
    let current = true;
    const fold = vi.fn();
    const sink = runtimeStreamSink("main", () => current, fold);
    sink.onEvent({ type: "content", text: "before switch" });
    // The agent switched away mid-stream: nothing from the old stream may land.
    current = false;
    sink.onEvent({ type: "content", text: "from the old agent" });
    sink.onEvent({ type: "tool_call", data: { name: "shell" } });
    expect(fold).toHaveBeenCalledTimes(1);
  });

  it("tracks the run id and session key the stream reports, for abort", () => {
    const sink = runtimeStreamSink("main", () => true, vi.fn());
    expect(sink.runId).toBeUndefined();
    sink.onEvent({ type: "content", text: "hi", runId: "run-1", sessionKey: "s-2" });
    expect(sink.runId).toBe("run-1");
    expect(sink.sessionKey).toBe("s-2");
    // Events without identity leave the last reported identity in place.
    sink.onEvent({ type: "content", text: "more" });
    expect(sink.runId).toBe("run-1");
  });

  it("does not record identities from a stale stream", () => {
    let current = true;
    const sink = runtimeStreamSink("main", () => current, vi.fn());
    sink.onEvent({ type: "content", text: "hi", runId: "run-1" });
    current = false;
    sink.onEvent({ type: "content", text: "late", runId: "run-2" });
    expect(sink.runId).toBe("run-1");
  });
});
