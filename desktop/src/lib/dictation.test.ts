import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DictationMachine,
  MIC_PERMISSION_ISSUE_ID,
  insertTranscript,
  type DictationCaptureLike,
  type DictationSessionLike,
} from "./dictation";
import {
  clearConnectionIssues,
  subscribeConnectionIssues,
  type ConnectionIssue,
} from "./connection-errors";

// dictation.ts constructs its singleton from ../api; the machine under test
// takes deps explicitly, so the factory is never called — but the import must
// resolve without Tauri IPC.
vi.mock("../api", () => ({ createVoiceTranscriptionSession: vi.fn() }));

class FakeSession implements DictationSessionLike {
  calls: string[] = [];
  transcript: string = "hello world";
  eventsError: Error | null = null;
  private hang = false;

  hangEvents() {
    this.hang = true;
  }

  sendAudio(bytes: Uint8Array) {
    this.calls.push(`audio:${bytes.length}`);
  }

  commit() {
    this.calls.push("commit");
  }

  close() {
    this.calls.push("close");
  }

  async *events(): AsyncGenerator<{ type: string; text?: string }, void, undefined> {
    this.calls.push("events");
    if (this.hang) {
      await new Promise<never>(() => {});
      return;
    }
    if (this.eventsError) throw this.eventsError;
    // The protocol may stream acks and deltas; only final is consumed.
    yield { type: "ack" };
    yield { type: "transcript.delta", text: "hel" };
    yield { type: "transcript.final", text: this.transcript };
  }
}

class FakeCapture implements DictationCaptureLike {
  readonly mimeType = "audio/webm;codecs=opus";
  stops = 0;
  private stopped = false;

  constructor(
    private readonly handlers: { onChunk: (bytes: Uint8Array) => void; onError: (error: unknown) => void },
    private readonly finalChunk?: Uint8Array,
  ) {}

  emit(bytes: Uint8Array) {
    this.handlers.onChunk(bytes);
  }

  fail(error: unknown) {
    this.handlers.onError(error);
  }

  /** Idempotent, like the real MicCapture.stop(). */
  async stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.stops += 1;
    // Like MediaRecorder.stop(): the tail of the recording arrives during stop.
    if (this.finalChunk) this.handlers.onChunk(this.finalChunk);
  }
}

function makeMachine(options: {
  session?: FakeSession;
  finalChunk?: Uint8Array;
  captureError?: unknown;
  sessionError?: unknown;
} = {}) {
  const session = options.session ?? new FakeSession();
  const machine = new DictationMachine({
    openSession: async () => {
      if (options.sessionError) throw options.sessionError;
      return session;
    },
    startCapture: async (handlers) => {
      if (options.captureError) throw options.captureError;
      return new FakeCapture(handlers, options.finalChunk);
    },
  });
  return { machine, session };
}

async function waitFor(expectation: () => void) {
  await vi.waitFor(expectation, { timeout: 1000, interval: 5 });
}

