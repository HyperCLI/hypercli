/**
 * Tests for `hyper voice` (src/commands/voice.ts).
 *
 * Mock seam: CommandContext.client is an injectable lazy factory — tests pass
 * a fake HyperCLI straight through ctx, capturing stdout/stderr via spies.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceAPI, VoiceTranscriptionSession } from '@hypercli.com/sdk';
import type { HyperCLI, VoiceChunkEvent, VoiceTranscriptionEvent } from '@hypercli.com/sdk';
import { WebSocketServer } from 'ws';
import * as voice from '../src/commands/voice.js';
import { exitCodeFor, printError } from '../src/core/errors.js';
import { createOutput } from '../src/core/output.js';
import type { CommandContext } from '../src/core/types.js';

let stdoutSpy: ReturnType<typeof vi.spyOn>;
let stderrSpy: ReturnType<typeof vi.spyOn>;
let stdoutChunks: string[];
let stderrChunks: string[];
const originalFetch = globalThis.fetch;

const stdout = () => stdoutChunks.join('');
const stderr = () => stderrChunks.join('');

beforeEach(() => {
  stdoutChunks = [];
  stderrChunks = [];
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    stdoutChunks.push(String(chunk));
    return true;
  }) as typeof stdoutSpy;
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    stderrChunks.push(String(chunk));
    return true;
  }) as typeof stderrSpy;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  stdoutSpy.mockRestore();
  stderrSpy.mockRestore();
  vi.restoreAllMocks();
});

// ---------- fixtures ----------

function chunkEvent(index: number, total: number, audio: Uint8Array): VoiceChunkEvent {
  return { requestId: 'req_1', index, total, audio, final: index === total - 1 };
}

interface FakeHandlers {
  tts?: (options: { text: string; voice?: string }) => Promise<Uint8Array>;
  ttsStream?: (options: {
    text: string;
    voice?: string;
  }) => AsyncGenerator<VoiceChunkEvent, void, undefined>;
  transcribe?: (options: { audio: Uint8Array; filename?: string; language?: string }) => Promise<{ text: string }>;
  transcribeStream?: (options: {
    audio: Uint8Array;
    filename?: string;
    language?: string;
  }) => AsyncGenerator<VoiceTranscriptionEvent, void, undefined>;
  clone?: (options: { text: string; refAudio: Uint8Array | ArrayBuffer }) => Promise<Uint8Array>;
}

function fakeClient(handlers: FakeHandlers = {}): HyperCLI {
  return {
    voice: {
      tts: handlers.tts ?? (async () => new Uint8Array([1, 2, 3, 4, 5])),
      ttsStream:
        handlers.ttsStream ??
        (async function* () {
          yield chunkEvent(0, 1, new Uint8Array([1, 2, 3]));
        }),
      transcribe: handlers.transcribe ?? (async () => ({ text: 'hello transcript' })),
      transcribeStream:
        handlers.transcribeStream ??
        (async function* () {
          yield { type: 'transcript.final', text: 'stream transcript' };
        }),
      clone: handlers.clone ?? (async () => new Uint8Array([8, 9])),
    },
  } as unknown as HyperCLI;
}

function makeCtx(client: HyperCLI, format: 'table' | 'json'): CommandContext {
  return {
    client: vi.fn(async () => client),
    output: createOutput(format),
    format,
    dev: false,
  };
}

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'hyper-voice-test-'));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

// ---------- tests ----------

describe('hyper voice', () => {
  it('tts: writes the audio file to --out and reports path + bytes', async () => {
    const audio = new Uint8Array([0xff, 0xfb, 0x90, 0x44, 0x00, 0x11, 0x22]);
    const tts = vi.fn(async () => audio);
    const ttsStream = vi.fn(fakeClient().voice.ttsStream as never);
    const client = fakeClient({ tts });
    const ctx = makeCtx(client, 'json');
    const outFile = join(workDir, 'hello.mp3');

    await voice.run(ctx, ['tts', 'hello world', '--out', outFile, '--json']);

    expect(tts).toHaveBeenCalledWith({ text: 'hello world', voice: 'serena' });
    expect(ttsStream).not.toHaveBeenCalled();
    const onDisk = await readFile(outFile);
    expect(onDisk).toEqual(Buffer.from(audio));
    const payload = JSON.parse(stdout());
    expect(payload.out).toBe(outFile);
    expect(payload.voice).toBe('serena');
    expect(payload.bytes).toBe(audio.byteLength);
    expect(payload.text).toBe('hello world');
    expect(payload.stream).toBe(false);
    expect(stderr()).toContain(outFile);
    expect(stderr()).toContain(String(audio.byteLength));
  });

  it('tts: table mode stdout gets the {out, voice, bytes} record', async () => {
    const client = fakeClient({ tts: async () => new Uint8Array(10) });
    const ctx = makeCtx(client, 'table');
    const outFile = join(workDir, 'a.mp3');

    await voice.run(ctx, ['tts', 'hi', '--out', outFile, '--voice', 'ivy']);

    const out = stdout();
    expect(out).toContain(outFile);
    expect(out).toContain('ivy');
    expect(out).toContain('10');
    expect(out).not.toContain('hi\n');
  });

  it('tts --stream: consumes the chunk generator and concatenates audio', async () => {
    const tts = vi.fn(async () => new Uint8Array([9]));
    const ttsStream = vi.fn(async function* () {
      yield chunkEvent(0, 3, new Uint8Array([1, 2]));
      yield chunkEvent(1, 3, new Uint8Array([]));
      yield chunkEvent(2, 3, new Uint8Array([3, 4, 5]));
    });
    const client = fakeClient({ tts, ttsStream: ttsStream as never });
    const ctx = makeCtx(client, 'json');
    const outFile = join(workDir, 'stream.mp3');

    await voice.run(ctx, ['tts', 'stream me', '--out', outFile, '--stream', '--json']);

    expect(ttsStream).toHaveBeenCalledWith({ text: 'stream me', voice: 'serena' });
    expect(tts).not.toHaveBeenCalled();
    const onDisk = await readFile(outFile);
    expect(onDisk).toEqual(Buffer.from([1, 2, 3, 4, 5]));
    const payload = JSON.parse(stdout());
    expect(payload.bytes).toBe(5);
    expect(payload.stream).toBe(true);
  });

  it('tts: missing text -> UsageError (exit 2)', async () => {
    const client = fakeClient();
    const ctx = makeCtx(client, 'table');

    const err: unknown = await voice.run(ctx, ['tts']).then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeTruthy();
    expect(exitCodeFor(err)).toBe(2);
    expect(ctx.client).not.toHaveBeenCalled();
  });

  it('clone --file --out: reads reference audio and saves cloned audio', async () => {
    const refFile = join(workDir, 'ref.wav');
    const outFile = join(workDir, 'clone.mp3');
    await writeFile(refFile, Buffer.from('reference-audio'));
    const cloned = new Uint8Array([3, 4, 5]);
    const clone = vi.fn(async () => cloned);
    const client = fakeClient({ clone });
    const ctx = makeCtx(client, 'json');

    await voice.run(ctx, ['clone', 'hello clone', '--file', refFile, '--out', outFile, '--json']);

    expect(clone).toHaveBeenCalledWith({
      text: 'hello clone',
      refAudio: Buffer.from('reference-audio'),
    });
    expect(await readFile(outFile)).toEqual(Buffer.from(cloned));
    const payload = JSON.parse(stdout());
    expect(payload.out).toBe(outFile);
    expect(payload.source).toBe(refFile);
    expect(payload.bytes).toBe(cloned.byteLength);
    expect(payload.text).toBe('hello clone');
  });

  it('clone --url without --out: fetches reference audio and writes audio bytes to stdout', async () => {
    globalThis.fetch = vi.fn(async () => new Response(Buffer.from('remote-reference'))) as typeof fetch;
    const cloned = Buffer.from('cloned-audio');
    const clone = vi.fn(async () => cloned);
    const client = fakeClient({ clone });
    const ctx = makeCtx(client, 'table');

    await voice.run(ctx, ['clone', 'hello', '--url', 'https://example.test/ref.wav']);

    expect(globalThis.fetch).toHaveBeenCalledWith('https://example.test/ref.wav', expect.objectContaining({
      redirect: 'manual',
      signal: expect.any(AbortSignal),
    }));
    expect(clone).toHaveBeenCalledWith({
      text: 'hello',
      refAudio: Buffer.from('remote-reference'),
    });
    expect(stdout()).toBe('cloned-audio');
  });

  it('clone: requires exactly one reference source', async () => {
    const ctx = makeCtx(fakeClient(), 'table');

    const err: unknown = await voice.run(ctx, ['clone', 'hello']).then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeTruthy();
    expect(exitCodeFor(err)).toBe(2);
    expect(ctx.client).not.toHaveBeenCalled();
  });

  it('clone --url: rejects non-HTTPS and local/private/reserved IP literals before API use', async () => {
    const ctx = makeCtx(fakeClient(), 'table');

    for (const url of [
      'http://example.test/ref.wav',
      'https://localhost/ref.wav',
      'https://127.0.0.1/ref.wav',
      'https://10.0.0.1/ref.wav',
      'https://169.254.1.1/ref.wav',
      'https://192.0.2.1/ref.wav',
      'https://[::1]/ref.wav',
      'https://[fe80::1]/ref.wav',
      'https://[2001:db8::1]/ref.wav',
    ]) {
      const err: unknown = await voice.run(ctx, ['clone', 'hello', '--url', url]).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err, url).toBeTruthy();
      expect(exitCodeFor(err), url).toBe(2);
    }
    expect(ctx.client).not.toHaveBeenCalled();
  });

  it('clone --url: enforces max reference size from content-length', async () => {
    globalThis.fetch = vi.fn(async () => new Response(null, {
      headers: { 'content-length': String(25 * 1024 * 1024 + 1) },
    })) as typeof fetch;
    const ctx = makeCtx(fakeClient(), 'table');

    const err: unknown = await voice.run(ctx, ['clone', 'hello', '--url', 'https://example.test/ref.wav']).then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeTruthy();
    expect(exitCodeFor(err)).toBe(1);
    expect(ctx.client).not.toHaveBeenCalled();
  });

  it('clone --file: enforces max reference size before API use', async () => {
    const refFile = join(workDir, 'large.wav');
    await writeFile(refFile, Buffer.alloc(25 * 1024 * 1024 + 1));
    const ctx = makeCtx(fakeClient(), 'table');

    const err: unknown = await voice.run(ctx, ['clone', 'hello', '--file', refFile]).then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeTruthy();
    expect(exitCodeFor(err)).toBe(1);
    expect(ctx.client).not.toHaveBeenCalled();
  });

  it('transcribe --rest: uses REST, prints text, and passes file metadata', async () => {
    const audio = Buffer.from([1, 2, 3]);
    const audioFile = join(workDir, 'speech.wav');
    await writeFile(audioFile, audio);
    const transcribe = vi.fn(async () => ({ text: 'hello world' }));
    const client = fakeClient({ transcribe: transcribe as never });
    const ctx = makeCtx(client, 'table');

    await voice.run(ctx, ['transcribe', audioFile, '--language', 'en', '--rest']);

    expect(transcribe).toHaveBeenCalledWith({
      audio,
      filename: 'speech.wav',
      language: 'en',
    });
    expect(stdout()).toBe('hello world\n');
  });

  it('transcribe --rest: real SDK path posts to /voice/transcribe', async () => {
    const audioFile = join(workDir, 'speech.wav');
    await writeFile(audioFile, Buffer.from([1, 2, 3]));
    let receivedUrl = '';
    let receivedForm: FormData | undefined;
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      receivedUrl = String(url);
      receivedForm = init?.body as FormData;
      return new Response(JSON.stringify({ text: 'routed transcript' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    const client = {
      voice: new VoiceAPI({ base: 'https://api.test/agents', credential: 'hyper_api_test' } as never),
    } as unknown as HyperCLI;
    const ctx = makeCtx(client, 'table');

    await voice.run(ctx, ['transcribe', audioFile, '--language', 'en', '--rest']);

    expect(receivedUrl).toBe('https://api.test/agents/voice/transcribe');
    expect(receivedForm?.get('language')).toBe('en');
    expect((receivedForm?.get('file') as Blob).size).toBe(3);
    expect(stdout()).toBe('routed transcript\n');
  });

  it('transcribe --out --json: writes transcript and emits JSON metadata', async () => {
    const audioFile = join(workDir, 'speech.wav');
    const outFile = join(workDir, 'transcript.txt');
    await writeFile(audioFile, Buffer.from([1]));
    const client = fakeClient({ transcribe: async () => ({ text: 'saved text' }) });
    const ctx = makeCtx(client, 'json');

    await voice.run(ctx, ['transcribe', audioFile, '--out', outFile, '--json', '--rest']);

    expect(await readFile(outFile, 'utf8')).toBe('saved text');
    const payload = JSON.parse(stdout());
    expect(payload.text).toBe('saved text');
    expect(payload.out).toBe(outFile);
    expect(payload.stream).toBe(false);
  });

  it('transcribe: defaults to WS and collects transcript.final', async () => {
    const audioFile = join(workDir, 'speech.wav');
    await writeFile(audioFile, Buffer.from([4, 5]));
    const transcribe = vi.fn(async () => ({ text: 'rest' }));
    const transcribeStream = vi.fn(async function* () {
      yield { type: 'transcript.delta', text: 'partial', delta: 'partial' };
      yield { type: 'transcript.final', text: 'final text' };
    });
    const client = fakeClient({ transcribe: transcribe as never, transcribeStream: transcribeStream as never });
    const ctx = makeCtx(client, 'table');

    await voice.run(ctx, ['transcribe', audioFile]);

    expect(transcribeStream).toHaveBeenCalledWith({
      audio: Buffer.from([4, 5]),
      language: undefined,
    });
    expect(transcribe).not.toHaveBeenCalled();
    expect(stdout()).toBe('final text\n');
  });

  it('transcribe: default real SDK path connects to /ws/voice/transcribe', async () => {
    const audioFile = join(workDir, 'speech.wav');
    await writeFile(audioFile, Buffer.from([4, 5]));
    const server = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => server.on('listening', () => resolve()));
    const address = server.address();
    const wsUrl = `ws://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/ws`;
    let requestUrl = '';
    const received: Buffer[] = [];
    server.on('connection', (ws, request) => {
      requestUrl = request.url ?? '';
      ws.send(JSON.stringify({ event: 'ready' }));
      ws.on('message', (raw) => {
        const value = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
        received.push(value);
        let message: Record<string, unknown> = {};
        try {
          message = JSON.parse(value.toString()) as Record<string, unknown>;
        } catch {
          // binary audio frame
        }
        if (message.event === 'commit') {
          ws.send(JSON.stringify({ event: 'transcript.final', text: 'ws routed transcript' }));
        }
      });
    });
    const session = new VoiceTranscriptionSession({ wsUrl, credential: 'hyper_api_test', language: 'en' });
    const client = {
      voice: {
        transcribeStream: async function* (options: { audio: Uint8Array; language?: string }) {
          await session.open();
          yield* session.transcribe(options.audio);
        },
      },
    } as unknown as HyperCLI;
    const ctx = makeCtx(client, 'table');

    try {
      await voice.run(ctx, ['transcribe', audioFile, '--language', 'en']);
    } finally {
      session.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    expect(requestUrl.startsWith('/ws/voice/transcribe?')).toBe(true);
    expect(new URLSearchParams(requestUrl.split('?')[1]).get('language')).toBe('en');
    expect(received[0]).toEqual(Buffer.from([4, 5]));
    expect(JSON.parse(received[1].toString())).toEqual({ event: 'commit' });
    expect(stdout()).toBe('ws routed transcript\n');
  });

  it('tts: SDK failure -> CliError (exit 1), no file written', async () => {
    const client = fakeClient({
      tts: async () => {
        throw new Error('voice backend exploded');
      },
    });
    const ctx = makeCtx(client, 'json');

    const err: unknown = await voice
      .run(ctx, ['tts', 'boom', '--out', join(workDir, 'x.mp3'), '--json'])
      .then(
        () => null,
        (e: unknown) => e,
      );

    expect(err).toBeTruthy();
    expect(exitCodeFor(err)).toBe(1);
    printError(err);
    expect(stderr()).toContain('voice backend exploded');
    expect(stdout()).toBe('');
  });

  it('--help prints help without touching the API', async () => {
    const client = fakeClient();
    const ctx = makeCtx(client, 'table');

    await voice.run(ctx, ['--help']);

    expect(ctx.client).not.toHaveBeenCalled();
    expect(stdout()).toContain('hyper voice');
    expect(stdout()).toContain('tts');
  });

  it('unknown subcommand -> UsageError (exit 2)', async () => {
    const ctx = makeCtx(fakeClient(), 'table');

    const err: unknown = await voice.run(ctx, ['bogus']).then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeTruthy();
    expect(exitCodeFor(err)).toBe(2);
  });
});
