import { createServer } from 'node:http';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import { expect, it } from 'vitest';
import { HTTPClient } from '../src/http.js';
import { Deployments } from '../src/agents.js';
import { SessionsAPI } from '../src/sessions.js';
import fixture from './fixtures/session-reactions.json';

it('reads current message meta after repeated product websocket hints without changing ACP or submitting turns', async () => {
  const requests: string[] = [];
  let base = '';
  let denied = false;
  const server = createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    expect(req.headers.authorization).toBe('Bearer fixture-key');
    res.setHeader('content-type', 'application/json');
    if (req.url === '/agents/deployments/events/token') {
      res.end(JSON.stringify({ token: 'fixture-token', ws_url: base.replace('http:', 'ws:') + '/ws/deployments' }));
    } else if (denied) {
      res.statusCode = 403; res.end(JSON.stringify({ detail: 'Session access denied' }));
    } else res.end(JSON.stringify({ items: [fixture.row], next_cursor: null, has_more: false }));
  });
  const sockets = new WebSocketServer({ server });
  sockets.on('connection', (socket, req) => {
    expect(req.url).toBe('/ws/deployments?token=fixture-token');
    socket.send(JSON.stringify({ type: 'ready' }));
    socket.send(JSON.stringify(fixture.event));
    socket.send(JSON.stringify(fixture.event));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const http = new HTTPClient(base, 'fixture-key');
  const sessions = new SessionsAPI(http);
  const deployments = new Deployments(http, 'fixture-key', base);
  const controller = new AbortController();
  const snapshots = [];
  try {
    await deployments.subscribe(async event => {
      expect(event).toEqual(fixture.event);
      const page = await sessions.getMessages('session-1');
      snapshots.push(page.items[0]);
      expect(page.items[0].meta).toEqual(fixture.row.meta);
      expect(page.items[0].acp).toEqual(fixture.row.acp);
      if (snapshots.length === 2) controller.abort();
    }, { signal: controller.signal });
    expect(snapshots[0]).toEqual(snapshots[1]);
    denied = true;
    await expect(sessions.getMessages('session-1')).rejects.toMatchObject({ statusCode: 403 });
    expect(requests.filter(r => r.startsWith('POST'))).toEqual(['POST /agents/deployments/events/token']);
  } finally {
    controller.abort(); sockets.close(); server.close();
  }
});
