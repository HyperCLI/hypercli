import { describe, it, expect, afterEach, vi } from 'vitest';
import { WebSocketServer, type WebSocket as WsSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Deployments, OpenCodeAgent } from '../src/agents.js';
import type { HTTPClient } from '../src/http.js';
import {
  CodingAgentAcpClient,
  CodingAgentAcpConnectionError,
  CodingAgentAcpReplayGapError,
  CodingAgentAcpUnavailableError,
} from '../src/acp.js';
import { CodingAgentAcpPool } from '../src/acp-pool.js';

const AGENT_ID = 'c0ffee00-0000-4000-8000-000000000001';

interface WireFrame {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string };
}

type PromptHook = (peer: FakeAcpPeer, frame: WireFrame) => void;

/**
 * Server-side stand-in for the hyperclaw-backend /ws bridge plus the pod-side
 * ACP child: accepts any number of client connections (the bridge keeps the
 * child long-lived while clients reconnect) and answers the ACP requests the
 * tests exercise. Frames are raw JSON-RPC text, exactly what the bridge
 * forwards.
 */
class FakeAcpPeer {
  public readonly frames: WireFrame[] = [];
  public readonly responses: WireFrame[] = [];
  public initializeCount = 0;
  public socketClosed = false;
  private nextSession = 0;
  private nextServerId = 10_000;

  constructor(
    private readonly server: FakeAcpBridge,
    private readonly socket: WsSocket,
  ) {
    socket.on('message', (data: Buffer) => {
      this.handle(JSON.parse(data.toString()) as WireFrame);
    });
    socket.on('close', () => {
      this.socketClosed = true;
    });
  }

  private handle(frame: WireFrame): void {
    this.frames.push(frame);
    if (frame.method === undefined) {
      this.responses.push(frame);
      this.server.onClientResponse?.(this, frame);
      return;
    }
    if (frame.id === undefined) {
      this.server.onClientNotification?.(this, frame);
      return;
    }
    switch (frame.method) {
      case 'initialize':
        this.initializeCount += 1;
        this.result(frame, {
          protocolVersion: 1,
          agentInfo: { name: 'fake-acp-child', version: '1.0.0' },
          agentCapabilities: this.server.capabilities,
        });
        return;
      case 'session/new':
        this.nextSession += 1;
        this.result(frame, { sessionId: `session-${this.nextSession}` });
        return;
      case 'session/load':
        if (this.server.failLoad) {
          this.error(frame, -32000, 'session is gone');
        } else {
          this.result(frame, {});
        }
        return;
      case 'session/list':
        this.result(frame, { sessions: [], nextCursor: null });
        return;
      case 'session/prompt':
        this.server.promptHook(this, frame);
        return;
      default:
        this.error(frame, -32601, `"Method not found": ${frame.method}`);
    }
  }

  result(request: WireFrame, result: unknown): void {
    this.socket.send(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
  }

  error(request: WireFrame, code: number, message: string): void {
    this.socket.send(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code, message } }));
  }

  notify(method: string, params: unknown): void {
    this.socket.send(JSON.stringify({ jsonrpc: '2.0', method, params }));
  }

  request(method: string, params: unknown): number {
    this.nextServerId += 1;
    this.socket.send(JSON.stringify({ jsonrpc: '2.0', id: this.nextServerId, method, params }));
    return this.nextServerId;
  }

  update(sessionId: string, text: string): void {
    this.notify('session/update', {
      sessionId,
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } },
    });
  }

  finishPrompt(promptFrame: WireFrame, stopReason: string): void {
    this.result(promptFrame, { stopReason });
  }

  drop(): void {
    this.socket.terminate();
  }

  closeWith(code: number): void {
    this.socket.close(code);
  }

  framesFor(method: string): WireFrame[] {
    return this.frames.filter((frame) => frame.method === method);
  }
}

interface FakeAcpBridgeOptions {
  capabilities?: Record<string, unknown>;
}

