import { describe, it, expect, vi } from 'vitest';
import { Files } from '../src/files.js';
import { Renders } from '../src/renders.js';
import { HTTPClient } from '../src/http.js';
import { HyperCLI } from '../src/client.js';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';

describe('product file contract', () => {
  const http = new HTTPClient('https://product.example', 'fixture-credential');
  const files = new Files(http);
  const link = 'https://storage.example/file?signature=fixture';

  it('passes arbitrary filenames through multipart and preserves processing nulls', async () => {
    const wire = { id: 'f', filename: 'results (2).custom', url: null, file_size: null,
      content_type: null, state: 'processing', download_url: null, expires_at: null };
    const post = vi.spyOn(http, 'postMultipart').mockResolvedValueOnce(wire);
    const content = Buffer.from([0, 255]);
    const file = await files.uploadBytes(content, wire.filename);
    expect(post).toHaveBeenCalledWith('/api/files/multi', {
      file: { filename: wire.filename, content, contentType: 'application/octet-stream' },
    });
    expect(file).toMatchObject({ filename: wire.filename, fileSize: null, contentType: null,
      url: null, downloadUrl: null, expiresAt: null });
    post.mockRestore();
  });

  it('keeps raw and download URLs distinct and exposes the render result file', async () => {
    const get = vi.spyOn(http, 'get')
      .mockResolvedValueOnce({ render: false })
      .mockResolvedValueOnce({ id: 'r', result_url: 'legacy', result_file_id: 'f' })
      .mockResolvedValueOnce({ id: 'f', file_size: 0, url: 's3://raw', download_url: link, expires_at: '2027-01-01' });
    const render = await new Renders(http).get('r');
    expect(render).toMatchObject({ resultUrl: 'legacy', resultFileId: 'f' });
    expect(await files.get(render.resultFileId!)).toMatchObject({
      fileSize: 0, url: 's3://raw', downloadUrl: link, expiresAt: '2027-01-01',
    });
    get.mockRestore();
  });

  it('authenticates only the product GET and does not follow or log the signed redirect', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.redirect(link, 302))
      .mockResolvedValueOnce(new Response(link, { status: 403 }));
    try {
      expect(await files.downloadUrl('id/encoded')).toBe(link);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledWith('https://product.example/api/files/id%2Fencoded/download',
        expect.objectContaining({ method: 'GET', redirect: 'manual',
          headers: expect.objectContaining({ Authorization: 'Bearer fixture-credential' }) }));
      await expect(files.downloadUrl('f')).rejects.toMatchObject({ statusCode: 403, detail: 'Expected a download redirect' });
    } finally {
      fetch.mockRestore();
    }
  });
});

describe('Files API', () => {
  const liveIt = process.env.HYPER_API_KEY ? it : it.skip;
let client: HyperCLI;

function getClient(): HyperCLI {
  if (!client) client = new HyperCLI({ apiKey: process.env.HYPER_API_KEY });
  return client;
}
  let uploadedFileId: string | undefined;
  const testFilePath = join('/tmp', 'test-upload.png');

  // Create a minimal 1x1 PNG
  const createTestPNG = () => {
    // Minimal PNG: 1x1 red pixel
    const pngData = Buffer.from([
      0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
      0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1
      0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, // 8-bit RGB
      0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, // IDAT chunk
      0x54, 0x08, 0xD7, 0x63, 0xF8, 0xCF, 0xC0, 0x00,
      0x00, 0x03, 0x01, 0x01, 0x00, 0x18, 0xDD, 0x8D,
      0xB4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, // IEND
      0x44, 0xAE, 0x42, 0x60, 0x82
    ]);

    writeFileSync(testFilePath, pngData);
  };

  it.skip('should upload a file (API issue - 422)', async () => {
    createTestPNG();

    const file = await getClient().files.upload(testFilePath);

    expect(file).toBeDefined();
    expect(file.id).toBeDefined();
    expect(typeof file.id).toBe('string');

    uploadedFileId = file.id;
  });

  it.skip('should get file metadata', async () => {
    if (!uploadedFileId) {
      throw new Error('No file uploaded in previous test');
    }

    const file = await getClient().files.get(uploadedFileId);

    expect(file).toBeDefined();
    expect(file.id).toBe(uploadedFileId);
  });

  it.skip('should delete the file', async () => {
    if (!uploadedFileId) {
      throw new Error('No file uploaded in previous test');
    }

    await getClient().files.delete(uploadedFileId);

    // Clean up local test file
    try {
      unlinkSync(testFilePath);
    } catch {
      // Ignore cleanup errors
    }
  });
});
