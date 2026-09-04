import { describe, it, expect, afterEach } from 'vitest';
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
  private nextSession = 0;
  private nextServerId = 10_000;

  constructor(
    private readonly server: FakeAcpBridge,
    private readonly socket: WsSocket,
  ) {
    socket.on('message', (data: Buffer) => {
      this.handle(JSON.parse(data.toString()) as WireFrame);
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
  for (const client of clients.splice(0)) client.close();
  for (const bridge of bridges.splice(0)) await bridge.close();
});

describe('CodingAgent.acpConnect', () => {
  it('dials the /ws bridge with bearer auth and agent_id, then completes the initialize handshake', async () => {
    const bridge = await startBridge();
    const updates: string[] = [];
    const client = track(await acpAgent(bridge).acpConnect({ onUpdate: () => updates.push('u') }));

    expect(client.connected).toBe(true);
    expect(bridge.peers).toHaveLength(1);
    const upgrade = bridge.upgrades[0];
    expect(upgrade.headers.authorization).toBe('Bearer hyper_api_test');
    const url = new URL(upgrade.url ?? '', 'http://127.0.0.1');
    expect(url.pathname).toBe('/ws');
    expect(url.searchParams.get('agent_id')).toBe(AGENT_ID);

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

    const stopReason = await client.prompt(session.sessionId, 'hello agent');
    expect(stopReason).toBe('end_turn');
    expect(updates).toEqual([
      { sessionId: 'session-1', text: 'chunk-1' },
      { sessionId: 'session-1', text: 'chunk-2' },
    ]);
    const promptFrame = bridge.currentPeer.framesFor('session/prompt')[0];
    expect(promptFrame.params).toMatchObject({
      sessionId: 'session-1',
      prompt: [{ type: 'text', text: 'hello agent' }],
    });

    await client.cancel(session.sessionId);
    await waitFor(() => bridge.currentPeer.framesFor('session/cancel').length > 0);
    expect(bridge.currentPeer.framesFor('session/cancel')[0].params).toMatchObject({
      sessionId: 'session-1',
    });
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
    await expect(client.prompt(session.sessionId, 'second turn')).resolves.toBe('end_turn');
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
