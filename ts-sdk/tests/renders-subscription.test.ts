import { afterEach, describe, expect, it, vi } from 'vitest';
import { APIError } from '../src/errors.js';
import { Renders } from '../src/renders.js';

describe('Renders subscription routing', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses /agents/flow when subscription flow is available', async () => {
    const calls: Array<[string, string, any?]> = [];
    const http = {
      get: async (path: string) => {
        calls.push(['get', path]);
        if (path === '/api/auth/me') {
          return {
            auth_type: 'orchestra_key',
            capabilities: ['flows:*'],
            has_active_subscription: true,
          };
        }
        return { id: 'render-123', state: 'queued' };
      },
      post: async (path: string, body: any) => {
        calls.push(['post', path, body]);
        return { id: 'render-123', state: 'queued' };
      },
      delete: async (path: string) => {
        calls.push(['delete', path]);
        return { status: 'cancelled' };
      },
    };

    const renders = new Renders(http as any);
    const render = await renders.flow('text-to-image', { prompt: 'hello' });

    expect(render.renderId).toBe('render-123');
    expect(calls[0]).toEqual(['get', '/api/auth/me']);
    expect(calls[1]).toEqual(['post', '/agents/flow/text-to-image', { prompt: 'hello' }]);
  });

  it('falls back to paid flow on subscription rejection', async () => {
    const calls: Array<[string, string, any?]> = [];
    let first = true;
    const http = {
      get: async (path: string) => {
        calls.push(['get', path]);
        return {
          auth_type: 'orchestra_key',
          capabilities: ['flows:*'],
          has_active_subscription: true,
        };
      },
      post: async (path: string, body: any) => {
        calls.push(['post', path, body]);
        if (path === '/agents/flow/text-to-image' && first) {
          first = false;
          throw new APIError(403, 'Active paid subscription required');
        }
        return { id: 'render-123', state: 'queued' };
      },
      delete: async (_path: string) => ({ status: 'cancelled' }),
    };

    const renders = new Renders(http as any);
    const render = await renders.flow('text-to-image', { prompt: 'hello' });

    expect(render.renderId).toBe('render-123');
    expect(calls[1]).toEqual(['post', '/agents/flow/text-to-image', { prompt: 'hello' }]);
    expect(calls[2]).toEqual(['post', '/api/flow/text-to-image', { prompt: 'hello' }]);
  });

  it('prefers subscription render routes for status operations', async () => {
    const calls: Array<[string, string, any?]> = [];
    const http = {
      get: async (path: string) => {
        calls.push(['get', path]);
        if (path === '/api/auth/me') {
          return {
            auth_type: 'user',
            capabilities: [],
            has_active_subscription: true,
          };
        }
        if (path.endsWith('/status')) {
          return { id: 'render-123', state: 'running', progress: 0.5 };
        }
        return { id: 'render-123', state: 'queued' };
      },
      post: async (_path: string, _body: any) => ({ id: 'render-123', state: 'queued' }),
      delete: async (path: string) => {
        calls.push(['delete', path]);
        return { status: 'cancelled' };
      },
    };

    const renders = new Renders(http as any);
    await renders.get('render-123');
    await renders.status('render-123');
    await renders.cancel('render-123');

    expect(calls).toContainEqual(['get', '/agents/flow/renders/render-123']);
    expect(calls).toContainEqual(['get', '/agents/flow/renders/render-123/status']);
    expect(calls).toContainEqual(['delete', '/agents/flow/renders/render-123']);
  });

  it('uses /api/flow/renders for flow-only keys when auth me is denied', async () => {
    const calls: Array<[string, string, any?]> = [];
    const http = {
      get: async (path: string) => {
        calls.push(['get', path]);
        if (path === '/api/auth/me') {
          throw new APIError(403, 'Access denied');
        }
        if (path.endsWith('/status')) {
          return { id: 'render-123', state: 'running', progress: 0.5 };
        }
        return { id: 'render-123', state: 'queued' };
      },
      post: async (_path: string, _body: any) => ({ id: 'render-123', state: 'queued' }),
      delete: async (path: string) => {
        calls.push(['delete', path]);
        return { status: 'cancelled' };
      },
    };

    const renders = new Renders(http as any);
    await renders.get('render-123');
    await renders.status('render-123');
    await renders.cancel('render-123');

    expect(calls).toContainEqual(['get', '/api/flow/renders/render-123']);
    expect(calls).toContainEqual(['get', '/api/flow/renders/render-123/status']);
    expect(calls).toContainEqual(['delete', '/api/flow/renders/render-123']);
  });

  it('waits through queue grace before timing out', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const http = {
      get: async (path: string) => {
        if (path === '/api/auth/me') {
          return {
            auth_type: 'user',
            capabilities: [],
            has_active_subscription: true,
          };
        }
        const now = Date.now();
        if (now < 15000) {
          return { id: 'render-123', state: 'running', started_at: null };
        }
        return { id: 'render-123', state: 'completed', started_at: '1970-01-01T00:00:15Z' };
      },
      post: async (_path: string, _body: any) => ({ id: 'render-123', state: 'queued' }),
      delete: async (_path: string) => ({ status: 'cancelled' }),
    };

    const renders = new Renders(http as any);
    const waitPromise = renders.wait('render-123', {
      timeoutMs: 10000,
      pollIntervalMs: 5000,
      queueGraceMs: 10000,
      activeGraceMs: 5000,
    });

    await vi.runAllTimersAsync();
    const render = await waitPromise;

    expect(render.state).toBe('completed');
  });

  it('waits through recent active grace before timing out', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const http = {
      get: async (path: string) => {
        if (path === '/api/auth/me') {
          return {
            auth_type: 'user',
            capabilities: [],
            has_active_subscription: true,
          };
        }
        const now = Date.now();
        if (now < 5000) {
          return { id: 'render-123', state: 'running', started_at: null };
        }
        if (now < 10000) {
          return { id: 'render-123', state: 'running', started_at: '1970-01-01T00:00:04Z' };
        }
        return { id: 'render-123', state: 'completed', started_at: '1970-01-01T00:00:04Z' };
      },
      post: async (_path: string, _body: any) => ({ id: 'render-123', state: 'queued' }),
      delete: async (_path: string) => ({ status: 'cancelled' }),
    };

    const renders = new Renders(http as any);
    const waitPromise = renders.wait('render-123', {
      timeoutMs: 5000,
      pollIntervalMs: 5000,
      queueGraceMs: 5000,
      activeGraceMs: 6000,
    });

    await vi.runAllTimersAsync();
    const render = await waitPromise;

    expect(render.state).toBe('completed');
  });
});
