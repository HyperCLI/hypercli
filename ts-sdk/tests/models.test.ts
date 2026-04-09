import { describe, expect, it, vi } from 'vitest';
import { ModelsAPI } from '../src/models.js';
import type { HTTPClient } from '../src/http.js';

describe('Models SDK', () => {
  it('lists OpenAI-compatible models', async () => {
    const http = {
      get: vi.fn().mockResolvedValue({
        object: 'list',
        data: [
          { id: 'glm-5', object: 'model', owned_by: 'hypercli' },
          { id: 'kimi-k2.5', object: 'model', owned_by: 'hypercli' },
        ],
      }),
    } as unknown as HTTPClient;

    const models = new ModelsAPI(http);
    const listed = await models.list();

    expect(listed.map((model) => model.id)).toEqual(['glm-5', 'kimi-k2.5']);
    expect((http.get as any).mock.calls[0][0]).toBe('/v1/models');
  });
});
