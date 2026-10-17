import { createServer } from 'node:http';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import { expect, it } from 'vitest';
import { HTTPClient } from '../src/http.js';
import { Deployments } from '../src/agents.js';
import { SessionsAPI, applySessionReactionOperation, sessionMessageMetaFromWire, newerSessionMessageMeta, type SessionReactionOperation } from '../src/sessions.js';
import fixture from './fixtures/session-reactions.json';

it('rejects malformed metadata at both REST and live boundaries before delivering state', async () => {
  const group = fixture.event.meta.reactions['unicode:👍'];
  const badGroups = [
    { ...group, count: -1 }, { ...group, count: 1.5 }, { ...group, count: 1 },
    { ...group, count: null }, { ...group, count: 3 }, { ...group, extra: true },
    { ...group, actors: null }, { ...group, actors: { unscoped: { isBot: false, receipt: null } } },
    { ...group, actors: { 'teams:u': { isBot: 'false', receipt: null } } },
    { ...group, actors: { 'teams:u': { isBot: false, receipt: 42 } } },
    { ...group, actors: { 'teams:u': { isBot: false, receipt: null, extra: true } } },
  ];
  const malformed: unknown[] = [null, { ...fixture.row.meta, reactions: null }, { ...fixture.row.meta, extra: true },
    ...['zzzz', '2026-02-30T12:00:00.000001Z', '2026-10-17T24:00:00.000001Z', '0000-01-01T00:00:00.000001Z', '2026-10-17T12:00:00.001Z'].map(reactionUpdatedAt => ({ ...fixture.row.meta, reactionUpdatedAt })),
    { ...fixture.row.meta, reactionSupport: 'unknown', reactionsComplete: true },
    ...['bad:👍', 'custom:unscoped', 'unicode:'].map(key => ({ ...fixture.event.meta, reactions: { [key]: group } })),
    ...badGroups.map(group => ({ ...fixture.event.meta, reactions: { 'unicode:👍': group } })),
  ];
  let meta: unknown, base = '';
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(req.method === 'POST' ? { token: 'fixture-token', ws_url: base.replace('http:', 'ws:') + '/ws/deployments' } :
      { items: [{ ...fixture.row, meta }], next_cursor: null, has_more: false }));
  });
  const sockets = new WebSocketServer({ server });
  sockets.on('connection', socket => {
    socket.send(JSON.stringify({ type: 'ready' }));
    socket.send(JSON.stringify({ ...fixture.event, meta }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const http = new HTTPClient(base, 'fixture-key');
  let delivered = 0;
  try {
    for (meta of malformed) {
      await expect(new SessionsAPI(http).getMessages('session-1')).rejects.toThrow('Invalid session reaction metadata');
      await expect(new Deployments(http, 'fixture-key', base).subscribe(() => { delivered++; })).rejects.toThrow('Invalid session reaction metadata');
    }
    expect(delivered).toBe(0);
    meta = { reactions: {}, reactionSupport: 'unknown', reactionsComplete: false };
    expect((await new SessionsAPI(http).getMessages('session-1')).items[0].meta?.reactionUpdatedAt).toBeNull();
  } finally { sockets.close(); server.close(); }
});

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
