/**
 * `hyper flow` — managed AI render flows (images, video, audio, speech).
 *
 *   hyper flow create <type> [typed flags] [--param key=value ...] [--dry-run]
 *   hyper flow list [--state STATE]
 *   hyper flow status <id>
 *   hyper flow wait <id> [--timeout SECONDS]
 *   hyper flow cancel <id> [--yes]
 *
 * One create path: every flow type resolves to renders.flow(type, params).
 * Typed flags are per-type sugar from the FLOW_TYPES table; --param key=value
 * overrides typed flags and passes arbitrary keys through. Image/audio assets
 * referenced in params are URLs or file IDs from `hyper files upload`.
 * Legacy types (listed: false) dispatch but are hidden from help.
 */

import { createInterface } from 'node:readline/promises';
import type { ParseArgsConfig } from 'node:util';
import type { Render } from '@hypercli.com/sdk';
import { parseCommandArgs, parseUniversal } from '../core/argv.js';
import { CliError, UsageError } from '../core/errors.js';
import { renderGroupHelp } from '../core/help.js';
import type { CommandContext } from '../core/types.js';

export const name = 'flow';
export const summary = 'Create and manage AI render flows.';

type FlagKind = 'string' | 'number' | 'boolean' | 'list';

interface FlowFlag {
  readonly flag: string;
  readonly key: string;
  readonly kind: FlagKind;
}

interface FlowType {
  readonly summary: string;
  readonly listed: boolean;
  readonly required: readonly string[];
  readonly flags: readonly FlowFlag[];
}

const PROMPT: FlowFlag = { flag: 'prompt', key: 'prompt', kind: 'string' };
const TEXT: FlowFlag = { flag: 'text', key: 'text', kind: 'string' };
const NEGATIVE: FlowFlag = { flag: 'negative', key: 'negative', kind: 'string' };
const WIDTH: FlowFlag = { flag: 'width', key: 'width', kind: 'number' };
const HEIGHT: FlowFlag = { flag: 'height', key: 'height', kind: 'number' };
const LENGTH: FlowFlag = { flag: 'length', key: 'length', kind: 'number' };
const NOTIFY_URL: FlowFlag = { flag: 'notify-url', key: 'notify_url', kind: 'string' };
const IMAGE_URL: FlowFlag = { flag: 'image-url', key: 'image_url', kind: 'string' };
const IMAGE_URLS: FlowFlag = { flag: 'image-urls', key: 'image_urls', kind: 'list' };
const AUDIO_URL: FlowFlag = { flag: 'audio-url', key: 'audio_url', kind: 'string' };
const START_IMAGE_URL: FlowFlag = { flag: 'start-image-url', key: 'start_image_url', kind: 'string' };
const END_IMAGE_URL: FlowFlag = { flag: 'end-image-url', key: 'end_image_url', kind: 'string' };
const FILE_IDS: FlowFlag = { flag: 'file-ids', key: 'file_ids', kind: 'list' };
const MODE: FlowFlag = { flag: 'mode', key: 'mode', kind: 'string' };
const LANGUAGE: FlowFlag = { flag: 'language', key: 'language', kind: 'string' };
const SPEAKER: FlowFlag = { flag: 'speaker', key: 'speaker', kind: 'string' };
const STYLE: FlowFlag = { flag: 'style', key: 'style', kind: 'string' };
const MODEL_SIZE: FlowFlag = { flag: 'model-size', key: 'model_size', kind: 'string' };
const VOICE_DESCRIPTION: FlowFlag = { flag: 'voice-description', key: 'voice_description', kind: 'string' };
const REF_AUDIO_URL: FlowFlag = { flag: 'ref-audio-url', key: 'ref_audio_url', kind: 'string' };
const REF_TEXT: FlowFlag = { flag: 'ref-text', key: 'ref_text', kind: 'string' };
const USE_XVECTOR_ONLY: FlowFlag = { flag: 'use-xvector-only', key: 'use_xvector_only', kind: 'boolean' };

