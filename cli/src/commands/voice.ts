/**
 * `hyper voice` — voice capability API.
 *
 *   hyper voice tts "hello"                  one-shot TTS (POST /voice/tts)
 *   hyper voice clone "hello" --file ref.wav clone a voice from reference audio over /ws/voice
 *   hyper voice tts "hello" --stream         streaming TTS over /ws/voice
 *   hyper voice transcribe audio.wav         speech-to-text over /ws/voice/transcribe
 *   hyper voice transcribe audio.wav --rest  one-shot STT (POST /voice/transcribe)
 *
 * Generation goes through the remote voice API. Audio is written with
 * node:fs/promises; stdout stays machine-usable.
 */

import { readFile, stat, writeFile } from 'node:fs/promises';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { basename, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { APIError } from '@hypercli.com/sdk';
import type { VoiceChunkEvent, VoiceTranscriptionEvent } from '@hypercli.com/sdk';
import { parseCommandArgs } from '../core/argv.js';
import { CliError, UsageError } from '../core/errors.js';
import { renderGroupHelp } from '../core/help.js';
import type { CommandContext } from '../core/types.js';

export const name = 'voice';
export const summary = 'Text-to-speech and transcription via the voice capability API.';
export const usage = [
  'hyper voice tts <text> [--out file.mp3] [--voice V] [--stream] [--json]',
  'hyper voice clone <text> (--file audio | --url audio-url) [--out file.mp3] [--rest] [--json]',
  'hyper voice transcribe <audio-file> [--language en] [--out transcript.txt] [--rest] [--json]',
];

const DEFAULT_VOICE = 'serena';
const MAX_REFERENCE_AUDIO_BYTES = 25 * 1024 * 1024;
const REFERENCE_AUDIO_TIMEOUT_MS = 30_000;

const TTS_OPTIONS = {
  out: { type: 'string' },
  voice: { type: 'string' },
  stream: { type: 'boolean', default: false },
} as const;

const CLONE_OPTIONS = {
  file: { type: 'string' },
  url: { type: 'string' },
  out: { type: 'string' },
  rest: { type: 'boolean', default: false },
} as const;

const TRANSCRIBE_OPTIONS = {
  language: { type: 'string' },
  out: { type: 'string' },
  rest: { type: 'boolean', default: false },
} as const;

function describeError(err: unknown): string {
  if (err instanceof APIError) return `${err.statusCode}: ${err.detail}`;
  return err instanceof Error ? err.message : String(err);
}

/** Consume the ttsStream chunk generator into one buffer, in order. */
async function collectStream(
  chunks: AsyncGenerator<VoiceChunkEvent, void, undefined>,
): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const chunk of chunks) {
    if (chunk.audio && chunk.audio.byteLength > 0) parts.push(Buffer.from(chunk.audio));
  }
  return Buffer.concat(parts);
}

async function collectTranscript(
  events: AsyncGenerator<VoiceTranscriptionEvent, void, undefined>,
): Promise<string> {
  let text = '';
  for await (const event of events) {
    if (event.type === 'transcript.final') return event.text;
    if (event.type === 'transcript.delta') text += event.delta || event.text;
  }
  return text;
}

function validateReferenceUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new UsageError('voice clone --url must be a valid HTTPS URL');
  }
  if (parsed.protocol !== 'https:') {
    throw new UsageError('voice clone --url only accepts HTTPS URLs');
  }
  const host = parsed.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) {
    throw new UsageError('voice clone --url cannot target localhost');
  }
  if (isBlockedIpLiteral(host)) {
    throw new UsageError('voice clone --url cannot target private, local, or reserved IP addresses');
  }
  return parsed;
}

