import { describe, expect, it } from "vitest";
import { VoicePlayer, type AudioBufferLike, type AudioContextLike, type BufferSourceLike } from "./voice-player";

class FakeBuffer implements AudioBufferLike {
  readonly data: Float32Array[];

  constructor(
    readonly channels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.data = Array.from({ length: channels }, () => new Float32Array(length));
  }

  get duration(): number {
    return this.length / this.sampleRate;
  }

  getChannelData(channel: number): Float32Array {
    return this.data[channel];
  }
}

class FakeSource implements BufferSourceLike {
  buffer: ({ duration: number } & Partial<FakeBuffer>) | null = null;
  startedAt: number | null = null;
  stopped = false;
  onended: (() => void) | null = null;

  connect(): void {}

  start(when = 0): void {
    this.startedAt = when;
  }

  stop(): void {
    this.stopped = true;
    this.onended?.();
  }
}

class FakeContext implements AudioContextLike {
  currentTime = 10;
  destination = {};
  state = "running";
  sources: FakeSource[] = [];

  async decodeAudioData(data: ArrayBuffer): Promise<{ duration: number }> {
    // First byte encodes the fake duration in whole seconds, for readable tests.
    return { duration: new Uint8Array(data)[0] ?? 1 };
  }

  createBuffer(numberOfChannels: number, length: number, sampleRate: number): FakeBuffer {
    return new FakeBuffer(numberOfChannels, length, sampleRate);
  }

  createBufferSource(): FakeSource {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }
}

async function* chunkStream(durations: number[], gate?: Promise<void>): AsyncIterable<Uint8Array> {
  for (const duration of durations) {
    if (gate) await gate;
    yield Uint8Array.of(duration);
  }
}

async function flush(times = 10): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("VoicePlayer", () => {
  it("decodes chunks and schedules them back-to-back", async () => {
    const ctx = new FakeContext();
    const player = new VoicePlayer(() => ctx);
    player.speak(chunkStream([2, 3]));
    await flush();
    expect(ctx.sources).toHaveLength(2);
    expect(ctx.sources[0].startedAt).toBeCloseTo(10.05);
    expect(ctx.sources[1].startedAt).toBeCloseTo(12.05);
  });

  it("a new speak stops the in-flight one (cancel-on-new-turn)", async () => {
    const ctx = new FakeContext();
    const player = new VoicePlayer(() => ctx);
    player.speak(chunkStream([5]));
    await flush();
    expect(ctx.sources).toHaveLength(1);
    player.speak(chunkStream([4]));
    await flush();
    // The first source was stopped mid-flight; the second scheduled from now.
    expect(ctx.sources[0].stopped).toBe(true);
    expect(ctx.sources[1].stopped).toBe(false);
    expect(ctx.sources[1].startedAt).toBeCloseTo(10.05);
  });

  it("a superseded stream blocked mid-iter never decodes or schedules", async () => {
    const ctx = new FakeContext();
    const player = new VoicePlayer(() => ctx);
    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => (releaseFirst = resolve));
    player.speak(chunkStream([1, 1], gate));
    await flush(2);
    player.speak(chunkStream([4]));
    releaseFirst();
    await flush();
    expect(ctx.sources).toHaveLength(1);
    expect(ctx.sources[0].buffer?.duration).toBe(4);
  });

  it("stop silences scheduled sources and blocks pending decodes", async () => {
    const ctx = new FakeContext();
    const player = new VoicePlayer(() => ctx);
    player.speak(chunkStream([5]));
    await flush();
    expect(player.playing).toBe(true);
    player.stop();
    expect(player.playing).toBe(false);
    expect(ctx.sources[0].stopped).toBe(true);
  });

  it("skips an undecodable chunk and keeps playing the rest", async () => {
    const ctx = new FakeContext();
    ctx.decodeAudioData = async (data: ArrayBuffer) => {
      const byte = new Uint8Array(data)[0];
      if (byte === 9) throw new Error("unsupported");
      return { duration: byte };
    };
    const player = new VoicePlayer(() => ctx);
    player.speak(chunkStream([9, 2]));
    await flush();
    expect(ctx.sources).toHaveLength(1);
    expect(ctx.sources[0].buffer?.duration).toBe(2);
  });

  it("survives an empty stream", async () => {
    const ctx = new FakeContext();
    const player = new VoicePlayer(() => ctx);
    player.speak(chunkStream([]));
    await flush();
    expect(ctx.sources).toHaveLength(0);
    expect(player.playing).toBe(false);
  });

  it("converts raw pcm chunks into AudioBuffers", async () => {
    const ctx = new FakeContext();
    const player = new VoicePlayer(() => ctx);
    const audio = new Uint8Array([0x00, 0x80, 0x00, 0x00, 0xff, 0x7f]);
    async function* chunks() {
      yield {
        requestId: "rpcm",
        index: 0,
        total: 1,
        audio,
        final: true,
        metadata: { format: "pcm", sampleRate: 3, channels: 1, sampleFormat: "s16le", bytesPerSample: 2 },
      };
    }

    player.speak(chunks());
    await flush();
    expect(ctx.sources).toHaveLength(1);
    expect(ctx.sources[0].buffer?.duration).toBe(1);
    expect((ctx.sources[0].buffer as FakeBuffer).getChannelData(0)).toEqual(Float32Array.of(-1, 0, 32767 / 32768));
  });
});