const FLOW_TYPES: Record<string, FlowType> = {
  'text-to-image': {
    summary: 'Generate an image (Qwen-Image)',
    listed: true,
    required: ['prompt'],
    flags: [PROMPT, NEGATIVE, WIDTH, HEIGHT, NOTIFY_URL],
  },
  'text-to-image-hidream': {
    summary: 'Generate an image (HiDream I1 Full)',
    listed: true,
    required: ['prompt'],
    flags: [PROMPT, NEGATIVE, WIDTH, HEIGHT, NOTIFY_URL],
  },
  'text-to-video': {
    summary: 'Generate a video (Wan 2.2 14B)',
    listed: true,
    required: ['prompt'],
    flags: [PROMPT, NEGATIVE, WIDTH, HEIGHT, NOTIFY_URL],
  },
  'image-to-video': {
    summary: 'Animate an image (Wan 2.2 Animate)',
    listed: true,
    required: ['prompt'],
    flags: [PROMPT, IMAGE_URL, FILE_IDS, NEGATIVE, WIDTH, HEIGHT, NOTIFY_URL],
  },
  'image-to-image': {
    summary: 'Transform images (Qwen Image Edit)',
    listed: true,
    required: ['prompt'],
    flags: [PROMPT, IMAGE_URLS, FILE_IDS, NEGATIVE, WIDTH, HEIGHT, NOTIFY_URL],
  },
  'first-last-frame-video': {
    summary: 'Morph video between two images (Wan 2.2)',
    listed: true,
    required: ['prompt'],
    flags: [PROMPT, START_IMAGE_URL, END_IMAGE_URL, FILE_IDS, NEGATIVE, WIDTH, HEIGHT, NOTIFY_URL],
  },
  'speaking-video': {
    summary: 'Lip-sync video (HuMo) [legacy]',
    listed: false,
    required: ['prompt'],
    flags: [PROMPT, IMAGE_URL, AUDIO_URL, FILE_IDS, NEGATIVE, LENGTH, WIDTH, HEIGHT, NOTIFY_URL],
  },
  'audio-to-text': {
    summary: 'Transcribe audio/video (WhisperX) [legacy]',
    listed: false,
    required: [],
    flags: [AUDIO_URL, FILE_IDS, NOTIFY_URL],
  },
  'text-to-speech': {
    summary: 'Generate speech (Qwen3-TTS) [legacy]',
    listed: false,
    required: ['text'],
    flags: [TEXT, MODE, LANGUAGE, SPEAKER, STYLE, MODEL_SIZE, VOICE_DESCRIPTION, REF_AUDIO_URL, FILE_IDS, REF_TEXT, USE_XVECTOR_ONLY, NOTIFY_URL],
  },
};

const LISTED_TYPES = Object.entries(FLOW_TYPES)
  .filter(([, row]) => row.listed)
  .map(([type]) => type);

export const usage = [
  'hyper flow create <type> [typed flags] [--param key=value ...] [--dry-run]',
  'hyper flow list [--state STATE]',
  'hyper flow status <id> [--json]',
  'hyper flow wait <id> [--timeout SECONDS] [--json]',
  'hyper flow cancel <id> [--yes]',
  `Flow types: ${LISTED_TYPES.join(', ')}`,
  "Image/audio params take URLs or file IDs from 'hyper files upload'.",
  'Typed flags differ per type; --param key=value overrides them and passes any key through (number/boolean values are coerced).',
];

const UNIVERSAL_KEYS = new Set(['json', 'output', 'dev', 'help', 'param', 'dry-run']);
const DEFAULT_WAIT_TIMEOUT_S = 3600;

type ParseOptions = NonNullable<ParseArgsConfig['options']>;

function createParseOptions(): ParseOptions {
  const options: ParseOptions = {
    param: { type: 'string', multiple: true },
    'dry-run': { type: 'boolean', default: false },
  };
  for (const row of Object.values(FLOW_TYPES)) {
    for (const flag of row.flags) {
      if (options[flag.flag]) continue;
      options[flag.flag] =
        flag.kind === 'boolean'
          ? { type: 'boolean' }
          : { type: 'string', multiple: flag.kind === 'list' };
    }
  }
  return options;
}

function coerceFlagValue(flag: FlowFlag, raw: unknown): unknown {
  if (flag.kind === 'boolean') return raw === true;
  if (flag.kind === 'list') {
    return (Array.isArray(raw) ? raw : [raw]).map((item) => String(item));
  }
  if (flag.kind === 'number') {
    const value = typeof raw === 'string' ? raw.trim() : '';
    const parsed = Number(value);
    if (!value || !Number.isFinite(parsed)) {
      throw new UsageError(`--${flag.flag} expects a number`);
    }
    return parsed;
  }
  return String(raw);
}