function ipv4ToNumber(host: string): number | undefined {
  const parts = host.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return undefined;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function ipv6ToBigInt(host: string): bigint | undefined {
  const value = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (!isIP(value)) return undefined;
  if (value.includes('.')) return undefined;
  const halves = value.split('::');
  if (halves.length > 2) return undefined;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const fill = 8 - left.length - right.length;
  if (fill < 0 || (halves.length === 1 && fill !== 0)) return undefined;
  const groups = [...left, ...Array(fill).fill('0'), ...right];
  return groups.reduce((acc, group) => (acc << 16n) + BigInt(parseInt(group || '0', 16)), 0n);
}

function inRange(value: number, base: number, bits: number): boolean {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (value & mask) === (base & mask);
}

function inRange6(value: bigint, base: bigint, bits: number): boolean {
  const mask = ((1n << BigInt(bits)) - 1n) << BigInt(128 - bits);
  return (value & mask) === (base & mask);
}

function isBlockedIpLiteral(host: string): boolean {
  const unbracketed = host.replace(/^\[|\]$/g, '');
  const family = isIP(unbracketed);
  if (family === 4) {
    const value = ipv4ToNumber(unbracketed);
    if (value === undefined) return true;
    return [
      ['0.0.0.0', 8],
      ['10.0.0.0', 8],
      ['100.64.0.0', 10],
      ['127.0.0.0', 8],
      ['169.254.0.0', 16],
      ['172.16.0.0', 12],
      ['192.0.0.0', 24],
      ['192.0.2.0', 24],
      ['192.168.0.0', 16],
      ['198.18.0.0', 15],
      ['198.51.100.0', 24],
      ['203.0.113.0', 24],
      ['224.0.0.0', 4],
      ['240.0.0.0', 4],
    ].some(([base, bits]) => inRange(value, ipv4ToNumber(base as string)!, bits as number));
  }
  if (family === 6) {
    const value = ipv6ToBigInt(unbracketed);
    if (value === undefined) return true;
    return value === 0n || value === 1n || [
      ['fc00::', 7],
      ['fe80::', 10],
      ['ff00::', 8],
      ['2001:db8::', 32],
    ].some(([base, bits]) => inRange6(value, ipv6ToBigInt(base as string)!, bits as number));
  }
  return false;
}

async function assertSafeResolvedHost(host: string): Promise<void> {
  const unbracketed = host.replace(/^\[|\]$/g, '');
  if (isIP(unbracketed)) return;
  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(host, { all: true, verbatim: true }) as Array<{ address: string }>;
  } catch {
    return;
  }
  if (addresses.some((address) => isBlockedIpLiteral(address.address))) {
    throw new UsageError('voice clone --url cannot resolve to private, local, or reserved IP addresses');
  }
}

async function readUrlBytes(url: string): Promise<Buffer> {
  const parsed = validateReferenceUrl(url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REFERENCE_AUDIO_TIMEOUT_MS);
  let response: Response | undefined;
  let current = parsed;
  try {
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      await assertSafeResolvedHost(current.hostname);
      response = await fetch(current.href, { signal: controller.signal, redirect: 'manual' });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get('location');
      if (!location) break;
      current = validateReferenceUrl(new URL(location, current).href);
    }
    if (!response) throw new CliError('failed to fetch reference audio');
    if (!response.ok) {
      throw new CliError(`failed to fetch reference audio: ${response.status} ${response.statusText}`);
    }
    const contentLength = response.headers.get('content-length');
    const contentLengthBytes = contentLength ? Number(contentLength) : undefined;
    if (contentLengthBytes !== undefined && (!Number.isFinite(contentLengthBytes) || contentLengthBytes > MAX_REFERENCE_AUDIO_BYTES)) {
      throw new CliError(`reference audio exceeds ${MAX_REFERENCE_AUDIO_BYTES} bytes`);
    }
    const reader = response.body?.getReader();
    if (!reader) return Buffer.from(await response.arrayBuffer());
    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_REFERENCE_AUDIO_BYTES) {
        throw new CliError(`reference audio exceeds ${MAX_REFERENCE_AUDIO_BYTES} bytes`);
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, total);
  } catch (err) {
    if (err instanceof CliError || err instanceof UsageError) throw err;
    throw new CliError(`failed to fetch reference audio: ${describeError(err)}`);
  } finally {
    clearTimeout(timeout);
  }
}

