import { createServer } from 'node:http';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import { expect, it } from 'vitest';
import { HTTPClient } from '../src/http.js';
import { Deployments } from '../src/agents.js';
import { SessionsAPI, applySessionReactionOperation, sessionMessageMetaFromWire, newerSessionMessageMeta, type SessionReactionOperation } from '../src/sessions.js';
import fixture from './fixtures/session-reactions.json';

it('applies confirmed operations from the product websocket without fetching per operation or submitting turns', async () => {
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
    socket.send(JSON.stringify({ ...fixture.event, session_id: 'other-session' }));
    socket.send(JSON.stringify({ ...fixture.event, type: 'removeReaction', meta: { ...fixture.event.meta, reactions: {}, reactionUpdatedAt: '2026-10-17T12:00:00.000003Z' } }));
    socket.send(JSON.stringify(fixture.event));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const http = new HTTPClient(base, 'fixture-key');
  const sessions = new SessionsAPI(http);
  const deployments = new Deployments(http, 'fixture-key', base);
  const controller = new AbortController();
  try {
    let rows = (await sessions.getMessages('session-1')).items;
    let count = 0;
    const snapshots: typeof rows[] = [];
    await deployments.subscribe(async event => {
      expect(['addReaction', 'removeReaction']).toContain(event.type);
      rows = applySessionReactionOperation(rows, event as SessionReactionOperation);
      snapshots.push(rows);
      expect(rows[0].acp).toEqual(fixture.row.acp);
      if (++count === 5) controller.abort();
    }, { signal: controller.signal });
    expect(snapshots[0][0].meta).toEqual(fixture.event.meta);
    expect(snapshots[1]).toBe(snapshots[0]);
    expect(snapshots[2]).toBe(snapshots[0]);
    expect(snapshots[4]).toBe(snapshots[3]);
    expect(snapshots[4][0].meta?.reactions).toEqual({});
    expect(requests.filter(r => r.startsWith('GET'))).toHaveLength(1);
    denied = true;
    await expect(sessions.getMessages('session-1')).rejects.toMatchObject({ statusCode: 403 });
    expect(requests.filter(r => r.startsWith('POST'))).toEqual(['POST /agents/deployments/events/token']);
  } finally {
    controller.abort(); sockets.close(); server.close();
  }
});

it('normalizes legacy read arrays only at the boundary and compares all six timestamp digits', () => {
  const legacy = sessionMessageMetaFromWire({ reactions: [{ reaction: { kind: 'custom', value: 'teams:heart' }, count: null,
    actors: [{ actor: { id: 'teams:user', isBot: false }, receipt: null }], actorsComplete: false }], reactionSupport: 'supported', reactionsComplete: false });
  expect(legacy?.reactions['custom:teams:heart']).toEqual({ count: null, actors: { 'teams:user': { isBot: false, receipt: null } }, actorsComplete: false });
  expect(legacy?.reactionUpdatedAt).toBeNull();
  const first = sessionMessageMetaFromWire(fixture.row.meta)!;
  const newer = sessionMessageMetaFromWire(fixture.event.meta)!;
  expect(newerSessionMessageMeta(first, newer)).toBe(newer);
  expect(newerSessionMessageMeta(newer, first)).toBe(newer);
  expect(newerSessionMessageMeta(newer, { ...newer })).toBe(newer);
});