class FakeAcpBridge {
  public peers: FakeAcpPeer[] = [];
  public upgrades: IncomingMessage[] = [];
  public capabilities: Record<string, unknown>;
  public failLoad = false;
  public promptHook: PromptHook = (peer, frame) => peer.finishPrompt(frame, 'end_turn');
  public onClientResponse: ((peer: FakeAcpPeer, frame: WireFrame) => void) | null = null;
  public onClientNotification: ((peer: FakeAcpPeer, frame: WireFrame) => void) | null = null;
  private wss: WebSocketServer | null = null;

  constructor(options: FakeAcpBridgeOptions = {}) {
    this.capabilities = options.capabilities ?? {
      loadSession: true,
      sessionCapabilities: { list: {} },
    };
  }

  get port(): number {
    if (!this.wss) throw new Error('bridge not started');
    return (this.wss.address() as AddressInfo).port;
  }

  /** ws URL base in the apiBase shape the SDK expects (http URL; /ws and agent_id are added by the SDK). */
  get apiBase(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  get currentPeer(): FakeAcpPeer {
    const peer = this.peers[this.peers.length - 1];
    if (!peer) throw new Error('no peer connected');
    return peer;
  }

  async start(): Promise<this> {
    if (this.wss) return this;
    this.wss = new WebSocketServer({ port: 0 });
    const wss = this.wss;
    wss.on('connection', (socket: WsSocket, request: IncomingMessage) => {
      this.upgrades.push(request);
      this.peers.push(new FakeAcpPeer(this, socket));
    });
    await new Promise<void>((resolve) => wss.once('listening', resolve));
    return this;
  }

  async close(): Promise<void> {
    for (const peer of this.peers) peer.drop();
    await new Promise<void>((resolve) => {
      if (!this.wss) return resolve();
      this.wss.close(() => resolve());
    });
    this.wss = null;
  }
}

async function waitFor(condition: () => boolean, timeoutMs = 4_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('timed out waiting for condition');
}

function acpAgent(bridge: FakeAcpBridge): OpenCodeAgent {
  const deployments = new Deployments(
    {} as unknown as HTTPClient,
    'hyper_api_test',
    bridge.apiBase,
  );
  const agent = OpenCodeAgent.fromDict({
    id: AGENT_ID,
    user_id: 'user-1',
    state: 'RUNNING',
    runtime: 'opencode',
  });
  agent._deployments = deployments;
  return agent;
}

const bridges: FakeAcpBridge[] = [];
const clients: CodingAgentAcpClient[] = [];
const pools: CodingAgentAcpPool[] = [];

async function startBridge(options?: FakeAcpBridgeOptions): Promise<FakeAcpBridge> {
  const bridge = await new FakeAcpBridge(options).start();
  bridges.push(bridge);
  return bridge;
}

function track(client: CodingAgentAcpClient): CodingAgentAcpClient {
  clients.push(client);
  return client;
}

afterEach(async () => {
  for (const pool of pools.splice(0)) pool.close();
  for (const client of clients.splice(0)) client.close();
  for (const bridge of bridges.splice(0)) await bridge.close();
});

describe('CodingAgent.acpConnect', () => {
  it('dials the /ws bridge with token query auth and agent_id, then completes the initialize handshake', async () => {
    const bridge = await startBridge();
    const updates: string[] = [];
    const client = track(await acpAgent(bridge).acpConnect({ onUpdate: () => updates.push('u') }));

    expect(client.connected).toBe(true);
    expect(bridge.peers).toHaveLength(1);
    const upgrade = bridge.upgrades[0];
    const url = new URL(upgrade.url ?? '', 'http://127.0.0.1');
    expect(url.pathname).toBe('/ws');
    expect(url.searchParams.get('agent_id')).toBe(AGENT_ID);
    expect(url.searchParams.get('token')).toBe('hyper_api_test');

    const init = bridge.currentPeer.framesFor('initialize');
    expect(init).toHaveLength(1);
    expect(init[0].params).toMatchObject({
      protocolVersion: 1,
      clientInfo: { name: 'hypercli-ts-sdk' },
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
      },
    });
    expect(client.initializeResponse?.agentInfo?.name).toBe('fake-acp-child');
    expect(updates).toEqual([]);
  });

  it('runs newSession → prompt with streamed updates → stopReason', async () => {
    const bridge = await startBridge();
    bridge.promptHook = (peer, frame) => {
      const sessionId = (frame.params as { sessionId: string }).sessionId;
      peer.update(sessionId, 'chunk-1');
      peer.update(sessionId, 'chunk-2');
      peer.finishPrompt(frame, 'end_turn');
    };
    const updates: Array<{ sessionId: string; text: string }> = [];
    const client = track(await acpAgent(bridge).acpConnect({
      onUpdate: (notification) => {
        const update = notification.update;
        if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text') {
          updates.push({ sessionId: notification.sessionId, text: update.content.text });
        }
      },
    }));

    const session = await client.newSession({ cwd: '/home/node' });
    expect(session.sessionId).toBe('session-1');
    expect(bridge.currentPeer.framesFor('session/new')[0].params).toMatchObject({
      cwd: '/home/node',
      mcpServers: [],
    });

    const turn = await client.prompt(session.sessionId, "hello agent");
    expect(turn.stopReason).toBe("end_turn");
    expect(updates).toEqual([
      { sessionId: 'session-1', text: 'chunk-1' },
      { sessionId: 'session-1', text: 'chunk-2' },
    ]);
    const promptFrame = bridge.currentPeer.framesFor('session/prompt')[0];
    expect(promptFrame.params).toMatchObject({
      sessionId: 'session-1',
      prompt: [{ type: 'text', text: 'hello agent' }],
    });
    expect(promptFrame.params.systemPrompt).toBeUndefined();

    await client.cancel(session.sessionId);
    await waitFor(() => bridge.currentPeer.framesFor('session/cancel').length > 0);
    expect(bridge.currentPeer.framesFor('session/cancel')[0].params).toMatchObject({
      sessionId: 'session-1',
    });
  });

