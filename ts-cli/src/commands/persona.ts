/** Read-only, dynamic persona discovery and live context resolution. */
import {
  APIError,
  PersonaError,
  type PersonaArtifact,
  type PersonaCatalog,
  type PersonaCatalogEntry,
  type PersonaResolution,
} from '@hypercli.com/sdk';
import { parseCommandArgs, type ParsedCommand } from '../core/argv.js';
import { CliError, UsageError } from '../core/errors.js';
import { renderGroupHelp } from '../core/help.js';
import type { CommandContext, CommandGroup } from '../core/types.js';

export const name = 'persona';
export const summary = 'Discover personas and resolve current USER + effective SOUL.';
export const usage = [
  'hyper persona list|ls [--source live] [--json]',
  'hyper persona get <id> [--source live] [--json]',
  'hyper persona resolve [--agent <id>] [--json]',
];

function printHelp(): void {
  process.stdout.write(`${renderGroupHelp({ name, summary, usage, run })}\n`);
}

function noPositionals(parsed: ParsedCommand): void {
  if (parsed.positionals.length) throw new UsageError(`unexpected argument '${parsed.positionals[0]}'`);
}

function stringOption(parsed: ParsedCommand, key: string): string | undefined {
  const value = parsed.values[key];
  return typeof value === 'string' ? value : undefined;
}

function requireLiveSource(parsed: ParsedCommand): void {
  const source = stringOption(parsed, 'source');
  if (source !== undefined && source !== 'live') {
    throw new UsageError(`--source supports only 'live'; no offline persona source is available (got '${source}')`);
  }
}

function describeFailure(error: unknown): string {
  if (error instanceof APIError) return `HTTP ${error.statusCode}: ${error.detail}`;
  return error instanceof Error ? error.message : String(error);
}

async function api<T>(what: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof CliError) throw error;
    if (error instanceof APIError && error.statusCode === 400 && error.detail.includes('agent_id is required')) {
      throw new UsageError(`${error.detail}; pass --agent <id>`);
    }
    if (error instanceof PersonaError) {
      if (error.code === 'agent_id_required') {
        throw new UsageError(`${error.message}; pass --agent <id>`);
      }
      throw new CliError(`${error.code}: ${error.message}`);
    }
    throw new CliError(`${what} failed: ${describeFailure(error)}`);
  }
}

function entryJson(entry: PersonaCatalogEntry): Record<string, unknown> {
  return {
    name: entry.id,
    description: entry.description,
    artifact: entry.artifact,
    schema: entry.schema,
    sources: entry.sources,
    digest: entry.digest,
    revision: entry.revision,
  };
}

function artifactJson(artifact: PersonaArtifact): Record<string, unknown> {
  return {
    ...entryJson(artifact),
    markdown: artifact.markdown,
    source: 'live',
  };
}

function catalogJson(catalog: PersonaCatalog): Record<string, unknown> {
  return {
    personas: catalog.personas.map(entryJson),
    catalog: catalog.catalog,
    source: 'live',
  };
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

async function cmdList(ctx: CommandContext, args: string[]): Promise<void> {
  const parsed = parseCommandArgs(args, { source: { type: 'string' } });
  if (parsed.help) return printHelp();
  noPositionals(parsed);
  requireLiveSource(parsed);
  const catalog = await api('list personas', async () => (await ctx.client()).personas.list());
  ctx.output.result(catalogJson(catalog), {
    columns: ['NAME', 'DESCRIPTION', 'SOURCE'],
    rows: catalog.personas.map(persona => [persona.id, truncate(persona.description, 56), 'live']),
  });
}

async function cmdGet(ctx: CommandContext, args: string[]): Promise<void> {
  const parsed = parseCommandArgs(args, { source: { type: 'string' } });
  if (parsed.help) return printHelp();
  if (parsed.positionals.length === 0) throw new UsageError('missing persona id (hyper persona get <id>)');
  if (parsed.positionals.length > 1) throw new UsageError(`unexpected argument '${parsed.positionals[1]}'`);
  const id = parsed.positionals[0];
  requireLiveSource(parsed);
  const artifact = await api('get persona', async () =>
    (await ctx.client()).personas.get(id));
  // Human get is a byte-exact Markdown read. Receipts belong to --json so no
  // source/provenance text is appended to the assembled INDEX.md body.
  ctx.output.result(artifactJson(artifact), artifact.markdown);
}

function resolutionJson(resolution: PersonaResolution): Record<string, unknown> {
  return {
    agent_id: resolution.agentId,
    user_id: resolution.userId,
    user: resolution.user,
    soul: resolution.soul,
    persona: resolution.personaId,
    revision: resolution.revision,
    digest: resolution.digest,
    source: resolution.source,
  };
}

function separatedDocument(label: string, body: string): string {
  return `${label}\n${body}${body.endsWith('\n') || body.length === 0 ? '' : '\n'}`;
}

function resolutionText(resolution: PersonaResolution): string {
  const selection = resolution.source === 'persona'
    ? `persona ${resolution.personaId} @ ${resolution.digest ?? 'unknown'}`
    : 'canonical default';
  return `${separatedDocument('--- USER ---', resolution.user)}\n${separatedDocument(`--- SOUL: ${selection} ---`, resolution.soul)}`;
}

async function cmdResolve(ctx: CommandContext, args: string[]): Promise<void> {
  const parsed = parseCommandArgs(args, { agent: { type: 'string' } });
  if (parsed.help) return printHelp();
  noPositionals(parsed);
  const agentId = stringOption(parsed, 'agent');
  const resolution = await api('resolve persona', async () =>
    (await ctx.client()).personas.resolve({ agentId }));
  ctx.output.result(resolutionJson(resolution), resolutionText(resolution));
}

export async function run(ctx: CommandContext, args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;
  if (subcommand === 'list' || subcommand === 'ls') return cmdList(ctx, rest);
  if (subcommand === 'get') return cmdGet(ctx, rest);
  if (subcommand === 'resolve') return cmdResolve(ctx, rest);

  const parsed = parseCommandArgs(args);
  if (parsed.help || parsed.positionals.length === 0) return printHelp();
  throw new UsageError(`unknown persona command '${parsed.positionals[0]}' (expected list, get, or resolve)`);
}

export const persona: CommandGroup = { name, summary, usage, run };
export default persona;
