import { afterEach, describe, it, expect, vi } from 'vitest';
import { Renders } from '../src/renders.js';
import { HTTPClient } from '../src/http.js';
import { APIError } from '../src/errors.js';

describe('render catalog transport', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it.each([false, true])('real transport attempts each submission once (included=%s)', async (included) => {
    const posts: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      if (init.method === 'GET') return Response.json({ render: included });
      posts.push(url);
      throw Object.assign(new Error('connection reset after acceptance'), { cause: { code: 'ECONNRESET' } });
    }));
    const renders = new Renders(new HTTPClient('https://unit.invalid', 'unit'));
    await expect(renders.submit('qwen21', 'sample')).rejects.toThrow('connection reset');
    await expect(renders.flow('text-to-image', { prompt: '42' })).rejects.toThrow('connection reset');
    await expect(renders.create({})).rejects.toThrow('connection reset');
    expect(posts).toEqual([
      `https://unit.invalid${included ? '/agents/flow/catalog' : '/api/renders'}`,
      `https://unit.invalid${included ? '/agents/flow' : '/api/flow'}/text-to-image`,
      'https://unit.invalid/api/renders',
    ]);
  });

  it('preserves GET transport retry', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockRejectedValueOnce(Object.assign(new Error('reset'), { cause: { code: 'ECONNRESET' } }))
      .mockResolvedValueOnce(Response.json({}));
    vi.stubGlobal('fetch', fetcher);
    const result = new Renders(new HTTPClient('https://unit.invalid', 'unit')).catalog();
    await vi.runAllTimersAsync();
    expect(await result).toEqual({});
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each([new APIError(403, 'denied'), new APIError(404, 'missing'), {}, { render: 'true' }])(
    'never submits when entitlement discovery fails: %s', async (reply) => {
      const http = {
        get: vi.fn(async () => { if (reply instanceof Error) throw reply; return reply; }),
        post: vi.fn(),
      };
      await expect(new Renders(http as unknown as HTTPClient).submit('qwen21', 'sample')).rejects.toBeInstanceOf(Error);
      expect(http.post).not.toHaveBeenCalled();
    },
  );
  it.each([false, true])('uses the same catalog and unchanged inputs (subscription=%s)', async (subscription) => {
    const catalog = { qwen21: { templates: { sample: { inputs: { prompt: { type: 'STRING' } } } } } };
    const http = {
      get: vi.fn(async (path: string) => path === '/agents/flow/access'
        ? { render: subscription } : catalog),
      post: vi.fn(async () => ({ id: 'render-1', state: 'pending' })),
    };
    const renders = new Renders(http as unknown as HTTPClient);
    expect(await renders.catalog()).toEqual(catalog);
    expect(http.get).toHaveBeenCalledExactlyOnceWith('/agents/flow/catalog');
    const inputs = { prompt: '42', seed: 0, images: { file_id: 'owned' } };
    await renders.submit('qwen21', 'sample', inputs);
    const [path, body] = http.post.mock.calls[0] as unknown as [string, any];
    expect(path).toBe(subscription ? '/agents/flow/catalog' : '/api/renders');
    expect(subscription ? body : body.params).toEqual({ family: 'qwen21', template: 'sample', inputs });
  });
});
