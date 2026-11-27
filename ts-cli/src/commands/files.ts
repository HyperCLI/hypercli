/**
 * `hyper files` — upload, inspect, and delete render assets.
 *
 *   hyper files upload <path>     upload a local file for use in renders
 *   hyper files get <id>          show file metadata
 *   hyper files delete <id>       delete an uploaded file
 *
 * Upload waits for backend processing (files.waitReady) so the returned id
 * is usable in renders as soon as the command exits.
 */

import { access } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { APIError } from '@hypercli.com/sdk';
import type { File as HyperFile } from '@hypercli.com/sdk';
import { parseCommandArgs } from '../core/argv.js';
import { CliError, redactDownloadLinks, UsageError } from '../core/errors.js';
import { renderGroupHelp } from '../core/help.js';
import type { CommandContext } from '../core/types.js';

export const name = 'files';
export const summary = 'Upload, inspect, download, and delete files.';
export const usage = [
  'hyper files upload <path> [--json]',
  'hyper files get <id> [--json]',
  'hyper files download-url <id> [--json]',
  'hyper files delete <id> [--yes] [--json]',
];

function describeError(err: unknown): string {
  if (err instanceof APIError) return `HTTP ${err.statusCode}`;
  return 'request failed';
}

/** Routine metadata output omits download credentials and preserves null fields. */
function fileRecord(file: HyperFile): Record<string, unknown> {
  return {
    id: file.id,
    userId: file.userId,
    filename: file.filename,
    contentType: file.contentType,
    fileSize: file.fileSize,
    url: file.url,
    state: file.state,
    error: file.error && redactDownloadLinks(file.error),
    createdAt: file.createdAt,
    expiresAt: file.expiresAt ?? null,
  };
}

async function assertReadable(path: string): Promise<void> {
  try {
    await access(path);
  } catch {
    throw new CliError(`cannot read file: ${path} — check the path exists and is readable`);
  }
}

async function upload(ctx: CommandContext, args: string[]): Promise<void> {
  const parsed = parseCommandArgs(args);
  if (parsed.help) {
    process.stdout.write(`${renderGroupHelp({ name, summary, usage, run })}\n`);
    return;
  }
  const [path, ...rest] = parsed.positionals;
  if (!path || rest.length > 0) {
    throw new UsageError('usage: hyper files upload <path> [--json]');
  }

  await assertReadable(path);

  const client = await ctx.client();
  let file: HyperFile;
  try {
    file = await client.files.upload(path);
  } catch (err) {
    throw new CliError(`failed to upload ${path}: ${describeError(err)}`);
  }

  // Return only once the file is usable in renders.
  const legacyReady = file.state == null && Boolean(file.url);
  if (!legacyReady && !client.files.isReady(file)) {
    ctx.output.info(`uploaded ${file.id}, waiting for processing to finish…`);
    try {
      file = await client.files.waitReady(file.id);
    } catch (err) {
      throw new CliError(`upload ${file.id} did not become ready: ${describeError(err)}`);
    }
  }

  ctx.output.info(`uploaded ${file.id}`);
  ctx.output.result(fileRecord(file), {
    columns: ['ID', 'NAME', 'URL'],
    rows: [[file.id, file.filename, file.url]],
  });
}

async function get(ctx: CommandContext, args: string[]): Promise<void> {
  const parsed = parseCommandArgs(args);
  if (parsed.help) {
    process.stdout.write(`${renderGroupHelp({ name, summary, usage, run })}\n`);
    return;
  }
  const [id, ...rest] = parsed.positionals;
  if (!id || rest.length > 0) {
    throw new UsageError('usage: hyper files get <id> [--json]');
  }

  const client = await ctx.client();
  let file: HyperFile;
  try {
    file = await client.files.get(id);
  } catch (err) {
    throw new CliError(`failed to get file ${id}: ${describeError(err)}`);
  }

  ctx.output.result(fileRecord(file), {
    columns: ['ID', 'NAME', 'URL', 'CREATED', 'SIZE', 'EXPIRES'],
    rows: [[file.id, file.filename, file.url, file.createdAt ?? '', file.fileSize ?? '', file.expiresAt ?? '']],
  });
}

async function downloadUrl(ctx: CommandContext, args: string[]): Promise<void> {
  const { positionals } = parseCommandArgs(args);
  const [id, ...rest] = positionals;
  if (!id || rest.length) throw new UsageError('usage: hyper files download-url <id> [--json]');
  const client = await ctx.client();
  try {
    const url = await client.files.downloadUrl(id);
    ctx.output.result({ id, downloadUrl: url }, url);
  } catch (err) {
    throw new CliError(`failed to resolve download: ${describeError(err)}`);
  }
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = (await rl.question(question)).trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}

async function del(ctx: CommandContext, args: string[]): Promise<void> {
  const parsed = parseCommandArgs(args, {
    yes: { type: 'boolean', short: 'y', default: false },
  });
  if (parsed.help) {
    process.stdout.write(`${renderGroupHelp({ name, summary, usage, run })}\n`);
    return;
  }
  const [id, ...rest] = parsed.positionals;
  if (!id || rest.length > 0) {
    throw new UsageError('usage: hyper files delete <id> [--yes] [--json]');
  }

  const skipPrompt = parsed.values.yes === true || parsed.format === 'json';
  if (!skipPrompt) {
    if (!process.stdin.isTTY) {
      throw new CliError(`refusing to delete ${id} without confirmation: pass --yes (or --json)`);
    }
    if (!(await confirm(`Delete file ${id}? [y/N] `))) {
      ctx.output.info(`aborted; file ${id} not deleted`);
      return;
    }
  }

  const client = await ctx.client();
  try {
    await client.files.delete(id);
  } catch (err) {
    throw new CliError(`failed to delete file ${id}: ${describeError(err)}`);
  }

  ctx.output.info(`deleted ${id}`);
  ctx.output.result({ id, deleted: true }, `Deleted ${id}`);
}

export async function run(ctx: CommandContext, args: string[]): Promise<void> {
  // Non-strict pre-scan: --help routes to group help regardless of position.
  const pre = parseCommandArgs(args, {
    yes: { type: 'boolean', short: 'y', default: false },
  });
  if (pre.help || pre.positionals.length === 0) {
    process.stdout.write(`${renderGroupHelp({ name, summary, usage, run })}\n`);
    return;
  }
  const [sub] = pre.positionals;
  // Hand the subcommand its own argv: the original args minus the sub token,
  // so flags (--json, --yes, …) survive strict re-parsing inside the subcommand.
  const subArgs = [...args];
  subArgs.splice(args.indexOf(sub), 1);
  switch (sub) {
    case 'upload':
      return upload(ctx, subArgs);
    case 'get':
      return get(ctx, subArgs);
    case 'download-url':
      return downloadUrl(ctx, subArgs);
    case 'delete':
      return del(ctx, subArgs);
    default:
      throw new UsageError(`unknown files command '${sub}'\nusage: ${usage.join('\n       ')}`);
  }
}