function coerceParamValue(text: string): string | number | boolean {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === 'number' || typeof parsed === 'boolean') return parsed;
  } catch {
    // not JSON — keep the raw string
  }
  return text;
}

function resolveParams(
  type: string,
  row: FlowType,
  values: Record<string, unknown>,
): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const [flagName, raw] of Object.entries(values)) {
    if (UNIVERSAL_KEYS.has(flagName)) continue;
    const flag = row.flags.find((f) => f.flag === flagName);
    if (!flag) {
      const known = row.flags.map((f) => `--${f.flag}`).join(', ');
      throw new UsageError(`--${flagName} is not a parameter of '${type}' (expects: ${known})`);
    }
    params[flag.key] = coerceFlagValue(flag, raw);
  }
  const overrides = values.param;
  for (const entry of Array.isArray(overrides) ? overrides : []) {
    const text = String(entry);
    const eq = text.indexOf('=');
    if (eq < 1) throw new UsageError(`--param expects key=value (got '${text}')`);
    params[text.slice(0, eq)] = coerceParamValue(text.slice(eq + 1));
  }
  for (const required of row.required) {
    const value = params[required];
    if (value === undefined || value === null || value === '') {
      const flag = row.flags.find((f) => f.key === required);
      const hint = flag ? `--${flag.flag}` : `--param ${required}=...`;
      throw new UsageError(`'${type}' requires ${hint} (or --param ${required}=...)`);
    }
  }
  return params;
}

function formatTimestamp(value: unknown): string {
  if (value === null || value === undefined || value === 0 || value === '') return '';
  if (typeof value === 'number') {
    return new Date(value < 1e12 ? value * 1000 : value).toISOString();
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? value : new Date(parsed).toISOString();
  }
  return String(value);
}

function renderDetail(render: Render): string {
  const rows: Array<[string, string]> = [
    ['id', render.renderId],
    ['type', render.renderType ?? render.template ?? ''],
    ['state', render.state],
  ];
  if (render.tags?.length) rows.push(['tags', render.tags.join(', ')]);
  const created = formatTimestamp(render.createdAt);
  if (created) rows.push(['created', created]);
  const started = formatTimestamp(render.startedAt);
  if (started) rows.push(['started', started]);
  const completed = formatTimestamp(render.completedAt);
  if (completed) rows.push(['completed', completed]);
  if (render.resultUrl) rows.push(['result_url', render.resultUrl]);
  if (render.error) rows.push(['error', render.error]);
  const width = Math.max(...rows.map(([key]) => key.length));
  return rows.map(([key, value]) => `${key.padEnd(width)}  ${value}`).join('\n');
}

function positional(parsed: { positionals: string[] }, index: number, usageLine: string): string {
  const value = parsed.positionals[index];
  if (!value) throw new UsageError(`usage: ${usageLine}`);
  const extra = parsed.positionals[index + 1];
  if (extra !== undefined) throw new UsageError(`unexpected argument '${extra}' (${usageLine})`);
  return value;
}

async function cmdCreate(ctx: CommandContext, args: string[]): Promise<void> {
  const parsed = parseCommandArgs(args, createParseOptions());
  const type = positional(parsed, 1, 'hyper flow create <type> [typed flags] [--param key=value ...] [--dry-run]');
  const row = FLOW_TYPES[type];
  if (!row) {
    throw new UsageError(
      `unknown flow type '${type}' — known types: ${LISTED_TYPES.join(', ')}. ` +
        'Arbitrary params pass through with --param key=value.',
    );
  }
  const params = resolveParams(type, row, parsed.values);
  if (parsed.values['dry-run'] === true) {
    const resolved = { type, params };
    ctx.output.result(resolved, JSON.stringify(resolved, null, 2));
    return;
  }
  const client = await ctx.client();
  const render = await client.renders.flow(type, params);
  ctx.output.result(
    render,
    [
      `created flow ${render.renderId}`,
      `  type   ${type}`,
      `  state  ${render.state || 'queued'}`,
      `  track  hyper flow status ${render.renderId}`,
    ].join('\n'),
  );
}

