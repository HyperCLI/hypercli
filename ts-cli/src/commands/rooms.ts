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
import type { RoomMessage, RoomRecord } from '@hypercli.com/sdk';

export const name = 'rooms';
export const summary = 'Create and read multiparty agent rooms, edit the brief or policy, and post owner messages.';
export const usage = [
  'hyper rooms create <agent-id...> [--title TITLE] [--purpose TEXT] [--style TEXT] [--rule TEXT]... [--token-limit N|none] [--agent-turn-limit N|none] [--json]',
  'hyper rooms get <room-id> [--json]',
  'hyper rooms update <room-id> [--title TITLE] [--purpose TEXT] [--style TEXT] [--rule TEXT]... [--token-limit N|none] [--agent-turn-limit N|none] [--status live|archived] [--json]',
  'hyper rooms message <room-id> <body...> [--reply-to MESSAGE-ID] [--json]',
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

function renderRoom(room: RoomRecord): string {
  const rules = room.rules.length > 0 ? room.rules.map((rule, index) => `${index + 1}) ${rule}`).join('\n  ') : '(none)';
  const rows: Array<[string, string]> = [
    ['room_id', room.id],
    ['title', room.title ?? '(untitled)'],
    ['purpose', room.purpose || '(none)'],
    ['style', room.style || '(none)'],
    ['owner_id', room.ownerId],
    ['agents', room.agents.map((agent) => `${agent.name} (${agent.agentId})`).join(', ') || '(none)'],
    ['token_limit', room.tokenLimit === null ? 'unlimited' : String(room.tokenLimit)],
    ['agent_turn_limit', `${room.agentTurnLimit}${room.configuredAgentTurnLimit === null ? ' (default)' : ''}`],
    ['status', room.status],
    ['setup_revision', String(room.setupRevision)],
    ['created_at', room.createdAt ?? ''],
    ['updated_at', room.updatedAt ?? ''],
  ];
  return [['Room', ...rowsBlock(rows)].join('\n'), `Rules\n  ${rules}`].join('\n\n');
}

function renderMessage(message: RoomMessage): string {
  const fanout = Object.entries(message.fanout)
    .map(([agentId, delivered]) => `${agentId}: ${delivered ? 'delivered' : 'not delivered'}`)
    .join('\n  ');
  const rows: Array<[string, string]> = [
    ['room_id', message.sessionId],
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
  if (command === 'create' && (rest.length < 1 || rest.some((id) => !id.trim()))) {
    throw new UsageError('rooms create requires at least one agent UUID');
  }
  if ((command === 'get' || command === 'update') && (rest.length !== 1 || !rest[0].trim())) {
    throw new UsageError(`rooms ${command} requires one room ID`);
  }
  const [roomId, ...bodyWords] = command === 'message' ? rest : [undefined];
  const messageBody = command === 'message' ? bodyWords.join(' ').trim() : undefined;
  if (command === 'message' && (!roomId || !roomId.trim() || !messageBody)) {
    throw new UsageError('rooms message requires a room ID and a message body');
  }

  const sessions = (await ctx.client()).sessions;
  switch (command) {
    case 'create': {
      const room = await sessions.createRoom(rest, {
        title: optionalText(parsed.values.title),
        purpose: optionalText(parsed.values.purpose),
        style: optionalText(parsed.values.style),
        ...(rules !== undefined ? { rules } : {}),
        ...(tokenLimit !== undefined ? { tokenLimit } : {}),
        ...(agentTurnLimit !== undefined ? { agentTurnLimit } : {}),
      });
      ctx.output.result(room, renderRoom(room));
      return;
    }
    case 'get': {
      const room = await sessions.getRoom(rest[0]);
      ctx.output.result(room, renderRoom(room));
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
      ctx.output.result(room, renderRoom(room));
      return;
    }
    case 'message': {
      const replyTo = optionalText(parsed.values['reply-to']);
      const message = await sessions.createRoomMessage(
        roomId as string, messageBody as string, replyTo !== undefined ? { replyTo } : {},
      );
      ctx.output.result(message, renderMessage(message));
      return;
    }
  }
}
