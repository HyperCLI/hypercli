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
  const requests: string[] = [];
  const server = createServer((req, res) => {
    requests.push(req.url!);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(req.url?.endsWith('/runtime-paths') ? { cwd: '/workspace' }
      : { id, name: 'test', runtime: 'opencode', state: 'RUNNING' }));
  });
  const ws = new WebSocketServer({ server });
  let child: ReturnType<typeof spawn> | undefined;
  ws.on('connection', socket => socket.on('message', data => {
    const frame = JSON.parse(String(data));
    frames.push(frame);
    const send = (value: unknown) => socket.send(JSON.stringify(value));
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
  }));
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
    return { code, signal, stdout, stderr, frames, requests };
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
  it.each(['auto', 'none'])('reports missing SDK policy seam for %s without network', async value => {
    const run = await exercise(['--permissions', value]);
    expect(run.code).toBe(1);
    expect(run.requests).toEqual([]);
    expect(run.stderr).toContain('SDK product session-policy support');
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
