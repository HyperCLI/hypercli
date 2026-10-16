import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import NodeWebSocket, { WebSocketServer } from 'ws';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Deployments, parseAgentLogFrame, AgentCapturedLogsError, type AgentCapturedLogsEvent } from '../src/agents.js';
import { HTTPClient } from '../src/http.js';

afterEach(() => vi.unstubAllGlobals());

function captured(logs = 'first\nsecond\n'): AgentCapturedLogsEvent {
  return {
    event: 'captured_logs', agent_id: '00000000-0000-4000-8000-000000000001',
    transport: 'runner', logs, unavailable: null,
    captures: [{
      assignment_id: '00000000-0000-4000-8000-000000000002', source: 'stdout', generation: 'current',
      file_generation: 'inode-1', launch_epoch: 7, content_base64: Buffer.from(logs).toString('base64'),
      truncated: true, unavailable: null, capture: { state: 'capturing', dropped_bytes: 3 },
      diagnostics_dropped: 2, runner_version: '0.8.5', runner_revision: 'abc123', executable_sha256: 'a'.repeat(64),
    }, {
      assignment_id: '00000000-0000-4000-8000-000000000002', source: 'stderr', generation: 'current',
      file_generation: null, launch_epoch: null, content_base64: null, truncated: false,
      unavailable: 'io_error', capture: { state: 'unavailable', dropped_bytes: 0 },
      diagnostics_dropped: 0, runner_version: '0.8.5', runner_revision: null, executable_sha256: null,
    }],
  };
}

/**
 * A socket the test drives by hand for callback/lifecycle ordering. The real
 * loopback test below also sends frames immediately on connection, guarding
 * the initial-snapshot race between socket opening and subscriber attachment.
 */
class ControllableWebSocket {
  public static instances: ControllableWebSocket[] = [];
  public onopen: (() => void) | null = null;
  public onmessage: ((event: { data: unknown }) => void) | null = null;
  public onerror: (() => void) | null = null;
  public onclose: ((event: { code: number; reason: string }) => void) | null = null;
  public close = vi.fn();

  constructor(public readonly url: string) {
    ControllableWebSocket.instances.push(this);
    queueMicrotask(() => this.onopen?.());
  }

  emit(frame: unknown) {
    this.onmessage?.({ data: typeof frame === 'string' ? frame : JSON.stringify(frame) });
  }

  end(code = 1000, reason = '') {
    this.onclose?.({ code, reason });
  }
}

function deploymentsWithLogsToken() {
  const post = vi.fn().mockResolvedValue({
    agent_id: 'agent-1',
    token: 'logs-token',
    expires_at: '2026-08-15T00:00:00Z',
    ws_url: 'wss://api.agents.dev.hypercli.com/ws/logs/agent-1',
  });
  const agents = new Deployments(
    { post, get: vi.fn(), delete: vi.fn(), apiKey: 'hyper_api_test' } as any,
    'sk-hyper-test',
    'https://api.dev.hypercli.com',
  );
  return { agents, post };
}

describe('parseAgentLogFrame', () => {
  it('preserves exact capture bytes, partial availability, health and provenance as a replacement event', () => {
    const snapshot = captured();
    expect(parseAgentLogFrame(JSON.stringify(snapshot))).toEqual({ kind: 'capturedLogs', snapshot });
    const empty = captured('');
    expect(empty.captures[0].content_base64).toBe('');
    expect(parseAgentLogFrame(JSON.stringify(empty))).toEqual({ kind: 'capturedLogs', snapshot: empty });
    expect(parseAgentLogFrame(JSON.stringify({ event: 'captured_logs' }))).toEqual({ kind: 'error', detail: 'Invalid captured logs snapshot' });
  });
  it('decodes the envelope the backend actually sends', () => {
    expect(parseAgentLogFrame(JSON.stringify({ event: 'log', log: 'hello' })))
      .toEqual({ kind: 'log', line: 'hello' });
    expect(parseAgentLogFrame(JSON.stringify({ event: 'history_end' })))
      .toEqual({ kind: 'historyEnd' });
    expect(parseAgentLogFrame(JSON.stringify({ event: 'error', detail: 'boom' })))
      .toEqual({ kind: 'error', detail: 'boom' });
  });

  it('degrades an unparsable or pre-envelope frame to a log line', () => {
    expect(parseAgentLogFrame('plain text')).toEqual({ kind: 'log', line: 'plain text' });
    expect(parseAgentLogFrame('[1,2]')).toEqual({ kind: 'log', line: '[1,2]' });
    expect(parseAgentLogFrame(JSON.stringify({ log: 'no event' })))
      .toEqual({ kind: 'log', line: JSON.stringify({ log: 'no event' }) });
  });

  it('ignores unknown control frames so they never render as log text', () => {
    expect(parseAgentLogFrame(JSON.stringify({ event: 'log_snapshot', logs: 'a\nb' })))
      .toEqual({ kind: 'ignore' });
  });

  it('supplies a detail for an error frame that carries none', () => {
    expect(parseAgentLogFrame(JSON.stringify({ event: 'error' })))
      .toEqual({ kind: 'error', detail: 'Log stream failed' });
  });
});

