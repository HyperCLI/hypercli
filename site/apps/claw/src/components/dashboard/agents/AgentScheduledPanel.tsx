"use client";

import React from "react";
import { CalendarClock, ChevronDown, ChevronLeft, Clock, Loader2, Pencil, Play, Plus, RefreshCw, Trash2 } from "lucide-react";

import { ConfirmDialog } from "@/components/dashboard/ConfirmDialog";
import { TabLoadingState } from "@/components/dashboard/agents/page-helpers";
import type { CronJob } from "@/components/dashboard/agentViewTypes";
import { buildCronJobInput, type CronJobInput } from "@/lib/cron-jobs";
import { fallbackOpenClawSessionDisplayName, sameOpenClawSelectableSessionKey } from "@/lib/openclaw-session-sdk-surface";

export interface ScheduledSessionOption {
  key: string;
  label: string;
}

interface AgentScheduledPanelProps {
  agentName: string;
  sessionKey: string;
  sessionOptions?: ScheduledSessionOption[];
  jobs: CronJob[];
  connected: boolean;
  connecting: boolean;
  hydrating?: boolean;
  error?: string | null;
  isSelectedRunning: boolean;
  onRefresh: () => Promise<void> | void;
  onCreate: (job: CronJobInput) => Promise<void> | void;
  onUpdate?: (jobId: string, job: CronJobInput) => Promise<void> | void;
  onRun: (jobId: string) => Promise<void> | void;
  onDelete: (jobId: string) => Promise<void> | void;
  onStartAgent?: () => Promise<void> | void;
  initialCommand?: string | null;
}

type ScheduledPanelView = "list" | "create" | "edit";

interface ScheduleDraft {
  command: string;
  name: string;
  schedule: string;
  targetSessionKey: string;
  nameTouched: boolean;
  scheduleTouched: boolean;
}

const INITIAL_SCHEDULE_DRAFT = {
  command: "",
  name: "",
  schedule: "0 9 * * 1-5",
  nameTouched: false,
  scheduleTouched: false,
};

const EMPTY_SESSION_OPTIONS: ScheduledSessionOption[] = [];

const CRON_PRESETS = [
  { label: "Every hour", cron: "0 * * * *" },
  { label: "Weekdays at 9am", cron: "0 9 * * 1-5" },
  { label: "Daily at 9am", cron: "0 9 * * *" },
  { label: "Mondays at 9am", cron: "0 9 * * 1" },
  { label: "1st of month", cron: "0 9 1 * *" },
  { label: "Every 15 minutes", cron: "*/15 * * * *" },
] as const;

const SCHEDULE_EXAMPLES = [
  "Every weekday at 9am, summarize unread Slack from #engineering and post a 5-bullet digest to #standup",
  "Every Monday at 8am, generate a weekly OKR digest for the leadership team",
  "Every hour, check for new GitHub issues with label urgent. If none, reply ok only. Otherwise notify #on-call.",
  "Every 15 minutes, check uptime of api.example.com. Only alert #ops if it is down.",
] as const;

const DOW_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function parseTimeOfDay(value: string | undefined): { hour: number; minute: number } {
  if (!value) return { hour: 9, minute: 0 };
  const match = value.trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!match) return { hour: 9, minute: 0 };
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? "0");
  const meridiem = match[3];
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  return {
    hour: Math.max(0, Math.min(23, hour)),
    minute: Math.max(0, Math.min(59, minute)),
  };
}

function dayOfWeekNumber(value: string): number {
  const key = value.slice(0, 3).toLowerCase();
  return { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }[key as "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat"] ?? 1;
}

function cronFromNaturalLanguage(value: string): string | null {
  const input = value.trim();
  if (!input) return null;

  let match = input.match(/every\s+(\d+)\s+minute/i);
  if (match) return `*/${match[1]} * * * *`;

  match = input.match(/every\s+(\d+)\s+hour/i);
  if (match) return `0 */${match[1]} * * *`;

  if (/every\s+minute/i.test(input)) return "* * * * *";
  if (/every\s+hour|hourly/i.test(input)) return "0 * * * *";

  match = input.match(/every\s+weekday(?:.*?at\s+(.+?))?(?:[,.]|$)/i);
  if (match) {
    const time = parseTimeOfDay(match[1] || "9am");
    return `${time.minute} ${time.hour} * * 1-5`;
  }

  match = input.match(/(?:every\s+)?weekend(?:.*?at\s+(.+?))?(?:[,.]|$)/i);
  if (match) {
    const time = parseTimeOfDay(match[1] || "10am");
    return `${time.minute} ${time.hour} * * 0,6`;
  }

  match = input.match(/every\s+(mon|tue|wed|thu|fri|sat|sun)\w*(?:.*?at\s+(.+?))?(?:[,.]|$)/i);
  if (match) {
    const time = parseTimeOfDay(match[2] || "9am");
    return `${time.minute} ${time.hour} * * ${dayOfWeekNumber(match[1] ?? "mon")}`;
  }

  match = input.match(/(?:every\s+day|daily)(?:.*?at\s+(.+?))?(?:[,.]|$)/i);
  if (match) {
    const time = parseTimeOfDay(match[1] || "9am");
    return `${time.minute} ${time.hour} * * *`;
  }

  match = input.match(/(?:1st|first)\s+(?:day\s+)?of\s+(?:the\s+)?month(?:.*?at\s+(.+?))?(?:[,.]|$)/i);
  if (match) {
    const time = parseTimeOfDay(match[1] || "9am");
    return `${time.minute} ${time.hour} 1 * *`;
  }

  match = input.match(/at\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i);
  if (match) {
    const time = parseTimeOfDay(match[1]);
    return `${time.minute} ${time.hour} * * *`;
  }

  return null;
}

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

