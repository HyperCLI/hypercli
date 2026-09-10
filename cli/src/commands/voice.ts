/**
 * `hyper voice` — text-to-speech via the voice capability API.
 *
 *   hyper voice tts "hello"                  one-shot TTS (POST /voice/tts)
 *   hyper voice tts "hello" --stream         streaming TTS over /ws/voice
 *
 * Generation goes through the remote voice API. Audio is written with
 * node:fs/promises; stdout stays machine-usable.
 */

import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { APIError } from '@hypercli.com/sdk';
import type { VoiceChunkEvent } from '@hypercli.com/sdk';
import { parseCommandArgs } from '../core/argv.js';
import { CliError, UsageError } from '../core/errors.js';
import { renderGroupHelp } from '../core/help.js';
import type { CommandContext } from '../core/types.js';

export const name = 'voice';
export const summary = 'Text-to-speech via the voice capability API.';
export const usage = [
  'hyper voice tts <text> [--out file.mp3] [--voice V] [--stream] [--json]',
];

const DEFAULT_VOICE = 'serena';

const TTS_OPTIONS = {
  out: { type: 'string' },
  voice: { type: 'string' },
  stream: { type: 'boolean', default: false },
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

  const record: Record<string, unknown> = { file, voice, bytes: bytes.byteLength };
  const data =
    ctx.format === 'json' ? { ...record, text, stream, format: 'mp3' } : record;
  ctx.output.result(data, {
    columns: ['FILE', 'VOICE', 'BYTES'],
    rows: [[file, voice, String(bytes.byteLength)]],
  });
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
      voice: { type: 'string' },
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
