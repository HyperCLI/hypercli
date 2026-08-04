const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

type ParsedCron = {
  minute: number[];
  hour: number[];
  dayOfMonth: number[];
  month: number[];
  dayOfWeek: number[];
  raw: string[];
};

function expandCronField(value: string, min: number, max: number): number[] | null {
  if (value === "*") return Array.from({ length: max - min + 1 }, (_, index) => min + index);

  const output = new Set<number>();
  for (const part of value.split(",")) {
    let match = part.match(/^\*\/(\d+)$/);
    if (match) {
      const step = Number(match[1]);
      if (!Number.isFinite(step) || step <= 0) return null;
      for (let current = min; current <= max; current += step) output.add(current);
      continue;
    }

    match = part.match(/^(\d+)-(\d+)(?:\/(\d+))?$/);
    if (match) {
      const start = Number(match[1]);
      const end = Number(match[2]);
      const step = Number(match[3] ?? "1");
      if (start < min || end > max || start > end || step <= 0) return null;
      for (let current = start; current <= end; current += step) output.add(current);
      continue;
    }

    match = part.match(/^(\d+)$/);
    if (match) {
      const item = Number(match[1]);
      if (item < min || item > max) return null;
      output.add(item);
      continue;
    }

    return null;
  }

  return [...output].sort((left, right) => left - right);
}

function parseCronExpression(value: string): ParsedCron | null {
  const raw = value.trim().split(/\s+/);
  if (raw.length !== 5) return null;
  const minute = expandCronField(raw[0] ?? "", 0, 59);
  const hour = expandCronField(raw[1] ?? "", 0, 23);
  const dayOfMonth = expandCronField(raw[2] ?? "", 1, 31);
  const month = expandCronField(raw[3] ?? "", 1, 12);
  const dayOfWeek = expandCronField(raw[4] ?? "", 0, 7)?.map((day) => day === 7 ? 0 : day);
  if (!minute || !hour || !dayOfMonth || !month || !dayOfWeek) return null;
  return {
    minute,
    hour,
    dayOfMonth,
    month,
    dayOfWeek: [...new Set(dayOfWeek)].sort((left, right) => left - right),
    raw,
  };
}

export function isValidCronExpression(expression: string): boolean {
  return parseCronExpression(expression) !== null;
}

function cronDateMatches(parsed: ParsedCron, value: Date): boolean {
  if (!parsed.minute.includes(value.getUTCMinutes())) return false;
  if (!parsed.hour.includes(value.getUTCHours())) return false;
  if (!parsed.month.includes(value.getUTCMonth() + 1)) return false;

  const dayOfMonthMatches = parsed.dayOfMonth.includes(value.getUTCDate());
  const dayOfWeekMatches = parsed.dayOfWeek.includes(value.getUTCDay());
  const dayOfMonthRestricted = parsed.raw[2] !== "*";
  const dayOfWeekRestricted = parsed.raw[4] !== "*";
  if (dayOfMonthRestricted && dayOfWeekRestricted) return dayOfMonthMatches || dayOfWeekMatches;
  return dayOfMonthMatches && dayOfWeekMatches;
}

export function nextCronOccurrences(expression: string, count: number, after = Date.now()): number[] {
  const parsed = parseCronExpression(expression);
  if (!parsed || count <= 0) return [];

  const output: number[] = [];
  const firstMinute = new Date(after + 60_000);
  firstMinute.setUTCSeconds(0, 0);
  const day = new Date(Date.UTC(
    firstMinute.getUTCFullYear(),
    firstMinute.getUTCMonth(),
    firstMinute.getUTCDate(),
  ));
  const maxDays = 366 * 8;

  for (let dayIndex = 0; dayIndex < maxDays && output.length < count; dayIndex += 1) {
    for (const hour of parsed.hour) {
      for (const minute of parsed.minute) {
        const candidate = new Date(Date.UTC(
          day.getUTCFullYear(),
          day.getUTCMonth(),
          day.getUTCDate(),
          hour,
          minute,
        ));
        if (candidate.getTime() < firstMinute.getTime()) continue;
        if (cronDateMatches(parsed, candidate)) output.push(candidate.getTime());
        if (output.length >= count) break;
      }
      if (output.length >= count) break;
    }
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return output;
}

export function nextCronOccurrence(expression: string, after = Date.now()): number | null {
  return nextCronOccurrences(expression, 1, after)[0] ?? null;
}

function timeLabel(hour: number, minute: number): string {
  const meridiem = hour >= 12 ? "pm" : "am";
  const displayHour = ((hour + 11) % 12) + 1;
  return `${displayHour}:${minute.toString().padStart(2, "0")} ${meridiem} UTC`;
}

export function humanizeCronSchedule(expression: string): string | null {
  const parsed = parseCronExpression(expression);
  if (!parsed) return null;
  const everyMinute = parsed.minute.length === 60;
  const singleMinute = parsed.minute.length === 1;
  const everyHour = parsed.hour.length === 24;
  const singleHour = parsed.hour.length === 1;
  const everyDayOfMonth = parsed.dayOfMonth.length === 31;
  const everyMonth = parsed.month.length === 12;
  const everyDayOfWeek = parsed.dayOfWeek.length === 7;
  const weekdays = parsed.dayOfWeek.length === 5 && parsed.dayOfWeek.every((day, index) => day === index + 1);
  const weekends = parsed.dayOfWeek.length === 2 && parsed.dayOfWeek.includes(0) && parsed.dayOfWeek.includes(6);

  let time = "Custom schedule";
  if (singleMinute && singleHour) {
    time = `At ${timeLabel(parsed.hour[0] ?? 0, parsed.minute[0] ?? 0)}`;
  } else if (singleMinute && everyHour) {
    time = (parsed.minute[0] ?? 0) === 0 ? "Every hour" : `${parsed.minute[0]} minutes past every hour`;
  } else if (everyMinute && everyHour) {
    time = "Every minute";
  } else {
    const step = parsed.raw[0]?.match(/^\*\/(\d+)$/);
    if (step) time = `Every ${step[1]} minutes`;
  }

  if (everyDayOfMonth && everyMonth && everyDayOfWeek) return time;
  if (weekdays && everyDayOfMonth && everyMonth) return `${time}, weekdays`;
  if (weekends && everyDayOfMonth && everyMonth) return `${time}, weekends`;
  if (!everyDayOfWeek && everyDayOfMonth && everyMonth) {
    return `${time}, ${parsed.dayOfWeek.map((day) => DAY_NAMES[day] ?? "Sun").join(", ")}`;
  }
  if (parsed.dayOfMonth.length === 1 && everyDayOfWeek) return `${time}, day ${parsed.dayOfMonth[0]} of each month`;
  return time;
}

export function normalizeCronTimestamp(value: number | undefined): number | null {
  if (!Number.isFinite(value)) return null;
  const numeric = Number(value);
  return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
}
