import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VoicePlayer, VoicePlayerChunk } from "./voice-player";

const speechStreamMock = vi.hoisted(() => vi.fn());
const prefState = vi.hoisted(() => ({ readAloudEnabled: true }));

vi.mock("../api", () => ({
  speechStream: speechStreamMock,
}));

vi.mock("./voice-read", async (importActual) => {
  const actual = await importActual<typeof import("./voice-read")>();
  return {
    ...actual,
    readAloudEnabled: () => prefState.readAloudEnabled,
  };
});

import { ReadAloudController } from "./read-aloud";

class FakePlayer {
  readonly enqueued: VoicePlayerChunk[][] = [];
  stops = 0;

  diagnostics(): { audioContextState?: string } {
    return { audioContextState: "running" };
  }

  enqueue(chunks: AsyncIterable<VoicePlayerChunk>): void {
    void (async () => {
      const collected: VoicePlayerChunk[] = [];
      for await (const chunk of chunks) collected.push(chunk);
      this.enqueued.push(collected);
    })();
  }

  stop(): void {
    this.stops += 1;
  }
}

async function flush(times = 10): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function deferredStream(label: number) {
  let resolve!: (value: unknown) => void;
  const gate = new Promise((r) => (resolve = r));
  return {
    stream: {
      chunks: (async function* () {
        await gate;
        yield Uint8Array.of(label);
      })(),
      cancel: vi.fn(),
    },
    resolve,
  };
}

function emptyStream() {
  return {
    chunks: (async function* () {})(),
    cancel: vi.fn(),
  };
}

