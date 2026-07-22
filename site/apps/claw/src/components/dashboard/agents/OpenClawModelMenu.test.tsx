import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithClient } from "@/test/utils";
import { OpenClawModelMenu } from "./OpenClawModelMenu";

const originalScrollIntoView = Element.prototype.scrollIntoView;

beforeEach(() => {
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: originalScrollIntoView,
  });
});

function buildChat(overrides: Partial<Parameters<typeof OpenClawModelMenu>[0]["chat"]> = {}) {
  return {
    activeSessionModel: null,
    activeSessionThinkingLevel: null,
    activeSessionThinkingLevels: [
      { id: "off", label: "Off" },
      { id: "medium", label: "Medium" },
    ],
    activeSessionThinkingDefault: "off",
    config: {
      agents: { defaults: { model: { primary: "openai/gpt-5-mini" } } },
      models: {
        providers: {
          openai: {
            name: "OpenAI",
            models: [{ id: "gpt-5-mini", name: "GPT-5 Mini" }],
          },
        },
      },
    },
    models: [
      { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5", providerId: "anthropic", providerName: "Anthropic" },
    ],
    saveConfig: vi.fn(async () => undefined),
    setActiveSessionModel: vi.fn(async () => undefined),
    setActiveSessionThinkingLevel: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("OpenClawModelMenu", () => {
  it("lists gateway variants and changes them independently from the model", async () => {
    const chat = buildChat({
      config: {
        agents: {
          defaults: {
            model: { primary: "hypercli/kimi-k2.6-anthropic" },
          },
        },
        models: {
          providers: {
            hypercli: {
              name: "hypercli",
              models: [
                { id: "kimi-k2.6-anthropic", name: "Kimi K2.6" },
                { id: "glm-5-anthropic", name: "GLM-5" },
              ],
            },
          },
        },
      },
      models: [],
      activeSessionThinkingLevel: "low",
      activeSessionThinkingLevels: [
        { id: "low", label: "Fast" },
        { id: "medium", label: "Medium" },
      ],
      activeSessionThinkingDefault: "low",
    });
    const { rerender } = renderWithClient(<OpenClawModelMenu chat={chat} />);

    const trigger = screen.getByRole("button", { name: "Model: Kimi K2.6, Fast" });
    expect(within(trigger).getByText("Kimi K2.6")).toHaveClass("text-[var(--selection-accent)]");
    expect(within(trigger).getByText("Fast")).toHaveClass("text-text-muted");

    fireEvent.click(trigger);
    const menuOptions = screen.getAllByRole("option");
    expect(menuOptions[0]).toHaveAccessibleName("Variant: Fast");
    expect(menuOptions[1]).toHaveAccessibleName("Variant: Medium");
    const selectedOption = screen.getByRole("option", { name: "Kimi K2.6" });
    expect(selectedOption).toHaveClass("data-[selected=true]:!bg-surface-high");
    expect(within(selectedOption).getByText("Kimi K2.6")).toHaveClass("text-[var(--selection-accent)]");

    const mediumOption = screen.getByRole("option", { name: "Variant: Medium" });
    expect(within(mediumOption).getByText("Medium")).toHaveClass("text-text-muted");
    fireEvent.click(mediumOption);

    await waitFor(() => expect(chat.setActiveSessionThinkingLevel).toHaveBeenCalledWith("medium"));
    expect(chat.setActiveSessionModel).not.toHaveBeenCalled();
    rerender(<OpenClawModelMenu chat={{ ...chat, activeSessionThinkingLevel: "medium" }} />);
    const updatedTrigger = screen.getByRole("button", { name: "Model: Kimi K2.6, Medium" });
    expect(within(updatedTrigger).getByText("Kimi K2.6")).toHaveClass("text-[var(--selection-accent)]");
    expect(within(updatedTrigger).getByText("Medium")).toHaveClass("text-text-muted");
  });

  it("lists and selects a model for the active conversation without search", async () => {
    const chat = buildChat();
    renderWithClient(<OpenClawModelMenu chat={chat} />);

    fireEvent.click(screen.getByRole("button", { name: /model: gpt-5 mini/i }));
    expect(screen.queryByRole("combobox", { name: "Search models" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "Claude Sonnet 4.5" }));

    await waitFor(() => expect(chat.setActiveSessionModel).toHaveBeenCalledWith("anthropic/claude-sonnet-4-5"));
  });

  it("adds a model to a configured provider and selects it", async () => {
    const chat = buildChat();
    renderWithClient(<OpenClawModelMenu chat={chat} />);

    fireEvent.click(screen.getByRole("button", { name: /model: gpt-5 mini/i }));
    fireEvent.click(screen.getByText("Add new model"));

    expect(screen.getByRole("dialog", { name: "Add model" })).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("claude-sonnet-4-5"), { target: { value: "gpt-5.2" } });
    fireEvent.click(screen.getByRole("button", { name: "Add model" }));

    await waitFor(() => expect(chat.saveConfig).toHaveBeenCalledWith({
      models: {
        providers: {
          openai: {
            models: [
              { id: "gpt-5-mini", name: "GPT-5 Mini" },
              { id: "gpt-5.2", name: "gpt-5.2" },
            ],
          },
        },
      },
    }));
    expect(chat.setActiveSessionModel).toHaveBeenCalledWith("openai/gpt-5.2");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add model" })).not.toBeInTheDocument());
  });

  it("directs users to settings when no provider is configured", () => {
    const onOpenSettings = vi.fn();
    const chat = buildChat({ config: { agents: { defaults: {} } }, models: [] });
    renderWithClient(<OpenClawModelMenu chat={chat} onOpenSettings={onOpenSettings} />);

    fireEvent.click(screen.getByRole("button", { name: /model: choose model/i }));
    fireEvent.click(screen.getByText("Add new model"));
    fireEvent.click(screen.getByRole("button", { name: "Open model provider settings" }));

    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });
});