describe("DictationMachine", () => {
  const issues: ConnectionIssue[][] = [];
  let unsubscribe: () => void;

  beforeEach(() => {
    clearConnectionIssues();
    issues.length = 0;
    unsubscribe = subscribeConnectionIssues((snapshot) => issues.push(snapshot));
  });

  afterEach(() => {
    unsubscribe();
    clearConnectionIssues();
  });

  it("full cycle: records, streams chunks, commits, delivers only the final transcript", async () => {
    let capture: FakeCapture | null = null;
    const session = new FakeSession();
    const machine = new DictationMachine({
      openSession: async () => session,
      startCapture: async (handlers) => {
        capture = new FakeCapture(handlers, new Uint8Array([3]));
        return capture;
      },
    });
    const transcripts: string[] = [];
    machine.onTranscript((text) => transcripts.push(text));

    machine.toggle();
    await waitFor(() => expect(machine.state.name).toBe("recording"));
    capture!.emit(new Uint8Array([1]));
    capture!.emit(new Uint8Array([2]));

    machine.toggle();
    expect(machine.state.name).toBe("transcribing");
    await waitFor(() => expect(machine.state.name).toBe("idle"));

    // The recorder's final-flush chunk lands before commit, then the socket closes.
    expect(session.calls).toEqual(["audio:1", "audio:1", "audio:1", "commit", "events", "close"]);
    expect(capture!.stops).toBe(1);
    expect(transcripts).toEqual(["hello world"]);
    machine.dispose();
  });

  it("cancel while recording discards everything — no commit, no insert", async () => {
    let capture: FakeCapture | null = null;
    const session = new FakeSession();
    const machine = new DictationMachine({
      openSession: async () => session,
      startCapture: async (handlers) => {
        capture = new FakeCapture(handlers);
        return capture;
      },
    });
    const transcripts: string[] = [];
    machine.onTranscript((text) => transcripts.push(text));

    machine.toggle();
    await waitFor(() => expect(machine.state.name).toBe("recording"));
    capture!.emit(new Uint8Array([1]));

    machine.cancel();
    await waitFor(() => expect(machine.state.name).toBe("idle"));
    expect(session.calls).toEqual(["audio:1", "close"]);
    expect(capture!.stops).toBe(1);
    expect(transcripts).toEqual([]);
    machine.dispose();
  });

  it("cancel while starting aborts the dial and still tears down", async () => {
    const session = new FakeSession();
    const machine = new DictationMachine({
      openSession: async () => session,
      startCapture: async (handlers) => new FakeCapture(handlers),
    });
    machine.toggle();
    machine.cancel();
    await waitFor(() => expect(machine.state.name).toBe("idle"));
    await waitFor(() => expect(session.calls).toContain("close"));
    expect(session.calls).not.toContain("commit");
    machine.dispose();
  });

  it("cancel while transcribing aborts the wait and inserts nothing", async () => {
    const session = new FakeSession();
    session.hangEvents();
    let capture: FakeCapture | null = null;
    const machine = new DictationMachine({
      openSession: async () => session,
      startCapture: async (handlers) => {
        capture = new FakeCapture(handlers);
        return capture;
      },
    });
    const transcripts: string[] = [];
    machine.onTranscript((text) => transcripts.push(text));

    machine.toggle();
    await waitFor(() => expect(machine.state.name).toBe("recording"));
    machine.toggle();
    await waitFor(() => expect(machine.state.name).toBe("transcribing"));
    await waitFor(() => expect(session.calls).toContain("commit"));

    machine.cancel();
    await waitFor(() => expect(machine.state.name).toBe("idle"));
    expect(transcripts).toEqual([]);
    expect(session.calls.filter((c) => c === "close")).toHaveLength(1);
    machine.dispose();
  });

  it("a second toggle while transcribing is inert", async () => {
    const session = new FakeSession();
    session.hangEvents();
    const machine = new DictationMachine({
      openSession: async () => session,
      startCapture: async (handlers) => new FakeCapture(handlers),
    });
    machine.toggle();
    await waitFor(() => expect(machine.state.name).toBe("recording"));
    machine.toggle();
    await waitFor(() => expect(machine.state.name).toBe("transcribing"));
    machine.toggle();
    expect(machine.state.name).toBe("transcribing");
    machine.cancel();
    machine.dispose();
  });

  it("mic permission denial reports a permission issue and returns to idle", async () => {
    const { machine } = makeMachine({ captureError: new DOMException("denied", "NotAllowedError") });
    const transcripts: string[] = [];
    machine.onTranscript((text) => transcripts.push(text));

    machine.toggle();
    await waitFor(() => expect(machine.state.name).toBe("idle"));
    const latest = issues.at(-1) ?? [];
    const issue = latest.find((candidate) => candidate.id === MIC_PERMISSION_ISSUE_ID);
    expect(issue?.kind).toBe("permission");
    expect(issue?.title).toBe("Microphone access is off");
    expect(issue?.hint).toContain("Microphone");
    expect(transcripts).toEqual([]);
    machine.dispose();
  });

  it("session open failure reports a named error and returns to idle", async () => {
    const { machine } = makeMachine({ sessionError: new Error("socket refused") });
    machine.toggle();
    await waitFor(() => expect(machine.state.name).toBe("idle"));
    const latest = issues.at(-1) ?? [];
    const issue = latest.find((candidate) => candidate.title === "Voice dictation failed");
    expect(issue).toBeTruthy();
    expect(issue?.detail).toContain("socket refused");
    machine.dispose();
  });

  it("stream failure while transcribing surfaces and returns to idle", async () => {
    const session = new FakeSession();
    session.eventsError = new Error("whisper exploded");
    const machine = new DictationMachine({
      openSession: async () => session,
      startCapture: async (handlers) => new FakeCapture(handlers),
    });
    const transcripts: string[] = [];
    machine.onTranscript((text) => transcripts.push(text));

    machine.toggle();
    await waitFor(() => expect(machine.state.name).toBe("recording"));
    machine.toggle();
    await waitFor(() => expect(machine.state.name).toBe("idle"));
    const latest = issues.at(-1) ?? [];
    expect(latest.some((candidate) => candidate.title === "Voice dictation failed")).toBe(true);
    expect(transcripts).toEqual([]);
    expect(session.calls).toContain("close");
    machine.dispose();
  });

  it("an empty final transcript inserts nothing and reports no error", async () => {
    const session = new FakeSession();
    session.transcript = "   ";
    const machine = new DictationMachine({
      openSession: async () => session,
      startCapture: async (handlers) => new FakeCapture(handlers),
    });
    const transcripts: string[] = [];
    machine.onTranscript((text) => transcripts.push(text));

    machine.toggle();
    await waitFor(() => expect(machine.state.name).toBe("recording"));
    machine.toggle();
    await waitFor(() => expect(machine.state.name).toBe("idle"));
    expect(transcripts).toEqual([]);
    expect(issues.at(-1) ?? []).toEqual([]);
    machine.dispose();
  });

  it("recorder errors mid-recording surface and reset", async () => {
    let capture: FakeCapture | null = null;
    const session = new FakeSession();
    const machine = new DictationMachine({
      openSession: async () => session,
      startCapture: async (handlers) => {
        capture = new FakeCapture(handlers);
        return capture;
      },
    });
    machine.toggle();
    await waitFor(() => expect(machine.state.name).toBe("recording"));
    capture!.fail(new Error("mic unplugged"));
    await waitFor(() => expect(machine.state.name).toBe("idle"));
    const latest = issues.at(-1) ?? [];
    expect(latest.some((candidate) => candidate.title === "Voice dictation failed")).toBe(true);
    expect(session.calls).toContain("close");
    machine.dispose();
  });

  it("dispose mid-recording tears down without inserting", async () => {
    let capture: FakeCapture | null = null;
    const session = new FakeSession();
    const machine = new DictationMachine({
      openSession: async () => session,
      startCapture: async (handlers) => {
        capture = new FakeCapture(handlers);
        return capture;
      },
    });
    const transcripts: string[] = [];
    machine.onTranscript((text) => transcripts.push(text));
    machine.toggle();
    await waitFor(() => expect(machine.state.name).toBe("recording"));
    machine.dispose();
    await waitFor(() => expect(session.calls).toContain("close"));
    expect(capture!.stops).toBe(1);
    expect(transcripts).toEqual([]);
  });
});

