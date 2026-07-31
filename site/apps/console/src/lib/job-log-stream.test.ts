import { describe, expect, it } from "vitest";
import {
  buildJobLogsWsUrl,
  combineJobLogs,
  getJobLogReconnectDelayMs,
  JOB_LOG_RECONNECT_MAX_MS,
  parseJobLogEvent,
  reconcileJobLogSnapshots,
  shouldStreamJobLogs,
} from "./job-log-stream";

describe("job log stream helpers", () => {
  it("builds compatible log websocket URLs", () => {
    expect(buildJobLogsWsUrl("https://api.hypercli.com", "job-key"))
      .toBe("wss://api.hypercli.com/ws/logs/job-key");
    expect(buildJobLogsWsUrl("wss://api.hypercli.com/orchestra/ws", "job-key"))
      .toBe("wss://api.hypercli.com/orchestra/ws/logs/job-key");
    expect(buildJobLogsWsUrl("wss://api.hypercli.com/ws/logs/", "job-key"))
      .toBe("wss://api.hypercli.com/ws/logs/job-key");
  });

  it("bounds exponential reconnect delay and jitter", () => {
    expect(getJobLogReconnectDelayMs(0, () => 0)).toBe(600);
    expect(getJobLogReconnectDelayMs(0, () => 1)).toBe(900);
    expect(getJobLogReconnectDelayMs(99, () => 1))
      .toBe(JOB_LOG_RECONNECT_MAX_MS);
  });

  it("parses both legacy live logs and authoritative snapshots", () => {
    expect(parseJobLogEvent(JSON.stringify({ event: "log", log: "next line\n" })))
      .toEqual({ type: "log", log: "next line\n" });
    expect(parseJobLogEvent(JSON.stringify({ event: "log_snapshot", logs: "all logs" })))
      .toEqual({ type: "snapshot", logs: "all logs" });
    expect(parseJobLogEvent(JSON.stringify({ event: "unknown", logs: "ignored" })))
      .toBeNull();
  });

  it("preserves a newer browser tail when legacy REST persistence lags", () => {
    const displayed = combineJobLogs("one\ntwo", ["three", "four"]);
    expect(reconcileJobLogSnapshots(displayed, "one\ntwo\nthree"))
      .toBe("one\ntwo\nthree\nfour");
  });

  it("extends the browser log without duplicating overlapping REST lines", () => {
    expect(reconcileJobLogSnapshots("one\ntwo\nthree", "two\nthree\nfour"))
      .toBe("one\ntwo\nthree\nfour");
    expect(reconcileJobLogSnapshots("three\nfour", "one\ntwo\nthree"))
      .toBe("one\ntwo\nthree\nfour");
  });

  it("only streams logs for active container states", () => {
    expect(shouldStreamJobLogs("assigned")).toBe(true);
    expect(shouldStreamJobLogs("running")).toBe(true);
    expect(shouldStreamJobLogs("failed")).toBe(false);
  });
});
