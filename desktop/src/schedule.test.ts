import { describe, expect, it } from "vitest";
import {
  TIMEZONE_OPTIONS,
  buildCron,
  buildRunAt,
  describeRoutine,
  describeSchedule,
  draftFromRoutine,
  formatGmtOffset,
  formatTime12h,
  isValidCron,
  localTimeZoneLabel,
  ordinal,
  parseUserTime,
  timeZoneCityName,
  timeZoneLabelFor,
  type ScheduleDraft,
} from "./schedule";

function draft(patch: Partial<ScheduleDraft> = {}): ScheduleDraft {
  return {
    frequency: "weekly",
    weekday: 1,
    dayOfMonth: 1,
    month: 1,
    time: "09:00",
    date: "",
    rawCron: "",
    ...patch,
  };
}

describe("formatTime12h", () => {
  it("renders 12-hour clock labels", () => {
    expect(formatTime12h(0, 0)).toBe("12:00 AM");
    expect(formatTime12h(0, 15)).toBe("12:15 AM");
    expect(formatTime12h(9, 5)).toBe("9:05 AM");
    expect(formatTime12h(12, 0)).toBe("12:00 PM");
    expect(formatTime12h(13, 30)).toBe("1:30 PM");
    expect(formatTime12h(23, 45)).toBe("11:45 PM");
  });
});

describe("parseUserTime", () => {
  it("parses 12-hour input", () => {
    expect(parseUserTime("9")).toEqual({ hour: 9, minute: 0 });
    expect(parseUserTime("9am")).toEqual({ hour: 9, minute: 0 });
    expect(parseUserTime("9 AM")).toEqual({ hour: 9, minute: 0 });
    expect(parseUserTime("9:30 PM")).toEqual({ hour: 21, minute: 30 });
    expect(parseUserTime("9:30pm")).toEqual({ hour: 21, minute: 30 });
    expect(parseUserTime("930pm")).toEqual({ hour: 21, minute: 30 });
    expect(parseUserTime("0930AM")).toEqual({ hour: 9, minute: 30 });
    expect(parseUserTime("12am")).toEqual({ hour: 0, minute: 0 });
    expect(parseUserTime("12pm")).toEqual({ hour: 12, minute: 0 });
    expect(parseUserTime("9:5 am")).toEqual({ hour: 9, minute: 5 });
    expect(parseUserTime("9.30")).toEqual({ hour: 9, minute: 30 });
    expect(parseUserTime("09:00")).toEqual({ hour: 9, minute: 0 });
  });

  it("parses 24-hour input", () => {
    expect(parseUserTime("21:00")).toEqual({ hour: 21, minute: 0 });
    expect(parseUserTime("21")).toEqual({ hour: 21, minute: 0 });
    expect(parseUserTime("14:45")).toEqual({ hour: 14, minute: 45 });
    expect(parseUserTime("1430")).toEqual({ hour: 14, minute: 30 });
    expect(parseUserTime("0:30")).toEqual({ hour: 0, minute: 30 });
  });

  it("rejects invalid input", () => {
    expect(parseUserTime("")).toBeNull();
    expect(parseUserTime("   ")).toBeNull();
    expect(parseUserTime("noon")).toBeNull();
    expect(parseUserTime("9 o'clock")).toBeNull();
    expect(parseUserTime("25")).toBeNull();
    expect(parseUserTime("24:00")).toBeNull();
    expect(parseUserTime("9:75")).toBeNull();
    expect(parseUserTime("999")).toBeNull();
    expect(parseUserTime("2400")).toBeNull();
    expect(parseUserTime("21pm")).toBeNull();
    expect(parseUserTime("0am")).toBeNull();
    expect(parseUserTime("13 pm")).toBeNull();
    expect(parseUserTime("9:")).toBeNull();
  });
});

describe("formatGmtOffset", () => {
  it("formats whole and fractional-hour offsets", () => {
    expect(formatGmtOffset(0)).toBe("GMT+0");
    expect(formatGmtOffset(120)).toBe("GMT+2");
    expect(formatGmtOffset(-300)).toBe("GMT-5");
    expect(formatGmtOffset(330)).toBe("GMT+5:30");
    expect(formatGmtOffset(-570)).toBe("GMT-9:30");
  });
});

describe("localTimeZoneLabel", () => {
  it("leads with the GMT offset and appends short IANA names", () => {
    const now = new Date();
    const gmt = formatGmtOffset(-now.getTimezoneOffset());
    expect(localTimeZoneLabel(now, "Europe/Athens")).toBe(`${gmt} (Europe/Athens)`);
  });

  it("omits missing, blank, or long IANA names", () => {
    const now = new Date();
    const gmt = formatGmtOffset(-now.getTimezoneOffset());
    expect(localTimeZoneLabel(now, "")).toBe(gmt);
    expect(localTimeZoneLabel(now, "  ")).toBe(gmt);
    expect(localTimeZoneLabel(now, "Some/Absurdly_Long_Timezone_Name")).toBe(gmt);
  });

  it("resolves the local zone without injected arguments", () => {
    expect(localTimeZoneLabel()).toMatch(/^GMT[+-]\d+(:\d{2})?( \(.+\))?$/);
  });
});

