import { beforeEach, describe, expect, it, vi } from "vitest";

const windowMock = vi.hoisted(() => ({ isFocused: vi.fn() }));
const notificationMock = vi.hoisted(() => ({
  isPermissionGranted: vi.fn(),
  requestPermission: vi.fn(),
  sendNotification: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => windowMock,
}));

vi.mock("@tauri-apps/plugin-notification", () => notificationMock);

import { agentNotificationsEnabled, notificationPreview, notifyTurnComplete } from "./turn-notifications";

class MemoryStore {
  constructor(private readonly values = new Map<string, string>()) {}

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
}

describe("turn notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("localStorage", new MemoryStore());
    windowMock.isFocused.mockResolvedValue(false);
    notificationMock.isPermissionGranted.mockResolvedValue(true);
    notificationMock.requestPermission.mockResolvedValue("granted");
  });

  it("defaults per-agent notifications to disabled", () => {
    expect(agentNotificationsEnabled("agent-1", new MemoryStore() as unknown as Storage)).toBe(false);
  });

  it("respects the per-agent enabled preference", () => {
    expect(agentNotificationsEnabled("agent-1", new MemoryStore(new Map([["desktop-ng-notify:agent-1", "1"]])) as unknown as Storage)).toBe(true);
  });

  it("respects the per-agent disabled preference", () => {
    expect(agentNotificationsEnabled("agent-1", new MemoryStore(new Map([["desktop-ng-notify:agent-1", "0"]])) as unknown as Storage)).toBe(false);
  });

  it("sends a system notification only when backgrounded and permitted", async () => {
    vi.stubGlobal("localStorage", new MemoryStore(new Map([["desktop-ng-notify:agent-1", "1"]])));

    await notifyTurnComplete({
      agentId: "agent-1",
      agentName: "GrokBot",
      message: "Here is the completed answer with a concise summary.",
    });

    expect(notificationMock.sendNotification).toHaveBeenCalledWith({
      title: "GrokBot replied",
      body: "Here is the completed answer with a concise summary.",
    });
  });

  it("does not notify while focused", async () => {
    vi.stubGlobal("localStorage", new MemoryStore(new Map([["desktop-ng-notify:agent-1", "1"]])));
    windowMock.isFocused.mockResolvedValue(true);
    await notifyTurnComplete({ agentId: "agent-1", agentName: "GrokBot", message: "Done." });
    expect(notificationMock.sendNotification).not.toHaveBeenCalled();
  });

  it("does not reject when notification permission lookup fails", async () => {
    vi.stubGlobal("localStorage", new MemoryStore(new Map([["desktop-ng-notify:agent-1", "1"]])));
    notificationMock.isPermissionGranted.mockRejectedValue(new Error("plugin unavailable"));

    await expect(
      notifyTurnComplete({ agentId: "agent-1", agentName: "GrokBot", message: "Done." }),
    ).resolves.toBeUndefined();
    expect(notificationMock.sendNotification).not.toHaveBeenCalled();
  });

  it("does not reject when notification delivery fails", async () => {
    vi.stubGlobal("localStorage", new MemoryStore(new Map([["desktop-ng-notify:agent-1", "1"]])));
    notificationMock.sendNotification.mockImplementation(() => {
      throw new Error("permission denied");
    });

    await expect(
      notifyTurnComplete({ agentId: "agent-1", agentName: "GrokBot", message: "Done." }),
    ).resolves.toBeUndefined();
  });

  it("uses the same speech flattener for short previews", () => {
    expect(notificationPreview("See https://example.com for `details`." )).toBe("See for details.");
  });
});
