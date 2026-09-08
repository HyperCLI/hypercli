import { afterEach, describe, expect, it, vi } from 'vitest';
import { deriveRoutinesApiBase, RoutinesAPI } from '../src/routines.js';
import type { Routine } from '../src/index.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Routines SDK', () => {
  it('derives routines API base from agents API base', () => {
    expect(deriveRoutinesApiBase('https://api.agents.dev.hypercli.com/agents')).toBe(
      'https://api.agents.dev.hypercli.com/routines',
    );
  });

  it('creates routines with bearer auth and normalized fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'routine-1',
          user_id: 'user-1',
          agent_id: 'agent-1',
          cron: '0 9 * * *',
          prompt: 'Summarize overnight activity',
          enabled: true,
          next_run_at: '2026-09-09T09:00:00Z',
          created_at: '2026-09-08T10:00:00Z',
          updated_at: '2026-09-08T10:00:00Z',
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const api = new RoutinesAPI('key', { apiBase: 'http://routines.test/routines' });
    const routine = await api.create({
      agentId: 'agent-1',
      cron: '0 9 * * *',
      prompt: 'Summarize overnight activity',
    });

    expect(routine).toMatchObject({
      id: 'routine-1',
      userId: 'user-1',
      agentId: 'agent-1',
      cron: '0 9 * * *',
      enabled: true,
      nextRunAt: '2026-09-09T09:00:00Z',
      createdAt: '2026-09-08T10:00:00Z',
      updatedAt: '2026-09-08T10:00:00Z',
    });
    expect(fetchMock.mock.calls[0][0]).toBe('http://routines.test/routines');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer key' }),
      body: JSON.stringify({
        agent_id: 'agent-1',
        cron: '0 9 * * *',
        prompt: 'Summarize overnight activity',
        enabled: true,
      }),
    });
  });

  it('creates one-shot routines with runAt and name', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'routine-2',
          user_id: 'user-1',
          agent_id: 'agent-1',
          cron: '',
          prompt: 'Open presents',
          enabled: true,
          name: 'Christmas',
          run_at: '2026-12-25T09:00:00Z',
          next_run_at: '2026-12-25T09:00:00Z',
          created_at: '2026-09-08T10:00:00Z',
          updated_at: '2026-09-08T10:00:00Z',
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const api = new RoutinesAPI('key', { apiBase: 'http://routines.test/routines' });
    const routine = await api.create({
      agentId: 'agent-1',
      prompt: 'Open presents',
      runAt: '2026-12-25T09:00:00Z',
      name: 'Christmas',
    });

    expect(routine.name).toBe('Christmas');
    expect(routine.runAt).toBe('2026-12-25T09:00:00Z');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({
        agent_id: 'agent-1',
        prompt: 'Open presents',
        enabled: true,
        run_at: '2026-12-25T09:00:00Z',
        name: 'Christmas',
      }),
    });
  });

  it('defaults name and runAt to null when absent from the response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'routine-1',
          user_id: 'user-1',
          agent_id: 'agent-1',
          cron: '0 9 * * *',
          prompt: 'Daily summary',
          enabled: true,
          next_run_at: null,
          created_at: '2026-09-08T10:00:00Z',
          updated_at: '2026-09-08T10:00:00Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const api = new RoutinesAPI('key', { apiBase: 'http://routines.test/routines' });
    const routine = await api.get('routine-1');

    expect(routine.name).toBeNull();
    expect(routine.runAt).toBeNull();
  });

  it('updates the routine name', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'routine-1',
          user_id: 'user-1',
          agent_id: 'agent-1',
          cron: '0 9 * * *',
          prompt: 'Daily summary',
          enabled: true,
          name: 'Renamed',
          run_at: null,
          next_run_at: null,
          created_at: '2026-09-08T10:00:00Z',
          updated_at: '2026-09-08T12:00:00Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const api = new RoutinesAPI('key', { apiBase: 'http://routines.test/routines' });
    const routine = await api.update('routine-1', { name: 'Renamed' });

    expect(routine.name).toBe('Renamed');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'PATCH',
      body: JSON.stringify({ name: 'Renamed' }),
    });
  });

  it('lists routines, optionally filtered by agent', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              id: 'routine-1',
              user_id: 'user-1',
              agent_id: 'agent-1',
              cron: '0 9 * * *',
              prompt: 'Daily summary',
              enabled: true,
              next_run_at: null,
              created_at: '2026-09-08T10:00:00Z',
              updated_at: '2026-09-08T10:00:00Z',
            },
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const api = new RoutinesAPI('key', { apiBase: 'http://routines.test/routines' });
    const routines = await api.list({ agentId: 'agent-1' });
    const all = await api.list();

    expect(routines[0]).toMatchObject({ id: 'routine-1', agentId: 'agent-1', nextRunAt: null });
    expect(fetchMock.mock.calls[0][0]).toBe('http://routines.test/routines?agent_id=agent-1');
    expect(fetchMock.mock.calls[1][0]).toBe('http://routines.test/routines');
    expect(all).toEqual([]);
  });

  it('gets a routine by id and encodes the reference', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'routine-1',
          user_id: 'user-1',
          agent_id: 'agent-1',
          cron: '*/15 * * * *',
          prompt: 'Check inbox',
          enabled: false,
          next_run_at: null,
          created_at: '2026-09-08T10:00:00Z',
          updated_at: '2026-09-08T11:00:00Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const api = new RoutinesAPI('key', { apiBase: 'http://routines.test/routines' });
    const routine: Routine = await api.get('routine/#1');

    expect(routine.enabled).toBe(false);
    expect(fetchMock.mock.calls[0][0]).toBe('http://routines.test/routines/routine%2F%231');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'GET',
      headers: expect.objectContaining({ Authorization: 'Bearer key' }),
    });
  });

  it('updates only provided routine fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'routine-1',
          user_id: 'user-1',
          agent_id: 'agent-1',
          cron: '0 10 * * *',
          prompt: 'Daily summary',
          enabled: false,
          next_run_at: null,
          created_at: '2026-09-08T10:00:00Z',
          updated_at: '2026-09-08T12:00:00Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const api = new RoutinesAPI('key', { apiBase: 'http://routines.test/routines' });
    const routine = await api.update('routine-1', { cron: '0 10 * * *', enabled: false });

    expect(routine.cron).toBe('0 10 * * *');
    expect(routine.enabled).toBe(false);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'PATCH',
      body: JSON.stringify({ cron: '0 10 * * *', enabled: false }),
    });
  });

  it('deletes routines and resolves on 204', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    const api = new RoutinesAPI('key', { apiBase: 'http://routines.test/routines' });
    await expect(api.delete('routine-1')).resolves.toBeUndefined();

    expect(fetchMock.mock.calls[0][0]).toBe('http://routines.test/routines/routine-1');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'DELETE' });
  });

  it('rejects a malformed list payload instead of returning an empty list', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ routines: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const api = new RoutinesAPI('key', { apiBase: 'http://routines.test/routines' });
    await expect(api.list()).rejects.toThrow('Routines response must be an array.');
  });

  it('preserves API error details', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: 'Routine not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const api = new RoutinesAPI('key', { apiBase: 'http://routines.test/routines' });
    await expect(api.get('missing')).rejects.toMatchObject({
      statusCode: 404,
      detail: 'Routine not found',
    });
  });
});
