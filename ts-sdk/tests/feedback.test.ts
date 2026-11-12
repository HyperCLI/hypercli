import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeedbackAPI } from '../src/feedback.js';
import { HTTPClient } from '../src/http.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Feedback SDK', () => {
  it('submits text and attachments as one multipart POST with bearer auth', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 'rep-1',
      attachment_count: 2,
      status: 'received',
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetch);

    const http = new HTTPClient('https://api.example.test/agents', 'hyper_api_fixture');
    const api = new FeedbackAPI(http);
    const receipt = await api.submitBugReport({
      text: 'The screenshot button does nothing',
      appVersion: '1.2.3',
      agentId: 'agent-1',
      sessionId: 'sess-1',
      attachments: [
        { filename: 'shot.png', blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }) },
        { filename: 'clip.mp4', blob: new Blob([new Uint8Array([4])], { type: 'video/mp4' }) },
      ],
    });

    expect(receipt).toEqual({ id: 'rep-1', attachmentCount: 2, status: 'received' });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example.test/agents/feedback');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer hyper_api_fixture');
    expect(new Headers(init.headers).get('Content-Type')).toBeNull();

    const body = init.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get('text')).toBe('The screenshot button does nothing');
    expect(body.get('app_version')).toBe('1.2.3');
    expect(body.get('agent_id')).toBe('agent-1');
    expect(body.get('session_id')).toBe('sess-1');
    expect(body.getAll('attachments')).toHaveLength(2);
  });

  it('omits unset context fields and sends no attachments entry when none are provided', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 'rep-2',
      attachment_count: 0,
      status: 'received',
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetch);

    const api = new FeedbackAPI(new HTTPClient('https://api.example.test/agents', 'hyper_api_fixture'));
    const receipt = await api.submitBugReport({ text: 'Just a note' });

    expect(receipt).toEqual({ id: 'rep-2', attachmentCount: 0, status: 'received' });
    const [, init] = fetch.mock.calls[0] as [string, RequestInit];
    const body = init.body as FormData;
    expect(body.get('app_version')).toBeNull();
    expect(body.get('agent_id')).toBeNull();
    expect(body.get('session_id')).toBeNull();
    expect(body.getAll('attachments')).toHaveLength(0);
  });

  it('surfaces backend rejections with their status', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      detail: 'Attachments must be PNG, JPEG, WebP, GIF, MP4, WebM, or MOV',
    }), { status: 415, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetch);

    const api = new FeedbackAPI(new HTTPClient('https://api.example.test/agents', 'hyper_api_fixture'));
    await expect(
      api.submitBugReport({ text: 'bad media', attachments: [{ filename: 'a.txt', blob: new Blob(['x'], { type: 'text/plain' }) }] })
    ).rejects.toMatchObject({ statusCode: 415 });
  });
});
