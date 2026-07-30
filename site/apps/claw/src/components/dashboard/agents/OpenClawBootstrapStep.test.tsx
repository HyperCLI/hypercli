import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  OPENCLAW_BOOTSTRAP_PACK_VERSION,
  buildDeterministicOpenClawBootstrapPack,
  createDefaultOpenClawBootstrapInputs,
  type OpenClawBootstrapDraft,
} from "@/lib/openclaw-bootstrap-pack";
import type { OpenClawBootstrapGenerationState } from "./openclaw-bootstrap-generation-machine";
import { OpenClawBootstrapStep } from "./OpenClawBootstrapStep";

describe("OpenClawBootstrapStep", () => {
  it("previews generated files from tabs and saves raw edits to the parent draft", async () => {
    const onRegenerate = vi.fn();

    function Harness() {
      const inputs = React.useMemo(() => createDefaultOpenClawBootstrapInputs("Tern"), []);
      const [draft, setDraft] = React.useState<OpenClawBootstrapDraft>({
        version: OPENCLAW_BOOTSTRAP_PACK_VERSION,
        inputs,
        files: buildDeterministicOpenClawBootstrapPack(inputs),
        generationSource: "deterministic",
      });
      const generation: OpenClawBootstrapGenerationState = {
        runId: 1,
        files: {
          "AGENTS.md": { status: "ready" },
          "SOUL.md": { status: "generating" },
          "USER.md": { status: "queued" },
        },
      };
      return (
        <OpenClawBootstrapStep
          agentName="Tern"
          draft={draft}
          onChange={setDraft}
          generation={generation}
          onRegenerate={onRegenerate}
          wide
        />
      );
    }

    render(<Harness />);

    expect(screen.queryByText("AGENTS.md ready")).not.toBeInTheDocument();
    expect(screen.queryByText("Generating SOUL.md")).not.toBeInTheDocument();
    expect(screen.queryByText("USER.md queued")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restart generation" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Shape the agent" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Generated workspace files" })).toBeInTheDocument();
    expect(screen.getByText("Describe its main goals, recurring tasks, and important limits.")).toBeInTheDocument();
    const fileTabs = screen.getByRole("group", { name: "Generated workspace files" });
    expect(within(fileTabs).getAllByRole("button")).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Preview" })).toHaveAttribute("aria-pressed", "true");
    expect(document.querySelector('[data-slot="openclaw-bootstrap-step"]')).toHaveClass(
      "min-h-full",
      "xl:h-full",
      "xl:min-h-0",
      "xl:grid-cols-[minmax(320px,0.9fr)_minmax(400px,1.1fr)]",
      "xl:grid-rows-[minmax(0,1fr)]",
    );

    fireEvent.change(screen.getByLabelText("What should this agent help you accomplish?"), {
      target: { value: "Investigate deployments without changing production." },
    });

    expect(screen.getByLabelText("What should this agent help you accomplish?"))
      .toHaveValue("Investigate deployments without changing production.");
    expect(screen.getByText("Investigate deployments without changing production.", { selector: "p" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Raw" }));
    const rawEditor = screen.getByLabelText("AGENTS.md contents") as HTMLTextAreaElement;
    expect(rawEditor.value)
      .toContain("Investigate deployments without changing production.");
    fireEvent.change(rawEditor, { target: { value: "# Custom operating instructions" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(screen.getByRole("heading", { name: "Custom operating instructions" })).toBeInTheDocument();

    fireEvent.click(within(fileTabs).getByRole("button", { name: "SOUL.md" }));
    expect(screen.getByRole("button", { name: "Preview" })).toHaveAttribute("aria-pressed", "true");

    const optionalContext = screen.getByText("Personal and work context").closest("details");
    expect(optionalContext).not.toHaveAttribute("open");
    fireEvent.click(optionalContext!.querySelector("summary")!);
    expect(optionalContext).toHaveAttribute("open");
    expect(screen.getByLabelText("Preferred name")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Restart generation" }));
    expect(onRegenerate).toHaveBeenCalledTimes(1);
  });
});