describe("insertTranscript", () => {
  it("fills an empty draft", () => {
    expect(insertTranscript("", "hello world")).toEqual({ draft: "hello world", caret: 11 });
  });

  it("appends to a non-empty draft with one separating space", () => {
    expect(insertTranscript("Fix the", "deploy")).toEqual({ draft: "Fix the deploy", caret: 14 });
    expect(insertTranscript("Fix the ", "deploy")).toEqual({ draft: "Fix the deploy", caret: 14 });
  });

  it("splices at the selection, replacing it", () => {
    expect(insertTranscript("Fix the deply now", "deploy", { start: 8, end: 13 })).toEqual({
      draft: "Fix the deploy now",
      caret: 14,
    });
  });

  it("adds a trailing space when the splice would glue onto following text", () => {
    expect(insertTranscript("hello world", "big", { start: 6, end: 6 })).toEqual({
      draft: "hello big world",
      caret: 9,
    });
  });

  it("appends when the selection is unusable", () => {
    expect(insertTranscript("ab", "c", { start: 1, end: 9 })).toEqual({ draft: "ab c", caret: 4 });
    expect(insertTranscript("ab", "c", null)).toEqual({ draft: "ab c", caret: 4 });
  });

  it("trims and ignores empty transcripts", () => {
    expect(insertTranscript("ab", "  ", { start: 1, end: 1 })).toEqual({ draft: "ab", caret: 2 });
  });
});