async function readReferenceFile(file: string): Promise<Buffer> {
  const info = await stat(file);
  if (info.size > MAX_REFERENCE_AUDIO_BYTES) {
    throw new CliError(`reference audio exceeds ${MAX_REFERENCE_AUDIO_BYTES} bytes`);
  }
  const bytes = await readFile(file);
  if (bytes.byteLength > MAX_REFERENCE_AUDIO_BYTES) {
    throw new CliError(`reference audio exceeds ${MAX_REFERENCE_AUDIO_BYTES} bytes`);
  }
  return bytes;
}

// ---------- tts (remote voice API) ----------

async function tts(ctx: CommandContext, args: string[]): Promise<void> {
  const parsed = parseCommandArgs(args, TTS_OPTIONS);
  if (parsed.help) {
    process.stdout.write(`${renderGroupHelp({ name, summary, usage, run })}\n`);
    return;
  }

  const [text, ...rest] = parsed.positionals;
  if (!text || rest.length > 0) {
    throw new UsageError(`usage: ${usage[0]}`);
  }
  const voice = typeof parsed.values.voice === 'string' ? parsed.values.voice : DEFAULT_VOICE;
  const stream = parsed.values.stream === true;
  const outArg = typeof parsed.values.out === 'string' ? parsed.values.out : undefined;
  const file = resolve(outArg ?? `tts-${Date.now()}.mp3`);

  const client = await ctx.client();
  let bytes: Uint8Array;
  try {
    bytes = stream
      ? await collectStream(client.voice.ttsStream({ text, voice }))
      : await client.voice.tts({ text, voice });
  } catch (err) {
    throw new CliError(`tts failed: ${describeError(err)}`);
  }

  await writeFile(file, bytes);
  ctx.output.info(`saved ${file} (${bytes.byteLength} bytes)`);

  const record: Record<string, unknown> = { out: file, voice, bytes: bytes.byteLength };
  const data =
    ctx.format === 'json' ? { ...record, text, stream, format: 'mp3' } : record;
  ctx.output.result(data, {
    columns: ['OUT', 'VOICE', 'BYTES'],
    rows: [[file, voice, String(bytes.byteLength)]],
  });
}

async function clone(ctx: CommandContext, args: string[]): Promise<void> {
  const parsed = parseCommandArgs(args, CLONE_OPTIONS);
  if (parsed.help) {
    process.stdout.write(`${renderGroupHelp({ name, summary, usage, run })}\n`);
    return;
  }

  const [text, ...rest] = parsed.positionals;
  if (!text || rest.length > 0) {
    throw new UsageError(`usage: ${usage[1]}`);
  }
  const fileArg = typeof parsed.values.file === 'string' ? parsed.values.file : undefined;
  const urlArg = typeof parsed.values.url === 'string' ? parsed.values.url : undefined;
  if ((fileArg ? 1 : 0) + (urlArg ? 1 : 0) !== 1) {
    throw new UsageError('voice clone requires exactly one of --file or --url');
  }
  const outArg = typeof parsed.values.out === 'string' ? parsed.values.out : undefined;
  if (!outArg && ctx.format === 'json') {
    throw new UsageError('voice clone --json requires --out');
  }

  const source = fileArg ? resolve(fileArg) : urlArg!;
  const refAudio = fileArg ? await readReferenceFile(source) : await readUrlBytes(source);
  const client = await ctx.client();
  const stream = parsed.values.rest !== true;
  let bytes: Uint8Array;
  try {
    bytes = stream
      ? await collectStream(client.voice.cloneStream({ text, refAudio }))
      : await client.voice.clone({ text, refAudio });
  } catch (err) {
    throw new CliError(`clone failed: ${describeError(err)}`);
  }

  if (!outArg) {
    process.stdout.write(Buffer.from(bytes));
    return;
  }

  const outFile = resolve(outArg);
  await writeFile(outFile, bytes);
  ctx.output.info(`saved ${outFile} (${bytes.byteLength} bytes)`);
  const record = { out: outFile, source, bytes: bytes.byteLength };
  ctx.output.result(ctx.format === 'json' ? { ...record, text, stream, format: 'mp3' } : record, {
    columns: ['OUT', 'SOURCE', 'BYTES'],
    rows: [[outFile, source, String(bytes.byteLength)]],
  });
}

