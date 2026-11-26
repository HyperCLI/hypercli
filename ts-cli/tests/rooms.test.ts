import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoomMessage, RoomParent } from '@hypercli.com/sdk';
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

const SESSION_ID = '2f5d8a10-97c3-4a1e-8b4d-9a2f6c0e7d31';
const AGENT_A = '3f6c9a20-1b4d-4e5f-8a7c-2d0e9f1b3a45';
const AGENT_B = '8d1f2b34-56a7-48b9-9c01-d23e4f5a6b7c';
const OWNER_ID = '81c2f4e6-7a8b-49c0-b1d2-3e4f5a6b7c8d';
/** What `hyper agents create` prints: the id trimmed to 12 characters. */
const SHORT_A = AGENT_A.slice(0, 12);
const SHORT_B = AGENT_B.slice(0, 12);

const PARENT_ID = '44444444-4444-4444-8444-444444444444';
const PARENT_MEMBER_PERIOD = '55555555-5555-4555-8555-555555555555';
const CHILD_GRANT_PERIOD = '66666666-6666-4666-8666-666666666666';
const parent: RoomParent = {
  id: PARENT_ID, title: 'Build triage', purpose: 'Investigate CI failures.',
  style: 'Concise technical discussion.', rules: ['Respond with new information only.'],
  token_limit: null, agent_turn_limit: 25, status: 'live', created_at: '2026-11-12T10:00:00Z',
};

const roomMessage: RoomMessage = {
  sessionId: SESSION_ID, messageId: 'msg-1', seq: 7, epochId: 'epoch-1',
  senderId: OWNER_ID, senderKind: 'user', senderName: 'Dmitry',
  body: 'Can you look at the build failure?', replyTo: null,
  createdAt: '2026-11-12T10:05:00Z', fanout: { [AGENT_A]: true, [AGENT_B]: false },
};

const AGENT_RECORDS = [
  { id: AGENT_A, name: 'helper', handle: 'helper', hostname: 'helper.example.com' },
  { id: AGENT_B, name: 'sidekick', handle: 'sidekick', hostname: 'sidekick.example.com' },
] as const;

/** Emulates the SDK's Deployments.resolveAgentId contract (agents.ts). */
function resolveAgentIdMock(ref: string): Promise<string> {
  const raw = String(ref ?? '').trim();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw)) return Promise.resolve(raw);
  const fields = (a: (typeof AGENT_RECORDS)[number]) => [a.id, a.name, a.handle, a.hostname];
  const matches = AGENT_RECORDS.filter((a) =>
    fields(a).some((v) => v === raw) || fields(a).some((v) => v.startsWith(raw)));
  if (matches.length === 0) return Promise.reject(new Error(`Agent not found: ${raw}`));
  if (matches.length > 1) {
    return Promise.reject(new Error(`Agent reference is ambiguous: ${raw} (${matches.map((m) => m.id).join(', ')})`));
  }
  return Promise.resolve(matches[0].id);
}