function parseCronExpression(value: string): {
  minute: number[];
  hour: number[];
  dom: number[];
  month: number[];
  dow: number[];
  raw: string[];
} | null {
  const parts = value.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const minute = expandCronField(parts[0] ?? "", 0, 59);
  const hour = expandCronField(parts[1] ?? "", 0, 23);
  const dom = expandCronField(parts[2] ?? "", 1, 31);
  const month = expandCronField(parts[3] ?? "", 1, 12);
  const dow = expandCronField(parts[4] ?? "", 0, 7)?.map((day) => (day === 7 ? 0 : day));
  if (!minute || !hour || !dom || !month || !dow) return null;
  return { minute, hour, dom, month, dow: [...new Set(dow)].sort((left, right) => left - right), raw: parts };
}

function timeLabel(hour: number, minute: number): string {
  const meridiem = hour >= 12 ? "pm" : "am";
  const displayHour = ((hour + 11) % 12) + 1;
  return `${displayHour}:${minute.toString().padStart(2, "0")} ${meridiem}`;
}

function humanizeCron(value: string): string | null {
  const parsed = parseCronExpression(value);
  if (!parsed) return null;
  const everyMinute = parsed.minute.length === 60;
  const singleMinute = parsed.minute.length === 1;
  const everyHour = parsed.hour.length === 24;
  const singleHour = parsed.hour.length === 1;
  const everyDom = parsed.dom.length === 31;
  const everyMonth = parsed.month.length === 12;
  const everyDow = parsed.dow.length === 7;
  const weekdays = parsed.dow.length === 5 && parsed.dow.every((day, index) => day === index + 1);
  const weekends = parsed.dow.length === 2 && parsed.dow.includes(0) && parsed.dow.includes(6);

  let time = "custom schedule";
  if (singleMinute && singleHour) {
    time = `at ${timeLabel(parsed.hour[0] ?? 0, parsed.minute[0] ?? 0)}`;
  } else if (singleMinute && everyHour) {
    time = (parsed.minute[0] ?? 0) === 0 ? "every hour" : `${parsed.minute[0]} minutes past every hour`;
  } else if (everyMinute && everyHour) {
    time = "every minute";
  } else {
    const step = parsed.raw[0]?.match(/^\*\/(\d+)$/);
    if (step) time = `every ${step[1]} minutes`;
  }

  if (everyDom && everyMonth && everyDow) return time;
  if (weekdays && everyDom && everyMonth) return `${time}, weekdays`;
  if (weekends && everyDom && everyMonth) return `${time}, weekends`;
  if (!everyDow && everyDom && everyMonth) return `${time}, on ${parsed.dow.map((day) => DOW_NAMES[day] ?? "Sun").join(", ")}`;
  if (parsed.dom.length === 1 && everyDow) return `${time}, on day ${parsed.dom[0]} of the month`;
  return time;
}

function nextRuns(value: string, count = 5): Date[] {
  const parsed = parseCronExpression(value);
  if (!parsed) return [];
  const output: Date[] = [];
  let cursor = new Date(Date.now() + 60_000);
  cursor.setSeconds(0, 0);

  for (let index = 0; output.length < count && index < 60 * 24 * 366; index += 1) {
    if (
      parsed.minute.includes(cursor.getMinutes()) &&
      parsed.hour.includes(cursor.getHours()) &&
      parsed.dom.includes(cursor.getDate()) &&
      parsed.month.includes(cursor.getMonth() + 1) &&
      parsed.dow.includes(cursor.getDay())
    ) {
      output.push(new Date(cursor));
    }
    cursor = new Date(cursor.getTime() + 60_000);
  }

  return output;
}

