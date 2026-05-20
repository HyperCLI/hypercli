export interface DashboardGreetingUser {
  fullName?: string | null;
  name?: string | null;
  username?: string | null;
  email?: string | null;
}

function firstNonEmptyString(...values: Array<string | null | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

export function displayNameFromEmail(email: string | null | undefined): string | undefined {
  const localPart = email?.split("@")[0]?.split("+")[0]?.trim();
  if (!localPart) return undefined;

  return localPart
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => {
      const normalized = part.toLowerCase();
      return `${normalized[0]?.toUpperCase() ?? ""}${normalized.slice(1)}`;
    })
    .join(" ");
}

export function displayNameForDashboard(user: DashboardGreetingUser | null | undefined): string {
  return (
    firstNonEmptyString(
      user?.fullName,
      user?.name,
      user?.username,
      displayNameFromEmail(user?.email),
    ) ?? "there"
  );
}

export function resolveBrowserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

function hourForDate(date: Date, timeZone?: string): number {
  try {
    const options: Intl.DateTimeFormatOptions = {
      hour: "numeric",
      hour12: false,
    };
    if (timeZone) options.timeZone = timeZone;

    const hourPart = new Intl.DateTimeFormat("en-US", options)
      .formatToParts(date)
      .find((part) => part.type === "hour")?.value;
    const hour = Number(hourPart);
    if (Number.isFinite(hour)) return hour % 24;
  } catch {
    // Fall through to the runtime's local hour if timezone formatting is unavailable.
  }

  return date.getHours();
}

export function greetingForDate(date: Date = new Date(), timeZone = resolveBrowserTimeZone()): string {
  const hour = hourForDate(date, timeZone);
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}