function setup(format: 'table' | 'json' = 'table') {
  const api = {
    createRoom: vi.fn(async () => ({ ...parent, session_id: SESSION_ID })),
    getRoom: vi.fn(async () => parent),
    listRoomSessions: vi.fn(async () => ({items: [{id:SESSION_ID,title:'test'}],next_cursor:null})),
    createRoomSession: vi.fn(async () => ({id:SESSION_ID,room_id:PARENT_ID})),
    updateSessionBudgets: vi.fn(async () => ({agent_turn_limit:null, token_limit:0})),
    listGrants:vi.fn(async()=>[]), issueMember:vi.fn(async()=>({id:CHILD_GRANT_PERIOD})), revokeMember:vi.fn(async()=>({id:CHILD_GRANT_PERIOD})),
    updateRoom: vi.fn(async () => parent),
    createRoomMessage: vi.fn(async () => roomMessage),
  };
  const deployments = { resolveAgentId: vi.fn(resolveAgentIdMock) };
  const client = vi.fn(async () => ({ sessions: api, deployments }) as unknown as HyperCLI);
  const ctx: CommandContext = { client, format, output: createOutput(format) };
  return { api, deployments, ctx, client };
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
    expect(stdout).toContain(SESSION_ID);
  });

  it('create omits absent optional flags so product defaults apply', async () => {
    const { ctx, api } = setup();
    await rooms.run(ctx, ['create', AGENT_A]);
    expect(api.createRoom).toHaveBeenCalledExactlyOnceWith([AGENT_A], {
      title: undefined, purpose: undefined, style: undefined,
    });
  });

  it('create resolves a short id prefix and a name to full agent ids', async () => {
    const { ctx, api, deployments } = setup();
    await rooms.run(ctx, ['create', SHORT_A, 'sidekick', '--title', 'Pair']);
    expect(deployments.resolveAgentId).toHaveBeenCalledWith(SHORT_A);
    expect(deployments.resolveAgentId).toHaveBeenCalledWith('sidekick');
    expect(api.createRoom).toHaveBeenCalledExactlyOnceWith([AGENT_A, AGENT_B], {
      title: 'Pair', purpose: undefined, style: undefined,
    });
  });

  it('create sends a full agent UUID unchanged, still through the resolver', async () => {
    const { ctx, api, deployments } = setup();
    await rooms.run(ctx, ['create', AGENT_A, '--title', 'Solo']);
    expect(deployments.resolveAgentId).toHaveBeenCalledExactlyOnceWith(AGENT_A);
    expect(api.createRoom).toHaveBeenCalledExactlyOnceWith([AGENT_A], {
      title: 'Solo', purpose: undefined, style: undefined,
    });
  });

  it('create with an unknown agent reference fails with the resolver error and creates nothing', async () => {
    const { ctx, api, deployments } = setup();
    await expect(rooms.run(ctx, ['create', SHORT_A, 'ghost', '--title', 'Nope']))
      .rejects.toThrow('Agent not found: ghost');
    expect(deployments.resolveAgentId).toHaveBeenCalledWith('ghost');
    expect(api.createRoom).not.toHaveBeenCalled();
  });

  it('child-create resolves its agent arguments the same way', async () => {
    const { ctx, api } = setup();
    await rooms.run(ctx, ['child-create', PARENT_ID, SHORT_B, 'helper', '--title', 'kid']);
    expect(api.createRoomSession).toHaveBeenCalledExactlyOnceWith(PARENT_ID, [AGENT_B, AGENT_A], { title: 'kid' });
    expect(stdout).toContain(SESSION_ID);
  });

  it('reads one room', async () => {
    const { ctx, api } = setup();
    await rooms.run(ctx, ['get', PARENT_ID]);
    expect(api.getRoom).toHaveBeenCalledExactlyOnceWith(PARENT_ID);
    expect(stdout).toContain(PARENT_ID);
    expect(stdout).toContain('live');
  });

  it('lists and creates children under the exact parent', async () => {
    const {ctx,api} = setup();
    await rooms.run(ctx,['children',PARENT_ID]);
    expect(api.listRoomSessions).toHaveBeenCalledWith(PARENT_ID,undefined);
    await rooms.run(ctx,['child-create',PARENT_ID,AGENT_A,'--title','test']);
    expect(api.createRoomSession).toHaveBeenCalledWith(PARENT_ID,[AGENT_A],{title:'test'});
    expect(stdout).toContain(SESSION_ID);
  });

  it('routes session override edits to the child, including clear and zero', async () => {
    const {ctx, api} = setup();
    await rooms.run(ctx, ['session-budget', SESSION_ID, '--token-limit', '0', '--agent-turn-limit', 'none']);
    expect(api.updateSessionBudgets).toHaveBeenCalledExactlyOnceWith(SESSION_ID, {token_limit:0,agent_turn_limit:null});
    expect(api.updateRoom).not.toHaveBeenCalled();
  });

  it('lists exact periods and uses the parent member period only for child issuance',async()=>{
    const {ctx,api}=setup();
    await rooms.run(ctx,['grants','rooms',PARENT_ID]);
    expect(api.listGrants).toHaveBeenCalledWith('rooms',PARENT_ID,undefined);
    await rooms.run(ctx,['grant','sessions',SESSION_ID,CHILD_GRANT_PERIOD,'agent',AGENT_A,PARENT_MEMBER_PERIOD]);
    expect(api.issueMember).toHaveBeenCalledWith('sessions',SESSION_ID,CHILD_GRANT_PERIOD,{subject_type:'agent',subject_id:AGENT_A,member_grant_id:PARENT_MEMBER_PERIOD});
    await rooms.run(ctx,['revoke','sessions',SESSION_ID,CHILD_GRANT_PERIOD]);
    expect(api.revokeMember).toHaveBeenCalledWith('sessions',SESSION_ID,CHILD_GRANT_PERIOD);
  });
  it('updates only the supplied fields', async () => {
    const { ctx, api } = setup();
    await rooms.run(ctx, ['update', PARENT_ID, '--title', 'New focus', '--status', 'archived']);
    expect(api.updateRoom).toHaveBeenCalledExactlyOnceWith(PARENT_ID, { title: 'New focus', status: 'archived' });
  });

  it('update maps none and repeated rules onto the wire knobs', async () => {
    const { ctx, api } = setup();
    await rooms.run(ctx, [
      'update', PARENT_ID, '--rule', 'Be terse.', '--rule', 'No repeats.',
      '--token-limit', 'none', '--agent-turn-limit', '5',
    ]);
    expect(api.updateRoom).toHaveBeenCalledExactlyOnceWith(PARENT_ID, {
      rules: ['Be terse.', 'No repeats.'], tokenLimit: null, agentTurnLimit: 5,
    });
  });

  it('posts a message body and reply reference', async () => {
    const { ctx, api } = setup();
    await rooms.run(ctx, ['message', SESSION_ID, 'Can you look', 'at the build failure?', '--reply-to', 'msg-0']);
    expect(api.createRoomMessage).toHaveBeenCalledExactlyOnceWith(
      SESSION_ID, 'Can you look at the build failure?', { replyTo: 'msg-0' },
    );
    expect(stdout).toContain('epoch-1');
    expect(stdout).toContain('delivered');
  });

  it.each(['table', 'json'] as const)('%s output is one complete SDK response', async (format) => {
    const { ctx, api } = setup(format);
    await rooms.run(ctx, ['get', PARENT_ID]);
    if (format === 'json') expect(JSON.parse(stdout)).toEqual(await api.getRoom.mock.results[0].value);
    else expect(stdout).toContain('room_id');
    await rooms.run(ctx, ['message', SESSION_ID, 'hello']);
    if (format === 'json') {
      const lines = stdout.trim().split('\n');
      expect(JSON.parse(lines[lines.length - 1])).toEqual(await api.createRoomMessage.mock.results[0].value);
    }
  });

  it.each([
    ['unknown'], ['bogus', 'x'],
    ['create', ' '],
    ['get'], ['get', 'a', 'b'],
    ['update'], ['update', 'a', 'b'],
    ['message'], ['message', SESSION_ID], ['message', '   '],
    ['get', PARENT_ID, '--title', 'x'],
    ['create', AGENT_A, '--status', 'live'],
    ['message', SESSION_ID, 'hi', '--title', 'x'],
    ['update', PARENT_ID, '--status', 'deleted'],
    ['create', AGENT_A, '--token-limit', '-5'],
    ['create', AGENT_A, '--agent-turn-limit', '1.5'],
    ['update', PARENT_ID, '--token-limit', 'abc'],
    ['create', AGENT_A, '--bogus'],
  ])('rejects bad argv %j before constructing a client', async (...args) => {
    const { ctx, client } = setup();
    await expect(rooms.run(ctx, args)).rejects.toBeInstanceOf(UsageError);
    expect(client).not.toHaveBeenCalled();
    expect(stdout).toBe('');
  });
});