  it('passes newSession systemPrompt through to session/new params', async () => {
    const bridge = await startBridge();
    const client = track(await acpAgent(bridge).acpConnect());

    await client.newSession({ cwd: '/home/node', systemPrompt: 'client session context' });
    expect(bridge.currentPeer.framesFor('session/new')[0].params).toMatchObject({
      cwd: '/home/node',
      systemPrompt: 'client session context',
    });

    await client.newSession({ cwd: '/home/node' });
    expect(bridge.currentPeer.framesFor('session/new')[1].params.systemPrompt).toBeUndefined();
  });

  it('gates listSessions/loadSession on advertised capabilities with typed errors', async () => {
    const bridge = await startBridge({ capabilities: {} });
    const client = track(await acpAgent(bridge).acpConnect());

    await expect(client.listSessions()).rejects.toBeInstanceOf(CodingAgentAcpUnavailableError);
    await expect(client.listSessions()).rejects.toThrow(/session\/list/);
    await expect(client.loadSession('session-9')).rejects.toBeInstanceOf(CodingAgentAcpUnavailableError);
    await expect(client.loadSession('session-9')).rejects.toThrow(/session\/load/);
    expect(bridge.currentPeer.framesFor('session/list')).toHaveLength(0);
    expect(bridge.currentPeer.framesFor('session/load')).toHaveLength(0);
  });

  it('serves listSessions when the child advertises sessionCapabilities.list', async () => {
    const bridge = await startBridge();
    const client = track(await acpAgent(bridge).acpConnect());
    const listed = await client.listSessions();
    expect(listed.sessions).toEqual([]);
    expect(bridge.currentPeer.framesFor('session/list')).toHaveLength(1);
  });

