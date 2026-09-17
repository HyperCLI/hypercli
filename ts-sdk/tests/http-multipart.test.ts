import { afterEach, describe, expect, it, vi } from 'vitest';

import { APIError } from '../src/errors.js';
import { HTTPClient, responseAPIError } from '../src/http.js';

describe('HTTPClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('passes FormData through without JSON encoding it', async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ ok: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);
    const client = new HTTPClient('https://api.example.test', 'test-token');

    await client.postMultipart('/files', {
      file: {
        filename: 'avatar.txt',
        content: Buffer.from('avatar'),
        contentType: 'text/plain',
      },
    }, { folder: 'profiles' });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example.test/files?folder=profiles');
    expect(init.body).toBeInstanceOf(FormData);
    const headers = new Headers(init.headers);
    expect(headers.get('Authorization')).toBe('Bearer test-token');
    expect(headers.has('Content-Type')).toBe(false);
    const uploaded = (init.body as FormData).get('file');
    expect(uploaded).toBeInstanceOf(Blob);
    expect(await (uploaded as Blob).text()).toBe('avatar');
  });

  it('renders structured API error details as JSON', async () => {
    const error = await responseAPIError(new Response(JSON.stringify({
      detail: [{ loc: ['body', 'launch_config', 'config'], msg: 'Field required' }],
    }), {
      status: 422,
      statusText: 'Unprocessable Entity',
    }), 'POST', 'https://api.example.test/agents/deployments/agent-1/start');

    expect(error).toBeInstanceOf(APIError);
    expect(error.message).toContain('"launch_config"');
    expect(error.message).toContain('"Field required"');
    expect(error.message).not.toContain('[object Object]');
  });
});