describe("TIMEZONE_OPTIONS", () => {
  it("offers a curated list across the GMT range", () => {
    expect(TIMEZONE_OPTIONS.length).toBeGreaterThanOrEqual(25);
    expect(TIMEZONE_OPTIONS.length).toBeLessThanOrEqual(40);
    for (const option of TIMEZONE_OPTIONS) {
      expect(option.label).toMatch(/^GMT[+-]\d+(:\d{2})? · .+$/);
    }
    const ids = TIMEZONE_OPTIONS.map((option) => option.id);
    for (const id of [
      "Pacific/Auckland",
      "Asia/Tokyo",
      "Asia/Shanghai",
      "Asia/Dubai",
      "Europe/Moscow",
      "Europe/Berlin",
      "Europe/London",
      "UTC",
      "America/New_York",
      "America/Chicago",
      "America/Denver",
      "America/Los_Angeles",
      "America/Sao_Paulo",
      "Australia/Sydney",
      "Asia/Kolkata",
      "Asia/Kathmandu",
    ]) {
      expect(ids).toContain(id);
    }
  });
});

describe("timeZoneCityName", () => {
  it("takes the last path segment and unescapes underscores", () => {
    expect(timeZoneCityName("America/Sao_Paulo")).toBe("Sao Paulo");
    expect(timeZoneCityName("UTC")).toBe("UTC");
    expect(timeZoneCityName("America/Argentina/Buenos_Aires")).toBe("Buenos Aires");
  });
});

describe("timeZoneLabelFor", () => {
  const now = new Date("2026-01-15T12:00:00Z");

  it("renders GMT offset and city for fixed zones", () => {
    expect(timeZoneLabelFor("Asia/Kathmandu", now)).toBe("GMT+5:45 · Kathmandu");
    expect(timeZoneLabelFor("Asia/Kolkata", now)).toBe("GMT+5:30 · Kolkata");
    expect(timeZoneLabelFor("Europe/Moscow", now)).toBe("GMT+3 · Moscow");
    expect(timeZoneLabelFor("UTC", now)).toBe("GMT+0 · UTC");
    expect(timeZoneLabelFor("Pacific/Pago_Pago", now)).toBe("GMT-11 · Pago Pago");
    expect(timeZoneLabelFor("Pacific/Kiritimati", now)).toBe("GMT+14 · Kiritimati");
  });

  it("falls back to the city name for unknown zones", () => {
    expect(timeZoneLabelFor("Bogus/Zone", now)).toBe("Zone");
  });
});

describe("ordinal", () => {
  it("suffixes day-of-month values", () => {
    expect(ordinal(1)).toBe("1st");
    expect(ordinal(2)).toBe("2nd");
    expect(ordinal(3)).toBe("3rd");
    expect(ordinal(4)).toBe("4th");
    expect(ordinal(11)).toBe("11th");
    expect(ordinal(12)).toBe("12th");
    expect(ordinal(13)).toBe("13th");
    expect(ordinal(21)).toBe("21st");
    expect(ordinal(22)).toBe("22nd");
    expect(ordinal(23)).toBe("23rd");
    expect(ordinal(28)).toBe("28th");
  });
});

describe("isValidCron", () => {
  it("accepts five-field expressions only", () => {
    expect(isValidCron("0 9 * * 1-5")).toBe(true);
    expect(isValidCron("0 9 * *")).toBe(false);
    expect(isValidCron("")).toBe(false);
    expect(isValidCron("0 9 * * * extra")).toBe(false);
  });
});

describe("buildCron", () => {
  it("builds crons per frequency", () => {
    expect(buildCron(draft({ frequency: "daily" }))).toBe("0 9 * * *");
    expect(buildCron(draft({ frequency: "weekdays", time: "14:30" }))).toBe("30 14 * * 1-5");
    expect(buildCron(draft({ frequency: "weekly", weekday: 3 }))).toBe("0 9 * * 3");
    expect(buildCron(draft({ frequency: "monthly", dayOfMonth: 15 }))).toBe("0 9 15 * *");
    expect(buildCron(draft({ frequency: "annually", month: 3, dayOfMonth: 15 }))).toBe("0 9 15 3 *");
    expect(buildCron(draft({ frequency: "none", date: "2026-09-14" }))).toBeNull();
  });

  it("keeps wall-time cron fields when a timezone is threaded through", () => {
    expect(buildCron(draft({ frequency: "daily", time: "14:30" }), "Asia/Tokyo")).toBe("30 14 * * *");
    expect(buildCron(draft({ frequency: "weekly", weekday: 3 }), "America/New_York")).toBe("0 9 * * 3");
  });
});