function dayStart(value: Date): number {
  const copy = new Date(value);
  copy.setHours(0, 0, 0, 0);
  return copy.getTime();
}

function formatAbsoluteDate(value: Date): string {
  return `${DOW_NAMES[value.getDay()]} ${MONTH_NAMES[value.getMonth()]} ${value.getDate()} at ${value.getHours().toString().padStart(2, "0")}:${value.getMinutes().toString().padStart(2, "0")}`;
}

function humanizeNextRun(value: Date): string {
  const days = Math.round((dayStart(value) - dayStart(new Date())) / 86_400_000);
  const time = `${value.getHours().toString().padStart(2, "0")}:${value.getMinutes().toString().padStart(2, "0")}`;
  if (days === 0) return `today ${time}`;
  if (days === 1) return `tomorrow ${time}`;
  if (days > 1 && days < 7) return `${DOW_NAMES[value.getDay()]} ${time}`;
  return `${MONTH_NAMES[value.getMonth()]} ${value.getDate()} ${time}`;
}

function normalizeUnixMs(value: number | undefined): number | null {
  if (!Number.isFinite(value)) return null;
  const numeric = Number(value);
  return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
}

function formatLastRun(value: number | undefined): string | null {
  const timestamp = normalizeUnixMs(value);
  if (!timestamp) return null;
  const diff = Date.now() - timestamp;
  if (diff < 0) return formatAbsoluteDate(new Date(timestamp));
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function formatNextRun(value: number | undefined): string | null {
  const timestamp = normalizeUnixMs(value);
  if (!timestamp) return null;
  return humanizeNextRun(new Date(timestamp));
}

function suggestNameFromPrompt(value: string): string {
  const firstSentence = value.split(/[.\n]/)[0]?.trim() ?? "";
  const words = firstSentence.replace(/^every\s+[^,]+,\s*/i, "").split(/\s+/).filter(Boolean).slice(0, 6);
  const name = words.join(" ");
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : "";
}

function deriveRunPrompt(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const explicitMessage = trimmed.match(/^(?:every|daily|hourly)\b[\s\S]*?\bsend\s+(?:this\s+)?message\s*:\s*([\s\S]+)$/i);
  if (explicitMessage?.[1]?.trim()) return explicitMessage[1].trim();
  const scheduledColonMessage = trimmed.match(/^(?:every|daily|hourly)\b[^:]{0,180}:\s*([\s\S]+)$/i);
  if (scheduledColonMessage?.[1]?.trim()) return scheduledColonMessage[1].trim();
  if (/^(every|daily|hourly)\b/i.test(trimmed) && trimmed.includes(",")) {
    return trimmed.slice(trimmed.indexOf(",") + 1).trim() || trimmed;
  }
  return trimmed;
}

function jobTitle(job: CronJob): string {
  return job.name || job.description || job.command || job.prompt || job.id || "Scheduled job";
}

function jobCommand(job: CronJob): string {
  return job.command || job.prompt || "";
}

function fallbackSessionLabel(sessionKey: string): string {
  return sessionKey ? fallbackOpenClawSessionDisplayName(sessionKey) : "Current Session";
}

function normalizeSessionOptions(sessionOptions: ScheduledSessionOption[], sessionKey: string): ScheduledSessionOption[] {
  const options: ScheduledSessionOption[] = [];
  const add = (key: string, label: string) => {
    const normalizedKey = key.trim();
    if (!normalizedKey || options.some((option) => sameOpenClawSelectableSessionKey(option.key, normalizedKey))) return;
    options.push({ key: normalizedKey, label: label.trim() || fallbackSessionLabel(normalizedKey) });
  };

  for (const option of sessionOptions) add(option.key, option.label);
  add(sessionKey, fallbackSessionLabel(sessionKey));
  return options;
}

function sessionLabel(sessionOptions: ScheduledSessionOption[], sessionKey: string): string {
  return sessionOptions.find((option) => sameOpenClawSelectableSessionKey(option.key, sessionKey))?.label ?? fallbackSessionLabel(sessionKey);
}

function sessionOptionKey(sessionOptions: ScheduledSessionOption[], sessionKey: string): string | null {
  return sessionOptions.find((option) => sameOpenClawSelectableSessionKey(option.key, sessionKey))?.key ?? null;
}

function emptyDraft(targetSessionKey: string): ScheduleDraft {
  return { ...INITIAL_SCHEDULE_DRAFT, targetSessionKey };
}

function newDraftFromCommand(command: string, targetSessionKey: string): ScheduleDraft {
  const schedule = cronFromNaturalLanguage(command) ?? INITIAL_SCHEDULE_DRAFT.schedule;
  const prompt = deriveRunPrompt(command);
  return {
    command,
    name: suggestNameFromPrompt(prompt),
    schedule,
    targetSessionKey,
    nameTouched: false,
    scheduleTouched: false,
  };
}

function draftFromJob(job: CronJob, targetSessionKey: string): ScheduleDraft {
  const command = jobCommand(job);
  const name = job.name || job.description || suggestNameFromPrompt(command);
  const schedule = job.schedule || INITIAL_SCHEDULE_DRAFT.schedule;
  return {
    command,
    name,
    schedule,
    targetSessionKey,
    nameTouched: Boolean(name),
    scheduleTouched: Boolean(job.schedule),
  };
}

export function AgentScheduledPanel({
  agentName,
  sessionKey,
  sessionOptions = EMPTY_SESSION_OPTIONS,
  jobs,
  connected,
  connecting,
  hydrating = false,
  error = null,
  isSelectedRunning,
  onRefresh,
  onCreate,
  onUpdate,
  onRun,
  onDelete,
  onStartAgent,
  initialCommand = null,
}: AgentScheduledPanelProps) {
  const normalizedSessionOptions = React.useMemo(() => normalizeSessionOptions(sessionOptions, sessionKey), [sessionOptions, sessionKey]);
  const defaultTargetSessionKey = normalizedSessionOptions.find((option) => option.key === sessionKey)?.key ?? normalizedSessionOptions[0]?.key ?? sessionKey;
  const initialDraft = initialCommand?.trim() ? newDraftFromCommand(initialCommand.trim(), defaultTargetSessionKey) : emptyDraft(defaultTargetSessionKey);
  const [view, setView] = React.useState<ScheduledPanelView>(() => initialDraft.command ? "create" : "list");
  const [draft, setDraft] = React.useState<ScheduleDraft>(() => initialDraft);
  const [editingJob, setEditingJob] = React.useState<CronJob | null>(null);
  const [notice, setNotice] = React.useState("");
  const [formError, setFormError] = React.useState("");
  const [refreshing, setRefreshing] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [runningJobId, setRunningJobId] = React.useState<string | null>(null);
  const [deleteJob, setDeleteJob] = React.useState<CronJob | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const [sessionPickerOpen, setSessionPickerOpen] = React.useState(false);
  const noticeTimeoutRef = React.useRef<number | null>(null);
  const sessionPickerRef = React.useRef<HTMLDivElement | null>(null);
  const parsedCron = React.useMemo(() => parseCronExpression(draft.schedule), [draft.schedule]);
  const inferredSchedule = React.useMemo(() => cronFromNaturalLanguage(draft.command), [draft.command]);
  const previewRuns = React.useMemo(() => nextRuns(draft.schedule, 5), [draft.schedule]);
  const humanSchedule = React.useMemo(() => humanizeCron(draft.schedule), [draft.schedule]);
  const runPrompt = deriveRunPrompt(draft.command);
  const selectedSessionLabel = sessionLabel(normalizedSessionOptions, draft.targetSessionKey);
  const selectedSessionIndex = normalizedSessionOptions.findIndex((option) => sameOpenClawSelectableSessionKey(option.key, draft.targetSessionKey));
  const naturalLanguageParsed = Boolean(draft.command.trim() && inferredSchedule);
  const editing = view === "edit";
  const scheduleError = draft.schedule.trim()
    ? parsedCron ? "" : "Use a five-field cron expression, for example 0 9 * * 1-5."
    : "Add a schedule.";
  const canSave = Boolean(runPrompt && draft.targetSessionKey && !scheduleError && !saving && (!editing || (editingJob?.id && onUpdate)));

  const showNotice = React.useCallback((message: string) => {
    if (noticeTimeoutRef.current !== null) window.clearTimeout(noticeTimeoutRef.current);
    setNotice(message);
    noticeTimeoutRef.current = window.setTimeout(() => {
      setNotice("");
      noticeTimeoutRef.current = null;
    }, 2600);
  }, []);

  React.useEffect(() => () => {
    if (noticeTimeoutRef.current !== null) window.clearTimeout(noticeTimeoutRef.current);
  }, []);

  React.useEffect(() => {
    if (!sessionPickerOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (sessionPickerRef.current && !sessionPickerRef.current.contains(event.target as Node)) setSessionPickerOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSessionPickerOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [sessionPickerOpen]);

  const openCreate = React.useCallback((nextDraft?: ScheduleDraft) => {
    setEditingJob(null);
    setSessionPickerOpen(false);
    setDraft(nextDraft ?? emptyDraft(defaultTargetSessionKey));
    setFormError("");
    setView("create");
  }, [defaultTargetSessionKey]);

  const closeForm = React.useCallback(() => {
    setEditingJob(null);
    setSessionPickerOpen(false);
    setFormError("");
    setView("list");
  }, []);

  const openEdit = React.useCallback((job: CronJob) => {
    if (!job.id || !onUpdate) return;
    const targetSessionKey = sessionOptionKey(normalizedSessionOptions, job.targetSessionKey || defaultTargetSessionKey) ?? defaultTargetSessionKey;
    setEditingJob(job);
    setSessionPickerOpen(false);
    setDraft(draftFromJob(job, targetSessionKey));
    setFormError("");
    setView("edit");
  }, [defaultTargetSessionKey, normalizedSessionOptions, onUpdate]);

  const selectSession = React.useCallback((sessionKey: string) => {
    setDraft((current) => ({ ...current, targetSessionKey: sessionKey }));
    setSessionPickerOpen(false);
  }, []);

  const handleSessionPickerKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    if (normalizedSessionOptions.length === 0) return;
    const direction = event.key === "ArrowDown" ? 1 : -1;
    const currentIndex = selectedSessionIndex >= 0 ? selectedSessionIndex : 0;
    const nextIndex = (currentIndex + direction + normalizedSessionOptions.length) % normalizedSessionOptions.length;
    const nextOption = normalizedSessionOptions[nextIndex];
    if (nextOption) setDraft((current) => ({ ...current, targetSessionKey: nextOption.key }));
    setSessionPickerOpen(true);
  }, [normalizedSessionOptions, selectedSessionIndex]);

  const handleCommandChange = (value: string) => {
    const parsedSchedule = cronFromNaturalLanguage(value);
    const prompt = deriveRunPrompt(value);
    setDraft((current) => ({
      ...current,
      command: value,
      schedule: parsedSchedule && !current.scheduleTouched ? parsedSchedule : current.schedule,
      name: current.nameTouched ? current.name : suggestNameFromPrompt(prompt),
    }));
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    setFormError("");
    try {
      await onRefresh();
      showNotice("Scheduled work refreshed.");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not refresh scheduled work.");
    } finally {
      setRefreshing(false);
    }
  };

  const handleSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setFormError("");
    try {
      const jobInput = buildCronJobInput({
        cron: draft.schedule.trim(),
        message: runPrompt,
        name: draft.name.trim() || suggestNameFromPrompt(runPrompt) || "Scheduled job",
        sessionKey: draft.targetSessionKey,
      });
      if (editing) {
        if (!editingJob?.id || !onUpdate) throw new Error("Could not find the scheduled job to update.");
        await onUpdate(editingJob.id, jobInput);
      } else {
        await onCreate(jobInput);
      }
      setEditingJob(null);
      setView("list");
      setDraft(emptyDraft(defaultTargetSessionKey));
      showNotice(editing ? "Scheduled job updated." : "Scheduled job created.");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : editing ? "Could not update scheduled job." : "Could not create scheduled job.");
    } finally {
      setSaving(false);
    }
  };

  const handleRun = async (jobId: string) => {
    if (!jobId) return;
    setRunningJobId(jobId);
    setFormError("");
    try {
      await onRun(jobId);
      showNotice("Scheduled run requested.");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not run scheduled job.");
    } finally {
      setRunningJobId(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleteJob) return;
    setDeleting(true);
    setFormError("");
    try {
      await onDelete(deleteJob.id);
      setDeleteJob(null);
      showNotice("Scheduled job removed.");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not remove scheduled job.");
    } finally {
      setDeleting(false);
    }
  };

  if (!isSelectedRunning) {
    return (
      <section aria-label="Scheduled work" className="flex h-full min-h-0 flex-1 items-center justify-center bg-background px-5 py-8">
        <div className="w-full max-w-[560px] rounded-xl border border-border bg-surface-low p-6 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-background text-text-muted">
            <CalendarClock className="h-5 w-5" />
          </div>
          <h1 className="text-xl font-semibold text-foreground">Start {agentName} to manage scheduled work</h1>
          <p className="mt-3 text-sm leading-6 text-text-muted">
            Scheduled jobs are managed through the agent gateway. Start the agent, then create recurring work or run existing jobs.
          </p>
          {onStartAgent ? (
            <button type="button" onClick={() => { void onStartAgent(); }} className="mt-5 inline-flex h-9 items-center justify-center rounded-lg bg-[var(--button-primary)] px-4 text-sm font-semibold text-[var(--button-primary-foreground)] transition-colors hover:bg-[var(--button-primary-hover)]">
              Start agent
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  if (!connected) {
    return (
      <TabLoadingState
        label={connecting || hydrating ? "Loading scheduled work" : "Waiting for gateway"}
        detail={connecting || hydrating ? "Opening the agent schedule manager." : error ?? "Scheduled work loads after the gateway is reachable."}
      />
    );
  }

  if (view === "create" || view === "edit") {
    return (
      <section aria-label={editing ? "Edit scheduled job" : "Create scheduled job"} className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background">
        <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-4 sm:px-5">
          <button
            type="button"
            onClick={closeForm}
            aria-label="Back to scheduled jobs"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border text-text-muted transition-colors hover:bg-surface-low hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold text-foreground">{editing ? "Edit scheduled job" : "New scheduled job"}</h1>
            <p className="truncate text-xs text-text-muted">Recurring work for {agentName}</p>
          </div>
        </div>

        <div className="grid flex-1 min-h-0 grid-cols-1 overflow-hidden lg:grid-cols-[minmax(0,1fr)_320px]">
          <form onSubmit={handleSave} className="min-h-0 overflow-auto px-4 py-5 sm:px-6 lg:px-8">
            <div className="mx-auto flex w-full max-w-[680px] flex-col gap-5 pb-8">
              <div>
                <div className="flex items-baseline justify-between gap-3">
                  <label htmlFor="scheduled-command" className="text-xs font-semibold uppercase tracking-wide text-foreground">What should this job do?</label>
                  <span className="hidden text-xs text-text-muted sm:inline">Plain English is fine</span>
                </div>
                <textarea
                  id="scheduled-command"
                  value={draft.command}
                  onChange={(event) => handleCommandChange(event.target.value)}
                  placeholder="Every weekday at 9am, summarize unread Slack from #engineering and post a 5-bullet digest to #standup"
                  className="mt-2 min-h-28 w-full resize-y rounded-xl border border-border bg-surface px-3 py-3 text-sm leading-6 text-foreground outline-none transition-colors placeholder:text-text-muted focus:border-border-strong"
                />
                {draft.command ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium ${naturalLanguageParsed ? "border-selection-accent/25 bg-selection-accent/10 text-selection-accent" : "border-warning/25 bg-warning/10 text-warning"}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${naturalLanguageParsed ? "bg-selection-accent" : "bg-warning"}`} />
                      {naturalLanguageParsed ? "Parsed" : "Unparsed"}
                    </span>
                    {naturalLanguageParsed ? <span className="font-mono text-text-muted">{inferredSchedule}</span> : <span className="text-text-muted">Use a preset or edit the cron expression below.</span>}
                  </div>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
                <span>Try:</span>
                {SCHEDULE_EXAMPLES.map((example) => (
                  <button
                    type="button"
                    key={example}
                    onClick={() => setDraft(newDraftFromCommand(example, draft.targetSessionKey || defaultTargetSessionKey))}
                    className="rounded-full border border-border bg-surface px-2.5 py-1 font-medium text-text-secondary transition-colors hover:border-border-strong hover:bg-surface-low hover:text-foreground"
                  >
                    {suggestNameFromPrompt(deriveRunPrompt(example))}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(220px,0.6fr)]">
                <div>
                  <label htmlFor="scheduled-name" className="text-xs font-semibold uppercase tracking-wide text-foreground">Name</label>
                  <input
                    id="scheduled-name"
                    type="text"
                    value={draft.name}
                    onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value, nameTouched: true }))}
                    placeholder="Daily standup summary"
                    className="mt-2 h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm text-foreground outline-none transition-colors placeholder:text-text-muted focus:border-border-strong"
                  />
                </div>
                <div>
                  <label htmlFor="scheduled-cron" className="text-xs font-semibold uppercase tracking-wide text-foreground">Cron</label>
                  <input
                    id="scheduled-cron"
                    type="text"
                    value={draft.schedule}
                    onChange={(event) => setDraft((current) => ({ ...current, schedule: event.target.value, scheduleTouched: true }))}
                    placeholder="0 9 * * 1-5"
                    className="mt-2 h-10 w-full rounded-lg border border-border bg-surface px-3 font-mono text-xs text-foreground outline-none transition-colors placeholder:text-text-muted focus:border-border-strong"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="scheduled-session" className="text-xs font-semibold uppercase tracking-wide text-foreground">Session</label>
                <div ref={sessionPickerRef} className="relative mt-2">
                  <button
                    type="button"
                    id="scheduled-session"
                    aria-haspopup="listbox"
                    aria-expanded={sessionPickerOpen}
                    aria-controls="scheduled-session-options"
                    onClick={() => setSessionPickerOpen((open) => !open)}
                    onKeyDown={handleSessionPickerKeyDown}
                    className="flex h-10 w-full items-center rounded-lg border border-border bg-surface px-3 pr-10 text-left text-sm text-foreground outline-none transition-colors focus:border-border-strong"
                  >
                    <span className="min-w-0 flex-1 truncate">{selectedSessionLabel}</span>
                  </button>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
                  {sessionPickerOpen ? (
                    <div
                      id="scheduled-session-options"
                      role="listbox"
                      aria-label="Session"
                      className="absolute left-0 right-0 z-50 mt-2 max-h-56 overflow-auto rounded-xl border border-selection-accent/45 bg-popover p-1.5 shadow-[0_18px_55px_color-mix(in_srgb,var(--foreground)_14%,transparent)] ring-1 ring-selection-accent/20"
                    >
                      {normalizedSessionOptions.map((option) => {
                        const selected = sameOpenClawSelectableSessionKey(option.key, draft.targetSessionKey);
                        return (
                          <button
                            type="button"
                            key={option.key}
                            role="option"
                            aria-selected={selected}
                            onClick={() => selectSession(option.key)}
                            className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${selected ? "bg-selection-accent font-semibold text-selection-accent-foreground" : "text-foreground hover:bg-selection-accent/15 hover:text-selection-accent"}`}
                          >
                            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${selected ? "bg-selection-accent-foreground" : "bg-selection-accent/45"}`} />
                            <span className="min-w-0 flex-1 truncate">{option.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              </div>

              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground">Presets</div>
                <div className="flex flex-wrap gap-2">
                  {CRON_PRESETS.map((preset) => (
                    <button
                      type="button"
                      key={preset.cron}
                      onClick={() => setDraft((current) => ({ ...current, schedule: preset.cron, scheduleTouched: true }))}
                      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${draft.schedule === preset.cron ? "border-selection-accent bg-selection-accent/10 text-selection-accent" : "border-border bg-surface text-text-secondary hover:border-border-strong hover:bg-surface-low hover:text-foreground"}`}
                    >
                      <span>{preset.label}</span>
                      <span className="font-mono text-[10px] opacity-60">{preset.cron}</span>
                    </button>
                  ))}
                </div>
              </div>

              {formError ? <p className="text-sm text-destructive" role="alert">{formError}</p> : null}
              {scheduleError ? <p className="text-xs text-warning">{scheduleError}</p> : null}

              <div className="flex flex-col-reverse gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs leading-5 text-text-muted">{editing ? "Saving replaces this schedule, so recent run timing may reset." : "Delivery, one-shot jobs, model overrides, and enable/disable controls are not available in this first pass."}</p>
                <div className="flex shrink-0 gap-2">
                  <button type="button" onClick={closeForm} className="h-9 rounded-lg border border-border px-4 text-sm font-medium text-foreground transition-colors hover:bg-surface-low">Cancel</button>
                  <button type="submit" disabled={!canSave} className="inline-flex h-9 items-center gap-2 rounded-lg bg-[var(--button-primary)] px-4 text-sm font-semibold text-[var(--button-primary-foreground)] transition-colors hover:bg-[var(--button-primary-hover)] disabled:cursor-not-allowed disabled:opacity-50">
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : editing ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                    {editing ? "Save changes" : "Schedule job"}
                  </button>
                </div>
              </div>
            </div>
          </form>

          <aside className="min-h-0 overflow-auto border-t border-border bg-surface-low p-4 lg:border-l lg:border-t-0">
            <div className="flex flex-col gap-3">
              <div className="rounded-xl border border-border bg-background p-4">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
                  <span className="h-2 w-2 rounded-full bg-selection-accent" />
                  Schedule
                </div>
                <div className="mt-3 font-mono text-sm text-foreground">{draft.schedule || "No cron set"}</div>
                <div className="mt-1 text-sm text-text-secondary">{humanSchedule ?? "Custom or invalid schedule"}</div>
              </div>

              <div className="rounded-xl border border-border bg-background p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-text-muted">Next 5 runs</div>
                <div className="mt-3 flex flex-col gap-2">
                  {previewRuns.length > 0 ? previewRuns.map((run) => (
                    <div key={run.getTime()} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-2 text-xs">
                      <span className="font-medium text-foreground">{humanizeNextRun(run)}</span>
                      <span className="text-text-muted">{formatAbsoluteDate(run)}</span>
                    </div>
                  )) : <p className="text-xs leading-5 text-text-muted">Set a valid schedule to preview runs.</p>}
                </div>
              </div>

              <div className="rounded-xl border border-border bg-background p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-text-muted">Session</div>
                <p className="mt-3 text-sm font-medium text-foreground">{selectedSessionLabel}</p>
                <p className="mt-1 break-all font-mono text-xs text-text-muted">{draft.targetSessionKey}</p>
              </div>

              <div className="rounded-xl border border-border bg-background p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-text-muted">Run message</div>
                <p className="mt-3 text-sm leading-6 text-foreground">{runPrompt || "Describe the job to preview the message sent to the agent."}</p>
              </div>
            </div>
          </aside>
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Scheduled work" className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <div className="flex shrink-0 flex-col gap-3 border-b border-border bg-background px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight text-foreground">Scheduled</h1>
          <p className="mt-1 text-sm text-text-muted">Run {agentName} automatically on recurring schedules.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" onClick={() => { void handleRefresh(); }} disabled={refreshing} className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-surface-low disabled:opacity-60">
            {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh
          </button>
          <button type="button" onClick={() => openCreate()} className="inline-flex h-9 items-center gap-2 rounded-lg bg-[var(--button-primary)] px-3 text-sm font-semibold text-[var(--button-primary-foreground)] transition-colors hover:bg-[var(--button-primary-hover)]">
            <Plus className="h-4 w-4" />
            Schedule
          </button>
        </div>
      </div>

      {notice ? <div role="status" aria-live="polite" className="mx-4 mt-3 rounded-full border border-selection-accent/25 bg-selection-accent/10 px-3 py-1.5 text-xs font-medium text-selection-accent sm:mx-6">{notice}</div> : null}
      {formError ? <div role="alert" className="mx-4 mt-3 rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive sm:mx-6">{formError}</div> : null}

      <div className="min-h-0 flex-1 overflow-auto px-4 py-5 sm:px-6">
        {jobs.length === 0 ? (
          <div className="mx-auto flex min-h-[420px] max-w-[680px] flex-col items-center justify-center rounded-xl border border-border bg-surface p-6 text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-surface-low text-text-muted">
              <Clock className="h-6 w-6" />
            </div>
            <h2 className="text-xl font-semibold text-foreground">No scheduled jobs</h2>
            <p className="mt-3 max-w-[500px] text-sm leading-6 text-text-muted">Run your agent on a cron or natural-language schedule. Try &quot;Every weekday at 9am&quot; to start.</p>
            <button type="button" onClick={() => openCreate(newDraftFromCommand(SCHEDULE_EXAMPLES[0], defaultTargetSessionKey))} className="mt-5 inline-flex h-9 items-center gap-2 rounded-lg bg-[var(--button-primary)] px-4 text-sm font-semibold text-[var(--button-primary-foreground)] transition-colors hover:bg-[var(--button-primary-hover)]">
              <Plus className="h-4 w-4" />
              Schedule a job
            </button>
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-[840px] flex-col gap-2">
            {jobs.map((job) => {
              const title = jobTitle(job);
              const command = jobCommand(job);
              const lastRun = formatLastRun(job.lastRun);
              const nextRun = formatNextRun(job.nextRun);
              const jobSessionLabel = job.targetSessionKey ? sessionLabel(normalizedSessionOptions, job.targetSessionKey) : "";
              return (
                <article key={job.id || `${job.schedule}-${title}`} className="rounded-xl border border-border bg-surface p-3 transition-colors hover:bg-surface-low/60">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-text-muted">
                      <Clock className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-sm font-semibold text-foreground">{title}</h2>
                        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${job.enabled === false ? "border-warning/25 bg-warning/10 text-warning" : "border-selection-accent/25 bg-selection-accent/10 text-selection-accent"}`}>
                          {job.enabled === false ? "Paused" : "Active"}
                        </span>
                      </div>
                      <div className="mt-1 font-mono text-xs text-text-muted">{job.schedule || "No schedule"}</div>
                      {command ? <p className="mt-2 line-clamp-2 text-sm leading-5 text-text-secondary">{command}</p> : null}
                      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
                        {lastRun ? <span>Last: {lastRun}</span> : null}
                        {nextRun ? <span>Next: {nextRun}</span> : null}
                        {jobSessionLabel ? <span>Session: {jobSessionLabel}</span> : null}
                        {!lastRun && !nextRun ? <span>No run timing reported yet.</span> : null}
                        {job.id ? <span className="font-mono">{job.id}</span> : null}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2 sm:justify-end">
                      {onUpdate ? (
                        <button
                          type="button"
                          onClick={() => openEdit(job)}
                          disabled={!job.id}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-background disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Edit
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => { void handleRun(job.id); }}
                        disabled={!job.id || runningJobId === job.id}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-background disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {runningJobId === job.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                        Run now
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteJob(job)}
                        disabled={!job.id}
                        aria-label={`Delete ${title}`}
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-text-muted transition-colors hover:border-destructive/35 hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(deleteJob)}
        title="Delete scheduled job?"
        message={deleteJob ? `Remove ${jobTitle(deleteJob)} from scheduled work?` : "Remove this scheduled job?"}
        confirmLabel="Delete"
        danger
        loading={deleting}
        onCancel={() => { if (!deleting) setDeleteJob(null); }}
        onConfirm={() => { void confirmDelete(); }}
      />
    </section>
  );
}