  it('a server-side prompt error does not poison the connection or session (regression: octet-stream attachment rejection swallowed later turns)', async () => {
    const bridge = await startBridge();
    let failNext = true;
    bridge.promptHook = (peer, frame) => {
      if (failNext) {
        failNext = false;
        peer.error(frame, -32603, "Internal error: 'media type: application/octet-stream' functionality not supported.");
        return;
      }
      peer.finishPrompt(frame, 'end_turn');
    };
    const client = track(await acpAgent(bridge).acpConnect());
    const session = await client.newSession();

    await expect(client.prompt(session.sessionId, 'with attachment')).rejects.toThrow(/octet-stream/);

    await expect(client.prompt(session.sessionId, 'plain follow-up')).resolves.toMatchObject({ stopReason: 'end_turn' });
    expect(bridge.peers).toHaveLength(1);
    expect(bridge.currentPeer.framesFor('session/prompt')).toHaveLength(2);
  });

  it('rejects an in-flight prompt on socket drop, reconnects, replays session/load, and prompts again', async () => {
    const bridge = await startBridge();
    let holdPrompt = true;
    bridge.promptHook = (peer, frame) => {
      if (holdPrompt) return;
      peer.finishPrompt(frame, 'end_turn');
    };
    const client = track(await acpAgent(bridge).acpConnect());
    const session = await client.newSession();

    const promptPromise = client.prompt(session.sessionId, 'long turn');
    const rejection = expect(promptPromise).rejects.toBeInstanceOf(CodingAgentAcpConnectionError);
    bridge.currentPeer.drop();
    await rejection;

    await client.waitConnected();
    expect(bridge.peers).toHaveLength(2);
    const second = bridge.currentPeer;
    expect(second.initializeCount).toBe(1);
    await waitFor(() => second.framesFor('session/load').length > 0);
    expect(second.framesFor('session/load')).toHaveLength(1);
    expect(second.framesFor('session/load')[0].params).toMatchObject({ sessionId: 'session-1' });

    holdPrompt = false;
    await expect(client.prompt(session.sessionId, "second turn")).resolves.toMatchObject({ stopReason: "end_turn" });
  });

  it('surfaces CodingAgentAcpReplayGapError when a session cannot be replayed, and stays connected', async () => {
    const bridge = await startBridge();
    const errors: Error[] = [];
    const client = track(await acpAgent(bridge).acpConnect({ onError: (error) => errors.push(error) }));
    await client.newSession();

    bridge.currentPeer.drop();
    bridge.failLoad = true;
    await client.waitConnected();
    await waitFor(() => errors.length > 0);

    expect(errors[0]).toBeInstanceOf(CodingAgentAcpReplayGapError);
    expect((errors[0] as CodingAgentAcpReplayGapError).sessionId).toBe('session-1');
    expect(client.connected).toBe(true);
    expect(client.sessionIds).toEqual([]);
  });

