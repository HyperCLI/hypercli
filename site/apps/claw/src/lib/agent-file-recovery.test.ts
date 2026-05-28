import { describe, expect, it, vi } from "vitest";

import {
  getSafeOpenClawWorkspaceFilePath,
  isPodFileReadFailedError,
  readAgentFileWithRecovery,
  toSafeAgentFileName,
} from "./agent-file-recovery";

function podReadError() {
  return Object.assign(new Error("API Error 502: Pod file read failed"), { statusCode: 502 });
}

describe("agent file recovery", () => {
  it("detects pod file read 502s", () => {
    expect(isPodFileReadFailedError(podReadError())).toBe(true);
    expect(isPodFileReadFailedError(new Error("API Error 502: Gateway failed"))).toBe(false);
    expect(isPodFileReadFailedError(Object.assign(new Error("Pod file read failed"), { statusCode: 404 }))).toBe(false);
  });

  it("builds safe workspace file names", () => {
    expect(toSafeAgentFileName("Agent Landing Page — Demo Architecture.md")).toBe("agent-landing-page-demo-architecture.md");
    expect(getSafeOpenClawWorkspaceFilePath(".openclaw/workspace/Agent Landing Page — Demo Architecture.md"))
      .toBe(".openclaw/workspace/agent-landing-page-demo-architecture.md");
    expect(getSafeOpenClawWorkspaceFilePath(".openclaw/workspace/safe-name.md")).toBeNull();
    expect(getSafeOpenClawWorkspaceFilePath("outside/Unsafe Name.md")).toBeNull();
  });

  it("retries a pod read failure before renaming", async () => {
    const read = vi.fn()
      .mockRejectedValueOnce(podReadError())
      .mockResolvedValueOnce("content");
    const rename = vi.fn(async (_from: string, to: string) => to);

    const result = await readAgentFileWithRecovery({
      path: ".openclaw/workspace/Agent Landing Page — Demo Architecture.md",
      read,
      rename,
      retryCount: 1,
      retryDelayMs: 0,
    });

    expect(result).toEqual({
      content: "content",
      path: ".openclaw/workspace/Agent Landing Page — Demo Architecture.md",
      renamed: false,
    });
    expect(read).toHaveBeenCalledTimes(2);
    expect(rename).not.toHaveBeenCalled();
  });

  it("renames unsafe workspace files when retry still fails", async () => {
    const read = vi.fn()
      .mockRejectedValueOnce(podReadError())
      .mockRejectedValueOnce(podReadError())
      .mockResolvedValueOnce("renamed content");
    const rename = vi.fn(async (_from: string, to: string) => to);

    const result = await readAgentFileWithRecovery({
      path: ".openclaw/workspace/Agent Landing Page — Demo Architecture.md",
      read,
      rename,
      retryCount: 1,
      retryDelayMs: 0,
    });

    expect(rename).toHaveBeenCalledWith(
      ".openclaw/workspace/Agent Landing Page — Demo Architecture.md",
      ".openclaw/workspace/agent-landing-page-demo-architecture.md",
    );
    expect(read).toHaveBeenLastCalledWith(".openclaw/workspace/agent-landing-page-demo-architecture.md");
    expect(result).toEqual({
      content: "renamed content",
      path: ".openclaw/workspace/agent-landing-page-demo-architecture.md",
      renamed: true,
    });
  });
});
