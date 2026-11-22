/**
 * `hyper rooms` — explicit multiparty agent rooms (docs/MULTIPARTY.md).
 *
 * A thin product surface over the Backend room REST API: create/read/update
 * the room brief and policy knobs, and post authenticated owner messages.
 * The backend owns identity, admission, turn/token accounting and fanout;
 * this command does none of it client-side.
 */

import { parseCommandArgs } from '../core/argv.js';
import { UsageError } from '../core/errors.js';
import { renderGroupHelp } from '../core/help.js';
import type { CommandContext } from '../core/types.js';
import type { RoomMessage } from '@hypercli.com/sdk';

export const name = 'rooms';
export const summary = 'Create and read multiparty agent rooms, edit the brief or policy, and post owner messages.';
export const usage = [
  'hyper rooms create [agent-id...] [--title TITLE] [--purpose TEXT] [--style TEXT] [--rule TEXT]... [--token-limit N|none] [--agent-turn-limit N|none] [--json]',
  'hyper rooms get <room-id> [--json]',
  'hyper rooms grants <rooms|sessions> <resource-id>',
  'hyper rooms grant <rooms|sessions> <resource-id> <grant-id> <user|agent> <subject-id> [parent-member-period-id]',
  'hyper rooms revoke <rooms|sessions> <resource-id> <grant-id>',
  'hyper rooms children <room-id> [--json]',
  'hyper rooms child-create <room-id> <agent-id...> [--title TITLE] [--json]',
  'hyper rooms session-budget <session-id> [--token-limit N|none] [--agent-turn-limit N|none] [--json]',
  'hyper rooms update <room-id> [--title TITLE] [--purpose TEXT] [--style TEXT] [--rule TEXT]... [--token-limit N|none] [--agent-turn-limit N|none] [--status live|archived] [--json]',
  'hyper rooms message <session-id> <body...> [--reply-to MESSAGE-ID] [--json]',
];

const ARG_SPEC = {
  title: { type: 'string' },
  purpose: { type: 'string' },
  style: { type: 'string' },
  rule: { type: 'string', multiple: true },
  'token-limit': { type: 'string' },
  'agent-turn-limit': { type: 'string' },
  status: { type: 'string' },
  'reply-to': { type: 'string' },
} as const;

const ALLOWED_FLAGS: Record<string, readonly string[]> = {
  create: ['title', 'purpose', 'style', 'rule', 'token-limit', 'agent-turn-limit'],
  get: [],
  grants: [], grant: [], revoke: [],
  children: [],
  'session-budget': ['token-limit', 'agent-turn-limit'],
  'child-create': ['title'],
  update: ['title', 'purpose', 'style', 'rule', 'token-limit', 'agent-turn-limit', 'status'],
  message: ['reply-to'],
};

/** Undefined preserves the knob; 'none' is the explicit product default; else a non-negative integer. */
function parseLimit(value: unknown, flag: string): number | null | undefined {
  if (value === undefined) return undefined;
  const text = String(value);
  if (text === 'none') return null;
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(Number(text))) {
    throw new UsageError(`${flag} must be a non-negative integer or 'none'`);
  }
  return Number(text);
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

// ---------- table rendering ----------

function rowsBlock(rows: ReadonlyArray<readonly [string, string]>): string[] {
  const width = Math.max(0, ...rows.map(([key]) => key.length));
  return rows.map(([key, value]) => `  ${key.padEnd(width)}  ${value}`.trimEnd());
}

function renderMessage(message: RoomMessage): string {
  const fanout = Object.entries(message.fanout)
    .map(([agentId, delivered]) => `${agentId}: ${delivered ? 'delivered' : 'not delivered'}`)
    .join('\n  ');
  const rows: Array<[string, string]> = [
    ['session_id', message.sessionId],
    ['message_id', message.messageId],
    ['seq', String(message.seq)],
    ['epoch_id', message.epochId],
    ['sender', `${message.senderName} (${message.senderId}, ${message.senderKind})`],
    ['reply_to', message.replyTo ?? ''],
    ['created_at', message.createdAt ?? ''],
  ];
  const blocks = [['Message', ...rowsBlock(rows)].join('\n'), `Body\n  ${message.body}`].join('\n\n');
  return fanout ? `${blocks}\n\nFanout\n  ${fanout}` : blocks;
}

