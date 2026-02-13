import { describe, it, expect } from 'vitest';
import { HyperCLI } from '../src/client.js';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';

describe('Files API', () => {
  const client = new HyperCLI();
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
    
    const file = await client.files.upload(testFilePath);
    
    expect(file).toBeDefined();
    expect(file.id).toBeDefined();
    expect(typeof file.id).toBe('string');
    
    uploadedFileId = file.id;
  });

  it.skip('should get file metadata', async () => {
    if (!uploadedFileId) {
      throw new Error('No file uploaded in previous test');
    }

    const file = await client.files.get(uploadedFileId);
    
    expect(file).toBeDefined();
    expect(file.id).toBe(uploadedFileId);
  });

  it.skip('should delete the file', async () => {
    if (!uploadedFileId) {
      throw new Error('No file uploaded in previous test');
    }

    await client.files.delete(uploadedFileId);
    
    // Clean up local test file
    try {
      unlinkSync(testFilePath);
    } catch {
      // Ignore cleanup errors
    }
  });
});