  it('answers permission requests with cancelled by default', async () => {
    const bridge = await startBridge();
    const client = track(await acpAgent(bridge).acpConnect());
    const session = await client.newSession();

    const permissionId = bridge.currentPeer.request('session/request_permission', {
      sessionId: session.sessionId,
      toolCall: { toolCallId: 'tool-1', title: 'Run ls', kind: 'execute', status: 'pending' },
      options: [{ optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' }],
    });
    await waitFor(() => bridge.currentPeer.responses.some((frame) => frame.id === permissionId));
    const response = bridge.currentPeer.responses.find((frame) => frame.id === permissionId);
    expect(response?.result).toEqual({ outcome: { outcome: 'cancelled' } });
  });

  it('routes permission requests to an opt-in handler', async () => {
    const bridge = await startBridge();
    const seen: string[] = [];
    const client = track(await acpAgent(bridge).acpConnect({
      onPermissionRequest: (params) => {
        seen.push(params.toolCall.toolCallId);
        return { outcome: { outcome: 'selected', optionId: params.options[0].optionId } };
      },
    }));
    const session = await client.newSession();

    const permissionId = bridge.currentPeer.request('session/request_permission', {
      sessionId: session.sessionId,
      toolCall: { toolCallId: 'tool-9', title: 'Write file', kind: 'edit', status: 'pending' },
      options: [{ optionId: 'allow-always', name: 'Always allow', kind: 'allow_always' }],
    });
    await waitFor(() => bridge.currentPeer.responses.some((frame) => frame.id === permissionId));
    const response = bridge.currentPeer.responses.find((frame) => frame.id === permissionId);
    expect(seen).toEqual(['tool-9']);
    expect(response?.result).toEqual({ outcome: { outcome: 'selected', optionId: 'allow-always' } });
  });

  it('rejects connect when the signal is already aborted, and closes on a later abort', async () => {
    const bridge = await startBridge();
    const preAborted = new AbortController();
    preAborted.abort();
    await expect(acpAgent(bridge).acpConnect({ signal: preAborted.signal }))
      .rejects.toBeInstanceOf(CodingAgentAcpConnectionError);
    expect(bridge.peers).toHaveLength(0);

    const controller = new AbortController();
    const client = track(await acpAgent(bridge).acpConnect({ signal: controller.signal }));
    expect(client.connected).toBe(true);
    controller.abort();
    expect(client.closed).toBe(true);
    expect(client.connected).toBe(false);
    await waitFor(() => bridge.currentPeer.framesFor('initialize').length === 1);
    await expect(client.newSession()).rejects.toBeInstanceOf(CodingAgentAcpConnectionError);
  });

  it('treats a terminal bridge close code as final: onClose fires, no reconnect', async () => {
    const bridge = await startBridge();
    const closes: Array<{ code: number; reason: string }> = [];
    const client = track(await acpAgent(bridge).acpConnect({
      onClose: (event) => closes.push(event),
    }));
    await client.newSession();

    bridge.currentPeer.closeWith(4401);
    await waitFor(() => closes.length > 0);

    expect(client.closed).toBe(true);
    expect(closes).toEqual([expect.objectContaining({ code: 4401 })]);
    await expect(client.newSession()).rejects.toBeInstanceOf(CodingAgentAcpConnectionError);
    expect(bridge.peers).toHaveLength(1);
  });
});

describe('CodingAgentAcpClient.addUpdateListener', () => {
  function updateText(notification: { update: unknown }): string | null {
    const update = notification.update as {
      sessionUpdate: string;
      content?: { type: string; text?: string };
    };
    if (update.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text') {
      return update.content.text ?? null;
    }
    return null;
  }

  it('fans session/update out to every listener plus the legacy onUpdate', async () => {
    const bridge = await startBridge();
    const legacy: string[] = [];
    const first: string[] = [];
    const second: string[] = [];
    const client = track(await acpAgent(bridge).acpConnect({
      onUpdate: (notification) => legacy.push(updateText(notification) ?? ''),
    }));
    client.addUpdateListener((notification) => first.push(updateText(notification) ?? ''));
    client.addUpdateListener((notification) => second.push(updateText(notification) ?? ''));

    bridge.currentPeer.update('session-1', 'chunk');
    await waitFor(() => first.length > 0 && second.length > 0 && legacy.length > 0);
    expect(first).toEqual(['chunk']);
    expect(second).toEqual(['chunk']);
    expect(legacy).toEqual(['chunk']);
  });

  it('unsubscribe stops delivery to that listener only', async () => {
    const bridge = await startBridge();
    const first: string[] = [];
    const second: string[] = [];
    const client = track(await acpAgent(bridge).acpConnect());
    client.addUpdateListener((notification) => first.push(updateText(notification) ?? ''));
    const offSecond = client.addUpdateListener((notification) => second.push(updateText(notification) ?? ''));

    bridge.currentPeer.update('session-1', 'before');
    await waitFor(() => first.length > 0 && second.length > 0);
    offSecond();

    bridge.currentPeer.update('session-1', 'after');
    await waitFor(() => first.length > 1);
    expect(first).toEqual(['before', 'after']);
    expect(second).toEqual(['before']);
  });

  it('a throwing listener does not break the others', async () => {
    const bridge = await startBridge();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const good: string[] = [];
    const client = track(await acpAgent(bridge).acpConnect());
    try {
      client.addUpdateListener(() => {
        throw new Error('listener blew up');
      });
      client.addUpdateListener((notification) => good.push(updateText(notification) ?? ''));

      bridge.currentPeer.update('session-1', 'chunk');
      await waitFor(() => good.length > 0);
      expect(good).toEqual(['chunk']);
      expect(consoleError).toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe('CodingAgentAcpPool', () => {
  function startPool(bridge: FakeAcpBridge): CodingAgentAcpPool {
    const pool = new CodingAgentAcpPool({
      connect: () => acpAgent(bridge).acpConnect(),
    });
    pools.push(pool);
    return pool;
  }

  it('shares one connection across concurrent acquires and closes it on the last release', async () => {
    const bridge = await startBridge();
    const pool = startPool(bridge);

    const [leaseA, leaseB] = await Promise.all([pool.acquire('agent'), pool.acquire('agent')]);
    expect(leaseA.client).toBe(leaseB.client);
    expect(bridge.peers).toHaveLength(1);
    expect(bridge.currentPeer.initializeCount).toBe(1);
    expect(pool.size('agent')).toBe(2);
    expect(pool.size()).toBe(1);

    const peer = bridge.currentPeer;
    leaseA.release();
    expect(pool.size('agent')).toBe(1);
    expect(peer.socketClosed).toBe(false);

    leaseB.release();
    await waitFor(() => peer.socketClosed);
    expect(pool.size('agent')).toBe(0);
    expect(pool.size()).toBe(0);

    // A fresh acquire after the last release dials anew.
    const leaseC = await pool.acquire('agent');
    expect(leaseC.client).not.toBe(leaseA.client);
    expect(leaseC.client.closed).toBe(false);
    expect(bridge.peers).toHaveLength(2);
    expect(bridge.currentPeer.initializeCount).toBe(1);
  });

  it('release is idempotent per lease', async () => {
    const bridge = await startBridge();
    const pool = startPool(bridge);
    const lease = await pool.acquire('agent');
    lease.release();
    lease.release();
    await waitFor(() => bridge.currentPeer.socketClosed);
    expect(pool.size('agent')).toBe(0);
  });

  it('drop closes the shared client with a live lease, release afterwards is a no-op', async () => {
    const bridge = await startBridge();
    const pool = startPool(bridge);
    const lease = await pool.acquire('agent');
    const peer = bridge.currentPeer;

    pool.drop('agent');
    expect(lease.client.closed).toBe(true);
    await waitFor(() => peer.socketClosed);
    expect(pool.size('agent')).toBe(0);

    lease.release();
    expect(pool.size('agent')).toBe(0);
    expect(bridge.peers).toHaveLength(1);

    const fresh = await pool.acquire('agent');
    expect(fresh.client).not.toBe(lease.client);
    expect(fresh.client.closed).toBe(false);
    expect(bridge.peers).toHaveLength(2);
  });

  it('forgets a client that closes itself on a terminal bridge code; next acquire dials fresh', async () => {
    const bridge = await startBridge();
    const pool = startPool(bridge);
    const lease = await pool.acquire('agent');
    const peer = bridge.currentPeer;

    peer.closeWith(4401);
    await waitFor(() => lease.client.closed && peer.socketClosed);
    expect(pool.size('agent')).toBe(0);

    const fresh = await pool.acquire('agent');
    expect(fresh.client).not.toBe(lease.client);
    expect(fresh.client.closed).toBe(false);
    expect(bridge.peers).toHaveLength(2);
    expect(bridge.currentPeer.initializeCount).toBe(1);
  });

  it('never hands out a client that terminal-closed while an acquire was pending', async () => {
    const bridge = await startBridge();
    const pool = startPool(bridge);
    const leaseA = await pool.acquire('agent');

    // B's handout continuation is already queued; the terminal close lands
    // (synchronously, the way terminate() runs through close()) first.
    const pendingB = pool.acquire('agent');
    leaseA.client.close();
    const leaseB = await pendingB;

    expect(leaseB.client).not.toBe(leaseA.client);
    expect(leaseB.client.closed).toBe(false);
    expect(bridge.peers).toHaveLength(2);
    leaseA.release();
    leaseB.release();
    await waitFor(() => bridge.currentPeer.socketClosed);
    expect(pool.size('agent')).toBe(0);
  });
});
