export type RoutineFrequency = "none" | "daily" | "weekdays" | "weekly" | "monthly" | "annually";

export interface ScheduleDraft {
  frequency: RoutineFrequency;
  weekday: number;
  dayOfMonth: number;
  month: number;
  time: string;
  date: string;
  rawCron: string;
}

export const DEFAULT_SCHEDULE: ScheduleDraft = {
  frequency: "weekly",
  weekday: 1,
  dayOfMonth: 1,
  month: 1,
  time: "09:00",
  date: "",
  rawCron: "",
};

export const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function dateInputValue(value: Date): string {
  return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
}

export function formatTime12h(hour: number, minute: number): string {
  const h = ((hour % 24) + 24) % 24;
  const m = ((minute % 60) + 60) % 60;
  const suffix = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad2(m)} ${suffix}`;
}

export function parseUserTime(input: string): { hour: number; minute: number } | null {
  const text = input.trim().toLowerCase().replace(/\s+/g, "");
  if (!text) return null;
  const meridiemMatch = /(a\.m\.|p\.m\.|am|pm)$/.exec(text);
  const meridiem = meridiemMatch ? (meridiemMatch[1].startsWith("p") ? "pm" : "am") : null;
  const core = meridiemMatch ? text.slice(0, -meridiemMatch[1].length) : text;
  const match = /^(\d{1,4})(?:[:.](\d{1,2}))?$/.exec(core);
  if (!match) return null;
  let hour: number;
  let minute: number;
  if (match[2] !== undefined) {
    hour = Number(match[1]);
    minute = Number(match[2]);
    if (minute > 59) return null;
  } else if (match[1].length <= 2) {
    hour = Number(match[1]);
    minute = 0;
  } else {
    hour = Number(match[1].slice(0, -2));
    minute = Number(match[1].slice(-2));
    if (minute > 59) return null;
  }
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour %= 12;
    if (meridiem === "pm") hour += 12;
  } else if (hour > 23) {
    return null;
  }
  return { hour, minute };
}

export function formatGmtOffset(offsetMinutes: number): string {
  const abs = Math.abs(offsetMinutes);
  const hours = Math.floor(abs / 60);
  const minutes = abs % 60;
  return `GMT${offsetMinutes < 0 ? "-" : "+"}${hours}${minutes === 0 ? "" : `:${pad2(minutes)}`}`;
}

export function localTimeZoneLabel(now: Date = new Date(), timeZone?: string): string {
  const gmt = formatGmtOffset(-now.getTimezoneOffset());
  let name = timeZone;
  if (name === undefined) {
    try {
      name = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      name = undefined;
    }
  }
  const trimmed = name?.trim() ?? "";
  return trimmed !== "" && trimmed.length <= 24 ? `${gmt} (${trimmed})` : gmt;
}

const STATIC_TIMEZONE_OFFSETS: Record<string, number> = {
  "Pacific/Pago_Pago": -660,
  "Pacific/Honolulu": -600,
  "America/Anchorage": -540,
  "America/Los_Angeles": -480,
  "America/Denver": -420,
  "America/Chicago": -360,
  "America/New_York": -300,
  "America/Santiago": -240,
  "America/Sao_Paulo": -180,
  "Atlantic/South_Georgia": -120,
  "Atlantic/Azores": -60,
  "Europe/London": 0,
  UTC: 0,
  "Europe/Berlin": 60,
  "Africa/Lagos": 60,
  "Europe/Helsinki": 120,
  "Europe/Moscow": 180,
  "Asia/Dubai": 240,
  "Asia/Kabul": 270,
  "Asia/Karachi": 300,
  "Asia/Kolkata": 330,
  "Asia/Kathmandu": 345,
  "Asia/Dhaka": 360,
  "Asia/Yangon": 390,
  "Asia/Bangkok": 420,
  "Asia/Shanghai": 480,
  "Asia/Tokyo": 540,
  "Australia/Darwin": 570,
  "Australia/Sydney": 600,
  "Pacific/Noumea": 660,
  "Pacific/Auckland": 720,
  "Pacific/Tongatapu": 780,
  "Pacific/Kiritimati": 840,
};

function gmtOffsetForTimeZone(timeZone: string, now: Date = new Date()): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" }).formatToParts(now);
    const name = parts.find((part) => part.type === "timeZoneName")?.value ?? "";
    const match = /^GMT(?:([+-])(\d{1,2})(?::(\d{2}))?)?$/.exec(name);
    if (match) {
      if (match[1] === undefined) return 0;
      const minutes = Number(match[2]) * 60 + Number(match[3] ?? "0");
      return match[1] === "-" ? -minutes : minutes;
    }
  } catch {
  }
  return STATIC_TIMEZONE_OFFSETS[timeZone] ?? null;
}

export function timeZoneCityName(timeZone: string): string {
  return (timeZone.split("/").pop() ?? timeZone).replace(/_/g, " ");
}

export function timeZoneLabelFor(timeZone: string, now: Date = new Date()): string {
  const trimmed = timeZone.trim();
  const offset = trimmed ? gmtOffsetForTimeZone(trimmed, now) : null;
  if (offset === null) return trimmed ? timeZoneCityName(trimmed) : localTimeZoneLabel(now);
  return `${formatGmtOffset(offset)} · ${timeZoneCityName(trimmed)}`;
}

export const TIMEZONE_OPTIONS: { id: string; label: string }[] = Object.keys(STATIC_TIMEZONE_OFFSETS).map((id) => ({
  id,
  label: timeZoneLabelFor(id),
}));

export function parseTime24(time: string): { hour: number; minute: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

export function ordinal(day: number): string {
  const tens = day % 100;
  if (tens >= 11 && tens <= 13) return `${day}th`;
  switch (day % 10) {
    case 1:
      return `${day}st`;
    case 2:
      return `${day}nd`;
    case 3:
      return `${day}rd`;
    default:
      return `${day}th`;
  }
}

export function isValidCron(expression: string): boolean {
  return expression.trim().split(/\s+/).length === 5;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// timeZone is accepted so the caller's selection travels with the request, but the
// cron fields are wall time as typed ("9:00 AM in zone X" -> hour 9). The backend
// interprets cron in UTC, a pre-existing mismatch that stays unresolved here.
export function buildCron(draft: ScheduleDraft, timeZone?: string): string | null {
  void timeZone;
  const { hour, minute } = parseTime24(draft.time) ?? { hour: 9, minute: 0 };
  switch (draft.frequency) {
    case "none":
      return null;
    case "daily":
      return `${minute} ${hour} * * *`;
    case "weekdays":
      return `${minute} ${hour} * * 1-5`;
    case "weekly":
      return `${minute} ${hour} * * ${clamp(Math.round(draft.weekday), 0, 6)}`;
    case "monthly":
      return `${minute} ${hour} ${clamp(Math.round(draft.dayOfMonth), 1, 28)} * *`;
    case "annually":
      return `${minute} ${hour} ${clamp(Math.round(draft.dayOfMonth), 1, 28)} ${clamp(Math.round(draft.month), 1, 12)} *`;
  }
}

export function buildRunAt(draft: ScheduleDraft): string | null {
  if (draft.frequency !== "none") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(draft.date.trim());
  if (!match) return null;
  const { hour, minute } = parseTime24(draft.time) ?? { hour: 9, minute: 0 };
  const value = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), hour, minute);
  return Number.isNaN(value.getTime()) ? null : value.toISOString();
}

export function describeSchedule(draft: ScheduleDraft): string {
  const override = draft.rawCron.trim();
  if (override) return `Custom schedule: ${override}`;
  const { hour, minute } = parseTime24(draft.time) ?? { hour: 9, minute: 0 };
  const time = formatTime12h(hour, minute);
  switch (draft.frequency) {
    case "none":
      return draft.date.trim() ? `Once on ${draft.date.trim()} at ${time}` : "Once — pick a date";
    case "daily":
      return `Every day at ${time}`;
    case "weekdays":
      return `Weekdays at ${time}`;
    case "weekly":
      return `${WEEKDAY_NAMES[clamp(Math.round(draft.weekday), 0, 6)]}s at ${time}`;
    case "monthly":
      return `Monthly on the ${ordinal(clamp(Math.round(draft.dayOfMonth), 1, 28))} at ${time}`;
    case "annually":
      return `${MONTH_NAMES[clamp(Math.round(draft.month), 1, 12) - 1]} ${ordinal(
        clamp(Math.round(draft.dayOfMonth), 1, 28),
      )} at ${time}`;
  }
}

export interface RoutineScheduleLike {
  cron?: string | null;
  run_at?: string | null;
}

export function describeRoutine(routine: RoutineScheduleLike): string {
  const runAt = routine.run_at?.trim();
  if (runAt) {
    const value = new Date(runAt);
    if (!Number.isNaN(value.getTime())) {
      return `Once on ${dateInputValue(value)} at ${formatTime12h(value.getHours(), value.getMinutes())}`;
    }
  }
  const cron = routine.cron?.trim() ?? "";
  const parts = cron.split(/\s+/);
  if (parts.length === 5) {
    const [minute, hour, dom, month, dow] = parts;
    if (hour === "*" && /^\d+$/.test(minute)) return `Hourly at :${pad2(Number(minute))}`;
    if (/^\d+$/.test(hour) && /^\d+$/.test(minute)) {
      const time = formatTime12h(Number(hour), Number(minute));
      if (dow === "1-5" && dom === "*" && month === "*") return `Weekdays at ${time}`;
      if (dow === "*" && dom === "*" && month === "*") return `Every day at ${time}`;
      if (/^[0-6]$/.test(dow) && dom === "*" && month === "*") {
        return `${WEEKDAY_NAMES[Number(dow)]}s at ${time}`;
      }
      if (dow === "*" && /^\d{1,2}$/.test(dom) && month === "*") {
        return `Monthly on the ${ordinal(Number(dom))} at ${time}`;
      }
      if (dow === "*" && /^\d{1,2}$/.test(dom) && /^\d{1,2}$/.test(month)) {
        const monthIndex = Number(month);
        if (monthIndex >= 1 && monthIndex <= 12) {
          return `${MONTH_NAMES[monthIndex - 1]} ${ordinal(Number(dom))} at ${time}`;
        }
      }
    }
  }
  return cron;
}

export function draftFromRoutine(routine: RoutineScheduleLike): ScheduleDraft {
  const draft = { ...DEFAULT_SCHEDULE };
  const runAt = routine.run_at?.trim();
  if (runAt) {
    const value = new Date(runAt);
    if (!Number.isNaN(value.getTime())) {
      draft.frequency = "none";
      draft.date = dateInputValue(value);
      draft.time = `${pad2(value.getHours())}:${pad2(Math.floor(value.getMinutes() / 15) * 15)}`;
      return draft;
    }
  }
  const parts = (routine.cron?.trim() ?? "").split(/\s+/);
  if (parts.length === 5) {
    const [minuteText, hourText, dom, month, dow] = parts;
    if (/^\d+$/.test(minuteText) && /^\d+$/.test(hourText)) {
      const minute = Number(minuteText);
      const hour = Number(hourText);
      if (minute % 15 === 0 && hour <= 23 && minute <= 59) {
        draft.time = `${pad2(hour)}:${pad2(minute)}`;
        if (dow === "1-5" && dom === "*" && month === "*") {
          draft.frequency = "weekdays";
          return draft;
        }
        if (dow === "*" && dom === "*" && month === "*") {
          draft.frequency = "daily";
          return draft;
        }
        if (/^[0-6]$/.test(dow) && dom === "*" && month === "*") {
          draft.frequency = "weekly";
          draft.weekday = Number(dow);
          return draft;
        }
        const domNumber = /^\d{1,2}$/.test(dom) ? Number(dom) : null;
        const monthNumber = /^\d{1,2}$/.test(month) ? Number(month) : null;
        if (dow === "*" && domNumber !== null && domNumber >= 1 && domNumber <= 28) {
          if (month === "*") {
            draft.frequency = "monthly";
            draft.dayOfMonth = domNumber;
            return draft;
          }
          if (monthNumber !== null && monthNumber >= 1 && monthNumber <= 12) {
            draft.frequency = "annually";
            draft.dayOfMonth = domNumber;
            draft.month = monthNumber;
            return draft;
          }
        }
      }
    }
  }
  draft.rawCron = routine.cron?.trim() ?? "";
  return draft;
}