async function cmdList(ctx: CommandContext, args: string[]): Promise<void> {
  const parsed = parseCommandArgs(args, { state: { type: 'string' } });
  if (parsed.positionals.length > 1) {
    throw new UsageError(`unexpected argument '${parsed.positionals[1]}' (hyper flow list [--state STATE])`);
  }
  const state = typeof parsed.values.state === 'string' ? parsed.values.state : undefined;
  const client = await ctx.client();
  const renders = await client.renders.list(state ? { state } : undefined);
  ctx.output.result(renders, {
    columns: ['ID', 'TYPE', 'STATE', 'CREATED', 'RESULTS'],
    rows: renders.map((render) => [
      render.renderId,
      render.renderType ?? render.template ?? '',
      render.state,
      formatTimestamp(render.createdAt),
      render.resultUrl ? 1 : 0,
    ]),
  });
}

async function cmdStatus(ctx: CommandContext, args: string[]): Promise<void> {
  const parsed = parseCommandArgs(args);
  const id = positional(parsed, 1, 'hyper flow status <id>');
  const client = await ctx.client();
  const render = await client.renders.get(id);
  ctx.output.result(render, renderDetail(render));
}

async function cmdWait(ctx: CommandContext, args: string[]): Promise<void> {
  const parsed = parseCommandArgs(args, { timeout: { type: 'string' } });
  const id = positional(parsed, 1, 'hyper flow wait <id> [--timeout SECONDS]');
  let timeoutS = DEFAULT_WAIT_TIMEOUT_S;
  if (parsed.values.timeout !== undefined) {
    timeoutS = Number(parsed.values.timeout);
    if (!Number.isFinite(timeoutS) || timeoutS <= 0) {
      throw new UsageError('--timeout expects a positive number of seconds');
    }
  }
  const client = await ctx.client();
  let render: Render;
  try {
    render = await client.renders.wait(id, { timeoutMs: timeoutS * 1000 });
  } catch (err) {
    if (err instanceof Error && /did not complete within/.test(err.message)) {
      let finalState = 'unknown';
      try {
        finalState = (await client.renders.get(id)).state || 'unknown';
      } catch {
        finalState = 'unknown';
      }
      throw new CliError(`flow ${id} did not complete within ${timeoutS}s (final state: ${finalState})`);
    }
    throw err;
  }
  const lines = [`flow ${render.renderId} ${render.state}`];
  if (render.resultUrl) lines.push(`result: ${render.resultUrl}`);
  if (render.error) lines.push(`error: ${render.error}`);
  ctx.output.result(render, lines.join('\n'));
}

async function cmdCancel(ctx: CommandContext, args: string[]): Promise<void> {
  const parsed = parseCommandArgs(args, { yes: { type: 'boolean', default: false } });
  const id = positional(parsed, 1, 'hyper flow cancel <id> [--yes]');
  const confirmed = parsed.values.yes === true || parsed.format === 'json';
  if (!confirmed) {
    if (!process.stdin.isTTY) {
      throw new CliError(`refusing to cancel ${id} without confirmation: pass --yes (or --json)`);
    }
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    try {
      const answer = (await rl.question(`Cancel flow ${id}? [y/N] `)).trim().toLowerCase();
      if (answer !== 'y' && answer !== 'yes') throw new CliError(`flow ${id} not cancelled`);
    } finally {
      rl.close();
    }
  }
  const client = await ctx.client();
  await client.renders.cancel(id);
  ctx.output.result({ id, cancelled: true }, `cancelled flow ${id}`);
}

const COMMANDS: Record<string, (ctx: CommandContext, args: string[]) => Promise<void>> = {
  create: cmdCreate,
  list: cmdList,
  status: cmdStatus,
  wait: cmdWait,
  cancel: cmdCancel,
};

export async function run(ctx: CommandContext, args: string[]): Promise<void> {
  const scan = parseUniversal(args);
  const [sub] = scan.positionals;
  if (scan.help || !sub) {
    process.stdout.write(`${renderGroupHelp({ name, summary, usage, run })}\n`);
    return;
  }
  const handler = COMMANDS[sub];
  if (!handler) {
    throw new UsageError(
      `unknown flow command '${sub}' (expected: ${Object.keys(COMMANDS).join(', ')})`,
    );
  }
  await handler(ctx, args);
}
