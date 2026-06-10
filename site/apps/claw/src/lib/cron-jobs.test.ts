import { describe, expect, it } from "vitest";

import { buildCronJobInput, normalizeCronJob } from "./cron-jobs";

describe("cron job helpers", () => {
  it("builds cron.add jobs with the gateway contract shape", () => {
    expect(buildCronJobInput({
      name: "Daily summary",
      cron: "0 9 * * *",
      message: "Summarize yesterday.",
      sessionKey: "main",
    })).toEqual({
      name: "Daily summary",
      sessionTarget: "session:main",
      schedule: { kind: "cron", expr: "0 9 * * *", tz: "UTC" },
      wakeMode: "now",
      payload: { kind: "agentTurn", message: "Summarize yesterday." },
    });
  });

  it("does not double-prefix session cron targets", () => {
    expect(buildCronJobInput({
      name: "Daily summary",
      cron: "0 9 * * *",
      message: "Summarize yesterday.",
      sessionKey: "session:main",
    }).sessionTarget).toBe("session:main");
  });

  it("normalizes gateway cron jobs and legacy aliases", () => {
    expect(normalizeCronJob({
      id: "job-1",
      name: "Daily summary",
      schedule: { kind: "cron", expr: "0 9 * * *", tz: "UTC" },
      sessionTarget: "session:project-daily",
      payload: { kind: "agentTurn", message: "Summarize yesterday." },
      last_run: 1000,
      next_run: 2000,
    })).toEqual(expect.objectContaining({
      id: "job-1",
      name: "Daily summary",
      description: "Daily summary",
      command: "Summarize yesterday.",
      prompt: "Summarize yesterday.",
      schedule: "0 9 * * *",
      targetSessionKey: "project-daily",
      lastRun: 1000,
      nextRun: 2000,
      enabled: true,
    }));

    expect(normalizeCronJob({
      id: "job-object-target",
      name: "Legacy object target",
      schedule: { cron: "0 11 * * *" },
      sessionTarget: { sessionKey: "project-legacy" },
      payload: { kind: "message", text: "Summarize legacy shape." },
    })).toEqual(expect.objectContaining({
      schedule: "0 11 * * *",
      targetSessionKey: "project-legacy",
      command: "Summarize legacy shape.",
    }));

    expect(normalizeCronJob({
      id: "job-2",
      description: "Legacy summary",
      schedule: "0 10 * * 1",
      prompt: "Compile notes.",
      enabled: false,
    })).toEqual(expect.objectContaining({
      id: "job-2",
      name: "Legacy summary",
      command: "Compile notes.",
      schedule: "0 10 * * 1",
      enabled: false,
    }));
  });
});
