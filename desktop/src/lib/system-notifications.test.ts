import { beforeEach, describe, expect, it, vi } from "vitest";

const notificationMock = vi.hoisted(() => ({
  isPermissionGranted: vi.fn(),
  requestPermission: vi.fn(),
  sendNotification: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-notification", () => notificationMock);

import { TauriSystemNotificationService } from "./system-notifications";

describe("system notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notificationMock.isPermissionGranted.mockResolvedValue(true);
    notificationMock.requestPermission.mockResolvedValue("granted");
  });

  it("uses existing notification permission", async () => {
    await expect(new TauriSystemNotificationService().ensurePermission()).resolves.toBe(true);

    expect(notificationMock.requestPermission).not.toHaveBeenCalled();
  });

  it("requests permission when not already granted", async () => {
    notificationMock.isPermissionGranted.mockResolvedValue(false);

    await expect(new TauriSystemNotificationService().ensurePermission()).resolves.toBe(true);
    expect(notificationMock.requestPermission).toHaveBeenCalled();
  });

  it("treats permission plugin failures as not granted", async () => {
    notificationMock.isPermissionGranted.mockRejectedValue(new Error("plugin unavailable"));

    await expect(new TauriSystemNotificationService().ensurePermission()).resolves.toBe(false);
  });

  it("catches notification send failures", async () => {
    notificationMock.sendNotification.mockImplementation(() => {
      throw new Error("permission denied");
    });

    await expect(new TauriSystemNotificationService().send({ title: "Agent replied", body: "Done." })).resolves.toBe(false);
  });
});
