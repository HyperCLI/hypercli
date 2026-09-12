/**
 * Read-aloud controller: streams assistant text as sentence-sized TTS jobs.
 * Up to five voice requests may run at once, but playback drains by sentence
 * index so faster later requests never speak before earlier ones.
 */
import { speechStream, type SpeechStream } from "../api";
import type { ReadAloudOptions } from "./voice-feature-service";
import { readAloudPlayer, type VoicePlayer, type VoicePlayerChunk, type WebAudioUnlockDiagnostic } from "./voice-player";
import { READ_ALOUD_WORD_CAP, flattenForSpeech, readAloudEnabled } from "./voice-read";

interface SpeechJob {
  index: number;
  text: string;
}

export type ReadAloudStateName = "idle" | "streaming" | "draining" | "stopped";

export interface ReadAloudDiagnostics {
  state: ReadAloudStateName;
  generation: number;
  enabled: boolean;
  bufferedChars: number;
  submittedPrefixChars: number;
  pendingJobs: number;
  activeJobs: number;
  readyResults: number;
  nextIndex: number;
  nextToPlay: number;
  audioContextState?: string;
  playerPlaying: boolean;
}

const MAX_CONCURRENT_SPEECH = 5;
const MAX_BUFFER_CHARS = 320;

export class ReadAloudController {
  private generation = 0;
  private state: ReadAloudStateName = "idle";
  private options: ReadAloudOptions = {};
  private buffer = "";
  private submittedPrefix = "";
  private nextIndex = 0;
  private nextToPlay = 0;
  private activeJobs = 0;
  private remainingWords = READ_ALOUD_WORD_CAP;
  private readonly pending: SpeechJob[] = [];
  private readonly results = new Map<number, VoicePlayerChunk[]>();
  private readonly cancelStreams = new Set<() => void>();

  constructor(private readonly player: VoicePlayer = readAloudPlayer) {}

  preparePlayback(): Promise<WebAudioUnlockDiagnostic> {
    return this.player.prepare();
  }

  diagnostics(): ReadAloudDiagnostics {
    return {
      state: this.state,
      generation: this.generation,
      enabled: readAloudEnabled(),
      bufferedChars: this.buffer.length,
      submittedPrefixChars: this.submittedPrefix.length,
      pendingJobs: this.pending.length,
      activeJobs: this.activeJobs,
      readyResults: this.results.size,
      nextIndex: this.nextIndex,
      nextToPlay: this.nextToPlay,
      audioContextState: this.player.diagnostics().audioContextState,
      playerPlaying: this.player.playing,
    };
  }

  /** Start a new streaming turn. No-op when voice replies are disabled. */
  startTurn(options: ReadAloudOptions = {}, behavior: { force?: boolean } = {}): void {
    this.stop();
    if (!behavior.force && !readAloudEnabled()) return;
    this.state = "streaming";
    this.options = options;
    this.remainingWords = READ_ALOUD_WORD_CAP;
  }

  /** Push finalized assistant text deltas as they arrive from the runtime. */
  pushText(delta: string): void {
    if (this.state !== "streaming" || !delta) return;
    this.buffer += delta;
    for (const sentence of takeCompleteSentences(this.buffer, (next) => { this.buffer = next; })) {
      this.enqueueSentence(sentence);
    }
  }

  /** Flush trailing text that did not end in punctuation. */
  finishTurn(): void {
    if (this.state !== "streaming") return;
    const tail = this.buffer.trim();
    this.buffer = "";
    if (tail) this.enqueueSentence(tail);
    this.state = this.pending.length > 0 || this.activeJobs > 0 || this.results.size > 0 ? "draining" : "idle";
  }

  /** Replace only text still buffered locally; already-submitted speech is never replayed. */
  replacePending(snapshot: string): void {
    if (this.state !== "streaming") return;
    if (snapshot.startsWith(this.submittedPrefix)) {
      this.buffer = snapshot.slice(this.submittedPrefix.length).trimStart();
      return;
    }
    this.buffer = "";
  }

  /** Reset a streaming turn after a replace=true runtime event. */
  resetTurn(text = ""): void {
    const options = this.options;
    this.startTurn(options);
    this.pushText(text);
  }

