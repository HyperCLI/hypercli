import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import { renderWithClient } from "@/test/utils";
import { AgentScheduledPanel } from "./AgentScheduledPanel";

function renderPanel(overrides: Partial<ComponentProps<typeof AgentScheduledPanel>> = {}) {
  const props: ComponentProps<typeof AgentScheduledPanel> = {
    agentName: "Ada",
    sessionKey: "main",
    jobs: [],
    connected: true,
    connecting: false,
    hydrating: false,
    error: null,
    isSelectedRunning: true,
    onRefresh: vi.fn(async () => undefined),
    onCreate: vi.fn(async () => undefined),
    onRun: vi.fn(async () => undefined),
    onDelete: vi.fn(async () => undefined),
    onStartAgent: vi.fn(async () => undefined),
    ...overrides,
  };

  return renderWithClient(<AgentScheduledPanel {...props} />);
}

describe("AgentScheduledPanel", () => {
  it("asks the user to start the agent before managing schedules", () => {
    const onStartAgent = vi.fn();
    renderPanel({ isSelectedRunning: false, connected: false, onStartAgent });

    expect(screen.getByText("Start Ada to manage scheduled work")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /start agent/i }));
    expect(onStartAgent).toHaveBeenCalledTimes(1);
  });

  it("creates a recurring cron job from the prototype-style plain English form", async () => {
    const onCreate = vi.fn(async () => undefined);
    renderPanel({ onCreate });

    fireEvent.click(screen.getByRole("button", { name: /schedule a job/i }));
    fireEvent.change(screen.getByLabelText(/what should this job do/i), {
      target: { value: "Every weekday at 9am, summarize unread Slack from #engineering and post a 5-bullet digest to #standup" },
    });

    expect(screen.getByText("Parsed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /schedule job/i }));

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
        schedule: { kind: "cron", expr: "0 9 * * 1-5", tz: "UTC" },
        payload: { kind: "agentTurn", message: expect.stringContaining("summarize unread Slack") },
        name: expect.stringContaining("Summarize unread Slack"),
        sessionTarget: "session:main",
        wakeMode: "now",
      }));
    });
  });

  it("targets the selected session in the cron job payload", async () => {
    const onCreate = vi.fn(async () => undefined);
    renderPanel({
      onCreate,
      sessionOptions: [
        { key: "main", label: "Main Session" },
        { key: "project-design", label: "Design Audit" },
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: /^schedule$/i }));
    expect(screen.getByLabelText(/^session$/i)).toHaveTextContent("Main Session");

    fireEvent.click(screen.getByLabelText(/^session$/i));
    const listbox = screen.getByRole("listbox", { name: /^session$/i });
    expect(within(listbox).getByRole("option", { name: /main session/i })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(within(listbox).getByRole("option", { name: /design audit/i }));
    expect(screen.queryByRole("listbox", { name: /^session$/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^session$/i)).toHaveTextContent("Design Audit");

    fireEvent.change(screen.getByLabelText(/what should this job do/i), {
      target: { value: "Every Monday at 8am, generate a weekly design audit" },
    });
    fireEvent.click(screen.getByRole("button", { name: /schedule job/i }));

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
        sessionTarget: "session:project-design",
        schedule: { kind: "cron", expr: "0 8 * * 1", tz: "UTC" },
        payload: { kind: "agentTurn", message: "generate a weekly design audit" },
      }));
    });
  });

  it("keeps scoped session options and does not add stale job targets to the picker", () => {
    renderPanel({
      sessionOptions: [
        { key: "main", label: "Main Session" },
        { key: "session:main", label: "Duplicate Main" },
        { key: "agent:agent-1:main", label: "Scoped Main" },
      ],
      jobs: [{
        id: "stale-job",
        schedule: "0 9 * * *",
        command: "Old scheduled work.",
        prompt: "Old scheduled work.",
        description: "Old scheduled work.",
        enabled: true,
        targetSessionKey: "project-stale",
      }],
    });

    fireEvent.click(screen.getByRole("button", { name: /^schedule$/i }));
    fireEvent.click(screen.getByLabelText(/^session$/i));

    const options = within(screen.getByRole("listbox", { name: /^session$/i })).getAllByRole("option");
    expect(options).toHaveLength(3);
    expect(options[0]).toHaveTextContent("Main Session");
    expect(options[1]).toHaveTextContent("Duplicate Main");
    expect(options[2]).toHaveTextContent("Scoped Main");
    expect(screen.queryByRole("option", { name: /project-stale/i })).not.toBeInTheDocument();
  });

  it("marks unparsed natural-language input without treating the default cron as parsed", () => {
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: /schedule a job/i }));
    fireEvent.change(screen.getByLabelText(/what should this job do/i), {
      target: { value: "Summarize unread Slack and send a digest" },
    });

    expect(screen.getByText("Unparsed")).toBeInTheDocument();
    expect(screen.getByLabelText(/cron/i)).toHaveValue("0 9 * * 1-5");
  });

  it("opens the create form with an initial slash-command draft", () => {
    renderPanel({
      sessionKey: "project-weekly",
      sessionOptions: [
        { key: "main", label: "Main Session" },
        { key: "project-weekly", label: "Weekly Planning" },
      ],
      initialCommand: "Every Monday at 8am, generate a weekly OKR digest for the leadership team",
    });

    expect(screen.getByRole("heading", { name: /new scheduled job/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/what should this job do/i)).toHaveValue("Every Monday at 8am, generate a weekly OKR digest for the leadership team");
    expect(screen.getByLabelText(/cron/i)).toHaveValue("0 8 * * 1");
    expect(screen.getByLabelText(/^session$/i)).toHaveTextContent("Weekly Planning");
  });

  it("hydrates and saves edits for an existing scheduled job", async () => {
    const onUpdate = vi.fn(async () => undefined);
    renderPanel({
      jobs: [{
        id: "job-1",
        schedule: "0 9 * * 1-5",
        command: "Summarize engineering updates.",
        prompt: "Summarize engineering updates.",
        name: "Daily standup summary",
        description: "Daily standup summary",
        enabled: true,
        targetSessionKey: "session:project-design",
      }],
      sessionOptions: [
        { key: "main", label: "Main Session" },
        { key: "project-design", label: "Design Audit" },
      ],
      onUpdate,
    });

    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));

    expect(screen.getByRole("heading", { name: /edit scheduled job/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/what should this job do/i)).toHaveValue("Summarize engineering updates.");
    expect(screen.getByLabelText(/^name$/i)).toHaveValue("Daily standup summary");
    expect(screen.getByLabelText(/cron/i)).toHaveValue("0 9 * * 1-5");
    expect(screen.getByLabelText(/^session$/i)).toHaveTextContent("Design Audit");

    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith("job-1", expect.objectContaining({
        name: "Daily standup summary",
        sessionTarget: "session:project-design",
        schedule: { kind: "cron", expr: "0 9 * * 1-5", tz: "UTC" },
        wakeMode: "now",
        payload: { kind: "agentTurn", message: "Summarize engineering updates." },
      }));
    });
  });

  it("runs, refreshes, and deletes scheduled jobs", async () => {
    const onRun = vi.fn(async () => undefined);
    const onRefresh = vi.fn(async () => undefined);
    const onDelete = vi.fn(async () => undefined);
    renderPanel({
      jobs: [{
        id: "job-1",
        schedule: "0 9 * * 1-5",
        command: "Summarize engineering updates.",
        prompt: "Summarize engineering updates.",
        name: "Daily standup summary",
        description: "Daily standup summary",
        enabled: true,
        targetSessionKey: "project-design",
        lastRun: Date.now() - 3_600_000,
        nextRun: Date.now() + 86_400_000,
      }],
      sessionOptions: [
        { key: "main", label: "Main Session" },
        { key: "project-design", label: "Design Audit" },
      ],
      onRun,
      onRefresh,
      onDelete,
    });

    expect(screen.getByText("Daily standup summary")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Session: Design Audit")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /run now/i }));
    await waitFor(() => expect(onRun).toHaveBeenCalledWith("job-1"));

    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: /delete daily standup summary/i }));
    expect(screen.getByRole("heading", { name: "Delete scheduled job?" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith("job-1"));
  });

  it("surfaces refresh errors", async () => {
    renderPanel({ onRefresh: vi.fn(async () => { throw new Error("Cron list failed"); }) });

    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Cron list failed");
  });
});
