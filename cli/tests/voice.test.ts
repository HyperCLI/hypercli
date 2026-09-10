/**
 * Tests for `hyper voice` (src/commands/voice.ts).
 *
 * Mock seam: CommandContext.client is an injectable lazy factory — tests pass
 * a fake HyperCLI straight through ctx, capturing stdout/stderr via spies.
 */

import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HyperCLI, VoiceChunkEvent } from '@hypercli.com/sdk';
import * as voice from '../src/commands/voice.js';
import { exitCodeFor, printError } from '../src/core/errors.js';
import { createOutput } from '../src/core/output.js';
import type { CommandContext } from '../src/core/types.js';

let stdoutSpy: ReturnType<typeof vi.spyOn>;
let stderrSpy: ReturnType<typeof vi.spyOn>;
let stdoutChunks: string[];
let stderrChunks: string[];

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
  stdoutSpy.mockRestore();
  stderrSpy.mockRestore();
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
    expect(payload.file).toBe(outFile);
    expect(payload.voice).toBe('serena');
    expect(payload.bytes).toBe(audio.byteLength);
    expect(payload.text).toBe('hello world');
    expect(payload.stream).toBe(false);
    expect(stderr()).toContain(outFile);
    expect(stderr()).toContain(String(audio.byteLength));
  });

  it('tts: table mode stdout gets the {file, voice, bytes} record', async () => {
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
    expect(stdout()).toContain('transcribe');
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

// ---------- transcribe (local faster-whisper bridge) ----------

const BRIDGE_TRANSCRIPT = {
  language: 'en',
  language_probability: 0.99,
  duration: 2.5,
  segments: [{ start: 0, end: 2.5, text: 'hello this is a smoke test' }],
  text: 'hello this is a smoke test',
};

/**
 * Fake "python with faster-whisper": echoes the bridge argv into
 * CAPTURE_FILE and prints the canned transcript JSON.
 */
async function writeFakePython(
  dir: string,
  body: string,
): Promise<string> {
  await mkdir(dir, { recursive: true });
  const bin = join(dir, 'fake-python');
  await writeFile(bin, `#!/bin/sh\n${body}\n`, 'utf8');
  await chmod(bin, 0o755);
  return bin;
}

describe('hyper voice transcribe', () => {
  let audioFile: string;
  let savedPython: string | undefined;

  beforeEach(async () => {
    savedPython = process.env.HYPER_VOICE_PYTHON;
    audioFile = join(workDir, 'voice.ogg');
    await writeFile(audioFile, Buffer.from([0x4f, 0x67, 0x67, 0x53]));
  });

  afterEach(() => {
    if (savedPython === undefined) {
      delete process.env.HYPER_VOICE_PYTHON;
    } else {
      process.env.HYPER_VOICE_PYTHON = savedPython;
    }
    delete process.env.CAPTURE_FILE;
  });

  it('prints the plain transcript on stdout in table mode', async () => {
    process.env.HYPER_VOICE_PYTHON = await writeFakePython(
      join(workDir, 'bin'),
      `printf '%s' "$@" > "$CAPTURE_FILE"\nprintf '%s\\n' '${JSON.stringify(BRIDGE_TRANSCRIPT)}'`,
    );
    const captureFile = join(workDir, 'argv.txt');
    process.env.CAPTURE_FILE = captureFile;
    const ctx = makeCtx(fakeClient(), 'table');

    await voice.run(ctx, ['transcribe', audioFile, '--model', 'tiny', '--language', 'en']);

    expect(stdout()).toContain('hello this is a smoke test');
    const bridgeArgv = await readFile(captureFile, 'utf8');
    // [python-ish args] = -c, <script>, <file>, <model>, <language>, <device>, <compute>
    expect(bridgeArgv).toContain(audioFile);
    expect(bridgeArgv).toContain('tiny');
    expect(bridgeArgv).toContain('en');
    expect(bridgeArgv).toContain('-c');
    expect(ctx.client).not.toHaveBeenCalled();
  });

  it('--json prints the transcript object (language, segments, text)', async () => {
    process.env.HYPER_VOICE_PYTHON = await writeFakePython(
      join(workDir, 'bin'),
      `printf '%s\\n' '${JSON.stringify(BRIDGE_TRANSCRIPT)}'`,
    );
    const ctx = makeCtx(fakeClient(), 'json');

    await voice.run(ctx, ['transcribe', audioFile, '-m', 'tiny', '-l', 'en', '--json']);

    const payload = JSON.parse(stdout());
    expect(payload.language).toBe('en');
    expect(payload.language_probability).toBe(0.99);
    expect(payload.duration).toBe(2.5);
    expect(payload.segments).toHaveLength(1);
    expect(payload.text).toBe('hello this is a smoke test');
  });

  it('--out writes the transcript to a file and keeps text off stdout', async () => {
    process.env.HYPER_VOICE_PYTHON = await writeFakePython(
      join(workDir, 'bin'),
      `printf '%s\\n' '${JSON.stringify(BRIDGE_TRANSCRIPT)}'`,
    );
    const ctx = makeCtx(fakeClient(), 'table');
    const outFile = join(workDir, 'transcript.txt');

    await voice.run(ctx, ['transcribe', audioFile, '--out', outFile]);

    expect((await readFile(outFile, 'utf8')).trim()).toBe('hello this is a smoke test');
    expect(stdout()).toBe('');
    expect(stderr()).toContain(outFile);
  });

  it('--out with --json writes the JSON shape to the file', async () => {
    process.env.HYPER_VOICE_PYTHON = await writeFakePython(
      join(workDir, 'bin'),
      `printf '%s\\n' '${JSON.stringify(BRIDGE_TRANSCRIPT)}'`,
    );
    const ctx = makeCtx(fakeClient(), 'json');
    const outFile = join(workDir, 'transcript.json');

    await voice.run(ctx, ['transcribe', audioFile, '--out', outFile, '--json']);

    const onDisk = JSON.parse((await readFile(outFile, 'utf8')).trim());
    expect(onDisk.text).toBe('hello this is a smoke test');
    expect(onDisk.segments[0].text).toBe('hello this is a smoke test');
  });

  it('missing audio file -> CliError (exit 1) without spawning the bridge', async () => {
    process.env.HYPER_VOICE_PYTHON = 'definitely-not-a-real-python';
    const ctx = makeCtx(fakeClient(), 'table');

    const err: unknown = await voice
      .run(ctx, ['transcribe', join(workDir, 'nope.wav')])
      .then(
        () => null,
        (e: unknown) => e,
      );

    expect(err).toBeTruthy();
    expect(exitCodeFor(err)).toBe(1);
    printError(err);
    expect(stderr()).toContain('file not found');
    expect(stdout()).toBe('');
  });

  it('missing faster-whisper -> CliError (exit 1) with install hint', async () => {
    process.env.HYPER_VOICE_PYTHON = await writeFakePython(
      join(workDir, 'bin'),
      "echo \"faster-whisper not installed. Install with: pip install 'hypercli-cli[stt]'\" >&2\nexit 3",
    );
    const ctx = makeCtx(fakeClient(), 'table');

    const err: unknown = await voice.run(ctx, ['transcribe', audioFile]).then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeTruthy();
    expect(exitCodeFor(err)).toBe(1);
    printError(err);
    expect(stderr()).toContain('faster-whisper not installed');
    expect(stderr()).toContain("pip install 'hypercli-cli[stt]'");
    expect(stdout()).toBe('');
  });

  it('interpreter not found -> CliError (exit 1) naming the interpreter', async () => {
    process.env.HYPER_VOICE_PYTHON = join(workDir, 'no-such-python');
    const ctx = makeCtx(fakeClient(), 'table');

    const err: unknown = await voice.run(ctx, ['transcribe', audioFile]).then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeTruthy();
    expect(exitCodeFor(err)).toBe(1);
    printError(err);
    expect(stderr()).toContain('no-such-python');
    expect(stderr()).toContain('HYPER_VOICE_PYTHON');
  });

  it('bridge crash -> CliError (exit 1)', async () => {
    process.env.HYPER_VOICE_PYTHON = await writeFakePython(
      join(workDir, 'bin'),
      'echo boom >&2\nexit 1',
    );
    const ctx = makeCtx(fakeClient(), 'json');

    const err: unknown = await voice.run(ctx, ['transcribe', audioFile, '--json']).then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeTruthy();
    expect(exitCodeFor(err)).toBe(1);
    expect(stdout()).toBe('');
  });

  it('missing file argument -> UsageError (exit 2), no bridge spawned', async () => {
    process.env.HYPER_VOICE_PYTHON = 'definitely-not-a-real-python';
    const ctx = makeCtx(fakeClient(), 'table');

    const err: unknown = await voice.run(ctx, ['transcribe']).then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeTruthy();
    expect(exitCodeFor(err)).toBe(2);
    expect(ctx.client).not.toHaveBeenCalled();
  });
});
