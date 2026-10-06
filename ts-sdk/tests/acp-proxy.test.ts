import { describe, it, expect, afterEach, vi } from 'vitest';
import { WebSocketServer, type WebSocket as WsSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Agent, Deployments } from '../src/agents.js';
import type { HTTPClient } from '../src/http.js';
import {
  ACP_PROXY_UNKNOWN_SESSION_CLOSE_CODE,
  CodingAgentAcpClient,
} from '../src/acp.js';

const AGENT_ID = 'c0ffee00-0000-4000-8000-00000000000a';
const BACKEND_SESSION_ID = '7e57c0de-0000-4000-8000-00000000000b';

interface WireFrame {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string };
}

/**
 * Server-side stand-in for the backend /ws/acp session proxy
 * (sessions/README §14) with just enough of the wire contract to exercise
 * create-or-attach:
 * - an attach whose session_id is not `knownSessionId` closes with 4404 —
 *   the proxy's unknown-session rejection, terminal for the client;
 * - session/new answers with the BACKEND session id (never the pod-side id),
 *   matching the proxy's record-minted response;
 * - session/prompt echoes one update chunk then resolves end_turn;
 * - session/load streams two history notifications for the addressed session,
 *   then resolves (the replay the attach-dial is meant to deliver).
 */
class FakeAcpProxy {
  public readonly upgrades: IncomingMessage[] = [];
  public readonly frames: WireFrame[] = [];
  public promptCalls = 0;
  private wss: WebSocketServer | null = null;

  async start(): Promise<this> {
    this.wss = new WebSocketServer({ port: 0 });
    const wss = this.wss;
    wss.on('connection', (socket: WsSocket, request: IncomingMessage) => {
      const url = new URL(request.url ?? '', 'http://127.0.0.1');
      const sessionId = url.searchParams.get('session_id');
      if (sessionId !== null && sessionId !== BACKEND_SESSION_ID) {
        socket.close(ACP_PROXY_UNKNOWN_SESSION_CLOSE_CODE, `Unknown ACP session ${sessionId}`);
        this.upgrades.push(request);
        return;
      }
      this.upgrades.push(request);
      socket.on('message', (data: Buffer) => this.handle(socket, JSON.parse(data.toString()) as WireFrame));
    });
    await new Promise<void>((resolve) => wss.once('listening', resolve));
    return this;
  }

  private handle(socket: WsSocket, frame: WireFrame): void {
    this.frames.push(frame);
    if (frame.method === undefined || frame.id === undefined) return;
    const reply = (result: unknown) => socket.send(JSON.stringify({ jsonrpc: '2.0', id: frame.id, result }));
    switch (frame.method) {
      case 'initialize':
        reply({
          protocolVersion: 2,
          info: { name: 'fake-acp-proxy', version: '1.0.0' },
          capabilities: { session: {} },
          _meta: { 'hypercli.com/launch-cwd': '/runtime/workspace' },
        });
        return;
      case 'session/new':
        reply({ sessionId: BACKEND_SESSION_ID });
        return;
      case 'session/list':
        reply({ sessions: [{ sessionId: BACKEND_SESSION_ID, cwd: '/original/workspace' }] });
        return;
      case 'session/resume': {
        const sessionId = (frame.params as { sessionId: string }).sessionId;
        if (sessionId !== BACKEND_SESSION_ID) {
          socket.send(JSON.stringify({ jsonrpc: '2.0', id: frame.id, error: { code: -32602, message: 'Unknown session' } }));
          return;
        }
        if ((frame.params as { replayFrom?: unknown }).replayFrom) {
          this.update(socket, sessionId, 'history-1');
          this.update(socket, sessionId, 'history-2');
        }
        reply({});
        return;
      }
      case 'session/prompt': {
        this.promptCalls += 1;
        const sessionId = (frame.params as { sessionId: string }).sessionId;
        const messageId = `input-${this.promptCalls}`;
        const notify = (update: unknown) => socket.send(JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update } }));
        notify({ sessionUpdate: 'user_message', messageId, content: (frame.params as { prompt: unknown }).prompt });
        notify({ sessionUpdate: 'state_update', state: 'running' });
        this.update(socket, sessionId, 'chunk');
        notify({ sessionUpdate: 'state_update', state: 'idle', stopReason: 'end_turn' });
        reply({ messageId });
        return;
      }
      default:
        socket.send(JSON.stringify({
          jsonrpc: '2.0',
          id: frame.id,
          error: { code: -32601, message: `Method not found: ${frame.method}` },
        }));
    }
  }

  private update(socket: WsSocket, sessionId: string, text: string): void {
    socket.send(JSON.stringify({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId,
        update: { sessionUpdate: 'agent_message_chunk', messageId: `reply-${text}`, content: { type: 'text', text } },
      },
    }));
  }

  get port(): number {
    if (!this.wss) throw new Error('proxy not started');
    return (this.wss.address() as AddressInfo).port;
  }

  upgradeUrls(): URL[] {
    return this.upgrades.map((request) => new URL(request.url ?? '', 'http://127.0.0.1'));
  }

  framesFor(method: string): WireFrame[] {
    return this.frames.filter((frame) => frame.method === method);
  }

  async close(): Promise<void> {
    const wss = this.wss;
    this.wss = null;
    if (!wss) return;
    for (const client of wss.clients) client.terminate();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  }
}

