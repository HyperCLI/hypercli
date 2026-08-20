import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Deployments, parseAgentLogFrame } from '../src/agents.js';

/**
 * A socket the test drives by hand. The shared one-shot harness delivers every
 * frame in the microtask that fires `onopen`, which lands before `subscribeLogs`
 * has attached its handlers -- `logsConnect` resolves on open, so attachment is
 * one await later. Driving delivery explicitly keeps the ordering under test.
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
  const post = vi.fn().mockResolvedValue({ jwt: 'jwt-logs' });
  const agents = new Deployments(
    { post, get: vi.fn(), delete: vi.fn(), apiKey: 'hyper_api_test' } as any,
    'sk-hyper-test',
    'https://api.dev.hypercli.com',
  );
  return { agents, post };
}

describe('parseAgentLogFrame', () => {
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
});