  /** Silences playback and cancels queued/in-flight TTS. Idempotent. */
  stop(): void {
    this.generation += 1;
    this.state = "stopped";
    this.options = {};
    this.buffer = "";
    this.submittedPrefix = "";
    this.nextIndex = 0;
    this.nextToPlay = 0;
    this.activeJobs = 0;
    this.remainingWords = READ_ALOUD_WORD_CAP;
    this.pending.length = 0;
    this.results.clear();
    for (const cancel of this.cancelStreams) cancel();
    this.cancelStreams.clear();
    this.player.stop();
  }

  /** Back-compat one-shot path: split and stream a completed string. */
  async read(text: string, options: ReadAloudOptions = {}): Promise<void> {
    this.startTurn(options);
    this.pushText(text);
    this.finishTurn();
  }

  async replay(text: string, options: ReadAloudOptions = {}): Promise<void> {
    this.startTurn(options, { force: true });
    this.pushText(text);
    this.finishTurn();
  }

  async readIfEnabled(text: string, options: ReadAloudOptions = {}): Promise<void> {
    if (!readAloudEnabled()) return;
    await this.read(text, options);
  }

  private enqueueSentence(raw: string): void {
    if (this.remainingWords <= 0) return;
    const text = flattenForSpeech(raw, this.remainingWords);
    if (!text) return;
    this.remainingWords -= wordCount(text);
    this.submittedPrefix += raw;
    this.pending.push({ index: this.nextIndex++, text });
    this.pump();
  }

  private pump(): void {
    while (this.activeJobs < MAX_CONCURRENT_SPEECH && this.pending.length > 0) {
      const job = this.pending.shift()!;
      this.activeJobs += 1;
      void this.runJob(this.generation, job);
    }
  }

  private async runJob(generation: number, job: SpeechJob): Promise<void> {
    let stream: SpeechStream | null = null;
    try {
      stream = await speechStream(job.text, this.options);
      if (generation !== this.generation) {
        stream.cancel();
        return;
      }
      this.cancelStreams.add(stream.cancel);
      const chunks: VoicePlayerChunk[] = [];
      for await (const chunk of stream.chunks) {
        if (generation !== this.generation) {
          stream.cancel();
          return;
        }
        chunks.push(chunk);
      }
      if (generation !== this.generation) return;
      this.results.set(job.index, chunks);
      this.drainReady();
    } catch (error) {
      if (generation === this.generation) {
        console.error("[hypercli] read-aloud sentence failed:", error);
        this.results.set(job.index, []);
        this.drainReady();
      }
    } finally {
      if (stream) this.cancelStreams.delete(stream.cancel);
      if (generation === this.generation) {
        this.activeJobs -= 1;
        this.pump();
        this.settleDrainState();
      }
    }
  }

  private drainReady(): void {
    while (this.results.has(this.nextToPlay)) {
      const chunks = this.results.get(this.nextToPlay)!;
      this.results.delete(this.nextToPlay);
      this.nextToPlay += 1;
      if (chunks.length > 0) this.player.enqueue(iterableOf(chunks));
    }
    this.settleDrainState();
  }

  private settleDrainState(): void {
    if (this.state !== "draining") return;
    if (this.pending.length === 0 && this.activeJobs === 0 && this.results.size === 0) this.state = "idle";
  }
}

function* takeCompleteSentences(buffer: string, setBuffer: (value: string) => void): Generator<string> {
  while (true) {
    const index = sentenceBoundary(buffer);
    if (index < 0) {
      if (buffer.length > MAX_BUFFER_CHARS) {
        const split = softBoundary(buffer);
        if (split > 0) {
          const chunk = buffer.slice(0, split).trim();
          buffer = buffer.slice(split).trimStart();
          setBuffer(buffer);
          yield chunk;
          continue;
        }
      }
      setBuffer(buffer);
      return;
    }
    const chunk = buffer.slice(0, index).trim();
    buffer = buffer.slice(index).trimStart();
    setBuffer(buffer);
    if (chunk) yield chunk;
  }
}

function sentenceBoundary(text: string): number {
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char !== "." && char !== "!" && char !== "?") continue;
    const next = text[i + 1];
    if (next === undefined || /\s/.test(next)) return i + 1;
  }
  return -1;
}

function softBoundary(text: string): number {
  const comma = text.lastIndexOf(",");
  if (comma > 80) return comma + 1;
  const space = text.lastIndexOf(" ");
  return space > 80 ? space + 1 : -1;
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

async function* iterableOf(chunks: VoicePlayerChunk[]): AsyncIterable<VoicePlayerChunk> {
  yield* chunks;
}

export const readAloud = new ReadAloudController();