function acpAgent(proxy: FakeAcpProxy): Agent {
  const deployments = new Deployments(
    {} as unknown as HTTPClient,
    'hyper_api_test',
    `http://127.0.0.1:${proxy.port}`,
  );
  const agent = Agent.fromDict({
    id: AGENT_ID,
    user_id: 'user-1',
    state: 'RUNNING',
    runtime: 'opencode',
  });
  agent._deployments = deployments;
  return agent;
}

const proxies: FakeAcpProxy[] = [];
const clients: CodingAgentAcpClient[] = [];

async function startProxy(): Promise<FakeAcpProxy> {
  const proxy = await new FakeAcpProxy().start();
  proxies.push(proxy);
  return proxy;
}

function track<T extends CodingAgentAcpClient>(client: T): T {
  clients.push(client);
  return client;
}

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  for (const proxy of proxies.splice(0)) await proxy.close();
});

describe('acpConnect proxy transport (sessions/README §14 seam)', () => {
  it('create: a session-less dial dials /ws/acp without session_id and session/new mints the backend session id', async () => {
    const proxy = await startProxy();
    const client = track(await acpAgent(proxy).acpConnect());

    const url = proxy.upgradeUrls()[0];
    expect(url.pathname).toBe('/ws/acp');
    expect(url.searchParams.get('agent_id')).toBe(AGENT_ID);
    expect(url.searchParams.get('token')).toBe('hyper_api_test');
    expect(url.searchParams.has('session_id')).toBe(false);

    const created = await client.newSession();
    // The proxy's session/new answers with its own backend session record id.
    expect(created.sessionId).toBe(BACKEND_SESSION_ID);
    expect(client.sessionIds).toEqual([BACKEND_SESSION_ID]);
    const accepted = await client.submitPrompt(BACKEND_SESSION_ID, [{ type: 'text', text: 'hi' }]);
    expect(accepted.messageId).toBeTruthy();
    expect(proxy.promptCalls).toBe(1);
    // Prompts address the backend session id verbatim (no client-side remap).
    expect((proxy.framesFor('session/prompt')[0].params as { sessionId: string }).sessionId).toBe(BACKEND_SESSION_ID);
  });

  it('attach: a provided sessionId uses standard resume, not a private dial prerequisite', async () => {
    const proxy = await startProxy();
    const updates: string[] = [];
    const client = track(await acpAgent(proxy).acpConnect({
      sessionId: BACKEND_SESSION_ID,
      onUpdate: (notification) => {
        const update = notification.update as { sessionUpdate?: string; content?: { text?: string } };
        if (update.sessionUpdate === 'agent_message_chunk' && update.content?.text) {
          updates.push(update.content.text);
        }
      },
    }));

    const url = proxy.upgradeUrls()[0];
    expect(url.pathname).toBe('/ws/acp');
    expect(url.searchParams.has('session_id')).toBe(false);
    expect(proxy.framesFor('session/resume')[0].params).toMatchObject({ sessionId: BACKEND_SESSION_ID });

    // Tee membership precedes the replay, so the load's history stream lands.
    await client.resumeSession(BACKEND_SESSION_ID, { replayFrom: { type: 'start' } });
    expect(updates).toEqual(['history-1', 'history-2']);
  });

  it('attach: an unknown standard session/resume fails without redial', async () => {
    const proxy = await startProxy();
    const error = await acpAgent(proxy)
      .acpConnect({ sessionId: 'not-a-real-session', cwd: '/original/workspace' })
      .then(
        () => null,
        (err: unknown) => err,
      );
    expect(error).toMatchObject({ code: -32602 });
    expect(proxy.upgrades).toHaveLength(1);
  });

  it("transport 'direct' stays the agent-keyed /ws bridge and never carries session_id", async () => {
    const proxy = await startProxy();
    const client = track(await acpAgent(proxy).acpConnect({ transport: 'direct' }));

    const url = proxy.upgradeUrls()[0];
    expect(url.pathname).toBe('/ws');
    expect(url.searchParams.get('agent_id')).toBe(AGENT_ID);
    expect(url.searchParams.has('session_id')).toBe(false);
    expect(client.negotiatedProtocolVersion).toBe(2);
  });

  it("transport 'direct' + sessionId throws without dialing", async () => {
    const proxy = await startProxy();
    await expect(
      acpAgent(proxy).acpConnect({ transport: 'direct', sessionId: BACKEND_SESSION_ID }),
    ).rejects.toThrow(/proxy-transport/);
    expect(proxy.upgrades).toHaveLength(0);
  });

  it('acpConnect({ token }) dials with the credential override, not the API key', async () => {
    const proxy = await startProxy();
    track(await acpAgent(proxy).acpConnect({ token: 'override-credential' }));

    const url = proxy.upgradeUrls()[0];
    expect(url.pathname).toBe('/ws/acp');
    expect(url.searchParams.get('agent_id')).toBe(AGENT_ID);
    expect(url.searchParams.get('token')).toBe('override-credential');
  });
});
