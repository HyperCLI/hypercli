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

export const TIME_OPTIONS: { value: string; label: string }[] = (() => {
  const options: { value: string; label: string }[] = [];
  for (let hour = 0; hour < 24; hour += 1) {
    for (let minute = 0; minute < 60; minute += 15) {
      options.push({
        value: `${pad2(hour)}:${pad2(minute)}`,
        label: formatTime12h(hour, minute),
      });
    }
  }
  return options;
})();

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

export function buildCron(draft: ScheduleDraft): string | null {
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
