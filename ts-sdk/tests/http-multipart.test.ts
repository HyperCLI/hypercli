import { afterEach, describe, expect, it, vi } from 'vitest';

import { HTTPClient } from '../src/http.js';

describe('HTTPClient multipart uploads', () => {
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
});