describe("ReadAloudController", () => {
  beforeEach(() => {
    speechStreamMock.mockReset();
    prefState.readAloudEnabled = true;
  });

  it("splits streamed text into sentence TTS jobs and plays results in sentence order", async () => {
    const first = deferredStream(1);
    const second = deferredStream(2);
    speechStreamMock.mockResolvedValueOnce(first.stream).mockResolvedValueOnce(second.stream);
    const player = new FakePlayer();
    const controller = new ReadAloudController(player as unknown as VoicePlayer);

    controller.startTurn({ voice: "serena" });
    controller.pushText("First sentence. Second sentence.");
    await flush();

    expect(speechStreamMock).toHaveBeenNthCalledWith(1, "First sentence.", { voice: "serena" });
    expect(speechStreamMock).toHaveBeenNthCalledWith(2, "Second sentence.", { voice: "serena" });

    second.resolve(undefined);
    await flush();
    expect(player.enqueued).toHaveLength(0);

    first.resolve(undefined);
    await flush();
    expect(player.enqueued.map((chunks) => (chunks[0] as Uint8Array)[0])).toEqual([1, 2]);
  });

  it("passes a clone reference through to every sentence's speech request", async () => {
    speechStreamMock.mockImplementation(async () => emptyStream());
    const controller = new ReadAloudController(new FakePlayer() as unknown as VoicePlayer);
    const options = { referenceAudioUrl: "https://cdn.example/voice.wav" };

    controller.startTurn(options);
    controller.pushText("One. Two.");
    await flush();

    expect(speechStreamMock).toHaveBeenNthCalledWith(1, "One.", options);
    expect(speechStreamMock).toHaveBeenNthCalledWith(2, "Two.", options);
  });

  it("limits concurrent sentence speech requests to five", async () => {
    const streams = Array.from({ length: 6 }, (_, index) => deferredStream(index + 1));
    for (const entry of streams) speechStreamMock.mockResolvedValueOnce(entry.stream);
    const controller = new ReadAloudController(new FakePlayer() as unknown as VoicePlayer);

    controller.startTurn();
    controller.pushText("One. Two. Three. Four. Five. Six.");
    await flush();

    expect(speechStreamMock).toHaveBeenCalledTimes(5);
    streams[0].resolve(undefined);
    await flush();
    expect(speechStreamMock).toHaveBeenCalledTimes(6);
  });

  it("sends the first complete sentence to TTS immediately, even when short", async () => {
    speechStreamMock.mockImplementation(async () => emptyStream());
    const controller = new ReadAloudController(new FakePlayer() as unknown as VoicePlayer);

    controller.startTurn();
    controller.pushText("Yes. Here is the actual first useful sentence.");
    await flush();

    expect(speechStreamMock).toHaveBeenCalledTimes(2);
    expect(speechStreamMock).toHaveBeenNthCalledWith(1, "Yes.", {});
    expect(speechStreamMock).toHaveBeenNthCalledWith(2, "Here is the actual first useful sentence.", {});
  });

  it("flushes trailing text at turn end without duplicating it", async () => {
    const stream = deferredStream(1);
    speechStreamMock.mockResolvedValue(stream.stream);
    const controller = new ReadAloudController(new FakePlayer() as unknown as VoicePlayer);

    controller.startTurn();
    controller.pushText("Yes.");
    controller.finishTurn();
    await flush();

    expect(speechStreamMock).toHaveBeenCalledWith("Yes.", {});
    expect(speechStreamMock).not.toHaveBeenCalledWith("Yes. Yes.", {});
  });

  it("caps spoken text across the whole streamed turn", async () => {
    speechStreamMock.mockImplementation(async () => emptyStream());
    const controller = new ReadAloudController(new FakePlayer() as unknown as VoicePlayer);
    const text = Array.from({ length: 101 }, (_, index) => {
      const n = index + 1;
      return `alpha${n} beta${n} gamma${n} delta${n} epsilon${n}.`;
    }).join(" ");

    controller.startTurn();
    controller.pushText(text);
    await flush(30);

    const spokenWords = speechStreamMock.mock.calls
      .map(([spoken]) => String(spoken).trim().split(/\s+/).filter(Boolean).length)
      .reduce((sum, count) => sum + count, 0);
    expect(spokenWords).toBe(500);
  });

  it("replaces pending unspoken text without replaying submitted speech", async () => {
    const stream = deferredStream(1);
    speechStreamMock.mockResolvedValue(stream.stream);
    const controller = new ReadAloudController(new FakePlayer() as unknown as VoicePlayer);

    controller.startTurn();
    controller.pushText("Hello");
    controller.replacePending("Hello, world.");
    controller.finishTurn();
    await flush();

    expect(speechStreamMock).toHaveBeenCalledWith("Hello, world.", {});
  });

  it("replaces only unsubmitted text after a cumulative replace", async () => {
    speechStreamMock.mockImplementation(async () => emptyStream());
    const controller = new ReadAloudController(new FakePlayer() as unknown as VoicePlayer);

    controller.startTurn();
    controller.pushText("Yes. More");
    controller.replacePending("Yes. More detail follows.");
    controller.finishTurn();
    await flush();

    expect(speechStreamMock).toHaveBeenCalledTimes(2);
    expect(speechStreamMock).toHaveBeenNthCalledWith(1, "Yes.", {});
    expect(speechStreamMock).toHaveBeenNthCalledWith(2, "More detail follows.", {});
  });

  it("never replays already-submitted speech after a non-prefix replace", async () => {
    speechStreamMock.mockImplementation(async () => emptyStream());
    const controller = new ReadAloudController(new FakePlayer() as unknown as VoicePlayer);

    controller.startTurn();
    controller.pushText("Yes.");
    controller.replacePending("Yes, actually.");
    controller.finishTurn();
    await flush();

    expect(speechStreamMock).toHaveBeenCalledTimes(1);
    expect(speechStreamMock).toHaveBeenCalledWith("Yes.", {});
  });

  it("reports explicit streaming and draining diagnostics", async () => {
    const stream = deferredStream(1);
    speechStreamMock.mockResolvedValue(stream.stream);
    const controller = new ReadAloudController(new FakePlayer() as unknown as VoicePlayer);

    controller.startTurn();
    controller.pushText("This sentence is long enough.");
    await flush();
    expect(controller.diagnostics()).toMatchObject({
      state: "streaming",
      pendingJobs: 0,
      activeJobs: 1,
      nextIndex: 1,
      nextToPlay: 0,
      audioContextState: "running",
    });

    controller.finishTurn();
    expect(controller.diagnostics()).toMatchObject({ state: "draining", activeJobs: 1 });

    stream.resolve(undefined);
    await flush();
    expect(controller.diagnostics()).toMatchObject({ state: "idle", activeJobs: 0, nextToPlay: 1 });
  });

  describe("launch-muted policy", () => {
    it("never starts a turn while the read-aloud pref is off", async () => {
      prefState.readAloudEnabled = false;
      speechStreamMock.mockImplementation(async () => emptyStream());
      const controller = new ReadAloudController(new FakePlayer() as unknown as VoicePlayer);

      controller.startTurn();
      controller.pushText("Hello there. This must stay silent.");
      controller.finishTurn();
      await flush();

      expect(controller.diagnostics()).toMatchObject({ enabled: false });
      expect(controller.diagnostics().state).not.toBe("streaming");
      expect(speechStreamMock).not.toHaveBeenCalled();
    });

    it("still speaks an explicit replay while muted", async () => {
      prefState.readAloudEnabled = false;
      speechStreamMock.mockImplementation(async () => emptyStream());
      const controller = new ReadAloudController(new FakePlayer() as unknown as VoicePlayer);

      await controller.replay("Replay me anyway.");
      await flush();

      expect(speechStreamMock).toHaveBeenCalledTimes(1);
      expect(speechStreamMock).toHaveBeenCalledWith("Replay me anyway.", {});
    });
  });
});