describe('Deployments.subscribeLogs', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    ControllableWebSocket.instances = [];
    vi.stubGlobal('WebSocket', ControllableWebSocket as any);
  });

  it('delivers overlapping tails only as replacements and forwards runner read selectors', async () => {
    const { agents } = deploymentsWithLogsToken();
    const lines = vi.fn(), snapshots: AgentCapturedLogsEvent[] = [];
    let displayed = '';
    const done = agents.subscribeLogs('agent-1', lines, {
      source: 'stderr', generation: 'previous', maxBytes: 1234, maxLines: 17,
      onCapturedLogs: async snapshot => { snapshots.push(snapshot); displayed = snapshot.logs ?? ''; },
    });
    await vi.waitFor(() => expect(ControllableWebSocket.instances[0]?.onmessage).toBeTypeOf('function'));
    const socket = ControllableWebSocket.instances[0], url = new URL(socket.url);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ source: 'stderr', generation: 'previous', max_bytes: '1234', max_lines: '17' });
    socket.emit(captured('first\nsecond\n'));
    socket.emit(captured('second\nthird\n'));
    const healthOnly = captured('second\nthird\n');
    healthOnly.captures[0].diagnostics_dropped = 9;
    socket.emit(healthOnly);
    socket.end(); await done;
    expect(lines).not.toHaveBeenCalled();
    expect(snapshots).toHaveLength(3);
    expect(snapshots[2].captures[0].diagnostics_dropped).toBe(9);
    expect(displayed).toBe('second\nthird\n');
  });

  it.each([null, 'offline'])('settles non-following captured reads after the awaited snapshot callback (%s)', async unavailable => {
    const { agents } = deploymentsWithLogsToken();
    const received = vi.fn();
    const done = agents.subscribeLogs('agent-1', vi.fn(), { follow: false, onCapturedLogs: received });
    await vi.waitFor(() => expect(ControllableWebSocket.instances[0]?.onmessage).toBeTypeOf('function'));
    const socket = ControllableWebSocket.instances[0];
    const snapshot = unavailable ? { ...captured(), unavailable, logs: null, captures: [] } : captured('');
    socket.emit(snapshot); await done;
    expect(received).toHaveBeenCalledExactlyOnceWith(snapshot);
    expect(socket.close).toHaveBeenCalled();
  });

  it('fails explicitly for a legacy append-only consumer instead of silently dropping runner logs', async () => {
    const { agents } = deploymentsWithLogsToken(), lines = vi.fn();
    const done = agents.subscribeLogs('agent-1', lines);
    await vi.waitFor(() => expect(ControllableWebSocket.instances[0]?.onmessage).toBeTypeOf('function'));
    ControllableWebSocket.instances[0].emit(captured());
    await expect(done).rejects.toThrow('onCapturedLogs');
    expect(lines).not.toHaveBeenCalled();
  });

  it('settles and detaches when a replacement renderer rejects', async () => {
    const { agents } = deploymentsWithLogsToken();
    const done = agents.subscribeLogs('agent-1', vi.fn(), {
      onCapturedLogs: async () => { throw new Error('render failed'); },
    });
    await vi.waitFor(() => expect(ControllableWebSocket.instances[0]?.onmessage).toBeTypeOf('function'));
    const socket = ControllableWebSocket.instances[0]; socket.emit(captured());
    await expect(done).rejects.toThrow('render failed');
    expect(socket.onmessage).toBeNull(); expect(socket.close).toHaveBeenCalled();
  });

  it('delivers replayed history, reports the boundary, then streams live lines', async () => {
    const { agents } = deploymentsWithLogsToken();
    const lines: string[] = [];
    const order: string[] = [];

    const done = agents.subscribeLogs('agent-1', (line) => {
      lines.push(line);
      order.push(`log:${line}`);
    }, {
      tailLines: 0,
      onHistoryEnd: () => { order.push('history_end'); },
    });

    await vi.waitFor(() => expect(ControllableWebSocket.instances).toHaveLength(1));
    const socket = ControllableWebSocket.instances[0];
    await vi.waitFor(() => expect(socket.onmessage).not.toBeNull());

    socket.emit({ event: 'log', log: 'past-1' });
    socket.emit({ event: 'log', log: 'past-2' });
    socket.emit({ event: 'history_end' });
    socket.emit({ event: 'log', log: 'live-1' });
    socket.end();
    await done;

    expect(lines).toEqual(['past-1', 'past-2', 'live-1']);
    expect(order).toEqual(['log:past-1', 'log:past-2', 'history_end', 'log:live-1']);
  });

  it('requests the whole snapshot when tailLines is 0', async () => {
    const { agents } = deploymentsWithLogsToken();
    const done = agents.subscribeLogs('agent-1', () => {}, { tailLines: 0, follow: false });

    await vi.waitFor(() => expect(ControllableWebSocket.instances).toHaveLength(1));
    const socket = ControllableWebSocket.instances[0];
    expect(socket.url).toContain('tail_lines=0');

    await vi.waitFor(() => expect(socket.onmessage).not.toBeNull());
    socket.emit({ event: 'history_end' });
    await done;
  });

  it('resolves at history_end without follow, so a stopped agent cannot hang', async () => {
    const { agents } = deploymentsWithLogsToken();
    const lines: string[] = [];
    const done = agents.subscribeLogs('agent-1', (line) => lines.push(line), { follow: false });

    await vi.waitFor(() => expect(ControllableWebSocket.instances).toHaveLength(1));
    const socket = ControllableWebSocket.instances[0];
    await vi.waitFor(() => expect(socket.onmessage).not.toBeNull());

    socket.emit({ event: 'log', log: 'only-history' });
    socket.emit({ event: 'history_end' });

    // Never closed by the peer: resolution comes from the boundary alone.
    await done;
    expect(lines).toEqual(['only-history']);
    expect(socket.close).toHaveBeenCalled();
  });

  it('rejects on an error frame and stops delivering lines', async () => {
    const { agents } = deploymentsWithLogsToken();
    const lines: string[] = [];
    const done = agents.subscribeLogs('agent-1', (line) => lines.push(line));

    await vi.waitFor(() => expect(ControllableWebSocket.instances).toHaveLength(1));
    const socket = ControllableWebSocket.instances[0];
    await vi.waitFor(() => expect(socket.onmessage).not.toBeNull());

    socket.emit({ event: 'error', detail: 'Log stream failed' });
    await expect(done).rejects.toThrow('Log stream failed');

    socket.emit({ event: 'log', log: 'after-error' });
    expect(lines).toEqual([]);
  });

  it('resolves when the caller aborts', async () => {
    const { agents } = deploymentsWithLogsToken();
    const controller = new AbortController();
    const done = agents.subscribeLogs('agent-1', () => {}, { signal: controller.signal });

    await vi.waitFor(() => expect(ControllableWebSocket.instances).toHaveLength(1));
    const socket = ControllableWebSocket.instances[0];
    await vi.waitFor(() => expect(socket.onmessage).not.toBeNull());

    controller.abort();
    await done;
    expect(socket.close).toHaveBeenCalled();
  });

  it('reports the close code so the caller can own reconnect policy', async () => {
    const { agents } = deploymentsWithLogsToken();
    const closes: { code: number; reason: string }[] = [];
    const ready: string[] = [];
    const done = agents.subscribeLogs('agent-1', () => {}, {
      onReady: () => { ready.push('ready'); },
      onClose: (event) => { closes.push(event); },
    });

    await vi.waitFor(() => expect(ControllableWebSocket.instances).toHaveLength(1));
    const socket = ControllableWebSocket.instances[0];
    await vi.waitFor(() => expect(socket.onmessage).not.toBeNull());

    socket.end(4401, 'Token expired');
    await done;

    expect(ready).toEqual(['ready']);
    expect(closes).toEqual([{ code: 4401, reason: 'Token expired' }]);
  });

  it('does not reconnect, so history is never replayed twice', async () => {
    const { agents } = deploymentsWithLogsToken();
    const lines: string[] = [];
    const done = agents.subscribeLogs('agent-1', (line) => lines.push(line));

    await vi.waitFor(() => expect(ControllableWebSocket.instances).toHaveLength(1));
    const socket = ControllableWebSocket.instances[0];
    await vi.waitFor(() => expect(socket.onmessage).not.toBeNull());

    socket.emit({ event: 'log', log: 'past-1' });
    socket.end(1006, 'transport lost');
    await done;

    expect(ControllableWebSocket.instances).toHaveLength(1);
    expect(lines).toEqual(['past-1']);
  });

  it('rejects legacy jwt-only log token responses before dialing', async () => {
    const post = vi.fn().mockResolvedValue({ jwt: 'logs-token' });
    const agents = new Deployments(
      { post, get: vi.fn(), delete: vi.fn(), apiKey: 'hyper_api_test' } as any,
      'sk-hyper-test',
      'https://api.dev.hypercli.com',
    );

    await expect(agents.logsConnect('agent-1')).rejects.toThrow(
      'Backend returned an invalid Agent logs token response',
    );
    expect(ControllableWebSocket.instances).toHaveLength(0);
  });
});

