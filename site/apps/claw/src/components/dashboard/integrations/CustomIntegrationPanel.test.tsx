import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { GatewayEphemeralChatOptions } from "@hypercli.com/sdk/openclaw/gateway";
import { describe, expect, it, vi } from "vitest";

import { expectNoA11yViolations } from "@/test/utils";
import { CustomIntegrationPanel } from "./CustomIntegrationPanel";
import { CUSTOM_INTEGRATION_RUN_SCHEMA, type CustomIntegrationRunner } from "./custom-integration-agent";

function response(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schema: CUSTOM_INTEGRATION_RUN_SCHEMA,
    status: "complete",
    summary: "Notion is installed, configured, and reachable from this workspace.",
    completed: ["Installed the official Notion CLI.", "Verified the Notion workspace connection."],
    userSteps: [],
    ...overrides,
  });
}

describe("CustomIntegrationPanel", () => {
  it("starts with one required question and explains the hidden setup boundary", async () => {
    const runner = vi.fn(async (_prompt: string, _options?: GatewayEphemeralChatOptions) => response());
    const { container } = render(<CustomIntegrationPanel connected runEphemeralPrompt={runner} />);

    expect(screen.getByRole("heading", { name: "Connect any tool" })).toBeInTheDocument();
    const card = screen.getByRole("region", { name: "Connect any tool" });
    expect(card).toHaveClass("rounded-[1.75rem]", "border-selection-accent/35", "bg-background", "shadow-2xl");
    expect(card).not.toHaveClass("border-warning/40");
    expect(screen.getByText(/review the service, source, and intended use before the agent installs or configures anything/i)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "What do you want to connect?" })).toHaveAttribute("placeholder", "Notion");
    expect(screen.getByRole("button", { name: "Review integration" })).toBeDisabled();
    expect(screen.queryByRole("textbox", { name: /api key|token|password|private key/i })).not.toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  it("can review intent while disconnected but cannot start setup", async () => {
    const user = userEvent.setup();
    render(<CustomIntegrationPanel connected />);

    await user.type(screen.getByRole("textbox", { name: "What do you want to connect?" }), "Notion");
    await user.click(screen.getByRole("button", { name: "Review integration" }));

    expect(screen.getByRole("heading", { name: "Is this the right integration?" })).toBeInTheDocument();
    expect(screen.getByText("Reconnect the agent before connecting a tool.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Yes, start setup" })).toBeDisabled();
  });

  it("requires confirmation of the exact service before setup and renders only sanitized completed work", async () => {
    const runner = vi.fn(async (_prompt: string, options?: GatewayEphemeralChatOptions) => {
      await options?.onEvent?.({ type: "tool_call", data: { name: "read", args: { path: "/private/path" } } });
      await options?.onEvent?.({ type: "tool_call", data: { name: "npm_install", args: { command: "private command" } } });
      await options?.onEvent?.({ type: "tool_result", data: { name: "npm_install", result: "private output" } });
      return response();
    });
    const user = userEvent.setup();
    render(<CustomIntegrationPanel connected runEphemeralPrompt={runner} />);

    await user.type(screen.getByRole("textbox", { name: "What do you want to connect?" }), "Notion");
    await user.type(screen.getByRole("textbox", { name: /What should it do/i }), "Read shared pages and create project notes.");
    await user.click(screen.getByText("Advanced details"));
    await user.type(screen.getByRole("textbox", { name: /Documentation URL/i }), "https://developers.notion.com/");
    await user.click(screen.getByRole("button", { name: "Review integration" }));

    expect(await screen.findByRole("heading", { name: "Is this the right integration?" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Notion" })).toBeInTheDocument();
    expect(screen.getByText("Connection path: Let agent decide")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Provided docs · developers\.notion\.com/i })).toHaveAttribute("href", "https://developers.notion.com/");
    expect(screen.getByText("Read shared pages and create project notes.")).toBeInTheDocument();
    expect(runner).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Yes, start setup" }));

    expect(await screen.findByRole("heading", { name: "Notion ready" })).toBeInTheDocument();
    expect(screen.getByText("Installed the official Notion CLI.")).toBeInTheDocument();
    expect(screen.getByText("Verified the Notion workspace connection.")).toBeInTheDocument();
    expect(screen.queryByText("private command")).not.toBeInTheDocument();
    expect(screen.queryByText("private output")).not.toBeInTheDocument();
    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner.mock.calls[0]?.[0]).toContain('"confirmedMatch":{"schema":"hypercli.custom-integration-match.v1","serviceName":"Notion"');
    expect(runner.mock.calls[0]?.[0]).toContain('"documentationUrl":"https://developers.notion.com/"');
    expect(runner.mock.calls[0]?.[0]).toContain("install official required packages or plugins");
    expect(runner.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ timeoutMs: 300_000, maxResponseChars: 32_768 }));
  });

  it("shows unavoidable user actions and continues only after confirmation", async () => {
    const runner = vi.fn<CustomIntegrationRunner>(async () => {
      if (runner.mock.calls.length === 1) return response({
        status: "needs_user_action",
        summary: "Notion authorization and page access are the only remaining steps.",
        completed: ["Installed the official Notion CLI."],
        userSteps: [{
          id: "authorize-notion",
          title: "Authorize Notion",
          instructions: "Choose the pages this agent may access, then return here.",
          url: "https://www.notion.so/my-integrations",
          actionLabel: "Open Notion",
        }, {
          id: "approve-page-access",
          title: "Approve page access",
          instructions: "Choose the pages this workspace may use.",
        }],
      });
      return response();
    });
    const user = userEvent.setup();
    render(<CustomIntegrationPanel connected runEphemeralPrompt={runner} />);

    await user.type(screen.getByRole("textbox", { name: "What do you want to connect?" }), "Notion");
    await user.click(screen.getByRole("button", { name: "Review integration" }));
    await user.click(screen.getByRole("button", { name: "Yes, start setup" }));

    expect(await screen.findByRole("heading", { name: "Finish Notion setup" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open Notion · www\.notion\.so/i })).toHaveAttribute("href", "https://www.notion.so/my-integrations");
    expect(screen.getByRole("button", { name: "Continue setup" })).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: "I completed: Authorize Notion" }));
    expect(screen.getByRole("button", { name: "Continue setup" })).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: "I completed: Approve page access" }));
    await user.click(screen.getByRole("button", { name: "Continue setup" }));

    expect(await screen.findByRole("heading", { name: "Notion ready" })).toBeInTheDocument();
    expect(runner).toHaveBeenCalledTimes(2);
    expect(runner.mock.calls[1]?.[0]).toContain('"confirmedStepIds":["authorize-notion","approve-page-access"]');
  });

  it("cancels the hidden run and ignores late completion", async () => {
    let resolveRun: ((value: string) => void) | null = null;
    let runOptions: GatewayEphemeralChatOptions | undefined;
    const runner = vi.fn((_prompt: string, options?: GatewayEphemeralChatOptions) => new Promise<string>((resolve) => {
      runOptions = options;
      resolveRun = resolve;
    }));
    const user = userEvent.setup();
    render(<CustomIntegrationPanel connected runEphemeralPrompt={runner} />);

    await user.type(screen.getByRole("textbox", { name: "What do you want to connect?" }), "Notion");
    await user.click(screen.getByRole("button", { name: "Review integration" }));
    await user.click(screen.getByRole("button", { name: "Yes, start setup" }));
    expect(screen.getByRole("heading", { name: "Setting up Notion" })).toBeInTheDocument();
    await act(async () => runOptions?.onEvent?.({ type: "tool_call", data: { name: "Shell", args: { command: "private command" } } }));
    expect(screen.getByText("Running workspace setup")).toBeInTheDocument();
    expect(screen.queryByText("private command")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(runOptions?.signal?.aborted).toBe(true);
    expect(screen.getByRole("heading", { name: "Stopping setup" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancelling" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Yes, start setup" })).not.toBeInTheDocument();

    await act(async () => resolveRun?.(response()));
    expect(await screen.findByRole("heading", { name: "Is this the right integration?" })).toBeInTheDocument();
    expect(screen.queryByText("Setup completed")).not.toBeInTheDocument();
  });

  it("rejects malformed agent output without rendering it", async () => {
    const runner = vi.fn(async () => "Notion token: secret_ABCDEFGHIJKLMNOPQRSTUVWXYZ");
    const user = userEvent.setup();
    render(<CustomIntegrationPanel connected runEphemeralPrompt={runner} />);

    await user.type(screen.getByRole("textbox", { name: "What do you want to connect?" }), "Notion");
    await user.click(screen.getByRole("button", { name: "Review integration" }));
    await user.click(screen.getByRole("button", { name: "Yes, start setup" }));

    expect(await screen.findByRole("heading", { name: "Retry setup" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("The setup response was incomplete");
    expect(screen.queryByText(/secret_ABCDEFGHIJKLMNOPQRSTUVWXYZ/)).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Yes, start setup" })).toBeEnabled());
  });

  it("does not render private gateway error details", async () => {
    const runner = vi.fn(async () => {
      throw new Error("Shell failed with token: secret_ABCDEFGHIJKLMNOPQRSTUVWXYZ at /home/agent/private/config.json");
    });
    const user = userEvent.setup();
    render(<CustomIntegrationPanel connected runEphemeralPrompt={runner} />);

    await user.type(screen.getByRole("textbox", { name: "What do you want to connect?" }), "Notion");
    await user.click(screen.getByRole("button", { name: "Review integration" }));
    await user.click(screen.getByRole("button", { name: "Yes, start setup" }));

    expect(await screen.findByRole("heading", { name: "Retry setup" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("private setup session stopped before it finished");
    expect(screen.queryByText(/secret_ABCDEFGHIJKLMNOPQRSTUVWXYZ|\/home\/agent\/private/i)).not.toBeInTheDocument();
  });
});
