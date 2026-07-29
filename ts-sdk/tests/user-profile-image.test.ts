import { describe, expect, it, vi } from 'vitest';
import { UserAPI } from '../src/user.js';


describe('User profile image API', () => {
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
});
