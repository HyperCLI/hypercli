import { describe, it, expect, vi } from 'vitest';
import { Renders } from '../src/renders.js';
import type { HTTPClient } from '../src/http.js';

describe('render catalog transport', () => {
  it.each([false, true])('uses the same catalog and unchanged inputs (subscription=%s)', async (subscription) => {
    const catalog = { qwen21: { templates: { sample: { inputs: { prompt: { type: 'STRING' } } } } } };
    const http = {
      get: vi.fn(async (path: string) => path === '/api/auth/me'
        ? { capabilities: subscription ? ['flows:*'] : [] } : catalog),
      post: vi.fn(async () => ({ id: 'render-1', state: 'pending' })),
    };
    const renders = new Renders(http as unknown as HTTPClient);
    expect(await renders.catalog()).toEqual(catalog);
    expect(http.get).toHaveBeenLastCalledWith(subscription ? '/agents/flow/catalog' : '/api/renders/catalog');
    const inputs = { prompt: '42', seed: 0, images: { file_id: 'owned' } };
    await renders.submit('qwen21', 'sample', inputs);
    const [path, body] = http.post.mock.calls[0] as unknown as [string, any];
    expect(path).toBe(subscription ? '/agents/flow/catalog' : '/api/renders');
    expect(subscription ? body : body.params).toEqual({ family: 'qwen21', template: 'sample', inputs });
  });
});
