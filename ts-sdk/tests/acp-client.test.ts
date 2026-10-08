import { describe, it, expect, afterEach, vi } from 'vitest';
import { ContentBlock, SessionUpdate } from '@agentclientprotocol/sdk/experimental/v2';
import { WebSocketServer, type WebSocket as WsSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Agent, Deployments } from '../src/agents.js';
import type { HTTPClient } from '../src/http.js';
import {
  CodingAgentAcpClient,
  CodingAgentAcpConnectionError,
  CodingAgentAcpRequestError,
  CodingAgentAcpObservationError,
  CodingAgentAcpReplayGapError,
  CodingAgentAcpUnavailableError,
  type CodingAgentAcpReplayEvent,
  type CodingAgentAcpDiagnostic,
} from '../src/acp.js';
import { CodingAgentAcpPool } from '../src/acp-pool.js';
import { AcpTurnDriver } from '../src/acp-driver.js';

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
  public lastInitializeParams: unknown = null;
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
        this.lastInitializeParams = frame.params ?? null;
        if (this.server.initializeHook) { this.server.initializeHook(this, frame); return; }
        if (this.server.protocolVersion === 2) {
          this.result(frame, {
            protocolVersion: 2,
            info: { name: 'fake-acp-child', version: '2.0.0' },
            capabilities: this.server.v2Capabilities,
          });
        } else {
          // Off-version answer in an otherwise v2-decodable shape: the client
          // must close on the version mismatch instead of negotiating down.
          this.result(frame, {
            protocolVersion: this.server.protocolVersion,
            info: { name: 'fake-acp-child', version: '1.0.0' },
            capabilities: {},
          });
        }
        return;
      case 'session/resume':
        if (this.server.failResume) {
          this.error(frame, -32000, 'session is gone');
        } else if (this.server.loadHook) {
          this.server.loadHook(this, frame);
        } else {
          this.result(frame, this.server.resumeResult ?? {});
        }
        return;
      case 'session/new':
        if (this.server.newHook) { this.server.newHook(this, frame); return; }
        if (frame.params?.cwd === '/missing-explicit-workspace') {
          this.error(frame, -32602, 'cwd must be an existing directory');
          return;
        }
        this.nextSession += 1;
        this.server.sessions.set(`session-${this.nextSession}`, String(frame.params?.cwd));
        this.result(frame, { sessionId: `session-${this.nextSession}` });
        return;
      case 'session/load':
        this.error(frame, -32601, '"Method not found": session/load');
        return;
      case 'session/list':
        if (this.server.listError) {
          this.error(frame, this.server.listError.code, this.server.listError.message);
          return;
        }
        this.result(frame, { sessions: [...this.server.sessions].map(([sessionId, cwd]) => ({ sessionId, cwd })), nextCursor: null });
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
      update: { sessionUpdate: 'agent_message_chunk', messageId: 'fixture-message', content: { type: 'text', text } },
    });
  }

  finishPrompt(promptFrame: WireFrame, stopReason: string): void {
    const sessionId = promptFrame.params?.sessionId;
    this.result(promptFrame, { messageId: `accepted-${promptFrame.id}` });
    this.notify('session/update', { sessionId, update: { sessionUpdate: 'user_message',
      messageId: `accepted-${promptFrame.id}`, content: promptFrame.params?.prompt } });
    this.notify('session/update', { sessionId, update: { sessionUpdate: 'state_update', state: 'running' } });
    this.notify('session/update', { sessionId, update: { sessionUpdate: 'state_update', state: 'idle', stopReason } });
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
  /** The protocol version the fake agent answers in initialize. Default 2. */
  protocolVersion?: 1 | 2;
  /** v2-shaped `capabilities` payload answered when protocolVersion is 2. */
  v2Capabilities?: Record<string, unknown>;
}

class FakeAcpBridge {
  public launchCwd: string | null = '/private/var/runner-state/agent/fixture';
  public sessions = new Map<string, string>();
  public peers: FakeAcpPeer[] = [];
  public upgrades: IncomingMessage[] = [];
  public protocolVersion: 1 | 2;
  public v2Capabilities: Record<string, unknown>;
  public failResume = false;
  public initializeHook: PromptHook | null = null;
  public newHook: PromptHook | null = null;
  public listError: { code: number; message: string } | null = null;
  /** Custom payload answered for session/resume. */
  public resumeResult: Record<string, unknown> | null = null;
  public promptHook: PromptHook = (peer, frame) => peer.finishPrompt(frame, 'end_turn');
  /** Overrides the default empty session/resume reply; the hook streams any replayed history, then answers. */
  public loadHook: PromptHook | null = null;
  public onClientResponse: ((peer: FakeAcpPeer, frame: WireFrame) => void) | null = null;
  public onClientNotification: ((peer: FakeAcpPeer, frame: WireFrame) => void) | null = null;
  private wss: WebSocketServer | null = null;

