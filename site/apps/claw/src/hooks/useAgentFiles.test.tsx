import { act, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HyperCLIContext, type HyperCLIContextValue } from "@/providers/HyperCLIContext";
import { renderHookWithClient } from "@/test/utils";
import { buildAgentFileEntry } from "@/test/factories";
import { useAgentFiles } from "./useAgentFiles";
import type { ReactNode } from "react";

function providerFor(value: Partial<HyperCLIContextValue>) {
  const context: HyperCLIContextValue = {
    deployments: null,
    hyperAgent: null,
    token: null,
    ready: false,
    refreshClients: vi.fn(),
    ...value,
  };

  return function Provider({ children }: { children: ReactNode }) {
    return <HyperCLIContext.Provider value={context}>{children}</HyperCLIContext.Provider>;
  };
}

describe("useAgentFiles", () => {
  it("stays disabled without an agent id or ready SDK", () => {
    const deployments = { filesList: vi.fn() };

    const { result } = renderHookWithClient(() => useAgentFiles(null), {
      provider: providerFor({ deployments: deployments as any, ready: false }),
    });

    expect(result.current.entries).toEqual([]);
    expect(deployments.filesList).not.toHaveBeenCalled();
  });

  it("loads and groups files from deployments", async () => {
    const deployments = {
      filesList: vi.fn().mockResolvedValue([
        buildAgentFileEntry({ name: "src", path: "/workspace/src", type: "directory" }),
        buildAgentFileEntry({ name: "README.md", type: "file" }),
      ]),
    };

    const { result } = renderHookWithClient(() => useAgentFiles("agent-1"), {
      provider: providerFor({ deployments: deployments as any, ready: true }),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.directories).toHaveLength(1);
    expect(result.current.files).toHaveLength(1);
  });

  it("uploads and deletes files through deployments and invalidates the list", async () => {
    const deployments = {
      filesList: vi.fn().mockResolvedValue([buildAgentFileEntry()]),
      fileWrite: vi.fn().mockResolvedValue(undefined),
      fileDelete: vi.fn().mockResolvedValue(undefined),
    };

    const { result } = renderHookWithClient(() => useAgentFiles("agent-1"), {
      provider: providerFor({ deployments: deployments as any, ready: true }),
    });

    await waitFor(() => expect(deployments.filesList).toHaveBeenCalledTimes(1));

    await act(async () => {
      await result.current.uploadFile("/workspace/new.md", "hello");
    });
    await waitFor(() => expect(deployments.fileWrite).toHaveBeenCalledWith("agent-1", "/workspace/new.md", "hello"));
    await waitFor(() => expect(deployments.filesList).toHaveBeenCalledTimes(2));

    await act(async () => {
      await result.current.deleteFile("/workspace/new.md", { recursive: true });
    });
    await waitFor(() =>
      expect(deployments.fileDelete).toHaveBeenCalledWith("agent-1", "/workspace/new.md", { recursive: true }),
    );
    await waitFor(() => expect(deployments.filesList).toHaveBeenCalledTimes(3));
  });

  it("reads and downloads through deployments methods", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const deployments = {
      filesList: vi.fn().mockResolvedValue([]),
      fileRead: vi.fn().mockResolvedValue("content"),
      fileReadBytes: vi.fn().mockResolvedValue(bytes),
    };

    const { result } = renderHookWithClient(() => useAgentFiles("agent-1"), {
      provider: providerFor({ deployments: deployments as any, ready: true }),
    });

    await expect(result.current.readFile("/workspace/a.txt")).resolves.toBe("content");
    await expect(result.current.downloadFile("/workspace/a.bin")).resolves.toBe(bytes);
  });

  it("surfaces list errors and keeps entries empty", async () => {
    const deployments = {
      filesList: vi.fn().mockRejectedValue(new Error("list failed")),
    };

    const { result } = renderHookWithClient(() => useAgentFiles("agent-1"), {
      provider: providerFor({ deployments: deployments as any, ready: true }),
    });

    await waitFor(() => expect(result.current.error).toBe("list failed"));
    expect(result.current.entries).toEqual([]);
  });

  it("uses non-recursive delete options and rejects SDK calls when not ready", async () => {
    const deployments = {
      filesList: vi.fn().mockResolvedValue([]),
      fileDelete: vi.fn().mockResolvedValue(undefined),
    };

    const { result } = renderHookWithClient(() => useAgentFiles("agent-1"), {
      provider: providerFor({ deployments: deployments as any, ready: true }),
    });

    await act(async () => {
      await result.current.deleteFile("/workspace/old.md");
    });
    expect(deployments.fileDelete).toHaveBeenCalledWith("agent-1", "/workspace/old.md", undefined);

    const missing = renderHookWithClient(() => useAgentFiles("agent-1"), {
      provider: providerFor({ deployments: null, ready: true }),
    });

    await act(async () => {
      await expect(missing.result.current.uploadFile("/workspace/new.md", "hello")).rejects.toThrow("SDK not ready");
    });
    await act(async () => {
      await expect(missing.result.current.deleteFile("/workspace/new.md")).rejects.toThrow("SDK not ready");
    });
    await expect(missing.result.current.readFile("/workspace/new.md")).rejects.toThrow("SDK not ready");
    await expect(missing.result.current.downloadFile("/workspace/new.md")).rejects.toThrow("SDK not ready");
  });
});
