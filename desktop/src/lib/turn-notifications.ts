import { appFocus, type AppFocusService } from "./app-focus";
import { systemNotifications, type SystemNotificationService } from "./system-notifications";
import { flattenForSpeech } from "./voice-read";

const NOTIFY_PREFIX = "desktop-ng-notify:";
const NOTIFICATION_WORD_CAP = 32;

function defaultStorage(): Pick<Storage, "getItem"> | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function agentNotificationsEnabled(agentId: string, storage: Pick<Storage, "getItem"> | null = defaultStorage()): boolean {
  try {
    if (!storage) return false;
    const value = storage.getItem(`${NOTIFY_PREFIX}${agentId}`);
    return value === "1";
  } catch {
    return false;
  }
}

export async function appIsBackgrounded(): Promise<boolean> {
  return appFocus.isBackgrounded();
}

export function notificationPreview(text: string): string {
  return flattenForSpeech(text, NOTIFICATION_WORD_CAP);
}

export async function notifyTurnComplete(options: {
  agentId: string;
  agentName: string;
  message: string;
}, services: {
  focus?: AppFocusService;
  notifications?: SystemNotificationService;
  storage?: Pick<Storage, "getItem"> | null;
} = {}): Promise<void> {
  if (!agentNotificationsEnabled(options.agentId, services.storage ?? defaultStorage())) return;
  if (!(await (services.focus ?? appFocus).isBackgrounded())) return;
  const body = notificationPreview(options.message);
  if (!body) return;

  const notifications = services.notifications ?? systemNotifications;
  if (!(await notifications.ensurePermission())) return;

  await notifications.send({
    title: `${options.agentName} replied`,
    body,
  });
}