export async function run(ctx: CommandContext, args: string[]): Promise<void> {
  const parsed = parseCommandArgs(args, ARG_SPEC);
  if (parsed.help || parsed.positionals.length === 0) {
    process.stdout.write(`${renderGroupHelp({ name, summary, usage, run })}\n`);
    return;
  }
  const [command, ...rest] = parsed.positionals;
  if (!Object.hasOwn(ALLOWED_FLAGS, command)) throw new UsageError(`unknown rooms command '${command}'`);
  for (const flag of Object.keys(ARG_SPEC)) {
    if (parsed.values[flag] !== undefined && !ALLOWED_FLAGS[command].includes(flag)) {
      throw new UsageError(`--${flag} is not supported by rooms ${command}`);
    }
  }

  const tokenLimit = parseLimit(parsed.values['token-limit'], '--token-limit');
  const agentTurnLimit = parseLimit(parsed.values['agent-turn-limit'], '--agent-turn-limit');
  const rules = Array.isArray(parsed.values.rule) ? parsed.values.rule as string[] : undefined;
  const status = optionalText(parsed.values.status);
  if (status !== undefined && status !== 'live' && status !== 'archived') {
    throw new UsageError('--status must be live or archived');
  }
  if (command === 'child-create' && rest.length < 2) throw new UsageError('child-create requires room ID and agents');
  if (rest.some(value => !value.trim())) throw new UsageError('Empty argument');
  if (['get', 'update', 'children'].includes(command) && (rest.length !== 1 || !rest[0].trim())) {
    throw new UsageError(`rooms ${command} requires one room ID`);
  }
  const [sessionId, ...bodyWords] = command === 'message' ? rest : [undefined];
  const messageBody = command === 'message' ? bodyWords.join(' ').trim() : undefined;
  if (command === 'message' && (!sessionId || !sessionId.trim() || !messageBody)) {
    throw new UsageError('rooms message requires a child session ID and a message body');
  }

  const sessions = (await ctx.client()).sessions;
  switch (command) {
    case 'grants':
    case 'grant':
    case 'revoke': {
      const [kind,id,period,subjectType,subjectId,parentPeriod] = rest;
      if ((kind !== 'rooms' && kind !== 'sessions') || !id) throw new UsageError('Specify rooms or sessions and its exact ID');
      if (command === 'grants' && rest.length === 2) {
        let cursor: string | undefined;
        const periods = [];
        for (;;) {
          const page = await sessions.listGrants(kind,id,cursor);
          periods.push(...page);
          if (page.length < 50) break;
          cursor = page[page.length-1].id;
        }
        ctx.output.result(periods,JSON.stringify(periods,null,2)); return;
      }
      if (command === 'revoke' && rest.length === 3) {
        const result = await sessions.revokeMember(kind,id,period);
        ctx.output.result(result,JSON.stringify(result,null,2)); return;
      }
      if (command === 'grant' && (rest.length === 5 || (kind === 'sessions' && rest.length === 6)) && (subjectType === 'agent' || subjectType === 'user')) {
        const result = await sessions.issueMember(kind,id,period,{subject_type:subjectType,subject_id:subjectId,member_grant_id:parentPeriod ?? null});
        ctx.output.result(result,JSON.stringify(result,null,2)); return;
      }
      throw new UsageError(`Invalid rooms ${command} arguments; see rooms --help`);
    }
    case 'create': {
      const room = await sessions.createRoom(rest, {
        title: optionalText(parsed.values.title),
        purpose: optionalText(parsed.values.purpose),
        style: optionalText(parsed.values.style),
        ...(rules !== undefined ? { rules } : {}),
        ...(tokenLimit !== undefined ? { tokenLimit } : {}),
        ...(agentTurnLimit !== undefined ? { agentTurnLimit } : {}),
      });
      ctx.output.result(room, rowsBlock([['room_id', room.id], ['session_id', room.session_id ?? '(none)'],
        ['title', room.title ?? '(untitled)']]).join('\n'));
      return;
    }
    case 'get': {
      const room = await sessions.getRoom(rest[0]);
      ctx.output.result(room, rowsBlock([['room_id', room.id], ['title', room.title ?? '(untitled)'], ['status', room.status]]).join('\n'));
      return;
    }
    case 'session-budget': {
      if (rest.length !== 1) throw new UsageError('session-budget requires a session ID');
      const value = tokenLimit === undefined && agentTurnLimit === undefined ? await sessions.getSessionBudgets(rest[0]) : await sessions.updateSessionBudgets(rest[0], {token_limit:tokenLimit,agent_turn_limit:agentTurnLimit});
      ctx.output.result(value, JSON.stringify(value)); return;
    }
    case 'children': {
      const items = [];
      let cursor: string | undefined;
      do {
        const page = await sessions.listRoomSessions(rest[0], cursor);
        items.push(...page.items);
        cursor = page.next_cursor ?? undefined;
      } while (cursor);
      ctx.output.result(items, items.map(s => `${s.id}  ${s.title ?? '(untitled)'}`).join('\n'));
      return;
    }
    case 'child-create': {
      const child = await sessions.createRoomSession(rest[0], rest.slice(1), { title: optionalText(parsed.values.title) });
      ctx.output.result(child, rowsBlock([['room_id', child.room_id], ['session_id', child.id]]).join('\n'));
      return;
    }
    case 'update': {
      const room = await sessions.updateRoom(rest[0], {
        ...(parsed.values.title !== undefined ? { title: parsed.values.title as string } : {}),
        ...(parsed.values.purpose !== undefined ? { purpose: parsed.values.purpose as string } : {}),
        ...(parsed.values.style !== undefined ? { style: parsed.values.style as string } : {}),
        ...(rules !== undefined ? { rules } : {}),
        ...(tokenLimit !== undefined ? { tokenLimit } : {}),
        ...(agentTurnLimit !== undefined ? { agentTurnLimit } : {}),
        ...(status !== undefined ? { status: status as 'live' | 'archived' } : {}),
      });
      ctx.output.result(room, rowsBlock([['room_id', room.id], ['status', room.status]]).join('\n'));
      return;
    }
    case 'message': {
      const replyTo = optionalText(parsed.values['reply-to']);
      const message = await sessions.createRoomMessage(
        sessionId as string, messageBody as string, replyTo !== undefined ? { replyTo } : {},
      );
      ctx.output.result(message, renderMessage(message));
      return;
    }
  }
}