describe("buildRunAt", () => {
  it("builds an ISO timestamp for one-time jobs", () => {
    const value = buildRunAt(draft({ frequency: "none", date: "2026-09-14", time: "09:00" }));
    expect(value).toBe(new Date(2026, 8, 14, 9, 0).toISOString());
  });

  it("returns null without a valid date or for repeating jobs", () => {
    expect(buildRunAt(draft({ frequency: "none", date: "" }))).toBeNull();
    expect(buildRunAt(draft({ frequency: "none", date: "14/09/2026" }))).toBeNull();
    expect(buildRunAt(draft({ frequency: "daily" }))).toBeNull();
  });
});

describe("describeSchedule", () => {
  it("describes each frequency in product language", () => {
    expect(describeSchedule(draft({ weekday: 1, time: "00:00" }))).toBe("Mondays at 12:00 AM");
    expect(describeSchedule(draft({ frequency: "daily" }))).toBe("Every day at 9:00 AM");
    expect(describeSchedule(draft({ frequency: "weekdays" }))).toBe("Weekdays at 9:00 AM");
    expect(describeSchedule(draft({ frequency: "monthly", dayOfMonth: 15 }))).toBe(
      "Monthly on the 15th at 9:00 AM",
    );
    expect(describeSchedule(draft({ frequency: "annually", month: 1, dayOfMonth: 1, time: "00:00" }))).toBe(
      "January 1st at 12:00 AM",
    );
    expect(describeSchedule(draft({ frequency: "annually", month: 3, dayOfMonth: 15 }))).toBe(
      "March 15th at 9:00 AM",
    );
    expect(describeSchedule(draft({ frequency: "none", date: "2026-09-14" }))).toBe(
      "Once on 2026-09-14 at 9:00 AM",
    );
  });

  it("lets the raw cron override win", () => {
    expect(describeSchedule(draft({ rawCron: "30 8 * * 2" }))).toBe("Custom schedule: 30 8 * * 2");
  });

  it("prompts for a date on one-time jobs without one", () => {
    expect(describeSchedule(draft({ frequency: "none" }))).toBe("Once — pick a date");
  });
});

describe("describeRoutine", () => {
  it("describes known cron patterns", () => {
    expect(describeRoutine({ cron: "0 9 * * 1" })).toBe("Mondays at 9:00 AM");
    expect(describeRoutine({ cron: "0 9 * * 6" })).toBe("Saturdays at 9:00 AM");
    expect(describeRoutine({ cron: "0 9 * * 1-5" })).toBe("Weekdays at 9:00 AM");
    expect(describeRoutine({ cron: "30 14 * * *" })).toBe("Every day at 2:30 PM");
    expect(describeRoutine({ cron: "5 * * * *" })).toBe("Hourly at :05");
    expect(describeRoutine({ cron: "0 9 15 * *" })).toBe("Monthly on the 15th at 9:00 AM");
    expect(describeRoutine({ cron: "0 0 1 1 *" })).toBe("January 1st at 12:00 AM");
  });

  it("describes one-time routines from run_at", () => {
    const runAt = new Date(2026, 8, 14, 9, 30).toISOString();
    expect(describeRoutine({ cron: "", run_at: runAt })).toBe("Once on 2026-09-14 at 9:30 AM");
  });

  it("falls back to the raw cron for unknown patterns", () => {
    expect(describeRoutine({ cron: "*/7 * * * *" })).toBe("*/7 * * * *");
  });
});

describe("draftFromRoutine", () => {
  it("round-trips picker-built crons", () => {
    expect(draftFromRoutine({ cron: "0 9 * * 1" })).toMatchObject({ frequency: "weekly", weekday: 1, time: "09:00" });
    expect(draftFromRoutine({ cron: "30 14 * * 1-5" })).toMatchObject({ frequency: "weekdays", time: "14:30" });
    expect(draftFromRoutine({ cron: "0 9 * * *" })).toMatchObject({ frequency: "daily" });
    expect(draftFromRoutine({ cron: "0 9 15 * *" })).toMatchObject({ frequency: "monthly", dayOfMonth: 15 });
    expect(draftFromRoutine({ cron: "0 9 15 3 *" })).toMatchObject({
      frequency: "annually",
      dayOfMonth: 15,
      month: 3,
    });
  });

  it("maps one-time routines to the date and time pickers", () => {
    const runAt = new Date(2026, 8, 14, 9, 30).toISOString();
    expect(draftFromRoutine({ cron: "", run_at: runAt })).toMatchObject({
      frequency: "none",
      date: "2026-09-14",
      time: "09:30",
    });
  });

  it("prefills the raw cron override for off-grid or unknown schedules", () => {
    expect(draftFromRoutine({ cron: "7 9 * * *" }).rawCron).toBe("7 9 * * *");
    expect(draftFromRoutine({ cron: "*/7 * * * *" }).rawCron).toBe("*/7 * * * *");
    expect(draftFromRoutine({ cron: "0 9 29 * *" }).rawCron).toBe("0 9 29 * *");
  });
});
