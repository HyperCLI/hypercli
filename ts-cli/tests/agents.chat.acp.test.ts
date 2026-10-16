import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { describe, expect, it } from 'vitest';

const id = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const root = fileURLToPath(new URL('..', import.meta.url));

async function exercise(args: string[], mode = 'reply') {
  const home = await mkdtemp(join(tmpdir(), 'hyper-chat-'));
  const frames: any[] = [];
  const modeWrites: unknown[] = [];
  const sequence: string[] = [];
  const connectionPaths: string[] = [];
  let acpClosed = false;
  const nativeAnswers: unknown[] = [];
  let appPeer: WebSocket | undefined;
  let app: WebSocket | undefined;
  let appFinished!: () => void;
  const appCompletion = new Promise<void>(resolve => { appFinished = resolve; });
  const requests: string[] = [];
  const server = createServer((req, res) => {
    requests.push(req.url!);
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'POST' && req.url === '/agents/sessions/public-session') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        const update = JSON.parse(body);
        modeWrites.push(update);
        sequence.push('set-mode');
        if (mode === 'policy-interrupt') child!.kill('SIGINT');
        setTimeout(() => {
          sequence.push('mode-response');
          res.statusCode = mode === 'policy-error' ? 503 : 200;
          res.end(JSON.stringify(mode === 'policy-error' ? { detail: 'mode unavailable' } : { mode: update.mode }));
        }, mode === 'policy-stall' || mode === 'policy-interrupt' ? 1500 : 100);
      });
      return;
    }
    res.end(JSON.stringify(req.url?.endsWith('/runtime-paths') ? { cwd: '/workspace' }
      : { id, name: 'test', runtime: 'opencode', state: 'RUNNING' }));
  });
  const ws = new WebSocketServer({ server });
  let child: ReturnType<typeof spawn> | undefined;
  ws.on('connection', (socket, request) => {
    connectionPaths.push(new URL(request.url!, 'http://localhost').pathname);
    if (request.url === '/app') {
      appPeer = socket;
      socket.on('message', data => {
        nativeAnswers.push(JSON.parse(String(data)));
        appFinished();
      });
      return;
    }
    socket.on('close', () => { acpClosed = true; });
    socket.on('message', data => {
    const frame = JSON.parse(String(data));
    const send = (value: unknown) => socket.send(JSON.stringify(value));
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
      if (mode === 'permission' || mode === 'permission-app') {
        send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'public-session',
          update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Partial reply' } } } });
        send({ jsonrpc: '2.0', id: 'callback-opaque', method: 'session/request_permission', params: {
          sessionId: 'public-session', toolCall: { toolCallId: 'tool-1', title: 'secret-tool-title', status: 'pending' },
          options: [{ optionId: 'opaque-X9', name: 'Permit', kind: 'allow_once' },
            { optionId: 'opaque-Y8', name: 'Reject', kind: 'reject_once' }],
        } });
        appPeer?.send(JSON.stringify({ jsonrpc: '2.0', id: 'app-callback', method: 'session/request_permission', params: {
          sessionId: 'public-session', options: [{ optionId: 'opaque-X9', kind: 'allow_once', name: 'Permit' }],
        } }));
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
    if (mode === 'permission-app') {
      app = new WebSocket(base.replace('http:', 'ws:') + '/app');
      app.on('message', data => {
        const request = JSON.parse(String(data));
        setTimeout(() => app!.send(JSON.stringify({ jsonrpc: '2.0', id: request.id,
          result: { outcome: { outcome: 'selected', optionId: request.params.options[0].optionId } } })), 50);
      });
      await once(app, 'open');
    }
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
    if (mode === 'permission-app') await appCompletion;
    return { code, signal, stdout, stderr, frames, requests, modeWrites, sequence, acpClosed, nativeAnswers, connectionPaths };
  } finally {
    app?.close();
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
    expect(run.modeWrites, JSON.stringify(run.requests)).toEqual([{ mode: value }]);
    expect(run.sequence.indexOf('set-mode')).toBeGreaterThan(run.sequence.indexOf('session/new'));
    expect(run.sequence.indexOf('session/prompt')).toBeGreaterThan(run.sequence.indexOf('mode-response'));
    expect(run.connectionPaths).toEqual(['/ws/acp']);
    expect(run.acpClosed).toBe(true);
    expect(JSON.parse(run.stdout).reply).toBe('Hello');
  });
  it.each(['policy-error', 'policy-stall'])(
    'fails %s without prompting and closes the chat transport', async mode => {
      const run = await exercise(['--permissions', 'auto', '--timeout', '1'], mode);
      expect(run.code, run.stderr).toBe(1);
      expect(run.stdout).toBe('');
      expect(run.stderr).toContain('policy');
      expect(run.frames.some(f => f.method === 'session/prompt')).toBe(false);
      expect(run.modeWrites).toEqual([{ mode: 'auto' }]);
      expect(run.connectionPaths).toEqual(['/ws/acp']);
      expect(run.acpClosed).toBe(true);
    });
  it('closes chat on SIGINT during the HTTP mode update without prompting', async () => {
    const run = await exercise(['--permissions', 'auto'], 'policy-interrupt');
    expect(run.code, run.stderr).toBe(130);
    expect(run.stdout).toBe('');
    expect(run.acpClosed).toBe(true);
    expect(run.frames.some(f => f.method === 'session/prompt')).toBe(false);
    expect(run.frames.some(f => f.method === 'session/cancel')).toBe(false);
  });
  it('omission prompts over ACP and emits one JSON result', async () => {
    const run = await exercise([]);
    expect(run.code, run.stderr).toBe(0);
    expect(JSON.parse(run.stdout).reply).toBe('Hello');
    expect(run.frames.map(f => f.method)).toEqual(['initialize', 'session/new', 'session/prompt']);
    expect(run.modeWrites).toEqual([]);
    expect(run.connectionPaths).toEqual(['/ws/acp']);
  });
  it('abstains from an opaque permission callback without cancelling the shared turn', async () => {
    const run = await exercise([], 'permission');
    expect(run.code, run.stderr).toBe(1);
    expect(run.stdout).toBe('');
    expect(run.stderr).toContain('"phase":"pending"');
    expect(run.stderr).toContain('permission required');
    expect(run.stderr).not.toContain('secret-tool-title');
    expect(run.frames.find(f => f.id === 'callback-opaque')).toEqual({ jsonrpc: '2.0', id: 'callback-opaque', result: { outcome: { outcome: 'cancelled' } } });
    expect(run.frames.some(f => f.method === 'session/cancel')).toBe(false);
  });
  it('never cancels a preexisting turn or prompts after a timed-out mode update responds late', async () => {
    const run = await exercise(['--session', 'public-session', '--permissions', 'auto', '--timeout', '1'], 'policy-stall');
    expect(run.code, run.stderr).toBe(1);
    expect(run.frames.some(f => f.method === 'session/resume')).toBe(true);
    expect(run.frames.some(f => f.method === 'session/prompt')).toBe(false);
    expect(run.frames.some(f => f.method === 'session/cancel')).toBe(false);
  });
  it('allows an app observer to select after CLI abstention, with one native answer and no cancellation', async () => {
    const run = await exercise([], 'permission-app');
    expect(run.code, run.stderr).toBe(1);
    expect(run.frames.filter(f => f.id === 'callback-opaque')).toHaveLength(1);
    expect(run.frames.find(f => f.id === 'callback-opaque').result.outcome.outcome).toBe('cancelled');
    expect(run.frames.some(f => f.method === 'session/cancel')).toBe(false);
    expect(run.nativeAnswers).toEqual([{ jsonrpc: '2.0', id: 'app-callback',
      result: { outcome: { outcome: 'selected', optionId: 'opaque-X9' } } }]);
  });
  it('resumes without policy mutation and keeps JSON streaming on stderr', async () => {
    const run = await exercise(['--session', 'public-session', '--stream']);
    expect(run.code, run.stderr).toBe(0);
    expect(JSON.parse(run.stdout).session).toEqual({ id: 'public-session', resumed: true });
    expect(run.stderr).toContain('Hello');
    expect(run.frames.map(f => f.method)).toEqual(['initialize', 'session/list', 'session/resume', 'session/prompt']);
    expect(run.modeWrites).toEqual([]);
    expect(run.connectionPaths).toEqual(['/ws/acp']);
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
