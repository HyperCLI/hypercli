import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";

export type SystemNotification = {
  title: string;
  body: string;
};

export interface SystemNotificationService {
  ensurePermission(): Promise<boolean>;
  send(notification: SystemNotification): Promise<boolean>;
}

export class TauriSystemNotificationService implements SystemNotificationService {
  async ensurePermission(): Promise<boolean> {
    try {
      let granted = await isPermissionGranted();
      if (!granted) {
        granted = (await requestPermission()) === "granted";
      }
      return granted;
    } catch {
      return false;
    }
  }

  async send(notification: SystemNotification): Promise<boolean> {
    try {
      await sendNotification(notification);
      return true;
    } catch {
      return false;
    }
  }
}

export const systemNotifications = new TauriSystemNotificationService();
