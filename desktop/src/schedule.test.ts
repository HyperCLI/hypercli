import { describe, expect, it } from "vitest";
import {
  TIME_OPTIONS,
  buildCron,
  buildRunAt,
  describeRoutine,
  describeSchedule,
  draftFromRoutine,
  formatTime12h,
  isValidCron,
  ordinal,
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

describe("TIME_OPTIONS", () => {
  it("covers the full day in 15-minute increments", () => {
    expect(TIME_OPTIONS).toHaveLength(96);
    expect(TIME_OPTIONS[0]).toEqual({ value: "00:00", label: "12:00 AM" });
    expect(TIME_OPTIONS[1]).toEqual({ value: "00:15", label: "12:15 AM" });
    expect(TIME_OPTIONS[TIME_OPTIONS.length - 1]).toEqual({ value: "23:45", label: "11:45 PM" });
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