  constructor(options: FakeAcpBridgeOptions = {}) {
    this.protocolVersion = options.protocolVersion ?? 2;
    this.v2Capabilities = options.v2Capabilities ?? { session: {} };
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

function acpAgent(bridge: FakeAcpBridge): Agent {
  const deployments = new Deployments(
    {} as unknown as HTTPClient,
    'hyper_api_test',
    bridge.apiBase,
  );
  const agent = Agent.fromDict({
    id: AGENT_ID,
    user_id: 'user-1',
    state: 'RUNNING',
    runtime: 'opencode',
    launch_config: { sync_root: '/poisoned-sync-root' },
  });
  agent._deployments = deployments;
  vi.spyOn(deployments, 'runtimePaths').mockImplementation(async () => {
    if (bridge.launchCwd === null) throw new Error('authoritative runtime cwd unavailable');
    return { cwd: bridge.launchCwd };
  });
  // The fake bridge serves no platform REST, so prompt completions are proven
  // by this canned receipt reader; per-test overrides win through the spread.
  const connect = agent.acpConnect.bind(agent);
  agent.acpConnect = (options = {}) => connect({
    getPromptCompletion: async () => ({ stopReason: 'end_turn' }),
    ...options,
  });
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

describe('ACP operation diagnostics', () => {
  it('separates a healthy socket/initialize/cwd from a correlated session/new rejection without leaking payloads', async () => {
    const bridge = await startBridge();
    const secret = 'do-not-log-token-or-prompt';
    bridge.newHook = (peer, frame) => peer.error(frame, -32003, `https://host/ws?token=${secret}`);
    const events: CodingAgentAcpDiagnostic[] = [];
    const agent = acpAgent(bridge);
    const client = track(await agent.acpConnect({ token: secret, onDiagnostic: (event) => events.push(event) }));
    await expect(client.newSession()).rejects.toMatchObject({
      name: 'CodingAgentAcpRequestError', method: 'session/new', code: -32003,
      cause: { code: -32003, message: `https://host/ws?token=${secret}` },
    });
    expect(events.filter((event) => event.phase === 'succeeded').map((event) => event.stage)).toEqual(['connect', 'initialize', 'cwd']);
    expect(events.at(-1)).toMatchObject({ stage: 'new', phase: 'failed', error: {
      name: 'CodingAgentAcpRequestError', code: -32003, cause: { name: 'RequestError', code: -32003 },
    } });
    expect(client.connected).toBe(true);
    expect(bridge.currentPeer.framesFor('session/new')).toHaveLength(1);
    expect(bridge.currentPeer.framesFor('session/prompt')).toHaveLength(0);
    expect(JSON.stringify(events)).not.toContain(secret);
    expect(JSON.stringify(events)).not.toContain('/ws');
    for (const event of events) {
      if (event.stage === 'transport' || event.phase === 'started') continue;
      expect(event.elapsedMs).toBeGreaterThanOrEqual(0);
      expect(events.find((start) => start.stage !== 'transport' && start.operationId === event.operationId))
        .toMatchObject({ stage: event.stage, phase: 'started' });
    }
    client.close();
    await waitFor(() => events.some((event) => event.stage === 'transport'));
    expect(events.at(-1)).toMatchObject({ stage: 'transport', phase: 'closed', reasonPresent: false });
  });

  it('identifies stalled initialize and aborts the pending connection without inventing an RPC rejection', async () => {
    const bridge = await startBridge();
    bridge.initializeHook = () => {};
    const controller = new AbortController();
    const events: CodingAgentAcpDiagnostic[] = [];
    const connecting = acpAgent(bridge).acpConnect({ signal: controller.signal, onDiagnostic: (event) => events.push(event) });
    const rejected = expect(connecting).rejects.toBeInstanceOf(CodingAgentAcpConnectionError);
    await waitFor(() => bridge.peers.some((peer) => peer.framesFor('initialize').length === 1));
    expect(events.map((event) => [event.stage, event.phase])).toEqual([
      ['connect', 'started'], ['connect', 'succeeded'], ['initialize', 'started'],
    ]);
    controller.abort();
    await rejected;
    await waitFor(() => bridge.currentPeer.socketClosed);
    expect(events).toContainEqual(expect.objectContaining({ stage: 'initialize', phase: 'failed' }));
    expect(events.some((event) => event.stage === 'new')).toBe(false);
  });

  it('preserves the upstream initialize rejection as cause separately from the ensuing local close', async () => {
    const bridge = await startBridge();
    bridge.initializeHook = (peer, frame) => peer.error(frame, -32602, 'initialize rejected');
    await expect(acpAgent(bridge).acpConnect()).rejects.toMatchObject({
      name: 'CodingAgentAcpConnectionError', code: null,
      cause: { code: -32602, message: 'initialize rejected' },
    });
    await waitFor(() => bridge.currentPeer.socketClosed);
  });

  it('reports cwd resolution failure before any session/new and forwards the caller signal', async () => {
    const bridge = await startBridge();
    bridge.launchCwd = null;
    const agent = acpAgent(bridge);
    const controller = new AbortController();
    const events: CodingAgentAcpDiagnostic[] = [];
    const client = track(await agent.acpConnect({ signal: controller.signal, onDiagnostic: (event) => events.push(event) }));
    await expect(client.newSession()).rejects.toThrow('authoritative runtime cwd unavailable');
    expect(agent._deployments!.runtimePaths).toHaveBeenCalledWith(AGENT_ID, { signal: controller.signal });
    expect(events.at(-1)).toMatchObject({ stage: 'cwd', phase: 'failed', error: { name: 'Error' } });
    expect(bridge.currentPeer.framesFor('session/new')).toHaveLength(0);
  });

  it('correlates list/resume failures and ignores diagnostic observer exceptions', async () => {
    const bridge = await startBridge();
    bridge.listError = { code: -32601, message: 'not available' };
    bridge.failResume = true;
    const client = track(await acpAgent(bridge).acpConnect({ onDiagnostic: () => { throw new Error('observer'); } }));
    await expect(client.listSessions()).rejects.toMatchObject({ method: 'session/list', code: -32601, cause: { code: -32601 } });
    await expect(client.resumeSession('original', { cwd: '/original' })).rejects.toMatchObject({
      method: 'session/resume', code: -32000, cause: { code: -32000 },
    });
    expect(bridge.currentPeer.framesFor('session/resume')).toHaveLength(1);
    expect(client.connected).toBe(true);
  });

  it('retains standard transport error codes without including error messages or arbitrary code strings', async () => {
    const bridge = await startBridge();
    const events: CodingAgentAcpDiagnostic[] = [];
    const failure = Object.assign(new Error('secret URL and prompt'), {
      code: 'ETIMEDOUT', cause: { code: 'secret URL and prompt' },
    });
    const client = track(await acpAgent(bridge).acpConnect({
      resolveDefaultCwd: async () => { throw failure; }, onDiagnostic: (event) => events.push(event),
    }));
    await expect(client.newSession()).rejects.toBe(failure);
    expect(events.at(-1)).toMatchObject({ stage: 'cwd', phase: 'failed', error: { code: 'ETIMEDOUT' } });
    expect(JSON.stringify(events)).not.toContain('secret');
  });
});

describe('Agent.acpConnect', () => {
  it('resolves a platform default lazily, with no initialization/list dependency', async () => {
    const bridge = await startBridge();
    const resolveDefaultCwd = vi.fn(async () => '/Users/runner/workspace');
    const client = track(await acpAgent(bridge).acpConnect({ resolveDefaultCwd }));
    expect(bridge.currentPeer.lastInitializeParams).not.toHaveProperty('_meta');
    await client.listSessions();
    await client.newSession({ cwd: '/explicit' });
    expect(resolveDefaultCwd).not.toHaveBeenCalled();
    await client.newSession();
    expect(resolveDefaultCwd).toHaveBeenCalledTimes(1);
    expect(bridge.currentPeer.framesFor('session/new')[1].params).toEqual({ cwd: '/Users/runner/workspace', mcpServers: [] });
  });

  it('raw explicit cwd resumes with a vanilla peer whose listing is unsupported', async () => {
    const bridge = await startBridge();
    bridge.listError = { code: -32601, message: 'Method not found' };
    const client = track(await CodingAgentAcpClient.connect({ url: `${bridge.apiBase.replace('http:', 'ws:')}/ws/acp`, token: 'fixture' }, { cwd: '/original/alias' }));
    await client.resumeSession('native-id');
    await client.resumeSession('another-id', { cwd: '/call/override' });
    expect(bridge.currentPeer.framesFor('session/list')).toHaveLength(0);
    expect(bridge.currentPeer.framesFor('session/resume').map(frame => frame.params?.cwd)).toEqual(['/original/alias', '/call/override']);
  });

  it('propagates catalog authorization failures and never uses launch defaults for resume', async () => {
    const bridge = await startBridge();
    bridge.listError = { code: -32000, message: 'Not authorized' };
    const resolveDefaultCwd = vi.fn(async () => '/wrong-default');
    const client = track(await acpAgent(bridge).acpConnect({ resolveDefaultCwd }));
    await expect(client.resumeSession('native-id')).rejects.toThrow('Not authorized');
    expect(resolveDefaultCwd).not.toHaveBeenCalled();
    expect(bridge.currentPeer.framesFor('session/resume')).toHaveLength(0);
  });

  it.each(['agent', 'static'] as const)('uses platform launch cwd without session overrides through %s connect', async (surface) => {
    const bridge = await startBridge();
    const client = track(await (surface === 'agent'
      ? acpAgent(bridge).acpConnect()
      : CodingAgentAcpClient.connect({ url: `${bridge.apiBase.replace('http:', 'ws:')}/ws/acp`, token: 'fixture' }, {
        getPromptCompletion: async () => ({ stopReason: 'end_turn' }),
        resolveDefaultCwd: async () => bridge.launchCwd!,
      })));
    const session = await client.newSession();
    expect(bridge.currentPeer.framesFor('session/new')[0].params?.cwd).toBe(bridge.launchCwd);
    expect((await client.prompt(session.sessionId, 'offline turn')).stopReason).toBe('end_turn');
  });

  it('preserves per-call > connect > platform cwd precedence', async () => {
    const bridge = await startBridge();
    const client = track(await acpAgent(bridge).acpConnect({ cwd: '/explicit-connect' }));
    await client.newSession();
    await client.newSession({ cwd: '/explicit-session' });
    expect(bridge.currentPeer.framesFor('session/new').map(frame => frame.params?.cwd))
      .toEqual(['/explicit-connect', '/explicit-session']);
  });

  it('fails clearly when platform cwd is unavailable rather than guessing HOME or sync root', async () => {
    const bridge = await startBridge();
    bridge.launchCwd = null;
    const client = track(await acpAgent(bridge).acpConnect());
    await expect(client.newSession()).rejects.toThrow(/runtime cwd unavailable/i);
    expect(bridge.currentPeer.framesFor('session/new')).toHaveLength(0);
    await client.newSession({ cwd: '/explicit-session' });
    expect(bridge.currentPeer.framesFor('session/new')[0].params?.cwd).toBe('/explicit-session');
  });

  it.each(['relative', '', '../escape', '/nul\0path'])('rejects invalid explicit cwd %j instead of replacing it', async (cwd) => {
    const bridge = await startBridge();
    const client = track(await acpAgent(bridge).acpConnect());
    await expect(client.newSession({ cwd })).rejects.toThrow(/absolute.*cwd/i);
    expect(bridge.currentPeer.framesFor('session/new')).toHaveLength(0);
  });

  it('preserves a nonexistent absolute override so runtime rejection reaches the caller', async () => {
    const bridge = await startBridge();
    const client = track(await acpAgent(bridge).acpConnect());
    await expect(client.newSession({ cwd: '/missing-explicit-workspace' })).rejects.toThrow(/existing directory/);
    expect(bridge.currentPeer.framesFor('session/new')[0].params?.cwd).toBe('/missing-explicit-workspace');
  });

  it('a fresh client resumes the persisted original cwd after the launch default changes', async () => {
    const bridge = await startBridge();
    const original = track(await acpAgent(bridge).acpConnect());
    const session = await original.newSession({ cwd: '/original-session-root' });
    original.close();
    bridge.launchCwd = '/different-launch-root';
    const fresh = track(await acpAgent(bridge).acpConnect({ sessionId: session.sessionId }));
    expect(bridge.currentPeer.framesFor('session/resume')[0].params?.cwd).toBe('/original-session-root');
    expect((await fresh.prompt(session.sessionId, 'resume turn')).stopReason).toBe('end_turn');
  });

  it('carries source only in the connection query, preserving auth and ACP payloads', async () => {
    const bridge = await startBridge();
    const client = track(await acpAgent(bridge).acpConnect({ source: 'future client/slack' }));
    await client.newSession();
    const url = new URL(bridge.upgrades[0].url ?? '', 'http://127.0.0.1');
    expect(url.searchParams.get('source')).toBe('future client/slack');
    expect(url.searchParams.get('token')).toBe('hyper_api_test');
    expect(url.searchParams.get('agent_id')).toBe(AGENT_ID);
    for (const frame of bridge.currentPeer.frames) {
      expect(frame.params).not.toHaveProperty('source');
      expect(frame.params?._meta ?? {}).not.toHaveProperty('source');
    }
  });
  it('dials the /ws/acp session proxy with token query auth and agent_id, then completes the initialize handshake', async () => {
    const bridge = await startBridge();
    const updates: string[] = [];
    const client = track(await acpAgent(bridge).acpConnect({ onUpdate: () => updates.push('u') }));

    expect(client.connected).toBe(true);
    expect(bridge.peers).toHaveLength(1);
    const upgrade = bridge.upgrades[0];
    const url = new URL(upgrade.url ?? '', 'http://127.0.0.1');
    // Default transport is the client-facing session proxy, not the raw
    // agent-keyed tunnel; no session_id means a session-less (create) dial.
    expect(url.pathname).toBe('/ws/acp');
    expect(url.searchParams.get('agent_id')).toBe(AGENT_ID);
    expect(url.searchParams.get('token')).toBe('hyper_api_test');
    expect(url.searchParams.has('session_id')).toBe(false);

    const init = bridge.currentPeer.framesFor('initialize');
    expect(init).toHaveLength(1);
    // v2 is the only frontend profile; there is no v1 opt-in.
    expect(init[0].params).toMatchObject({ protocolVersion: 2 });
    expect(client.negotiatedProtocolVersion).toBe(2);
    expect((client.initializeResponse as { info?: { name?: string } } | null)?.info?.name).toBe('fake-acp-child');
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
        if (SessionUpdate.isAgentMessageChunk(update) && ContentBlock.isText(update.content)) {
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

  it('rejects nonstandard session/new instructions instead of sending them', async () => {
    const bridge = await startBridge();
    const client = track(await acpAgent(bridge).acpConnect());

    // @ts-expect-error Intentionally exercise a legacy JavaScript caller.
    await expect(client.newSession({ cwd: '/home/node', systemPrompt: 'client session context' })).rejects.toThrow(/native configuration/);

    await client.newSession({ cwd: '/home/node' });
    expect(bridge.currentPeer.framesFor('session/new')[0].params.systemPrompt).toBeUndefined();
  });

  it('gates listSessions on the advertised v2 session surface; loadSession always steers to resumeSession', async () => {
    const bridge = await startBridge({ v2Capabilities: {} });
    const client = track(await acpAgent(bridge).acpConnect());

    await expect(client.listSessions()).rejects.toBeInstanceOf(CodingAgentAcpUnavailableError);
    await expect(client.listSessions()).rejects.toThrow(/session\/list/);
    await expect(client.loadSession('session-9')).rejects.toBeInstanceOf(CodingAgentAcpUnavailableError);
    await expect(client.loadSession('session-9')).rejects.toThrow(/resumeSession/);
    expect(bridge.currentPeer.framesFor('session/list')).toHaveLength(0);
    expect(bridge.currentPeer.framesFor('session/load')).toHaveLength(0);
  });

  it('serves listSessions when the child advertises a v2 session surface', async () => {
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

  it('rejects an in-flight prompt on socket drop, reconnects, replays session/resume, and prompts again', async () => {
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
    await waitFor(() => second.framesFor('session/resume').length > 0);
    expect(second.framesFor('session/load')).toHaveLength(0);
    expect(second.framesFor('session/resume').length).toBe(1);
    expect(second.framesFor('session/resume')[0].params).toMatchObject({
      sessionId: 'session-1',
      replayFrom: { type: 'start' },
    });

    holdPrompt = false;
    await expect(client.prompt(session.sessionId, "second turn")).resolves.toMatchObject({ stopReason: "end_turn" });
  });

  it('surfaces CodingAgentAcpReplayGapError when a session cannot be replayed, and stays connected', async () => {
    const bridge = await startBridge();
    const errors: Error[] = [];
    const client = track(await acpAgent(bridge).acpConnect({ onError: (error) => errors.push(error) }));
    await client.newSession();

    bridge.currentPeer.drop();
    bridge.failResume = true;
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
      title: 'Run ls',
      subject: { type: 'tool_call', toolCall: { toolCallId: 'tool-1', title: 'Run ls', kind: 'execute', status: 'pending' } },
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
      title: 'Write file',
      subject: { type: 'tool_call', toolCall: { toolCallId: 'tool-9', title: 'Write file', kind: 'edit', status: 'pending' } },
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

describe('ACP version negotiation', () => {
  it('a v2-answering agent negotiates v2 and exposes the v2-shaped initialize response', async () => {
    const bridge = await startBridge({ protocolVersion: 2 });
    const client = track(await acpAgent(bridge).acpConnect());

    expect(client.negotiatedProtocolVersion).toBe(2);
    const init = bridge.currentPeer.framesFor('initialize');
    expect(init[0].params).toMatchObject({ protocolVersion: 2 });
    const response = client.initializeResponse as { info?: { name?: string } };
    expect(response.info?.name).toBe('fake-acp-child');
  });

  it('v2: loadSession is unavailable and steers callers to resumeSession with replayFrom', async () => {
    const bridge = await startBridge({ protocolVersion: 2 });
    const client = track(await acpAgent(bridge).acpConnect());
    await client.newSession();

    await expect(client.loadSession('session-1')).rejects.toBeInstanceOf(CodingAgentAcpUnavailableError);
    await expect(client.loadSession('session-1')).rejects.toThrow(/resumeSession/);
    expect(bridge.currentPeer.framesFor('session/load')).toHaveLength(0);
    expect(bridge.currentPeer.framesFor('session/resume')).toHaveLength(0);
  });

  it('v2: resumeSession accepts replayFrom and brackets the replay epoch', async () => {
    const bridge = await startBridge({ protocolVersion: 2 });
    bridge.resumeResult = {};
    const events: CodingAgentAcpReplayEvent[] = [];
    const client = track(await acpAgent(bridge).acpConnect());
    client.addReplayListener((event) => events.push(event));
    await client.newSession();

    await client.resumeSession('session-1', { replayFrom: { type: 'start' } });

    const resumes = bridge.currentPeer.framesFor('session/resume');
    expect(resumes).toHaveLength(1);
    expect(resumes[0].params).toMatchObject({
      sessionId: 'session-1',
      replayFrom: { type: 'start' },
    });
    expect(events).toEqual([
      { sessionId: 'session-1', phase: 'start', epoch: 1 },
      { sessionId: 'session-1', phase: 'end', epoch: 1, ok: true },
    ]);
    expect(client.replayEpoch('session-1')).toBe(0);
  });

  it('v2: resumeSession without replayFrom stays unbracketed', async () => {
    const bridge = await startBridge({ protocolVersion: 2 });
    const events: CodingAgentAcpReplayEvent[] = [];
    const client = track(await acpAgent(bridge).acpConnect());
    client.addReplayListener((event) => events.push(event));
    await client.newSession();

    await client.resumeSession('session-1');
    const resumes = bridge.currentPeer.framesFor('session/resume');
    expect(resumes[0].params).not.toHaveProperty('replayFrom');
    expect(events).toEqual([]);
  });

  it('an agent answering v1 fails the connect — the client closes on version mismatch only', async () => {
    const bridge = await startBridge({ protocolVersion: 1 });
    const clientPromise = acpAgent(bridge).acpConnect();
    await expect(clientPromise).rejects.toBeInstanceOf(CodingAgentAcpConnectionError);
    await expect(clientPromise).rejects.toThrow(/initialize failed/);
    const error = await clientPromise.catch((caught) => caught);
    expect(String((error as { cause?: unknown }).cause)).toMatch(/protocol version/);
  });

  it('v2: reconnect replays sessions via session/resume, never session/load', async () => {
    const bridge = await startBridge({ protocolVersion: 2 });
    let holdPrompt = true;
    bridge.promptHook = (peer, frame) => {
      if (holdPrompt) return;
      peer.finishPrompt(frame, 'end_turn');
    };
    const client = track(await acpAgent(bridge).acpConnect());
    await client.newSession();

    bridge.currentPeer.drop();
    await waitFor(() => bridge.peers.length === 2);
    await client.waitConnected();
    const second = bridge.currentPeer;

    await waitFor(() => second.framesFor('session/resume').length > 0);
    expect(second.framesFor('session/load')).toHaveLength(0);
    expect(second.framesFor('session/resume')[0].params).toMatchObject({
      sessionId: 'session-1',
      replayFrom: { type: 'start' },
    });

    holdPrompt = false;
    await expect(client.submitPrompt('session-1', [{ type: 'text', text: 'after reconnect' }])).resolves.toHaveProperty('messageId');
  });

  it('v2: a failed resume replay after reconnect surfaces a replay gap and drops the session', async () => {
    const bridge = await startBridge({ protocolVersion: 2 });
    const errors: Error[] = [];
    const client = track(await acpAgent(bridge).acpConnect({ onError: (error) => errors.push(error) }));
    await client.newSession();

    bridge.failResume = true;
    bridge.currentPeer.drop();
    await waitFor(() => errors.length > 0);

    expect(errors[0]).toBeInstanceOf(CodingAgentAcpReplayGapError);
    expect((errors[0] as CodingAgentAcpReplayGapError).sessionId).toBe('session-1');
    expect(client.connected).toBe(true);
    expect(client.sessionIds).toEqual([]);
  });

  it('v2: reconnect against an agent without a session surface drops sessions with a replay gap', async () => {
    const bridge = await startBridge({ protocolVersion: 2, v2Capabilities: {} });
    const errors: Error[] = [];
    const client = track(await acpAgent(bridge).acpConnect({ onError: (error) => errors.push(error) }));

    await expect(client.resumeSession('anything')).rejects.toBeInstanceOf(CodingAgentAcpUnavailableError);

    // Track a session manually via raw new since v2 surface gating blocks nothing for session/new.
    await client.newSession();
    bridge.currentPeer.drop();
    await waitFor(() => errors.length > 0);

    expect(errors[0]).toBeInstanceOf(CodingAgentAcpReplayGapError);
    expect(errors[0].message).toMatch(/session surface/);
    expect(client.sessionIds).toEqual([]);
  });

  it('an unsupported answered version fails the connect', async () => {
    const bridge = await startBridge();
    (bridge as { protocolVersion: number }).protocolVersion = 99;
    const clientPromise = acpAgent(bridge).acpConnect();
    await expect(clientPromise).rejects.toBeInstanceOf(CodingAgentAcpConnectionError);
    await expect(clientPromise).rejects.toThrow(/initialize failed/);
  });

  it('pool: a v1-answering agent is rejected on version mismatch while a v2 agent connects', async () => {
    const bridgeV1 = await startBridge({ protocolVersion: 1 });
    const bridgeV2 = await startBridge({ protocolVersion: 2 });
    const pool = new CodingAgentAcpPool({
      connect: (key) => acpAgent(key === 'v2-agent' ? bridgeV2 : bridgeV1).acpConnect(),
    });
    pools.push(pool);

    const lease2 = await pool.acquire('v2-agent');
    expect(lease2.client.negotiatedProtocolVersion).toBe(2);
    await expect(pool.acquire('v1-agent')).rejects.toBeInstanceOf(CodingAgentAcpConnectionError);

    lease2.release();
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

describe('read receipts', () => {
  it('emits no read-ack traffic: updates arrive unannotated, user read cursors are backend-owned', async () => {
    const bridge = await startBridge();
    const updates: string[] = [];
    track(await acpAgent(bridge).acpConnect({ onUpdate: () => updates.push('u') }));
    bridge.currentPeer.update('session-1', 'one');
    bridge.currentPeer.update('session-1', 'two');
    await waitFor(() => updates.length === 2);
    await new Promise((resolve) => setTimeout(resolve, 50));
    // The only frame the client may ever send here is initialize — any
    // `_hypercli.dev/session_read_ack` would be the resurrected no-op lie.
    expect(bridge.currentPeer.frames.map((frame) => frame.method)).toEqual(['initialize']);
  });
});

describe('CodingAgentAcpClient replay epoch tracking', () => {
  it('keeps crossed replay epochs distinct after an earlier replay has completed', async () => {
    const bridge = await startBridge();
    const client = track(await acpAgent(bridge).acpConnect());
    await client.newSession();
    const events: CodingAgentAcpReplayEvent[] = [];
    client.addReplayListener(event => events.push(event));
    await client.resumeSession('session-1', { replayFrom: { type: 'start' } });
    const held: WireFrame[] = [];
    bridge.loadHook = (_peer, frame) => { held.push(frame); };
    const older = client.resumeSession('session-1', { replayFrom: { type: 'start' } });
    void older.catch(() => {});
    const newer = client.resumeSession('session-1', { replayFrom: { type: 'start' } });
    await waitFor(() => held.length === 2);
    bridge.currentPeer.result(held[1], {});
    await newer;
    expect(client.replayEpoch('session-1')).toBe(0);
    bridge.currentPeer.error(held[0], -32003, 'older replay failed');
    await expect(older).rejects.toThrow('older replay failed');
    expect(client.replayEpoch('session-1')).toBe(0);
    expect(events.filter(e => e.phase === 'start').map(e => e.epoch)).toEqual([1, 2, 3]);
    expect(events.filter(e => e.phase === 'end').map(e => [e.epoch, e.ok])).toEqual([[1, true], [3, true], [2, false]]);
  });
  it('brackets a replaying resume: replayed updates observe a live epoch, which ends when the resume resolves', async () => {
    const bridge = await startBridge();
    bridge.loadHook = (peer, frame) => {
      peer.update('session-1', 'history one');
      peer.update('session-1', 'history two');
      peer.result(frame, {});
    };
    const epochsAtUpdate: number[] = [];
    const events: CodingAgentAcpReplayEvent[] = [];
    const client = track(await acpAgent(bridge).acpConnect({
      onUpdate: () => epochsAtUpdate.push(client.replayEpoch('session-1')),
    }));
    client.addReplayListener((event) => events.push(event));
    await client.newSession();

    expect(client.replayEpoch('session-1')).toBe(0);
    await client.resumeSession('session-1', { replayFrom: { type: 'start' } });

    expect(epochsAtUpdate.length).toBeGreaterThan(0);
    expect(epochsAtUpdate.every((epoch) => epoch === 1)).toBe(true);
    expect(client.replayEpoch('session-1')).toBe(0);
    expect(events).toEqual([
      { sessionId: 'session-1', phase: 'start', epoch: 1 },
      { sessionId: 'session-1', phase: 'end', epoch: 1, ok: true },
    ]);
  });

  it('ends the epoch on a rejected resume (ok: false), leaving no replay state behind', async () => {
    const bridge = await startBridge();
    const events: CodingAgentAcpReplayEvent[] = [];
    const client = track(await acpAgent(bridge).acpConnect());
    client.addReplayListener((event) => events.push(event));
    await client.newSession();

    bridge.failResume = true;
    await expect(client.resumeSession('session-1', { replayFrom: { type: 'start' } })).rejects.toThrow();

    expect(client.replayEpoch('session-1')).toBe(0);
    expect(events).toEqual([
      { sessionId: 'session-1', phase: 'start', epoch: 1 },
      { sessionId: 'session-1', phase: 'end', epoch: 1, ok: false },
    ]);
  });

  it('isolates epochs per session — a replay on one never tags another', async () => {
    const bridge = await startBridge();
    bridge.loadHook = (peer, frame) => {
      peer.update('session-1', 'history');
      peer.update('session-2', 'foreign live traffic');
      peer.result(frame, {});
    };
    const epochsAtUpdate: Array<{ sessionId: string; epoch: number }> = [];
    const client = track(await acpAgent(bridge).acpConnect({
      onUpdate: (notification) => epochsAtUpdate.push({
        sessionId: notification.sessionId,
        epoch: client.replayEpoch(notification.sessionId),
      }),
    }));
    await client.newSession();
    await client.newSession();

    await client.resumeSession('session-1', { replayFrom: { type: 'start' } });

    expect(epochsAtUpdate).toEqual([
      { sessionId: 'session-1', epoch: 1 },
      { sessionId: 'session-2', epoch: 0 },
    ]);
  });

  it('overlapping replays for one session increment the epoch — latest wins, stale ends do not clear it', async () => {
    const bridge = await startBridge();
    const pendingLoads: WireFrame[] = [];
    bridge.loadHook = (_peer, frame) => {
      pendingLoads.push(frame);
    };
    const events: CodingAgentAcpReplayEvent[] = [];
    const client = track(await acpAgent(bridge).acpConnect());
    client.addReplayListener((event) => events.push(event));
    await client.newSession();

    const replayFrom = { replayFrom: { type: 'start' as const } };
    const first = client.resumeSession('session-1', replayFrom);
    const second = client.resumeSession('session-1', replayFrom);
    await waitFor(() => pendingLoads.length === 2);
    expect(client.replayEpoch('session-1')).toBe(2);

    bridge.currentPeer.result(pendingLoads[0], {});
    await first;
    expect(client.replayEpoch('session-1')).toBe(2);

    bridge.currentPeer.result(pendingLoads[1], {});
    await second;
    expect(client.replayEpoch('session-1')).toBe(0);
    expect(events).toEqual([
      { sessionId: 'session-1', phase: 'start', epoch: 1 },
      { sessionId: 'session-1', phase: 'start', epoch: 2 },
      { sessionId: 'session-1', phase: 'end', epoch: 1, ok: true },
      { sessionId: 'session-1', phase: 'end', epoch: 2, ok: true },
    ]);
  });

  it('the internal reconnect replay fires the same boundary events', async () => {
    const bridge = await startBridge();
    const events: CodingAgentAcpReplayEvent[] = [];
    const client = track(await acpAgent(bridge).acpConnect());
    client.addReplayListener((event) => events.push(event));
    await client.newSession();

    bridge.loadHook = (peer, frame) => {
      peer.update('session-1', 'replayed after reconnect');
      peer.result(frame, {});
    };
    bridge.currentPeer.drop();
    await client.waitConnected();
    await waitFor(() => events.some((event) => event.phase === 'end'));

    expect(events).toEqual([
      { sessionId: 'session-1', phase: 'start', epoch: 1 },
      { sessionId: 'session-1', phase: 'end', epoch: 1, ok: true },
    ]);
    expect(client.replayEpoch('session-1')).toBe(0);
  });
});

describe('CodingAgentAcpClient foreground admission after resume', () => {
  it('does not mistake an untracked session for observed quiet', async () => {
    const bridge = await startBridge();
    const client = track(await acpAgent(bridge).acpConnect());
    await expect(client.waitForIdle('untracked')).rejects.toThrow(/unknown|not.*restored/i);
  });

  it.each([true, false])('latest failed resume stays unknown after older success (older ends first=%s)', async olderFirst => {
    const bridge = await startBridge();
    const client = track(await acpAgent(bridge).acpConnect());
    await client.newSession();
    const held: WireFrame[] = [];
    bridge.loadHook = (_peer, frame) => { held.push(frame); };
    const older = client.resumeSession('session-1', { replayFrom: { type: 'start' } });
    const latest = client.resumeSession('session-1', { replayFrom: { type: 'start' } });
    void latest.catch(() => {});
    await waitFor(() => held.length === 2);
    if (olderFirst) { bridge.currentPeer.result(held[0], {}); await older; }
    bridge.currentPeer.error(held[1], -32603, 'latest failed');
    await expect(latest).rejects.toThrow('latest failed');
    if (!olderFirst) { bridge.currentPeer.result(held[0], {}); await older; }
    await expect(client.waitForIdle('session-1')).rejects.toThrow(/unknown|not.*restored/i);
  });

  it('preserves request rejection identity and never mistakes an accepted notice for it', async () => {
    const bridge = await startBridge();
    const client = track(await acpAgent(bridge).acpConnect());
    await client.newSession();
    bridge.promptHook = (peer, frame) => peer.error(frame, -32003, 'Resume the session before submitting input');
    await expect(client.prompt('session-1', 'unsent')).rejects.toMatchObject({
      name: 'CodingAgentAcpRequestError', method: 'session/prompt', code: -32003,
      message: 'Resume the session before submitting input',
    });
    const accepted = vi.fn();
    bridge.promptHook = (peer, frame) => {
      peer.result(frame, { messageId: 'accepted' });
      peer.notify('session/update', { sessionId: 'session-1', update: {
        sessionUpdate: 'notice', severity: 'error', title: 'Runtime disconnected',
      } });
    };
    const error = await client.prompt('session-1', 'accepted', { onAccepted: accepted }).catch(e => e);
    expect(error).toBeInstanceOf(CodingAgentAcpObservationError);
    expect(error).not.toBeInstanceOf(CodingAgentAcpRequestError);
    expect(error.messageId).toBe('accepted');
    expect(accepted).toHaveBeenCalledOnce();
    expect(bridge.currentPeer.framesFor('session/prompt')).toHaveLength(2);
  });

  it('quarantines historical error notices while an accepted prompt is observed', async () => {
    const bridge = await startBridge();
    const receipts = vi.fn().mockResolvedValue(null);
    const client = track(await acpAgent(bridge).acpConnect({ getPromptCompletion: receipts }));
    await client.newSession();
    let accepted!: () => void;
    const admission = new Promise<void>(resolve => { accepted = resolve; });
    bridge.promptHook = (peer, frame) => peer.result(frame, { messageId: 'active' });
    const result = client.prompt('session-1', 'active', { onAccepted: accepted });
    let settled = false;
    void result.then(() => { settled = true; }, () => { settled = true; });
    await admission;
    bridge.loadHook = (peer, frame) => {
      peer.notify('session/update', { sessionId: 'session-1', update: {
        sessionUpdate: 'notice', severity: 'error', title: 'Runtime disconnected',
      } });
      peer.result(frame, {});
    };
    await client.resumeSession('session-1', { replayFrom: { type: 'start' } });
    await client.listSessions();
    expect(receipts).toHaveBeenCalledExactlyOnceWith('session-1', 'active');
    expect(settled).toBe(false);
    receipts.mockResolvedValue({ stopReason: 'end_turn' });
    bridge.currentPeer.notify('session/update', { sessionId: 'session-1', update: { sessionUpdate: 'state_update', state: 'idle' } });
    await expect(result).resolves.toMatchObject({ messageId: 'active', stopReason: 'end_turn' });
    expect(receipts).toHaveBeenCalledTimes(2);
  });

  it('ignores an obsolete receipt failure and reconciles the accepted ID after the newer replay', async () => {
    const bridge = await startBridge();
    let rejectOld!: (error: Error) => void;
    const oldRead = new Promise<null>((_resolve, reject) => { rejectOld = reject; });
    let reading!: () => void;
    const readStarted = new Promise<void>(resolve => { reading = resolve; });
    const receipts = vi.fn().mockImplementationOnce(() => { reading(); return oldRead; })
      .mockResolvedValue({ stopReason: 'end_turn' });
    const client = track(await acpAgent(bridge).acpConnect({ getPromptCompletion: receipts }));
    await client.newSession();
    let accepted!: () => void;
    const admission = new Promise<void>(resolve => { accepted = resolve; });
    bridge.promptHook = (peer, frame) => peer.result(frame, { messageId: 'accepted-A' });
    const turn = client.prompt('session-1', 'A', { onAccepted: accepted });
    let settled = false;
    void turn.then(() => { settled = true; }, () => { settled = true; });
    await admission;
    await client.resumeSession('session-1', { replayFrom: { type: 'start' } });
    await readStarted;
    let resumeEntered!: (frame: WireFrame) => void;
    const entered = new Promise<WireFrame>(resolve => { resumeEntered = resolve; });
    bridge.loadHook = (_peer, frame) => resumeEntered(frame);
    const replay = client.resumeSession('session-1', { replayFrom: { type: 'start' } });
    const held = await entered;
    rejectOld(new Error('obsolete REST failure'));
    await client.listSessions();
    expect(settled).toBe(false);
    bridge.currentPeer.result(held, {});
    await replay;
    await expect(turn).resolves.toEqual({ messageId: 'accepted-A', stopReason: 'end_turn' });
    expect(receipts.mock.calls).toEqual([['session-1', 'accepted-A'], ['session-1', 'accepted-A']]);
    expect(bridge.currentPeer.framesFor('session/prompt')).toHaveLength(1);
  });

  it('forgets the lost generation running state on a quiet reconnect without synthesizing idle', async () => {
    const bridge = await startBridge();
    const states: string[] = [];
    const client = track(await acpAgent(bridge).acpConnect());
    stateObserver(client, states);
    await client.newSession();
    bridge.currentPeer.notify('session/update', { sessionId: 'session-1', update: { sessionUpdate: 'state_update', state: 'running' } });
    await waitFor(() => states.includes('running'));
    const replayed = new Promise<void>(resolve => client.addReplayListener(e => { if (e.phase === 'end') resolve(); }));
    const failedWait = expect(client.waitForIdle('session-1')).rejects.toBeInstanceOf(CodingAgentAcpConnectionError);
    bridge.currentPeer.drop();
    await failedWait;
    await replayed;
    expect(states).toEqual(['running']);
    await client.waitForIdle('session-1');
    await expect(client.prompt('session-1', 'new generation')).resolves.toMatchObject({ stopReason: 'end_turn' });
    expect(bridge.currentPeer.framesFor('session/prompt')).toHaveLength(1);
  });
  /** Live state announcements the test waits on via onUpdate (no public marker accessor). */
  function stateObserver(client: CodingAgentAcpClient, states: string[]): void {
    client.addUpdateListener((notification) => {
      const update = notification.update as { sessionUpdate?: string; state?: string };
      if (update.sessionUpdate === 'state_update' && update.state) states.push(update.state);
    });
  }

  it('v2: a resume replay of an in-flight-at-disconnect turn does not gate the next prompt', async () => {
    const bridge = await startBridge();
    // Retained-history contract for a turn cut off mid-flight: its `running`
    // state frame is retained, its terminal `idle` never is.
    bridge.loadHook = (peer, frame) => {
      const sessionId = (frame.params as { sessionId: string }).sessionId;
      peer.notify('session/update', { sessionId, update: { sessionUpdate: 'user_message',
        messageId: 'old-1', content: [{ type: 'text', text: 'old input' }] } });
      peer.notify('session/update', { sessionId, update: { sessionUpdate: 'agent_message',
        messageId: 'old-2', content: [{ type: 'text', text: 'old output' }] } });
      peer.notify('session/update', { sessionId, update: { sessionUpdate: 'state_update', state: 'running' } });
      peer.result(frame, {});
    };
    const client = track(await acpAgent(bridge).acpConnect());
    const states: string[] = [];
    stateObserver(client, states);
    await client.newSession();
    // The frontend socket stayed open while the runtime completed out of
    // sight. Resume must retire the stale observation, not synthesize idle.
    bridge.currentPeer.notify('session/update', { sessionId: 'session-1', update: { sessionUpdate: 'state_update', state: 'running' } });
    await waitFor(() => states.includes('running'));

    await client.resumeSession('session-1', { replayFrom: { type: 'start' } });
    expect(states).toEqual(['running', 'running']);
    await expect(client.prompt('session-1', 'after resume')).resolves.toMatchObject({ stopReason: 'end_turn' });
    expect(bridge.currentPeer.framesFor('session/prompt')).toHaveLength(1);
  });

  it('v2: replayed state frames do not satisfy a waitForIdle registered before the replay', async () => {
    const bridge = await startBridge();
    bridge.loadHook = (peer, frame) => {
      const sessionId = (frame.params as { sessionId: string }).sessionId;
      peer.notify('session/update', { sessionId, update: { sessionUpdate: 'state_update', state: 'idle', stopReason: 'end_turn' } });
      peer.result(frame, {});
    };
    const states: string[] = [];
    const client = track(await acpAgent(bridge).acpConnect());
    stateObserver(client, states);
    await client.newSession();
    bridge.currentPeer.notify('session/update', { sessionId: 'session-1', update: { sessionUpdate: 'state_update', state: 'running' } });
    await waitFor(() => states.includes('running'));

    let settled = false;
    const waiting = client.waitForIdle('session-1').then(() => { settled = true; });
    await client.resumeSession('session-1', { replayFrom: { type: 'start' } });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(settled).toBe(false);
    bridge.currentPeer.notify('session/update', { sessionId: 'session-1', update: { sessionUpdate: 'state_update', state: 'idle', stopReason: 'end_turn' } });
    await waiting;
  });

  it('v2: live foreground state after resume still gates prompt, and waitForIdle settles on the live idle', async () => {
    const bridge = await startBridge();
    const states: string[] = [];
    const client = track(await acpAgent(bridge).acpConnect());
    stateObserver(client, states);
    await client.newSession();
    await client.resumeSession('session-1', { replayFrom: { type: 'start' } });

    // The session announces its genuinely live turn after the epoch (the
    // proxy emits current-state announcements past the replayed history).
    bridge.currentPeer.notify('session/update', { sessionId: 'session-1', update: { sessionUpdate: 'state_update', state: 'running' } });
    await waitFor(() => states.includes('running'));
    await expect(client.prompt('session-1', 'during live work')).rejects.toThrow('Session foreground is active');
    expect(bridge.currentPeer.framesFor('session/prompt')).toHaveLength(0);

    const waiting = client.waitForIdle('session-1');
    bridge.currentPeer.notify('session/update', { sessionId: 'session-1', update: { sessionUpdate: 'state_update', state: 'idle', stopReason: 'end_turn' } });
    await waiting;
    await expect(client.prompt('session-1', 'after idle')).resolves.toMatchObject({ stopReason: 'end_turn' });
  });

  it('v2: waitForIdle resolves immediately on a quiet session and rejects on connection loss mid-wait', async () => {
    const bridge = await startBridge();
    const states: string[] = [];
    const client = track(await acpAgent(bridge).acpConnect());
    stateObserver(client, states);
    await client.newSession();
    await client.waitForIdle('session-1');

    bridge.currentPeer.notify('session/update', { sessionId: 'session-1', update: { sessionUpdate: 'state_update', state: 'running' } });
    await waitFor(() => states.includes('running'));
    const rejection = expect(client.waitForIdle('session-1')).rejects.toBeInstanceOf(CodingAgentAcpConnectionError);
    bridge.currentPeer.drop();
    await rejection;
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

describe('Agent.acpTurnDriver', () => {
  it('returns a ready per-session driver on the pooled connection; the prompt response completes the turn', async () => {
    const bridge = await startBridge();
    const agent = acpAgent(bridge);
    // The default promptHook answers with stopReason and emits NO vendor
    // frames: hyper-acp is a pure passthrough, the response is the turn end.
    const commits: { stopReason: string | null }[] = [];

    const driver = await agent.acpTurnDriver({
      sessionId: 'session-1',
      commit: async (stopReason) => {
        commits.push({ stopReason });
      },
    });

    expect(driver).toBeInstanceOf(AcpTurnDriver);
    expect(bridge.peers).toHaveLength(1);
    expect(agent.acpPool.size(agent.id)).toBe(1);

    void driver.submit('hello from the pane');
    await waitFor(() => commits.length === 1);

    const prompts = bridge.currentPeer.framesFor('session/prompt');
    expect(prompts).toHaveLength(1);
    const blocks = (prompts[0].params as { prompt: { type: string; text?: string }[] }).prompt;
    expect(blocks).toEqual([{ type: 'text', text: 'hello from the pane' }]);

    // The prompt response completes the turn: commit sees its stopReason.
    expect(commits).toEqual([{ stopReason: 'end_turn' }]);
    // No ack frames exist on the wire contract: nothing is sent.
    expect(bridge.currentPeer.framesFor('_hypercli.dev/turn_ended_ack')).toEqual([]);
    driver.close();
    await waitFor(() => bridge.currentPeer.socketClosed);
  });

  it('shares one pooled connection across sessions, isolates per session, and releases per lease', async () => {
    const bridge = await startBridge();
    const agent = acpAgent(bridge);
    const commitsA: unknown[] = [];
    const commitsB: unknown[] = [];

    const driverA = await agent.acpTurnDriver({
      sessionId: 'session-1',
      commit: async (stopReason) => {
        commitsA.push(stopReason);
      },
    });
    const driverB = await agent.acpTurnDriver({
      sessionId: 'session-2',
      commit: async (stopReason) => {
        commitsB.push(stopReason);
      },
    });

    // Both drivers ride the single pooled connection for this agent.
    expect(bridge.peers).toHaveLength(1);
    expect(agent.acpPool.size(agent.id)).toBe(2);

    // Driver A's turn completes via its prompt response; driver B is idle
    // and untouched.
    void driverA.submit('for A');
    await waitFor(() => commitsA.length === 1);
    expect(commitsB).toEqual([]);

    // A notification for a foreign session mutates neither driver's state.
    bridge.currentPeer.notify('session/update', { sessionId: 'session-2', update: { sessionUpdate: 'agent_message_chunk', messageId: 'foreign-message', content: { type: 'text', text: 'x' } } });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(driverA.turnState).toBe('idle');
    expect(driverB.turnState).toBe('idle');

    // Lease discipline: a pane-style lease + driver leases on one connection;
    // closing one never tears the connection down under the others.
    const pane = await agent.acpPool.acquire(agent.id);
    const peer = bridge.currentPeer;
    driverA.close();
    expect(agent.acpPool.size(agent.id)).toBe(2);
    expect(peer.socketClosed).toBe(false);

    pane.release();
    expect(agent.acpPool.size(agent.id)).toBe(1);
    expect(peer.socketClosed).toBe(false);

    driverB.close();
    await waitFor(() => peer.socketClosed);
    expect(agent.acpPool.size(agent.id)).toBe(0);
  });
});
