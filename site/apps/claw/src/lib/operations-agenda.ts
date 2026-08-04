import type { CronJob } from "@/components/dashboard/agentViewTypes";
import {
  humanizeCronSchedule,
  nextCronOccurrence,
  normalizeCronTimestamp,
} from "@/lib/cron-schedule";

export type OperationsAgendaItem = {
  id: string;
  kind: "cron";
  title: string;
  detail: string;
  startsAt: number | null;
  agentId: string;
  agentName: string;
  sessionKey: string | null;
  enabled: boolean;
  needsAttention: boolean;
};

export type AgentCronJobs = {
  agentId: string;
  agentName: string;
  jobs: CronJob[];
};

function cronTitle(job: CronJob): string {
  return job.name || job.description || job.command || job.prompt || "Scheduled job";
}

export function buildOperationsAgenda(
  agentJobs: readonly AgentCronJobs[],
  now = Date.now(),
): OperationsAgendaItem[] {
  return agentJobs
    .flatMap(({ agentId, agentName, jobs }) => jobs.map((job, index) => {
      const reportedNextRun = normalizeCronTimestamp(job.nextRun);
      const timezone = job.timezone?.trim() || "UTC";
      const canProjectSchedule = timezone.toUpperCase() === "UTC";
      const projectedNextRun = job.enabled === false
        ? null
        : reportedNextRun && reportedNextRun >= now
          ? reportedNextRun
          : canProjectSchedule
            ? nextCronOccurrence(job.schedule, now)
            : null;
      const scheduleLabel = canProjectSchedule ? humanizeCronSchedule(job.schedule) : null;
      return {
        id: `${agentId}:${job.id || `${job.schedule}:${index}`}`,
        kind: "cron" as const,
        title: cronTitle(job),
        detail: (scheduleLabel ?? `${job.schedule}${timezone ? ` (${timezone})` : ""}`) || "Schedule unavailable",
        startsAt: projectedNextRun,
        agentId,
        agentName,
        sessionKey: job.targetSessionKey?.trim() || null,
        enabled: job.enabled !== false,
        needsAttention: job.enabled !== false && projectedNextRun === null,
      };
    }))
    .sort((left, right) => {
      if (left.startsAt !== null && right.startsAt !== null) return left.startsAt - right.startsAt;
      if (left.startsAt !== null) return -1;
      if (right.startsAt !== null) return 1;
      if (left.needsAttention !== right.needsAttention) return left.needsAttention ? -1 : 1;
      return left.title.localeCompare(right.title);
    });
}
