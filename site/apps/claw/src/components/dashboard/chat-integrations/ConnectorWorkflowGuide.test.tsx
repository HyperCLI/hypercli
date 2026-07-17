import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ConnectorWorkflow } from "@/lib/connector-workflow";
import { ConnectorWorkflowGuide } from "./ConnectorWorkflowGuide";

const workflow: ConnectorWorkflow = {
  schema: "hypercli.connector-workflow.v1",
  connectorId: "github",
  runtimeFingerprint: "openclaw:test",
  summary: "Prepare GitHub for this runtime.",
  steps: [{
    id: "install-gh",
    title: "Install GitHub tools",
    instructions: "Review the proposed installation command.",
    kind: "action",
    operation: "github.shell-proposal",
    command: "apt-get install -y gh",
    approvalRequired: true,
  }],
};

describe("ConnectorWorkflowGuide", () => {
  it("offers a retry when generation is temporarily unavailable", () => {
    const onRetry = vi.fn();
    render(<ConnectorWorkflowGuide workflow={null} unavailable onRetry={onRetry} />);

    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders an expandable numbered timeline with direct external links", () => {
    const timelineWorkflow: ConnectorWorkflow = {
      schema: "hypercli.connector-workflow.v1",
      connectorId: "telegram",
      runtimeFingerprint: "openclaw:telegram",
      summary: "Connect Telegram.",
      steps: [{
        id: "create-bot",
        title: "Create your bot",
        instructions: "Open the official bot creator to begin.",
        kind: "instruction",
        url: "https://t.me/BotFather",
        approvalRequired: false,
      }, {
        id: "enter-token",
        title: "Enter the bot token",
        instructions: "Paste the token into the protected field.",
        kind: "input",
        inputSlots: ["telegram.botToken"],
        approvalRequired: false,
      }],
    };
    const { container } = render(
      <ConnectorWorkflowGuide
        workflow={timelineWorkflow}
        inputControls={{
          "telegram.botToken": { content: <input aria-label="Protected token" />, valid: true },
        }}
      />,
    );

    expect(container.querySelector("[data-workflow-timeline]")).toBeInTheDocument();
    expect(container.querySelector("[data-workflow-navigation]")).toHaveClass("justify-start");
    expect(container.querySelector("[data-workflow-navigation]")).not.toHaveClass("justify-end");
    expect(container.querySelector('[data-workflow-step="create-bot"]')).toHaveAttribute("data-step-active", "true");
    expect(container.querySelector('[data-workflow-step="enter-token"]')).toHaveAttribute("data-step-active", "false");
    expect(screen.getByText("Open the official bot creator to begin.")).toBeInTheDocument();
    expect(screen.queryByText("Paste the token into the protected field.")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open @botfather/i })).toHaveAttribute("href", "https://t.me/BotFather");

    fireEvent.click(screen.getByRole("button", { name: /step 2: enter the bot token/i }));

    expect(container.querySelector('[data-workflow-step="create-bot"]')).toHaveAttribute("data-step-active", "false");
    expect(container.querySelector('[data-workflow-step="enter-token"]')).toHaveAttribute("data-step-active", "true");
    expect(screen.queryByText("Open the official bot creator to begin.")).not.toBeInTheDocument();
    expect(screen.getByText("Paste the token into the protected field.")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Protected token" }).closest("[data-workflow-step]")).toHaveAttribute("data-workflow-step", "enter-token");
  });

  it("moves forward through the steps and offers to review from the start", () => {
    const timelineWorkflow: ConnectorWorkflow = {
      schema: "hypercli.connector-workflow.v1",
      connectorId: "telegram",
      runtimeFingerprint: "openclaw:telegram",
      summary: "Connect Telegram.",
      steps: [{
        id: "create-bot",
        title: "Create your bot",
        instructions: "Create the bot.",
        kind: "instruction",
        approvalRequired: false,
      }, {
        id: "enter-token",
        title: "Enter the bot token",
        instructions: "Enter the token securely.",
        kind: "input",
        inputSlots: ["telegram.botToken"],
        approvalRequired: false,
      }],
    };
    const { container } = render(
      <ConnectorWorkflowGuide
        workflow={timelineWorkflow}
        inputControls={{
          "telegram.botToken": { content: <input aria-label="Protected token" />, valid: true },
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /next step: enter the bot token/i }));
    expect(container.querySelector('[data-workflow-step="create-bot"]')).toHaveAttribute("data-step-complete", "true");
    expect(screen.getByRole("button", { name: /step 1: create your bot \(completed\)/i })).toHaveClass("border-selection-accent", "bg-selection-accent", "text-selection-accent-foreground");
    expect(screen.getByRole("button", { name: "Create your bot" })).toHaveClass("text-selection-accent");
    expect(container.querySelector('[data-workflow-step="enter-token"]')).toHaveAttribute("data-step-active", "true");
    expect(screen.getByRole("button", { name: "Enter the bot token" })).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: /complete step/i }));
    expect(container.querySelector('[data-workflow-step="enter-token"]')).toHaveAttribute("data-step-complete", "true");
    fireEvent.click(screen.getByRole("button", { name: /walkthrough complete: review from start/i }));
    expect(container.querySelector('[data-workflow-step="create-bot"]')).toHaveAttribute("data-step-active", "true");
    expect(screen.getByRole("button", { name: "Create your bot" })).toHaveFocus();
  });

  it("blocks step completion until contained inputs are valid", () => {
    const inputWorkflow: ConnectorWorkflow = {
      schema: "hypercli.connector-workflow.v1",
      connectorId: "telegram",
      runtimeFingerprint: "openclaw:telegram",
      summary: "Configure Telegram.",
      steps: [{
        id: "credentials",
        title: "Enter protected settings",
        instructions: "Enter the required values.",
        kind: "input",
        inputSlots: ["telegram.botToken"],
        approvalRequired: false,
      }],
    };
    const { rerender } = render(
      <ConnectorWorkflowGuide
        workflow={inputWorkflow}
        inputControls={{ "telegram.botToken": { content: <input aria-label="Protected token" />, valid: false } }}
      />,
    );

    expect(screen.getByRole("button", { name: /complete step/i })).toBeDisabled();
    rerender(
      <ConnectorWorkflowGuide
        workflow={inputWorkflow}
        inputControls={{ "telegram.botToken": { content: <input aria-label="Protected token" />, valid: true } }}
      />,
    );
    expect(screen.getByRole("button", { name: /complete step/i })).toBeEnabled();
  });

  it("renders and validates dependent controls from shared conditions", () => {
    const inputWorkflow: ConnectorWorkflow = {
      schema: "hypercli.connector-workflow.v1",
      connectorId: "telegram",
      runtimeFingerprint: "openclaw:telegram",
      summary: "Configure Telegram.",
      steps: [{
        id: "access",
        title: "Choose access",
        instructions: "Choose a policy and provide its required values.",
        kind: "input",
        inputSlots: ["telegram.dmPolicy", "telegram.allowFrom"],
        approvalRequired: false,
      }],
    };
    const dependentControl = {
      content: <input aria-label="Allowed users" />,
      valid: true,
      value: "",
      visibleWhen: {
        all: [{ inputSlot: "telegram.dmPolicy" as const, operator: "one-of" as const, values: ["allowlist", "pairing"] }],
      },
      requiredWhen: {
        all: [{ inputSlot: "telegram.dmPolicy" as const, operator: "equals" as const, value: "allowlist" }],
      },
      disclosureWhen: {
        all: [{ inputSlot: "telegram.dmPolicy" as const, operator: "equals" as const, value: "pairing" }],
      },
      disclosureLabel: "Pre-authorize a user",
    };
    const { rerender } = render(
      <ConnectorWorkflowGuide
        workflow={inputWorkflow}
        inputControls={{
          "telegram.dmPolicy": { content: <select aria-label="DM policy" />, valid: true, value: "pairing" },
          "telegram.allowFrom": dependentControl,
        }}
      />,
    );

    expect(screen.queryByRole("textbox", { name: "Allowed users" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /pre-authorize a user/i }));
    expect(screen.getByRole("textbox", { name: "Allowed users" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /complete step/i })).toBeEnabled();

    rerender(
      <ConnectorWorkflowGuide
        workflow={inputWorkflow}
        inputControls={{
          "telegram.dmPolicy": { content: <select aria-label="DM policy" />, valid: true, value: "allowlist" },
          "telegram.allowFrom": dependentControl,
        }}
      />,
    );
    expect(screen.getByRole("textbox", { name: "Allowed users" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /complete step/i })).toBeDisabled();

    rerender(
      <ConnectorWorkflowGuide
        workflow={inputWorkflow}
        inputControls={{
          "telegram.dmPolicy": { content: <select aria-label="DM policy" />, valid: true, value: "allowlist" },
          "telegram.allowFrom": { ...dependentControl, valid: true, value: "123456789" },
        }}
      />,
    );
    expect(screen.getByRole("button", { name: /complete step/i })).toBeEnabled();
  });

  it("renders and copies commands entered in external tools", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const telegramWorkflow: ConnectorWorkflow = {
      schema: "hypercli.connector-workflow.v1",
      connectorId: "telegram",
      runtimeFingerprint: "openclaw:telegram",
      summary: "Create a Telegram bot.",
      steps: [{
        id: "create-bot",
        title: "Create a new bot",
        instructions: "Send this command to the bot management chat.",
        kind: "action",
        url: "https://t.me/BotFather",
        externalCommand: "/newbot",
        approvalRequired: false,
      }],
    };
    render(<ConnectorWorkflowGuide workflow={telegramWorkflow} />);

    expect(screen.getByText("/newbot")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy external command /newbot" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("/newbot"));
    expect(screen.getByRole("button", { name: "Copy external command /newbot" })).toHaveTextContent("Copied");
    expect(screen.queryByRole("button", { name: /^approve$/i })).not.toBeInTheDocument();
  });

  it("renders and copies a suggested value independently from external commands", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const suggestionWorkflow: ConnectorWorkflow = {
      schema: "hypercli.connector-workflow.v1",
      connectorId: "slack",
      runtimeFingerprint: "openclaw:slack",
      summary: "Configure a workspace connection.",
      steps: [{
        id: "choose-label",
        title: "Choose a connection label",
        instructions: "Choose a recognizable label that can be changed later.",
        kind: "instruction",
        suggestedValue: "Customer support",
        approvalRequired: false,
      }],
    };
    render(<ConnectorWorkflowGuide workflow={suggestionWorkflow} />);

    expect(screen.getByText("Suggested value")).toBeInTheDocument();
    expect(screen.getByText("Customer support")).toBeInTheDocument();
    const copyButton = screen.getByRole("button", { name: "Copy suggested value Customer support" });
    fireEvent.click(copyButton);

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Customer support"));
    expect(copyButton).toHaveTextContent("Copied");
    expect(screen.queryByRole("button", { name: /copy external command/i })).not.toBeInTheDocument();
  });

  it("renders an official reference image and handles image failure", () => {
    const imageWorkflow: ConnectorWorkflow = {
      schema: "hypercli.connector-workflow.v1",
      connectorId: "github",
      runtimeFingerprint: "openclaw:github",
      summary: "Review the setup interface.",
      steps: [{
        id: "review-interface",
        title: "Review the interface",
        instructions: "Use the image as a visual reference.",
        kind: "instruction",
        referenceImage: {
          url: "https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png",
          alt: "Reference interface control",
          caption: "The highlighted area shows where to continue.",
        },
        approvalRequired: false,
      }],
    };
    render(<ConnectorWorkflowGuide workflow={imageWorkflow} />);

    const image = screen.getByAltText("Reference interface control");
    expect(image).toHaveAttribute("src", imageWorkflow.steps[0]?.referenceImage?.url);
    expect(screen.getByText("The highlighted area shows where to continue.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open reference image: reference interface control/i })).toHaveAttribute("href", imageWorkflow.steps[0]?.referenceImage?.url);

    fireEvent.error(image);
    expect(screen.getByRole("status", { name: /image unavailable/i })).toBeInTheDocument();
  });

  it("does not run a generated command until the user approves it", async () => {
    const onRunShellProposal = vi.fn(async () => undefined);
    render(<ConnectorWorkflowGuide workflow={workflow} onRunShellProposal={onRunShellProposal} />);

    expect(screen.getByText("apt-get install -y gh")).toBeInTheDocument();
    expect(onRunShellProposal).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /^approve$/i }));

    await waitFor(() => expect(onRunShellProposal).toHaveBeenCalledWith("apt-get install -y gh"));
    expect(screen.getByText("Approved")).toBeInTheDocument();
  });
});
