import { useEffect, useState } from "react";
import { CalendarClock, Loader2, Play, X } from "lucide-react";
import { listAcpSessions, routinesCreate, routinesUpdate, type AcpSessionInfo, type AgentSummary, type Routine } from "../api";
import { runtimeFamily } from "../agent-utils";
import {
  DEFAULT_SCHEDULE,
  MONTH_NAMES,
  TIME_OPTIONS,
  WEEKDAY_NAMES,
  buildCron,
  buildRunAt,
  dateInputValue,
  describeSchedule,
  draftFromRoutine,
  isValidCron,
  type RoutineFrequency,
  type ScheduleDraft,
} from "../schedule";

const TEMPLATES = [
  { label: "Weekday standup summary…", prompt: "Every weekday morning, summarize the threads that need my response and my open tasks into a short standup note." },
  { label: "Weekly OKR digest…", prompt: "Summarize this week's progress toward my OKRs, flag blockers, and suggest next week's focus." },
  { label: "Daily inbox triage…", prompt: "Check my inbox each evening and list the threads most likely to need a reply tomorrow." },
  { label: "Meeting prep brief…", prompt: "Before my first meeting each day, prepare a one-page brief with attendees, agenda, and relevant context." },
  { label: "Month-end expense nudge…", prompt: "On the last weekday of the month, compile untracked expenses into a draft report and remind me to submit it." },
];

const FREQUENCIES: { id: RoutineFrequency; label: string }[] = [
  { id: "none", label: "Doesn't repeat" },
  { id: "daily", label: "Daily" },
  { id: "weekdays", label: "Weekdays" },
  { id: "weekly", label: "Weekly" },
  { id: "monthly", label: "Monthly" },
  { id: "annually", label: "Annually" },
];

const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DAYS_OF_MONTH = Array.from({ length: 28 }, (_, index) => index + 1);

const FIELD_CLASS =
  "rounded-md border border-border bg-background px-2.5 py-1.5 text-[12px] outline-none focus:border-border-strong";

function FieldLabel({ children, first }: { children: string; first?: boolean }) {
  return <div className={`mb-1.5 text-[12px] text-text-secondary ${first ? "" : "mt-5"}`}>{children}</div>;
}

