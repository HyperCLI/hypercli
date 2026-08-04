import { describe, expect, it } from "vitest";

import {
  humanizeCronSchedule,
  isValidCronExpression,
  nextCronOccurrence,
  nextCronOccurrences,
} from "./cron-schedule";
import { buildOperationsAgenda } from "./operations-agenda";

describe("cron schedule helpers", () => {
  it("projects UTC weekday schedules", () => {
    const mondayMorning = Date.UTC(2026, 7, 3, 8, 30);
    expect(nextCronOccurrence("0 9 * * 1-5", mondayMorning)).toBe(Date.UTC(2026, 7, 3, 9, 0));

    const fridayAfternoon = Date.UTC(2026, 7, 7, 15, 0);
    expect(nextCronOccurrence("0 9 * * 1-5", fridayAfternoon)).toBe(Date.UTC(2026, 7, 10, 9, 0));
  });

  it("uses standard cron OR semantics when day-of-month and weekday are both restricted", () => {
    const mondayMorning = Date.UTC(2026, 7, 3, 10, 0);
    expect(nextCronOccurrence("0 9 15 * 1", mondayMorning)).toBe(Date.UTC(2026, 7, 10, 9, 0));
  });

  it("projects sparse leap-day schedules beyond one year", () => {
    const august2026 = Date.UTC(2026, 7, 3, 10, 0);
    expect(nextCronOccurrence("0 0 29 2 *", august2026)).toBe(Date.UTC(2028, 1, 29, 0, 0));
  });

  it("validates, humanizes, and returns multiple occurrences", () => {
    expect(isValidCronExpression("*/15 * * * *")).toBe(true);
    expect(isValidCronExpression("not a cron")).toBe(false);
    expect(humanizeCronSchedule("0 9 * * 1-5")).toBe("At 9:00 am UTC, weekdays");
    expect(nextCronOccurrences("*/15 * * * *", 3, Date.UTC(2026, 7, 3, 8, 1))).toEqual([
      Date.UTC(2026, 7, 3, 8, 15),
      Date.UTC(2026, 7, 3, 8, 30),
      Date.UTC(2026, 7, 3, 8, 45),
    ]);
  });
});

describe("operations agenda", () => {
  it("keeps one upcoming occurrence per job and retains paused or invalid jobs", () => {
    const now = Date.UTC(2026, 7, 3, 8, 0);
    const agenda = buildOperationsAgenda([{
      agentId: "agent-1",
      agentName: "Ada",
      jobs: [
        {
          id: "daily",
          name: "Daily brief",
          schedule: "0 9 * * *",
          prompt: "Brief the team",
          description: "Daily brief",
          enabled: true,
        },
        {
          id: "paused",
          name: "Paused report",
          schedule: "0 10 * * *",
          prompt: "Report",
          description: "Paused report",
          enabled: false,
        },
        {
          id: "broken",
          name: "Broken schedule",
          schedule: "invalid",
          prompt: "Check",
          description: "Broken schedule",
          enabled: true,
        },
      ],
    }], now);

    expect(agenda.map((item) => item.title)).toEqual(["Daily brief", "Broken schedule", "Paused report"]);
    expect(agenda[0]?.startsAt).toBe(Date.UTC(2026, 7, 3, 9, 0));
    expect(agenda[1]).toMatchObject({ startsAt: null, needsAttention: true, enabled: true });
    expect(agenda[2]).toMatchObject({ startsAt: null, needsAttention: false, enabled: false });
  });
});
