import { describe, expect, it, vi } from "vitest";

import {
  CHAT_IMAGE_UPLOAD_CONCURRENCY,
  MAX_INLINE_CHAT_IMAGE_BYTES,
  MAX_INLINE_CHAT_IMAGES,
  shouldStageChatImageCollection,
  uploadChatImageCollection,
  type ChatImageCollectionSource,
} from "./chat-image-collection";

function image(name: string, size = 10, type = "image/png"): ChatImageCollectionSource {
  return {
    name,
    size,
    type,
    arrayBuffer: vi.fn(async () => new Uint8Array(size).buffer),
  };
}

describe("chat image collections", () => {
  it("stages image sets that exceed the inline count or byte budget", () => {
    expect(shouldStageChatImageCollection(Array.from({ length: MAX_INLINE_CHAT_IMAGES }, () => image("small.png")))).toBe(false);
    expect(shouldStageChatImageCollection(Array.from({ length: MAX_INLINE_CHAT_IMAGES + 1 }, () => image("small.png")))).toBe(true);
    expect(shouldStageChatImageCollection([image("large.png", MAX_INLINE_CHAT_IMAGE_BYTES + 1)])).toBe(true);
  });

  it("uploads one dropped collection with bounded concurrency and a manifest", async () => {
    let activeWrites = 0;
    let maxActiveWrites = 0;
    const writes: Array<{ path: string; content: ArrayBuffer | string }> = [];
    const writeFile = vi.fn(async (path: string, content: ArrayBuffer | string) => {
      activeWrites += 1;
      maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
      await new Promise((resolve) => setTimeout(resolve, 1));
      writes.push({ path, content });
      activeWrites -= 1;
    });
    const deleteFile = vi.fn(async () => undefined);
    const progress = vi.fn();
    const files = [
      image("Photo One.png"),
      image("photo-one.png"),
      ...Array.from({ length: 98 }, (_, index) => image(`image-${index + 3}.png`)),
    ];

    const result = await uploadChatImageCollection({
      files,
      writeFile,
      deleteFile,
      onProgress: progress,
      collectionId: "batch-test",
    });

    expect(result.cancelled).toBe(false);
    expect(result.failures).toEqual([]);
    expect(result.cleanupFailures).toEqual([]);
    expect(result.collection).toMatchObject({ count: 100 });
    expect(result.collection?.uploadPaths).toHaveLength(100);
    expect(maxActiveWrites).toBeLessThanOrEqual(CHAT_IMAGE_UPLOAD_CONCURRENCY);
    expect(writeFile).toHaveBeenCalledTimes(101);
    expect(deleteFile).not.toHaveBeenCalled();
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ completed: 100, total: 100 }));

    const manifestWrite = writes.find(({ path }) => path.endsWith("/image-collection-100.json"));
    expect(manifestWrite?.content).toEqual(expect.any(String));
    const manifest = JSON.parse(String(manifestWrite?.content));
    expect(manifest).toMatchObject({ kind: "image-collection", count: 100 });
    expect(manifest.images[0].path).toMatch(/photo-one\.png$/);
    expect(manifest.images[1].path).toMatch(/photo-one-1\.png$/);
    expect(manifest.images.map((entry: { originalName: string }) => entry.originalName)).toEqual(files.map((file) => file.name));
  });

  it("rolls back successful images when one upload fails", async () => {
    const writes: Array<{ path: string; content: ArrayBuffer | string }> = [];
    const deleteFile = vi.fn(async () => undefined);
    const result = await uploadChatImageCollection({
      files: [image("good.png"), image("bad.png")],
      collectionId: "partial-test",
      writeFile: async (path, content) => {
        if (path.endsWith("/bad.png")) throw new Error("storage unavailable");
        writes.push({ path, content });
      },
      deleteFile,
    });

    expect(result.collection).toBeNull();
    expect(result.manifestName).toBeNull();
    expect(result.failures).toEqual([{ name: "bad.png", message: "storage unavailable" }]);
    expect(writes.some(({ path }) => path.endsWith(".json"))).toBe(false);
    expect(deleteFile).toHaveBeenCalledWith(expect.stringMatching(/\/good\.png$/));
  });

  it("removes completed writes when the target becomes inactive", async () => {
    let active = true;
    const writtenPaths: string[] = [];
    const deleteFile = vi.fn(async (_path: string) => undefined);
    const result = await uploadChatImageCollection({
      files: Array.from({ length: 10 }, (_, index) => image(`image-${index + 1}.png`)),
      collectionId: "cancelled-test",
      isActive: () => active,
      writeFile: async (path) => {
        writtenPaths.push(path);
        active = false;
      },
      deleteFile,
    });

    expect(result).toMatchObject({ collection: null, manifestName: null, cancelled: true });
    expect(writtenPaths.length).toBeGreaterThan(0);
    expect(deleteFile.mock.calls.map(([path]) => path).sort()).toEqual([...writtenPaths].sort());
  });

  it("removes image writes when the manifest cannot be saved", async () => {
    const deleteFile = vi.fn(async () => undefined);
    const result = await uploadChatImageCollection({
      files: [image("one.png"), image("two.png")],
      collectionId: "manifest-failure-test",
      writeFile: async (path) => {
        if (path.endsWith(".json")) throw new Error("manifest unavailable");
      },
      deleteFile,
    });

    expect(result).toMatchObject({ collection: null, manifestName: null, cancelled: false });
    expect(result.failures).toEqual([{
      name: "image-collection-2.json",
      message: "manifest unavailable",
    }]);
    expect(deleteFile).toHaveBeenCalledTimes(3);
  });

  it("reserves the generated manifest name before naming images", async () => {
    const writes: string[] = [];
    const result = await uploadChatImageCollection({
      files: [image("image-collection-2.json"), image("photo.png")],
      collectionId: "manifest-name-test",
      writeFile: async (path) => {
        writes.push(path);
      },
      deleteFile: async () => undefined,
    });

    expect(result.collection?.manifestPath).toMatch(/\/image-collection-2\.json$/);
    expect(new Set(writes).size).toBe(3);
    expect(writes.some((path) => path.endsWith("/image-collection-2-1.json"))).toBe(true);
    const manifestPath = writes.find((path) => path.endsWith("/image-collection-2.json"));
    expect(manifestPath).toBeDefined();
  });

  it("bounds flattened nested image paths to a filesystem-safe filename", async () => {
    const writes: Array<{ path: string; content: ArrayBuffer | string }> = [];
    const originalName = `${"nested-folder/".repeat(30)}photo.png`;
    const result = await uploadChatImageCollection({
      files: [image(originalName)],
      collectionId: "long-name-test",
      writeFile: async (path, content) => {
        writes.push({ path, content });
      },
      deleteFile: async () => undefined,
    });

    const imagePath = result.collection?.uploadPaths[0] ?? "";
    const stagedName = imagePath.split("/").pop() ?? "";
    expect(stagedName.length).toBeLessThanOrEqual(180);
    expect(stagedName).toMatch(/\.png$/);
    const manifest = JSON.parse(String(writes.find(({ path }) => path.endsWith(".json"))?.content));
    expect(manifest.images[0].originalName).toBe(originalName);
  });
});
