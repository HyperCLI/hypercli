import { describe, expect, it } from "vitest";

import { normalizeOpenClawMediaDisplayPath, normalizeOpenClawMediaFilePath, normalizeOpenClawWorkspaceFilePath } from "./agent-file-path";

describe("normalizeOpenClawWorkspaceFilePath", () => {
  it("maps absolute OpenClaw workspace paths to the dashboard workspace root", () => {
    expect(normalizeOpenClawWorkspaceFilePath("/home/node/.openclaw/workspace/report.md")).toBe(".openclaw/workspace/report.md");
  });

  it("keeps existing workspace-relative paths stable", () => {
    expect(normalizeOpenClawWorkspaceFilePath(".openclaw/workspace/report.md")).toBe(".openclaw/workspace/report.md");
  });

  it("maps workspace shorthand paths to the OpenClaw workspace root", () => {
    expect(normalizeOpenClawWorkspaceFilePath("workspace/report.md")).toBe(".openclaw/workspace/report.md");
  });

  it("maps generated media workspace paths to the agent home display path", () => {
    expect(normalizeOpenClawMediaDisplayPath("MEDIA:/home/node/.openclaw/workspace/865621.jpg")).toBe("/home/865621.jpg");
  });

  it("maps generated media display paths back to the workspace file path", () => {
    expect(normalizeOpenClawMediaFilePath("MEDIA:/home/865621.jpg")).toBe(".openclaw/workspace/865621.jpg");
  });
});
