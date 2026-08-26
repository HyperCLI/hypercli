import { describe, expect, it } from "vitest";

import {
  launchConfigSyncRoot,
  normalizeAgentBrowserFilePath,
  normalizeOpenClawMediaDisplayPath,
  normalizeOpenClawMediaFilePath,
  normalizeOpenClawWorkspaceFilePath,
  resolveAgentFileReadPath,
  resolveAgentFileSourcePath,
} from "./agent-file-path";

describe("normalizeOpenClawWorkspaceFilePath", () => {
  it("takes the Files root directly from launch_config.sync_root", () => {
    expect(launchConfigSyncRoot({ sync_root: "/configured/root/" })).toBe("/configured/root");
    expect(launchConfigSyncRoot({ sync_root: ".openclaw/workspace" })).toBe("");
    expect(launchConfigSyncRoot(null)).toBe("");
  });

  it("preserves absolute browser paths including filesystem root", () => {
    expect(normalizeAgentBrowserFilePath("/")).toBe("/");
    expect(normalizeAgentBrowserFilePath("/home/node/.openclaw/")).toBe("/home/node/.openclaw");
    expect(normalizeAgentBrowserFilePath(".openclaw/workspace/")).toBe(".openclaw/workspace");
  });

  it("canonicalizes parent segments without escaping an absolute root", () => {
    expect(normalizeAgentBrowserFilePath("/home/node/../../etc/hosts")).toBe("/etc/hosts");
    expect(normalizeAgentBrowserFilePath("/../../etc/hosts")).toBe("/etc/hosts");
    expect(normalizeAgentBrowserFilePath("notes/drafts/../todo.md")).toBe("notes/todo.md");
  });

  it("resolves displayed paths through the configured Files sync root", () => {
    expect(resolveAgentFileSourcePath("/home/node/workspace/audio/reply.mp3", "/home/node"))
      .toBe("workspace/audio/reply.mp3");
    expect(resolveAgentFileSourcePath("/home/node/.openclaw/workspace/report.md", "/home/node"))
      .toBe(".openclaw/workspace/report.md");
    expect(resolveAgentFileSourcePath("workspace/audio/reply.mp3", "/home/node"))
      .toBe("workspace/audio/reply.mp3");
    expect(resolveAgentFileSourcePath("/workspace/audio/reply.mp3", "/"))
      .toBe("workspace/audio/reply.mp3");
  });

  it("composes chat reads through the Files root without applying legacy aliases twice", () => {
    expect(resolveAgentFileReadPath("/srv/agent/workspace/audio/reply.mp3", "/srv/agent"))
      .toBe("workspace/audio/reply.mp3");
    expect(resolveAgentFileReadPath("workspace/audio/reply.mp3", "/srv/agent"))
      .toBe("workspace/audio/reply.mp3");
    expect(resolveAgentFileReadPath("/home/node/.openclaw/workspace/reply.mp3", ""))
      .toBe(".openclaw/workspace/reply.mp3");
  });

  it("rejects source paths outside the configured Files sync root", () => {
    expect(() => resolveAgentFileSourcePath("/etc/hosts", "/home/node"))
      .toThrow("browse-only");
    expect(() => resolveAgentFileSourcePath("../secrets.txt", "/home/node"))
      .toThrow("browse-only");
    expect(() => resolveAgentFileSourcePath("/a/../../etc/passwd", "/"))
      .toThrow("browse-only");
    expect(resolveAgentFileSourcePath("/a/../etc/passwd", "/"))
      .toBe("etc/passwd");
  });

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

  it("preserves generated media paths inside the configured Files sync root", () => {
    expect(normalizeOpenClawMediaFilePath(
      "MEDIA:/home/node/workspace/audio/reply.mp3",
      "/home/node",
    )).toBe("/home/node/workspace/audio/reply.mp3");
  });
});