it('reads real HTTP captured metadata/errors and consumes immediate real WebSocket replacement frames', async () => {
  vi.stubGlobal('WebSocket', NodeWebSocket);
  let unavailable = false;
  const requests: URL[] = [];
  const snapshot = captured();
  const { event: _event, ...rest } = snapshot;
  const failed = { ...rest, logs: null, unavailable: 'io_error', captures: [rest.captures[1]] };
  const server = createServer((request, response) => {
    const url = new URL(request.url!, 'http://localhost'); requests.push(url);
    response.setHeader('Content-Type', 'application/json');
    if (url.pathname.endsWith('/logs/token')) response.end(JSON.stringify({
      token: 'synthetic-token', agent_id: snapshot.agent_id, expires_at: '2026-12-01T00:00:00Z',
      ws_url: `ws://${request.headers.host}/ws/logs/${snapshot.agent_id}`,
    }));
    else { response.statusCode = unavailable ? 502 : 200; response.end(JSON.stringify(unavailable ? { detail: failed } : rest)); }
  });
  const wss = new WebSocketServer({ server });
  wss.on('connection', (socket, request) => {
    requests.push(new URL(request.url!, 'http://localhost'));
    socket.send(JSON.stringify(snapshot));
    socket.send(JSON.stringify({ ...captured('rotated\n'), captures: [{ ...captured('rotated\n').captures[0], file_generation: 'inode-2' }] }));
    socket.close();
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const agents = new Deployments(new HTTPClient(base, 'synthetic-key'), 'synthetic-key', base, base.replace('http:', 'ws:') + '/ws');
  try {
    expect(await agents.getLogs(snapshot.agent_id, { source: 'both', generation: 'previous', maxBytes: 45, maxLines: 2 })).toEqual(rest);
    expect(Object.fromEntries(requests[0].searchParams)).toEqual({ source: 'both', generation: 'previous', max_bytes: '45', max_lines: '2' });
    unavailable = true;
    await expect(agents.getLogs(snapshot.agent_id)).rejects.toMatchObject({ name: 'AgentCapturedLogsError', statusCode: 502, snapshot: failed });
    await expect(agents.getLogs(snapshot.agent_id)).rejects.toBeInstanceOf(AgentCapturedLogsError);
    const lines = vi.fn(), snapshots: AgentCapturedLogsEvent[] = [];
    await agents.subscribeLogs(snapshot.agent_id, lines, { onCapturedLogs: value => { snapshots.push(value); } });
    expect(lines).not.toHaveBeenCalled();
    expect(snapshots.map(value => value.logs)).toEqual([snapshot.logs, 'rotated\n']);
    expect(snapshots[1].captures[0].file_generation).toBe('inode-2');
  } finally {
    for (const socket of wss.clients) socket.terminate();
    await new Promise<void>(resolve => wss.close(() => resolve()));
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
