import { describe, expect, it } from "vitest";
import {
  VoicePlayer,
  installVoicePlaybackWarmup,
  type AudioBufferLike,
  type AudioContextLike,
  type BufferSourceLike,
  type WarmupTarget,
} from "./voice-player";

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
  resumes = 0;
  /** WKWebView failure mode: resume() resolves but the state never changes. */
  resumeSucceeds = true;

  async resume(): Promise<void> {
    this.resumes += 1;
    if (this.resumeSucceeds) this.state = "running";
  }

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
  it("decodes chunks and plays one queued source at a time", async () => {
    const ctx = new FakeContext();
    const player = new VoicePlayer(() => ctx);
    player.speak(chunkStream([2, 3]));
    await flush();
    expect(ctx.sources).toHaveLength(1);
    expect(ctx.sources[0].startedAt).toBeCloseTo(0);
    ctx.sources[0].onended?.();
    await flush();
    expect(ctx.sources).toHaveLength(2);
    expect(ctx.sources[1].startedAt).toBeCloseTo(0);
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
    expect(ctx.sources[1].startedAt).toBeCloseTo(0);
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

  it("prepares web audio and exposes playback diagnostics", async () => {
    const ctx = new FakeContext();
    const player = new VoicePlayer(() => ctx);

    expect(player.diagnostics()).toMatchObject({ generation: 0, playing: false, playback: { name: "idle", queued: 0 } });
    await player.prepare();
    expect(ctx.sources).toHaveLength(1);
    expect(player.diagnostics()).toMatchObject({
      audioContextState: "running",
      lastUnlock: { ok: true, contextState: "running" },
      playback: { name: "idle", queued: 0 },
    });

    player.speak(chunkStream([2, 3]));
    await flush();
    expect(player.diagnostics()).toMatchObject({ generation: 1, playing: true, playback: { name: "playing", queued: 1 } });
  });

  it("awaits suspended context resume before scheduling playback", async () => {
    const ctx = new FakeContext();
    ctx.state = "suspended";
    const player = new VoicePlayer(() => ctx);

    await player.prepare();
    player.speak(chunkStream([2]));
    await flush();

    expect(ctx.resumes).toBe(1);
    expect(ctx.sources).toHaveLength(2);
    expect(ctx.sources[1].startedAt).toBeCloseTo(0);
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

  it("queues pcm chunks as separate playback items", async () => {
    const ctx = new FakeContext();
    const player = new VoicePlayer(() => ctx);
    async function* chunks() {
      yield {
        requestId: "chunked-pcm",
        index: 0,
        total: 2,
        audio: new Uint8Array([0x00, 0x80]),
        final: false,
        metadata: { format: "pcm", sampleRate: 2, channels: 1, sampleFormat: "s16le", bytesPerSample: 2 },
      };
      yield {
        requestId: "chunked-pcm",
        index: 1,
        total: 2,
        audio: new Uint8Array([0xff, 0x7f]),
        final: true,
        metadata: { format: "pcm", sampleRate: 2, channels: 1, sampleFormat: "s16le", bytesPerSample: 2 },
      };
    }

    player.speak(chunks());
    await flush();
    expect(ctx.sources).toHaveLength(1);
    expect((ctx.sources[0].buffer as FakeBuffer).getChannelData(0)).toEqual(Float32Array.of(-1));
    ctx.sources[0].onended?.();
    await flush();
    expect(ctx.sources).toHaveLength(2);
    expect((ctx.sources[1].buffer as FakeBuffer).getChannelData(0)).toEqual(Float32Array.of(32767 / 32768));
  });

  it("skips unaligned pcm chunks without poisoning the queue", async () => {
    const ctx = new FakeContext();
    const player = new VoicePlayer(() => ctx);
    async function* chunks() {
      yield {
        requestId: "missing-pcm",
        index: 0,
        total: 2,
        audio: new Uint8Array([0x00]),
        final: false,
        metadata: { format: "pcm", sampleRate: 2, channels: 1, sampleFormat: "s16le", bytesPerSample: 2 },
      };
      yield {
        requestId: "missing-pcm",
        index: 1,
        total: 2,
        audio: new Uint8Array([0x00, 0x80]),
        final: true,
        metadata: { format: "pcm", sampleRate: 2, channels: 1, sampleFormat: "s16le", bytesPerSample: 2 },
      };
    }

    player.speak(chunks());
    await flush();
    expect(ctx.sources).toHaveLength(1);
    expect((ctx.sources[0].buffer as FakeBuffer).getChannelData(0)).toEqual(Float32Array.of(-1));
  });

  it("marks the player unlocked only once the context is verified running", async () => {
    const ctx = new FakeContext();
    ctx.state = "suspended";
    const player = new VoicePlayer(() => ctx);

    expect(player.unlocked).toBe(false);
    const diagnostic = await player.prepare();
    expect(diagnostic).toEqual({ ok: true, contextState: "running" });
    expect(player.unlocked).toBe(true);
  });

  it("reports a failed unlock when resume() resolves but the context stays suspended", async () => {
    const ctx = new FakeContext();
    ctx.state = "suspended";
    ctx.resumeSucceeds = false;
    const player = new VoicePlayer(() => ctx);

    const diagnostic = await player.prepare();

    expect(diagnostic.ok).toBe(false);
    expect(diagnostic.contextState).toBe("suspended");
    expect(player.unlocked).toBe(false);
    expect(ctx.sources).toHaveLength(0);
  });

  it("never claims playback on a context that stays suspended", async () => {
    const ctx = new FakeContext();
    ctx.state = "suspended";
    ctx.resumeSucceeds = false;
    const player = new VoicePlayer(() => ctx);

    player.speak(chunkStream([2]));
    await flush();

    expect(ctx.sources).toHaveLength(0);
    expect(player.playing).toBe(false);
    expect(player.diagnostics().lastError).toBeInstanceOf(Error);
  });
});

class FakeWarmupTarget implements WarmupTarget {
  private readonly listeners = new Map<string, Set<() => void>>();

  addEventListener(type: string, listener: () => void, _options?: { capture?: boolean }): void {
    const set = this.listeners.get(type) ?? new Set<() => void>();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: () => void, _options?: { capture?: boolean }): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener();
  }

  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

describe("installVoicePlaybackWarmup", () => {
  it("registers capture-phase pointerdown and click listeners and uninstalls them", () => {
    const target = new FakeWarmupTarget();
    const registrations: { type: string; options?: { capture?: boolean } }[] = [];
    const tracked: WarmupTarget = {
      addEventListener: (type, listener, options) => {
        registrations.push({ type, options });
        target.addEventListener(type, listener, options);
      },
      removeEventListener: (type, listener, options) => target.removeEventListener(type, listener, options),
    };
    const uninstall = installVoicePlaybackWarmup(new VoicePlayer(() => new FakeContext()), tracked);

    expect(registrations).toEqual([
      { type: "pointerdown", options: { capture: true } },
      { type: "click", options: { capture: true } },
    ]);

    uninstall();
    expect(target.listenerCount("pointerdown")).toBe(0);
    expect(target.listenerCount("click")).toBe(0);
  });

  it("resumes a suspended context on the first capture-phase gesture", async () => {
    const ctx = new FakeContext();
    ctx.state = "suspended";
    const player = new VoicePlayer(() => ctx);
    const target = new FakeWarmupTarget();
    installVoicePlaybackWarmup(player, target);

    target.dispatch("pointerdown");
    await flush();

    expect(ctx.resumes).toBe(1);
    expect(ctx.state).toBe("running");
    expect(player.unlocked).toBe(true);
    expect(ctx.sources).toHaveLength(1);
  });

  it("stops warming once the context is verified running", async () => {
    const ctx = new FakeContext();
    ctx.state = "suspended";
    const player = new VoicePlayer(() => ctx);
    const target = new FakeWarmupTarget();
    installVoicePlaybackWarmup(player, target);

    target.dispatch("pointerdown");
    await flush();
    expect(ctx.sources).toHaveLength(1);

    target.dispatch("click");
    target.dispatch("pointerdown");
    await flush();
    expect(ctx.resumes).toBe(1);
    expect(ctx.sources).toHaveLength(1);
  });

  it("keeps retrying on later gestures while the context stays suspended", async () => {
    const ctx = new FakeContext();
    ctx.state = "suspended";
    ctx.resumeSucceeds = false;
    const player = new VoicePlayer(() => ctx);
    const target = new FakeWarmupTarget();
    installVoicePlaybackWarmup(player, target);

    target.dispatch("pointerdown");
    await flush();
    target.dispatch("click");
    await flush();

    expect(ctx.resumes).toBe(2);
    expect(player.unlocked).toBe(false);
    expect(ctx.sources).toHaveLength(0);
  });
});
