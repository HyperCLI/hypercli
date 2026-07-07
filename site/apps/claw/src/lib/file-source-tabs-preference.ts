export const FILE_SOURCE_TABS_PREFERENCE_STORAGE_KEY = "claw.files.showSourceTabs.v1";

export function readFileSourceTabsPreference(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(FILE_SOURCE_TABS_PREFERENCE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeFileSourceTabsPreference(value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(FILE_SOURCE_TABS_PREFERENCE_STORAGE_KEY, value ? "1" : "0");
  } catch {}
}
