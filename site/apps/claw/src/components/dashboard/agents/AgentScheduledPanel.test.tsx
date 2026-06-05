import { fireEvent, screen, waitFor } from "@testing-library/react";
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
        schedule: { cron: "0 9 * * 1-5" },
        payload: { kind: "message", text: expect.stringContaining("summarize unread Slack"), deliver: false },
        name: expect.stringContaining("Summarize unread Slack"),
        sessionTarget: { sessionKey: "main" },
      }));
    });
  });

  it("targets the selected project in the cron job payload", async () => {
    const onCreate = vi.fn(async () => undefined);
    renderPanel({
      onCreate,
      projectOptions: [
        { key: "main", label: "Main Project" },
        { key: "project-design", label: "Design Audit" },
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: /^schedule$/i }));
    expect(screen.getByLabelText(/^project$/i)).toHaveValue("main");

    fireEvent.change(screen.getByLabelText(/^project$/i), { target: { value: "project-design" } });
    fireEvent.change(screen.getByLabelText(/what should this job do/i), {
      target: { value: "Every Monday at 8am, generate a weekly design audit" },
    });
    fireEvent.click(screen.getByRole("button", { name: /schedule job/i }));

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
        sessionTarget: { sessionKey: "project-design" },
        payload: { kind: "message", text: "generate a weekly design audit", deliver: false },
      }));
    });
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
      projectOptions: [
        { key: "main", label: "Main Project" },
        { key: "project-weekly", label: "Weekly Planning" },
      ],
      initialCommand: "Every Monday at 8am, generate a weekly OKR digest for the leadership team",
    });

    expect(screen.getByRole("heading", { name: /new scheduled job/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/what should this job do/i)).toHaveValue("Every Monday at 8am, generate a weekly OKR digest for the leadership team");
    expect(screen.getByLabelText(/cron/i)).toHaveValue("0 8 * * 1");
    expect(screen.getByLabelText(/^project$/i)).toHaveValue("project-weekly");
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
      projectOptions: [
        { key: "main", label: "Main Project" },
        { key: "project-design", label: "Design Audit" },
      ],
      onRun,
      onRefresh,
      onDelete,
    });

    expect(screen.getByText("Daily standup summary")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Project: Design Audit")).toBeInTheDocument();

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
