import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoomMessage, RoomRecord } from '@hypercli.com/sdk';
import type { HyperCLI } from '@hypercli.com/sdk';
import * as rooms from '../src/commands/rooms.js';
import { UsageError } from '../src/core/errors.js';
import { createOutput } from '../src/core/output.js';
import type { CommandContext } from '../src/core/types.js';
import { GROUPS, findGroup } from '../src/registry.js';
import { renderRootHelp } from '../src/core/help.js';

let stdout: string;
let stderr: string;
beforeEach(() => {
  stdout = ''; stderr = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((value) => { stdout += String(value); return true; });
  vi.spyOn(process.stderr, 'write').mockImplementation((value) => { stderr += String(value); return true; });
});
afterEach(() => vi.restoreAllMocks());

const ROOM_ID = '2f5d8a10-97c3-4a1e-8b4d-9a2f6c0e7d31';
const AGENT_A = '3f6c9a20-1b4d-4e5f-8a7c-2d0e9f1b3a45';
const AGENT_B = '8d1f2b34-56a7-48b9-9c01-d23e4f5a6b7c';
const OWNER_ID = '81c2f4e6-7a8b-49c0-b1d2-3e4f5a6b7c8d';

const roomRecord: RoomRecord = {
  id: ROOM_ID, kind: 'room', title: 'Build triage',
  purpose: 'Investigate CI failures.', style: 'Concise technical discussion.',
  rules: ['Respond with new information only.'], ownerId: OWNER_ID,
  agents: [
    { agentId: AGENT_A, name: 'Atlas', internalSessionId: 'claude-9f2e' },
    { agentId: AGENT_B, name: 'Maya', internalSessionId: null },
  ],
  tokenLimit: null, agentTurnLimit: 25, configuredAgentTurnLimit: null,
  status: 'live', setupRevision: 3,
  createdAt: '2026-11-12T10:00:00Z', updatedAt: '2026-11-12T10:00:00Z',
};

const roomMessage: RoomMessage = {
  sessionId: ROOM_ID, messageId: 'msg-1', seq: 7, epochId: 'epoch-1',
  senderId: OWNER_ID, senderKind: 'user', senderName: 'Dmitry',
  body: 'Can you look at the build failure?', replyTo: null,
  createdAt: '2026-11-12T10:05:00Z', fanout: { [AGENT_A]: true, [AGENT_B]: false },
};

function setup(format: 'table' | 'json' = 'table') {
  const api = {
    createRoom: vi.fn(async () => roomRecord),
    getRoom: vi.fn(async () => roomRecord),
    updateRoom: vi.fn(async () => roomRecord),
    createRoomMessage: vi.fn(async () => roomMessage),
  };
  const client = vi.fn(async () => ({ sessions: api }) as unknown as HyperCLI);
  const ctx: CommandContext = { client, format, output: createOutput(format) };
  return { api, ctx, client };
}

