import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { expectNoA11yViolations, renderWithClient } from "@/test/utils";
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
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-color-mode");
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
    setActiveSessionModel: vi.fn(async () => undefined),
    setActiveSessionThinkingLevel: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("OpenClawModelMenu", () => {
  it("only references the model menu while its content is mounted", async () => {
    const chat = buildChat();
    renderWithClient(<OpenClawModelMenu chat={chat} compactTrigger />);

    const trigger = screen.getByRole("button", { name: "Variant: Off, model: GPT-5 Mini" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).not.toHaveAttribute("aria-controls");

    fireEvent.click(trigger);
    const menu = screen.getByRole("dialog", { name: "Choose conversation model" });
    const menuId = trigger.getAttribute("aria-controls");
    expect(menuId).toBeTruthy();
    expect(menu).toHaveAttribute("id", menuId);

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => {
      expect(trigger).toHaveAttribute("aria-expanded", "false");
      expect(trigger).not.toHaveAttribute("aria-controls");
    });
  });

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
                { id: "kimi-k3-anthropic", name: "Kimi K3" },
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

    const trigger = screen.getByRole("button", { name: "Model: Kimi K2.6" });
    expect(within(trigger).getByText("Kimi K2.6")).toHaveClass("text-foreground");
    expect(within(trigger).queryByText("Fast")).not.toBeInTheDocument();

    fireEvent.click(trigger);
    const menuOptions = screen.getAllByRole("option");
    expect(menuOptions[0]).toHaveAccessibleName("Variant: Fast, current");
    expect(menuOptions[1]).toHaveAccessibleName("Variant: Medium");
    const selectedOption = screen.getByRole("option", { name: "Kimi K2.6 (hypercli), current" });
    expect(selectedOption).toHaveClass("data-[selected=true]:!bg-surface-high");
    expect(within(selectedOption).getByText("Kimi K2.6")).toHaveClass("text-foreground");

    const mediumOption = screen.getByRole("option", { name: "Variant: Medium" });
    expect(within(mediumOption).getByText("Medium")).toHaveClass("text-text-muted");
    fireEvent.click(mediumOption);

    await waitFor(() => expect(chat.setActiveSessionThinkingLevel).toHaveBeenCalledWith("medium"));
    expect(chat.setActiveSessionModel).not.toHaveBeenCalled();
    rerender(<OpenClawModelMenu chat={{ ...chat, activeSessionThinkingLevel: "medium" }} />);
    const updatedTrigger = screen.getByRole("button", { name: "Model: Kimi K2.6" });
    expect(within(updatedTrigger).getByText("Kimi K2.6")).toHaveClass("text-foreground");
    expect(within(updatedTrigger).queryByText("Medium")).not.toBeInTheDocument();
  });

  it("uses the current variant as the compact trigger label and changes it directly", async () => {
    const chat = buildChat({
      activeSessionModel: "openai/gpt-5-mini",
      activeSessionThinkingLevel: "medium",
      activeSessionThinkingDefault: "off",
    });
    renderWithClient(<OpenClawModelMenu chat={chat} compactTrigger />);

    const trigger = screen.getByRole("button", { name: "Variant: Medium, model: GPT-5 Mini" });
    expect(trigger).toHaveClass("bg-surface-high");
    expect(within(trigger).getByText("Medium")).toHaveClass("text-text-secondary");
    expect(within(trigger).queryByText("GPT-5 Mini")).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute("title", "Medium variant, GPT-5 Mini");

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("option", { name: "Variant: Off" }));

    await waitFor(() => expect(chat.setActiveSessionThinkingLevel).toHaveBeenCalledWith("off"));
    expect(chat.setActiveSessionModel).not.toHaveBeenCalled();
  });

  it.each([
    ["aurora-light", "light"],
    ["aurora-dark", "dark"],
  ] as const)("keeps the compact model label accessible in the %s theme", async (theme, mode) => {
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.setAttribute("data-color-mode", mode);
    const chat = buildChat({
      activeSessionModel: "openai/gpt-5-mini",
      activeSessionThinkingLevel: "medium",
    });
    const { container } = renderWithClient(<OpenClawModelMenu chat={chat} compactTrigger />);

    const trigger = screen.getByRole("button", { name: "Variant: Medium, model: GPT-5 Mini" });
    expect(within(trigger).getByText("Medium")).toHaveClass("text-text-secondary");
    await expectNoA11yViolations(container);
  });

  it("lists and selects a model for the active conversation without search", async () => {
    const chat = buildChat();
    renderWithClient(<OpenClawModelMenu chat={chat} />);

    fireEvent.click(screen.getByRole("button", { name: /model: gpt-5 mini/i }));
    expect(screen.queryByRole("combobox", { name: "Search models" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "Claude Sonnet 4.5 (Anthropic)" }));

    await waitFor(() => expect(chat.setActiveSessionModel).toHaveBeenCalledWith("anthropic/claude-sonnet-4-5"));
  });

  it("does not offer persistent model additions", () => {
    const chat = buildChat();
    renderWithClient(<OpenClawModelMenu chat={chat} />);

    fireEvent.click(screen.getByRole("button", { name: /model: gpt-5 mini/i }));

    expect(screen.queryByText("Add new model")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Add model" })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Claude Sonnet 4.5 (Anthropic)" })).toBeInTheDocument();
  });
});
