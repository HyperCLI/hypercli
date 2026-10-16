import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { describe, expect, it } from 'vitest';

const id = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const root = fileURLToPath(new URL('..', import.meta.url));

async function exercise(args: string[], mode = 'reply') {
  const home = await mkdtemp(join(tmpdir(), 'hyper-chat-'));
  const frames: any[] = [];
  const policyFrames: any[] = [];
  const sequence: string[] = [];
  let policyClosed = false;
  const requests: string[] = [];
  const server = createServer((req, res) => {
    requests.push(req.url!);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(req.url?.endsWith('/runtime-paths') ? { cwd: '/workspace' }
      : { id, name: 'test', runtime: 'opencode', state: 'RUNNING' }));
  });
  const ws = new WebSocketServer({ server });
  let child: ReturnType<typeof spawn> | undefined;
  ws.on('connection', (socket, request) => {
    const isPolicy = request.url?.startsWith('/ws/session-policy');
    if (isPolicy) socket.on('close', () => { policyClosed = true; });
    socket.on('message', data => {
    const frame = JSON.parse(String(data));
    const send = (value: unknown) => socket.send(JSON.stringify(value));
    if (isPolicy) {
      policyFrames.push(frame);
      sequence.push(frame.type);
      const snapshot = (revision: number, selected: string, status = 'pending') => ({
        type: 'session.policy.snapshot', request_id: frame.request_id, session_id: frame.session_id, agent_id: frame.agent_id,
        desired: { revision, mode: selected }, applied: { status, revision: status === 'applied' ? revision : 0,
          mode: status === 'applied' ? selected : 'ask', runtime_generation: 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb',
          binding_id: 'cccccccc-1111-4111-8111-cccccccccccc' },
      });
      if (frame.type === 'session.policy.subscribe') send(snapshot(0, mode === 'same' ? 'auto' : 'ask'));
      if (frame.type === 'session.policy.set') {
        if (mode === 'conflict') {
          send({ type: 'session.policy.result', request_id: frame.request_id, origin: id, outcome: 'conflict' });
          return;
        }
        const revision = mode === 'same' ? 0 : 1;
        send(snapshot(mode === 'superseded' ? 2 : revision, mode === 'superseded-mode' ? 'none' : frame.mode));
        if (mode === 'policy-interrupt') { child!.kill('SIGINT'); return; }
        if (mode === 'policy-disconnect') { socket.close(); return; }
        if (mode === 'policy-stall') return;
        if (mode === 'stale') send({ ...snapshot(0, 'ask', 'applied'), type: 'session.policy.applied' });
        setTimeout(() => {
          if (socket.readyState !== 1) return;
          const applied = snapshot(revision, frame.mode, mode === 'unsupported' ? 'unsupported' : 'applied');
          if (mode === 'wrong-binding') applied.applied.binding_id = 'dddddddd-1111-4111-8111-dddddddddddd';
          if (mode === 'wrong-generation') applied.applied.runtime_generation = 'dddddddd-1111-4111-8111-dddddddddddd';
          sequence.push('host-applied');
          send({ ...applied, type: 'session.policy.applied' });
        }, 100);
      }
      return;
    }
    frames.push(frame);
    sequence.push(frame.method);
    const result = (value: unknown) => send({ jsonrpc: '2.0', id: frame.id, result: value });
    if (frame.method === 'initialize') result({ protocolVersion: 1, agentCapabilities: { sessionCapabilities: { resume: {} } } });
    if (frame.method === 'session/new') result({ sessionId: 'public-session' });
    if (frame.method === 'session/list') result({ sessions: [{ sessionId: 'public-session', cwd: '/workspace' }] });
    if (frame.method === 'session/resume') result({});
    if (frame.method === 'session/prompt') {
      if (mode === 'disconnect') { socket.close(); return; }
      if (mode === 'interrupt') { child!.kill('SIGINT'); return; }
      if (mode === 'stall') return;
      if (mode === 'permission') {
        send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'public-session',
          update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Partial reply' } } } });
        send({ jsonrpc: '2.0', id: 'callback-opaque', method: 'session/request_permission', params: {
          sessionId: 'public-session', toolCall: { toolCallId: 'tool-1', title: 'secret-tool-title', status: 'pending' },
          options: [{ optionId: 'opaque-X9', name: 'Permit', kind: 'allow_once' },
            { optionId: 'opaque-Y8', name: 'Reject', kind: 'reject_once' }],
        } });
        return;
      }
      send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'public-session',
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hello' } } } });
      result({ stopReason: 'end_turn' });
    }
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  try {
    child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts', 'agents', 'chat', id, 'hello', '--json', ...args], {
      cwd: root, env: { ...process.env, HYPER_HOME: home, HYPER_API_KEY: 'test-only',
        HYPER_API_BASE: base, HYPER_AGENTS_API_BASE: base }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout!.on('data', data => { stdout += data; });
    child.stderr!.on('data', data => { stderr += data; });
    const deadline = setTimeout(() => child!.kill('SIGKILL'), 8000);
    const [code, signal] = await once(child, 'close');
    clearTimeout(deadline);
    return { code, signal, stdout, stderr, frames, requests, policyFrames, sequence, policyClosed };
  } finally {
    for (const client of ws.clients) client.terminate();
    await new Promise<void>(resolve => ws.close(() => resolve()));
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(home, { recursive: true, force: true });
  }
}

describe('chat actual argv and SDK wire', () => {
  it('rejects a missing option value before network', async () => {
    const run = await exercise(['--permissions']);
    expect(run.code).toBe(2);
    expect(run.requests).toEqual([]);
    expect(run.stdout).toBe('');
  });
  it.each(['ask', 'invalid', ''])('rejects %j without network', async value => {
    const run = await exercise(['--permissions', value]);
    expect(run.code).toBe(2);
    expect(run.requests).toEqual([]);
    expect(run.stdout).toBe('');
    expect(run.stderr).toContain(value === 'ask' ? 'interactive permission UI' : 'auto or none');
  });
  it.each(['auto', 'none'])('applies persisted %s before prompting', async value => {
    const run = await exercise(['--permissions', value]);
    expect(run.code, run.stderr).toBe(0);
    expect(run.policyFrames.map(f => f.type)).toEqual(['session.policy.subscribe', 'session.policy.set']);
    expect(run.policyFrames[1]).toMatchObject({ mode: value, expected_revision: 0, session_id: 'public-session', agent_id: id });
    expect(run.sequence.indexOf('session/prompt')).toBeGreaterThan(run.sequence.indexOf('host-applied'));
    expect(run.policyClosed).toBe(true);
    expect(JSON.parse(run.stdout).reply).toBe('Hello');
  });
  it.each(['same', 'stale'])('waits for application with %s revision evidence', async mode => {
    const run = await exercise(['--permissions', 'auto'], mode);
    expect(run.code, run.stderr).toBe(0);
    expect(run.sequence.indexOf('session/prompt')).toBeGreaterThan(run.sequence.indexOf('host-applied'));
  });
  it.each(['conflict', 'superseded', 'superseded-mode', 'wrong-binding', 'wrong-generation', 'unsupported', 'policy-disconnect', 'policy-stall'])(
    'fails %s without prompting and closes policy transport', async mode => {
      const run = await exercise(['--permissions', 'auto', '--timeout', '1'], mode);
      expect(run.code, run.stderr).toBe(1);
      expect(run.stdout).toBe('');
      expect(run.stderr).toContain('policy');
      expect(run.frames.some(f => f.method === 'session/prompt')).toBe(false);
      expect(run.policyFrames.filter(f => f.type === 'session.policy.set')).toHaveLength(1);
      expect(run.policyClosed).toBe(true);
    });
  it('closes both transports on SIGINT during policy application without prompting', async () => {
    const run = await exercise(['--permissions', 'auto'], 'policy-interrupt');
    expect(run.code, run.stderr).toBe(130);
    expect(run.stdout).toBe('');
    expect(run.policyClosed).toBe(true);
    expect(run.frames.some(f => f.method === 'session/prompt')).toBe(false);
    expect(run.frames.some(f => f.method === 'session/cancel')).toBe(true);
  });
  it('omission prompts over ACP and emits one JSON result', async () => {
    const run = await exercise([]);
    expect(run.code, run.stderr).toBe(0);
    expect(JSON.parse(run.stdout).reply).toBe('Hello');
    expect(run.frames.map(f => f.method)).toEqual(['initialize', 'session/new', 'session/prompt']);
    expect(run.requests.some(path => path.includes('policy'))).toBe(false);
  });
  it('cancels an opaque permission callback and the turn with a clear failure', async () => {
    const run = await exercise([], 'permission');
    expect(run.code, run.stderr).toBe(1);
    expect(run.stdout).toBe('');
    expect(run.stderr).toContain('"phase":"pending"');
    expect(run.stderr).toContain('permission required');
    expect(run.stderr).not.toContain('secret-tool-title');
    expect(run.frames.find(f => f.id === 'callback-opaque')).toEqual({ jsonrpc: '2.0', id: 'callback-opaque', result: { outcome: { outcome: 'cancelled' } } });
    expect(run.frames.some(f => f.method === 'session/cancel')).toBe(true);
  });
  it('resumes without policy mutation and keeps JSON streaming on stderr', async () => {
    const run = await exercise(['--session', 'public-session', '--stream']);
    expect(run.code, run.stderr).toBe(0);
    expect(JSON.parse(run.stdout).session).toEqual({ id: 'public-session', resumed: true });
    expect(run.stderr).toContain('Hello');
    expect(run.frames.map(f => f.method)).toEqual(['initialize', 'session/list', 'session/resume', 'session/prompt']);
    expect(run.requests.some(path => path.includes('policy'))).toBe(false);
  });
  it.each(['stall', 'interrupt'])('bounded cancellation on %s', async mode => {
    const run = await exercise(['--timeout', '1'], mode);
    expect(run.code, run.stderr).toBe(mode === 'interrupt' ? 130 : 1);
    expect(run.stdout).toBe('');
    expect(run.frames.some(f => f.method === 'session/cancel')).toBe(true);
  });
  it('does not replay a prompt after socket loss', async () => {
    const run = await exercise([], 'disconnect');
    expect(run.code).toBe(1);
    expect(run.stdout).toBe('');
    expect(run.frames.filter(f => f.method === 'session/prompt')).toHaveLength(1);
  });
});
