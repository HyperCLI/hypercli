import { getCurrentWindow } from "@tauri-apps/api/window";

export interface AppFocusService {
  isBackgrounded(): Promise<boolean>;
}

export class TauriAppFocusService implements AppFocusService {
  async isBackgrounded(): Promise<boolean> {
    try {
      return !(await getCurrentWindow().isFocused());
    } catch {
      return typeof document !== "undefined" ? document.hidden : false;
    }
  }
}

export const appFocus = new TauriAppFocusService();