describe('hyper rooms', () => {
  it('registers in root help', () => {
    expect(findGroup('rooms')).toBe(rooms);
    expect(renderRootHelp(GROUPS)).toContain('rooms');
  });

  it.each(['--help', 'create', 'get', 'update', 'message'])('prints offline help for %s', async (command) => {
    const { ctx, client } = setup();
    await rooms.run(ctx, command === '--help' ? [command] : [command, '--help']);
    expect(stdout).toContain(`hyper rooms ${command === '--help' ? 'create' : command}`);
    expect(stdout).toContain('multiparty');
    expect(client).not.toHaveBeenCalled();
  });

  it('creates a room with the full brief and both policy knobs', async () => {
    const { ctx, api } = setup();
    await rooms.run(ctx, [
      'create', AGENT_A, AGENT_B, '--title', 'Build triage', '--purpose', 'Investigate CI failures.',
      '--style', 'Concise technical discussion.', '--rule', 'Respond with new information only.',
      '--token-limit', '100000', '--agent-turn-limit', '0',
    ]);
    expect(api.createRoom).toHaveBeenCalledExactlyOnceWith([AGENT_A, AGENT_B], {
      title: 'Build triage', purpose: 'Investigate CI failures.', style: 'Concise technical discussion.',
      rules: ['Respond with new information only.'], tokenLimit: 100000, agentTurnLimit: 0,
    });
    expect(stdout).toContain('Build triage');
    expect(stdout).toContain('Atlas');
  });

  it('create omits absent optional flags so product defaults apply', async () => {
    const { ctx, api } = setup();
    await rooms.run(ctx, ['create', AGENT_A]);
    expect(api.createRoom).toHaveBeenCalledExactlyOnceWith([AGENT_A], {
      title: undefined, purpose: undefined, style: undefined,
    });
  });

  it('reads one room', async () => {
    const { ctx, api } = setup();
    await rooms.run(ctx, ['get', ROOM_ID]);
    expect(api.getRoom).toHaveBeenCalledExactlyOnceWith(ROOM_ID);
    expect(stdout).toContain(ROOM_ID);
    expect(stdout).toContain('unlimited');
    expect(stdout).toContain('25 (default)');
  });

  it('updates only the supplied fields', async () => {
    const { ctx, api } = setup();
    await rooms.run(ctx, ['update', ROOM_ID, '--title', 'New focus', '--status', 'archived']);
    expect(api.updateRoom).toHaveBeenCalledExactlyOnceWith(ROOM_ID, { title: 'New focus', status: 'archived' });
  });

  it('update maps none and repeated rules onto the wire knobs', async () => {
    const { ctx, api } = setup();
    await rooms.run(ctx, [
      'update', ROOM_ID, '--rule', 'Be terse.', '--rule', 'No repeats.',
      '--token-limit', 'none', '--agent-turn-limit', '5',
    ]);
    expect(api.updateRoom).toHaveBeenCalledExactlyOnceWith(ROOM_ID, {
      rules: ['Be terse.', 'No repeats.'], tokenLimit: null, agentTurnLimit: 5,
    });
  });

  it('posts a message body and reply reference', async () => {
    const { ctx, api } = setup();
    await rooms.run(ctx, ['message', ROOM_ID, 'Can you look', 'at the build failure?', '--reply-to', 'msg-0']);
    expect(api.createRoomMessage).toHaveBeenCalledExactlyOnceWith(
      ROOM_ID, 'Can you look at the build failure?', { replyTo: 'msg-0' },
    );
    expect(stdout).toContain('epoch-1');
    expect(stdout).toContain('delivered');
  });

  it.each(['table', 'json'] as const)('%s output is one complete SDK response', async (format) => {
    const { ctx, api } = setup(format);
    await rooms.run(ctx, ['get', ROOM_ID]);
    if (format === 'json') expect(JSON.parse(stdout)).toEqual(await api.getRoom.mock.results[0].value);
    else expect(stdout).toContain('agent_turn_limit');
    await rooms.run(ctx, ['message', ROOM_ID, 'hello']);
    if (format === 'json') {
      const lines = stdout.trim().split('\n');
      expect(JSON.parse(lines[lines.length - 1])).toEqual(await api.createRoomMessage.mock.results[0].value);
    }
  });

  it.each([
    ['unknown'], ['bogus', 'x'],
    ['create'],
    ['create', ' '],
    ['get'], ['get', 'a', 'b'],
    ['update'], ['update', 'a', 'b'],
    ['message'], ['message', ROOM_ID], ['message', '   '],
    ['get', ROOM_ID, '--title', 'x'],
    ['create', AGENT_A, '--status', 'live'],
    ['message', ROOM_ID, 'hi', '--title', 'x'],
    ['update', ROOM_ID, '--status', 'deleted'],
    ['create', AGENT_A, '--token-limit', '-5'],
    ['create', AGENT_A, '--agent-turn-limit', '1.5'],
    ['update', ROOM_ID, '--token-limit', 'abc'],
    ['create', AGENT_A, '--bogus'],
  ])('rejects bad argv %j before constructing a client', async (...args) => {
    const { ctx, client } = setup();
    await expect(rooms.run(ctx, args)).rejects.toBeInstanceOf(UsageError);
    expect(client).not.toHaveBeenCalled();
    expect(stdout).toBe('');
  });
});
