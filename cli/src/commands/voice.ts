/**
 * `hyper voice` — text-to-speech via the voice capability API, plus local
 * transcription (faster-whisper, no API key).
 *
 *   hyper voice tts "hello"                  one-shot TTS (POST /voice/tts)
 *   hyper voice tts "hello" --stream         streaming TTS over /ws/voice
 *   hyper voice transcribe voice.ogg         local faster-whisper STT
 *
 * Remote generation goes through the voice API; transcribe shells out to a
 * Python faster-whisper bridge (agent images carry the venv at
 * /opt/hypercli-cli/venv; override with HYPER_VOICE_PYTHON). Audio and
 * transcripts are written with node:fs/promises; stdout stays machine-usable.
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
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
export const summary = 'Text-to-speech and local audio transcription.';
export const usage = [
  'hyper voice tts <text> [--out file.mp3] [--voice V] [--stream] [--json]',
  'hyper voice transcribe <file> [--model M] [--language L] [--device D] [--compute T] [--out file] [--json]',
];

const DEFAULT_VOICE = 'serena';
const DEFAULT_WHISPER_MODEL = 'turbo';

const TTS_OPTIONS = {
  out: { type: 'string' },
  voice: { type: 'string' },
  stream: { type: 'boolean', default: false },
} as const;

const TRANSCRIBE_OPTIONS = {
  model: { type: 'string', short: 'm' },
  language: { type: 'string', short: 'l' },
  device: { type: 'string', short: 'd' },
  compute: { type: 'string' },
  out: { type: 'string' },
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

// ---------- transcribe (local faster-whisper bridge) ----------

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface Transcript {
  language: string;
  language_probability: number;
  duration: number;
  segments: TranscriptSegment[];
  text: string;
}

/**
 * Python bridge: mirrors py-cli stt.py device/compute resolution and JSON
 * shape ({language, language_probability, duration, segments, text}).
 * Diagnostics go to stderr; the transcript JSON is the only stdout line.
 * Exit 3 means faster-whisper is missing.
 */
const STT_BRIDGE = [
  'import json, sys',
  'file_path, model_name, language, device, compute_type = sys.argv[1:6]',
  'try:',
  '    from faster_whisper import WhisperModel',
  'except ImportError:',
  '    sys.stderr.write("faster-whisper not installed. Install with: pip install \'hypercli-cli[stt]\'\\n")',
  '    sys.exit(3)',
  'if compute_type == "auto":',
  '    compute_type = "int8" if device == "cpu" else "float16"',
  'if device == "auto":',
  '    try:',
  '        import torch',
  '        device = "cuda" if torch.cuda.is_available() else "cpu"',
  '    except ImportError:',
  '        device = "cpu"',
  '    if device == "cpu" and compute_type == "float16":',
  '        compute_type = "int8"',
  'sys.stderr.write(f"model: {model_name} | device: {device} | compute: {compute_type}\\n")',
  'model = WhisperModel(model_name, device=device, compute_type=compute_type)',
  'kwargs = {"language": language} if language else {}',
  'segments, info = model.transcribe(file_path, **kwargs)',
  'results = [{"start": round(s.start, 3), "end": round(s.end, 3), "text": s.text.strip()} for s in segments]',
  'if language == "":',
  '    sys.stderr.write(f"detected language: {info.language} (p={info.language_probability:.2f})\\n")',
  'print(json.dumps({',
  '    "language": info.language,',
  '    "language_probability": round(info.language_probability, 3),',
  '    "duration": round(info.duration, 3),',
  '    "segments": results,',
  '    "text": " ".join(r["text"] for r in results),',
  '}, ensure_ascii=False))',
].join('\n');

/**
 * Python interpreter for the bridge: HYPER_VOICE_PYTHON override first, then
 * the agent-image venv (has faster-whisper), then PATH `python3`.
 */
function resolveSttPython(): string {
  const override = process.env.HYPER_VOICE_PYTHON?.trim();
  if (override) return override;
  const agentVenv = '/opt/hypercli-cli/venv/bin/python3';
  if (existsSync(agentVenv)) return agentVenv;
  return 'python3';
}

function runSttBridge(
  python: string,
  file: string,
  model: string,
  language: string,
  device: string,
  compute: string,
): Promise<Transcript> {
  return new Promise((resolvePromise, reject) => {
    execFile(
      python,
      ['-c', STT_BRIDGE, file, model, language, device, compute],
      { maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (stderr.trim()) process.stderr.write(`${stderr.trim()}\n`);
        if (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            reject(
              new CliError(
                `python interpreter '${python}' not found. Install Python 3 with faster-whisper ` +
                  `(pip install 'hypercli-cli[stt]') or set HYPER_VOICE_PYTHON.`,
              ),
            );
            return;
          }
          if (stderr.includes('faster-whisper not installed')) {
            reject(
              new CliError(
                "faster-whisper not installed. Install with: pip install 'hypercli-cli[stt]' " +
                  '(or set HYPER_VOICE_PYTHON to an interpreter that has it).',
              ),
            );
            return;
          }
          reject(new CliError(`transcribe failed: ${describeError(error)}`));
          return;
        }
        try {
          resolvePromise(JSON.parse(stdout.trim()) as Transcript);
        } catch {
          reject(new CliError(`transcribe failed: unexpected bridge output: ${stdout.trim().slice(0, 200)}`));
        }
      },
    );
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
    throw new UsageError(`usage: ${usage[1]}`);
  }
  const model = typeof parsed.values.model === 'string' ? parsed.values.model : DEFAULT_WHISPER_MODEL;
  const language = typeof parsed.values.language === 'string' ? parsed.values.language : '';
  const device = typeof parsed.values.device === 'string' ? parsed.values.device : 'auto';
  const compute = typeof parsed.values.compute === 'string' ? parsed.values.compute : 'auto';
  const outArg = typeof parsed.values.out === 'string' ? parsed.values.out : undefined;

  const file = resolve(audioFile);
  if (!existsSync(file)) {
    throw new CliError(`file not found: ${audioFile}`);
  }

  ctx.output.info(`file: ${audioFile} | model: ${model}${language ? ` | language: ${language}` : ''}`);
  const transcript = await runSttBridge(resolveSttPython(), file, model, language, device, compute);

  if (outArg) {
    const target = resolve(outArg);
    const content =
      ctx.format === 'json' ? JSON.stringify(transcript, null, 2) : transcript.text;
    await writeFile(target, `${content}\n`);
    ctx.output.info(`saved ${target}`);
  }
  if (ctx.format === 'json') {
    ctx.output.result(transcript);
  } else if (!outArg) {
    ctx.output.result(transcript.text, transcript.text);
  }
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
      voice: { type: 'string' },
      stream: { type: 'boolean' },
      model: { type: 'string', short: 'm' },
      language: { type: 'string', short: 'l' },
      device: { type: 'string', short: 'd' },
      compute: { type: 'string' },
    },
    strict: false,
    allowPositionals: true,
  });
  return {
    help: parsed.values.help === true,
    positionals: parsed.positionals,
  };
}