async function transcribe(ctx: CommandContext, args: string[]): Promise<void> {
  const parsed = parseCommandArgs(args, TRANSCRIBE_OPTIONS);
  if (parsed.help) {
    process.stdout.write(`${renderGroupHelp({ name, summary, usage, run })}\n`);
    return;
  }

  const [audioFile, ...rest] = parsed.positionals;
  if (!audioFile || rest.length > 0) {
    throw new UsageError(`usage: ${usage[2]}`);
  }
  const language = typeof parsed.values.language === 'string' ? parsed.values.language : undefined;
  const useRest = parsed.values.rest === true;
  const stream = !useRest;
  const outArg = typeof parsed.values.out === 'string' ? parsed.values.out : undefined;
  const file = resolve(audioFile);
  const outFile = outArg ? resolve(outArg) : undefined;

  const audio = await readFile(file);
  const client = await ctx.client();
  let text: string;
  try {
    if (stream) {
      text = await collectTranscript(client.voice.transcribeStream({
        audio,
        language,
      }));
    } else {
      const result = await client.voice.transcribe({
        audio,
        filename: basename(file),
        language,
      });
      text = result.text;
    }
  } catch (err) {
    throw new CliError(`transcribe failed: ${describeError(err)}`);
  }

  if (outFile) {
    await writeFile(outFile, text, 'utf8');
    ctx.output.info(`saved ${outFile} (${text.length} chars)`);
  }

  const record: Record<string, unknown> = { text, file, out: outFile, language, stream };
  if (outFile) {
    ctx.output.result(record, {
      columns: ['FILE', 'OUT', 'CHARS'],
      rows: [[file, outFile, String(text.length)]],
    });
  } else {
    ctx.output.result(record, text);
  }
}

export async function run(ctx: CommandContext, args: string[]): Promise<void> {
  // Non-strict pre-scan with the union of subcommand flags: --help routes to
  // group help regardless of position, strict errors stay in the subcommand.
  const pre = parseUniversalGroup(args);
  if (pre.help || pre.positionals.length === 0) {
    process.stdout.write(`${renderGroupHelp({ name, summary, usage, run })}\n`);
    return;
  }
  const [sub] = pre.positionals;
  // Hand the subcommand its own argv (original args minus the sub token)
  // so flags survive strict re-parsing inside the subcommand.
  const subArgs = [...args];
  subArgs.splice(args.indexOf(sub), 1);
  switch (sub) {
    case 'tts':
      return tts(ctx, subArgs);
    case 'clone':
      return clone(ctx, subArgs);
    case 'transcribe':
      return transcribe(ctx, subArgs);
    default:
      throw new UsageError(`unknown voice command '${sub}'\nusage: ${usage.join('\n       ')}`);
  }
}

/** Loose scan over the union of all subcommand flags (never throws). */
function parseUniversalGroup(args: string[]): {
  help: boolean;
  positionals: string[];
} {
  const parsed = parseArgs({
    args,
    options: {
      json: { type: 'boolean' },
      output: { type: 'string', short: 'o' },
      dev: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      out: { type: 'string' },
      file: { type: 'string' },
      url: { type: 'string' },
      voice: { type: 'string' },
      language: { type: 'string' },
      rest: { type: 'boolean' },
      stream: { type: 'boolean' },
    },
    strict: false,
    allowPositionals: true,
  });
  return {
    help: parsed.values.help === true,
    positionals: parsed.positionals,
  };
}
