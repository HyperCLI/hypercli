import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserHyperCLI } from '../src/browser.js';
import { UserAPI } from '../src/user.js';


describe('User profile image API', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('gets, uploads, and deletes account avatars through the agents API client', async () => {
    const productHttp = {} as any;
    const profileHttp = {
      get: vi.fn(async () => ({
        id: 'user-123',
        avatar_url: 'https://cdn.example.test/current.png',
        s3_key: 'prod/user-123/user-123.png',
      })),
      postRaw: vi.fn(async () => ({
        id: 'user-123',
        avatar_url: 'https://cdn.example.test/updated.png',
        s3_key: 'prod/user-123/user-123.png',
      })),
      delete: vi.fn(async () => ({
        id: 'user-123',
        avatar_url: null,
        s3_key: null,
      })),
    } as any;
    const user = new UserAPI(productHttp, productHttp, profileHttp);
    const image = new Blob(['image'], { type: 'image/webp' });

    await expect(user.getProfileImage()).resolves.toEqual({
      id: 'user-123',
      avatarUrl: 'https://cdn.example.test/current.png',
      s3Key: 'prod/user-123/user-123.png',
    });
    await expect(user.uploadProfileImage(image)).resolves.toEqual({
      id: 'user-123',
      avatarUrl: 'https://cdn.example.test/updated.png',
      s3Key: 'prod/user-123/user-123.png',
    });
    await expect(user.deleteProfileImage()).resolves.toEqual({
      id: 'user-123',
      avatarUrl: null,
      s3Key: null,
    });

    expect(profileHttp.get).toHaveBeenCalledWith('/users/profile-image');
    expect(profileHttp.postRaw).toHaveBeenCalledWith('/users/profile-image', image, 'image/webp');
    expect(profileHttp.delete).toHaveBeenCalledWith('/users/profile-image');
  });

  it('sends raw image bytes to the configured agents API', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => new Response(
      JSON.stringify({
        id: 'user-123',
        avatar_url: init?.method === 'DELETE' ? null : 'https://cdn.example.test/profile.png',
        s3_key: init?.method === 'DELETE' ? null : 'prod/user-123/profile.png',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);
    const client = new BrowserHyperCLI({
      apiUrl: 'https://api.dev.hypercli.com',
      agentsApiBaseUrl: 'https://api.dev.hypercli.com/agents',
      token: 'app-token',
    });
    const image = new Blob(['image'], { type: 'image/webp' });

    await client.user.uploadProfileImage(image);
    await client.user.getProfileImage();
    await client.user.deleteProfileImage();

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://api.dev.hypercli.com/agents/users/profile-image',
      expect.objectContaining({ method: 'POST', body: image }),
    );
    const uploadHeaders = new Headers((fetchMock.mock.calls[0]?.[1] as RequestInit).headers);
    expect(uploadHeaders.get('Authorization')).toBe('Bearer app-token');
    expect(uploadHeaders.get('Content-Type')).toBe('image/webp');
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://api.dev.hypercli.com/agents/users/profile-image',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'https://api.dev.hypercli.com/agents/users/profile-image',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});
