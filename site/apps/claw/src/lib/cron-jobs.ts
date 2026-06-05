import type { CronJob } from "@/components/dashboard/agentViewTypes";

export interface CronScheduleSpec extends Record<string, unknown> {
  kind: "cron";
  expr: string;
  tz: "UTC";
}

export type CronSessionTarget = "main" | "isolated" | "current" | `session:${string}`;

export interface CronPayload extends Record<string, unknown> {
  kind: "agentTurn";
  message: string;
}

export interface CronJobInput extends Record<string, unknown> {
  name: string;
  sessionTarget: CronSessionTarget;
  schedule: CronScheduleSpec;
  wakeMode: "now";
  payload: CronPayload;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function cronScheduleLabel(value: unknown): string {
  if (typeof value === "string") return value;
  const schedule = asRecord(value);
  if (!schedule) return "";
  return firstString(schedule.expr, schedule.cron, schedule.expression, schedule.value);
}

export function cronPayloadMessage(value: unknown): string {
  if (typeof value === "string") return value;
  const payload = asRecord(value);
  if (!payload) return "";
  return firstString(payload.message, payload.text, payload.prompt, payload.command);
}

function cronSessionTarget(sessionKey: string): CronSessionTarget {
  const normalized = sessionKey.trim();
  if (normalized.startsWith("session:")) {
    return normalized as CronSessionTarget;
  }
  return `session:${normalized || "main"}`;
}

export function buildCronJobInput(params: {
  name: string;
  cron: string;
  message: string;
  sessionKey: string;
}): CronJobInput {
  return {
    name: params.name,
    sessionTarget: cronSessionTarget(params.sessionKey),
    schedule: { kind: "cron", expr: params.cron, tz: "UTC" },
    wakeMode: "now",
    payload: { kind: "agentTurn", message: params.message },
  };
}

export function cronSessionTargetKey(value: unknown): string {
  const entry = asRecord(value);
  if (!entry) return "";
  if (typeof entry.sessionTarget === "string") {
    return entry.sessionTarget.startsWith("session:") ? entry.sessionTarget.slice("session:".length) : entry.sessionTarget;
  }
  const sessionTarget = asRecord(entry.sessionTarget ?? entry.session_target);
  return firstString(
    sessionTarget?.sessionKey,
    sessionTarget?.session_key,
    entry.sessionKey,
    entry.session_key,
  );
}

export function normalizeCronJob(value: unknown): CronJob {
  const entry = asRecord(value) ?? {};
  const name = firstString(entry.name, entry.description);
  const command = firstString(entry.command, entry.prompt, cronPayloadMessage(entry.payload));
  const lastRun = typeof entry.lastRun === "number"
    ? entry.lastRun
    : typeof entry.last_run === "number"
      ? entry.last_run
      : undefined;
  const nextRun = typeof entry.nextRun === "number"
    ? entry.nextRun
    : typeof entry.next_run === "number"
      ? entry.next_run
      : undefined;

  return {
    id: typeof entry.id === "string" ? entry.id : String(entry.id ?? ""),
    schedule: cronScheduleLabel(entry.schedule),
    name,
    command,
    prompt: command,
    description: name,
    targetSessionKey: cronSessionTargetKey(entry),
    enabled: entry.enabled !== false,
    lastRun,
    nextRun,
  };
}