export function NewScheduledJobModal({
  agent,
  routine = null,
  onClose,
  onSaved,
}: {
  agent: AgentSummary;
  routine?: Routine | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = routine !== null;
  const isAcp = runtimeFamily(agent.runtime) === "acp";
  const [initialDraft] = useState<ScheduleDraft>(() =>
    routine ? draftFromRoutine(routine) : { ...DEFAULT_SCHEDULE, date: dateInputValue(new Date()) },
  );
  const [draft, setDraft] = useState<ScheduleDraft>(initialDraft);
  const [prompt, setPrompt] = useState(routine?.prompt ?? "");
  const [name, setName] = useState(routine?.name ?? "");
  const [sessionId, setSessionId] = useState(routine?.session_id ?? "");
  const [sessions, setSessions] = useState<AcpSessionInfo[]>([]);

  useEffect(() => {
    if (!isAcp) return;
    let cancelled = false;
    listAcpSessions(agent.id)
      .then((list) => {
        if (!cancelled) setSessions(list.sessions);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [agent.id, isAcp]);
  const [delivery, setDelivery] = useState<"in-app" | "slack">("in-app");
  const [showAdvanced, setShowAdvanced] = useState(initialDraft.rawCron.trim() !== "");
  const [templateOffset, setTemplateOffset] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (patch: Partial<ScheduleDraft>) => setDraft((current) => ({ ...current, ...patch }));

  const rawCron = draft.rawCron.trim();
  const runAt = buildRunAt(draft);
  const scheduleReady = rawCron ? isValidCron(rawCron) : draft.frequency === "none" ? runAt !== null : true;
  const canSave = prompt.trim() !== "" && scheduleReady && !saving;
  const summary = rawCron && !isValidCron(rawCron)
    ? "Cron expressions need exactly 5 fields, e.g. 0 9 * * 1-5"
    : `Scheduled for: ${describeSchedule(draft)}`;
  const templateChips = [0, 1].map((index) => TEMPLATES[(templateOffset + index) % TEMPLATES.length]);

  const save = async () => {
    const text = prompt.trim();
    if (!text || !scheduleReady || saving) return;
    const cron = rawCron || (draft.frequency === "none" ? null : buildCron(draft));
    const oneTime = !rawCron && draft.frequency === "none" ? runAt : null;
    const trimmedName = name.trim();
    setSaving(true);
    setError(null);
    try {
      if (routine) {
        await routinesUpdate(routine.id, {
          name: trimmedName,
          prompt: text,
          cron: cron ?? "",
          runAt: oneTime ?? "",
          // Empty sessionId is sent as JSON null by the SDK — clears the binding.
          ...(isAcp ? { sessionId } : {}),
        });
      } else {
        await routinesCreate({
          agentId: agent.id,
          prompt: text,
          enabled: true,
          ...(trimmedName ? { name: trimmedName } : {}),
          ...(cron ? { cron } : {}),
          ...(oneTime ? { runAt: oneTime } : {}),
          ...(isAcp && sessionId ? { sessionId } : {}),
        });
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : typeof e === "string" ? e : "Could not save the scheduled job.");
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={saving ? undefined : onClose}>
      <main
        role="dialog"
        aria-modal="true"
        aria-label={editing ? "Edit Scheduled Job" : "New Scheduled Job"}
        className="modal-card relative flex max-h-[86vh] w-[560px] max-w-[calc(100vw-32px)] flex-col overflow-hidden"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
          <div>
            <div className="text-[13px] font-semibold">{editing ? "Edit Scheduled Job" : "New Scheduled Job"}</div>
            <div className="text-[11px] text-text-secondary">Run a prompt on a schedule</div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <FieldLabel first>What should this job do?</FieldLabel>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Send me a digest of my Notion tasks"
            rows={3}
            autoFocus
            className={`${FIELD_CLASS} w-full resize-none px-2.5 py-2`}
          />
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-text-secondary">Try:</span>
            {templateChips.map((template) => (
              <button
                type="button"
                key={template.label}
                onClick={() => setPrompt(template.prompt)}
                className="rounded-full border border-border px-2.5 py-1 text-[11px] text-text-secondary hover:bg-active-row hover:text-foreground transition-colors"
              >
                {template.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setTemplateOffset((offset) => (offset + 2) % TEMPLATES.length)}
              className="text-[11px] font-medium text-accent hover:underline"
            >
              More templates
            </button>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3">
            <div>
              <div className="mb-1.5 text-[12px] text-text-secondary">Name</div>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Weekly Notion Digest"
                className={`${FIELD_CLASS} w-full`}
              />
            </div>
            <div>
              <div className="mb-1.5 text-[12px] text-text-secondary">Post to</div>
              <select
                value={delivery}
                onChange={(event) => setDelivery(event.target.value as "in-app" | "slack")}
                className={`${FIELD_CLASS} w-full`}
              >
                <option value="in-app">In-app</option>
                <option value="slack" disabled title="Coming soon">
                  Slack
                </option>
              </select>
            </div>
          </div>

          {isAcp && (
            <div>
              <FieldLabel>Session</FieldLabel>
              <select
                value={sessionId}
                onChange={(event) => setSessionId(event.target.value)}
                className={`${FIELD_CLASS} w-full`}
              >
                <option value="">New session each run</option>
                {sessionId && !sessions.some((s) => s.session_id === sessionId) && (
                  <option value={sessionId}>{sessionId}</option>
                )}
                {sessions.map((session) => (
                  <option key={session.session_id} value={session.session_id}>
                    {session.title ?? session.session_id}
                  </option>
                ))}
              </select>
            </div>
          )}

          <FieldLabel>When</FieldLabel>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={draft.frequency}
              onChange={(event) => update({ frequency: event.target.value as RoutineFrequency })}
              className={FIELD_CLASS}
            >
              {FREQUENCIES.map((frequency) => (
                <option key={frequency.id} value={frequency.id}>
                  {frequency.label}
                </option>
              ))}
            </select>
            {draft.frequency === "weekly" && (
              <select
                value={draft.weekday}
                onChange={(event) => update({ weekday: Number(event.target.value) })}
                className={FIELD_CLASS}
              >
                {WEEKDAY_ORDER.map((day) => (
                  <option key={day} value={day}>
                    {WEEKDAY_NAMES[day]}
                  </option>
                ))}
              </select>
            )}
            {draft.frequency === "monthly" && (
              <select
                value={draft.dayOfMonth}
                onChange={(event) => update({ dayOfMonth: Number(event.target.value) })}
                className={FIELD_CLASS}
              >
                {DAYS_OF_MONTH.map((day) => (
                  <option key={day} value={day}>
                    {day}
                  </option>
                ))}
              </select>
            )}
            {draft.frequency === "annually" && (
              <select
                value={draft.month}
                onChange={(event) => update({ month: Number(event.target.value) })}
                className={FIELD_CLASS}
              >
                {MONTH_NAMES.map((month, index) => (
                  <option key={month} value={index + 1}>
                    {month}
                  </option>
                ))}
              </select>
            )}
            {draft.frequency === "annually" && (
              <select
                value={draft.dayOfMonth}
                onChange={(event) => update({ dayOfMonth: Number(event.target.value) })}
                className={FIELD_CLASS}
              >
                {DAYS_OF_MONTH.map((day) => (
                  <option key={day} value={day}>
                    {day}
                  </option>
                ))}
              </select>
            )}
            {draft.frequency === "none" && (
              <input
                type="date"
                value={draft.date}
                onChange={(event) => update({ date: event.target.value })}
                className={FIELD_CLASS}
              />
            )}
            <select
              value={draft.time}
              onChange={(event) => update({ time: event.target.value })}
              className={FIELD_CLASS}
            >
              {TIME_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-4 rounded-lg border border-border bg-card">
            <button
              type="button"
              onClick={() => setShowAdvanced((value) => !value)}
              className="flex w-full items-center justify-between px-3 py-2.5 text-left text-[12px] font-medium"
            >
              Advanced options
              <span className="text-[11px] font-normal text-text-secondary">{showAdvanced ? "Hide" : "Optional"}</span>
            </button>
            {showAdvanced && (
              <div className="border-t border-border px-3 py-3">
                <div className="mb-1.5 text-[11px] font-medium text-text-secondary">Cron expression</div>
                <input
                  value={draft.rawCron}
                  onChange={(event) => update({ rawCron: event.target.value })}
                  placeholder="0 9 * * 1-5"
                  spellCheck={false}
                  className={`${FIELD_CLASS} w-full font-mono`}
                />
                <p className="mt-2 text-[11px] leading-snug text-text-secondary">
                  When set, this cron expression overrides the pickers above.
                </p>
              </div>
            )}
          </div>

          <div className="mt-4 flex items-center gap-1.5 text-[11px] text-text-secondary">
            <CalendarClock size={13} className="shrink-0" />
            <span>{summary}</span>
          </div>

          {error && (
            <div className="mt-4 rounded-lg bg-error-bg px-3 py-2 text-[12px] leading-relaxed text-error">
              {error}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between border-t border-border px-4 py-3">
          <button
            type="button"
            disabled
            title="Coming soon"
            className="ui-secondary-button flex items-center gap-1.5 disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <Play size={12} />
            Run Test
          </button>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="text-[12px] text-text-secondary hover:text-foreground transition-colors disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={!canSave}
              className="onboarding-primary min-w-20 disabled:opacity-50"
            >
              {saving ? <Loader2 size={14} className="mx-auto animate-spin" /> : "Save"}
            </button>
          </div>
        </div>
        <button
          onClick={onClose}
          disabled={saving}
          className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full text-text-secondary hover:bg-active-row hover:text-foreground disabled:opacity-40 transition-colors"
        >
          <X size={15} />
        </button>
      </main>
    </div>
  );
}
