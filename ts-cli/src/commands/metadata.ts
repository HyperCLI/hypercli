/** Backend-owned account and Agent semantic metadata commands. */

import { readFileSync } from 'node:fs';
import type { Agent, AgentMeta, Deployments, HyperCLI } from '@hypercli.com/sdk';
import { parseCommandArgs } from '../core/argv.js';
import { CliError, UsageError } from '../core/errors.js';
import { renderGroupHelp } from '../core/help.js';
import type { CommandContext, CommandGroup } from '../core/types.js';
import { resolveAgentRef } from './agents.js';

interface SoulResult {
  agent_id: string;
  soul: string;
}

interface RoleResult {
  agent_id: string;
  role: string | null;
}

interface UserResult {
  user_id: string;
  profile: string;
}

function help(ctx: CommandContext, group: CommandGroup): void {
  ctx.output.result(null, renderGroupHelp(group));
}

function noPositionals(positionals: string[]): void {
  if (positionals.length) throw new UsageError(`unexpected argument '${positionals[0]}'`);
}

export function fileContents(
  path: string | undefined,
  read: typeof readFileSync = readFileSync,
): string | undefined {
  if (path === undefined) return undefined;
  try {
    return read(path === '-' ? 0 : path, 'utf8') as string;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new CliError(`cannot read ${path === '-' ? 'stdin' : `'${path}'`}: ${detail}`);
  }
}

async function deployments(ctx: CommandContext): Promise<{ client: HyperCLI; api: Deployments }> {
  const client = await ctx.client();
  return { client, api: client.deployments };
}

async function resolveAgent(api: Deployments, ref: string | undefined): Promise<string> {
  if (ref !== undefined) return resolveAgentRef(api, ref);
  const identity = await api.accessIdentity();
  if (identity.agentId) return identity.agentId;
  throw new UsageError(
    'this credential does not identify exactly one agent; pass --agent <id> or use hyper agent <id> ...',
  );
}

function canonicalSoul(meta: AgentMeta | null): string {
  if (meta?.soul !== undefined) {
    return typeof meta.soul === 'string' ? meta.soul : '';
  }
  // Read-only compatibility for older Backend projections and stored records.
  return typeof meta?.ui?.soul === 'string' ? meta.ui.soul : '';
}

function soulResult(agent: Agent): SoulResult {
  return { agent_id: agent.id, soul: canonicalSoul(agent.meta) };
}

function roleResult(agent: Agent): RoleResult {
  return {
    agent_id: agent.id,
    role: typeof agent.meta?.role === 'string' ? agent.meta.role : null,
  };
}

async function runSoul(
  ctx: CommandContext,
  ref: string | undefined,
  inputFile: string | undefined,
): Promise<void> {
  const content = fileContents(inputFile);
  const { api } = await deployments(ctx);
  const id = await resolveAgent(api, ref);
  const agent = content === undefined
    ? await api.get(id)
    : await api.update(id, { soul: content });
  const result = soulResult(agent);
  ctx.output.result(result, result.soul);
}

async function runRole(
  ctx: CommandContext,
  ref: string | undefined,
  value: string | undefined,
): Promise<void> {
  const { api } = await deployments(ctx);
  const id = await resolveAgent(api, ref);
  const agent = value === undefined
    ? await api.get(id)
    : await api.update(id, { role: value === '' ? null : value });
  const result = roleResult(agent);
  ctx.output.result(result, result.role ?? '');
}

export async function runAgentMetadata(ctx: CommandContext, args: string[], group: CommandGroup): Promise<void> {
  const parsed = parseCommandArgs(args, { file: { type: 'string', short: 'f' } });
  if (parsed.help) return help(ctx, group);
  const [ref, field, value, ...extra] = parsed.positionals;
  if (!ref || !field) throw new UsageError('expected <id> soul or <id> role [value]');
  if (extra.length) throw new UsageError(`unexpected argument '${extra[0]}'`);
  if (field === 'soul') {
    if (value !== undefined) throw new UsageError('soul content must be supplied with -f <file> or -f -');
    return runSoul(ctx, ref, parsed.values.file as string | undefined);
  }
  if (field === 'role') {
    if (parsed.values.file !== undefined) throw new UsageError('-f is only valid for soul');
    return runRole(ctx, ref, value);
  }
  throw new UsageError(`unknown agent metadata field '${field}' (expected soul or role)`);
}

export async function runSoulShorthand(ctx: CommandContext, args: string[], group: CommandGroup): Promise<void> {
  const parsed = parseCommandArgs(args, {
    agent: { type: 'string' },
    file: { type: 'string', short: 'f' },
  });
  if (parsed.help) return help(ctx, group);
  noPositionals(parsed.positionals);
  return runSoul(ctx, parsed.values.agent as string | undefined, parsed.values.file as string | undefined);
}

export async function runRoleShorthand(ctx: CommandContext, args: string[], group: CommandGroup): Promise<void> {
  const parsed = parseCommandArgs(args, { agent: { type: 'string' } });
  if (parsed.help) return help(ctx, group);
  if (parsed.positionals.length > 1) {
    throw new UsageError(`unexpected argument '${parsed.positionals[1]}'`);
  }
  return runRole(ctx, parsed.values.agent as string | undefined, parsed.positionals[0]);
}

export async function runUserProfile(ctx: CommandContext, args: string[], group: CommandGroup): Promise<void> {
  const parsed = parseCommandArgs(args, { file: { type: 'string', short: 'f' } });
  if (parsed.help) return help(ctx, group);
  noPositionals(parsed.positionals);
  const content = fileContents(parsed.values.file as string | undefined);
  const { client } = await deployments(ctx);
  const profile = content === undefined
    ? await client.user.getProfile()
    : await client.user.updateProfile(content);
  const result: UserResult = { user_id: profile.id, profile: profile.profile };
  ctx.output.result(result, result.profile);
}
