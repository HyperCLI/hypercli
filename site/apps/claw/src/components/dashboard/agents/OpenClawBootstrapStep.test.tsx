import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  OPENCLAW_BOOTSTRAP_PACK_VERSION,
  buildDeterministicOpenClawBootstrapPack,
  createDefaultOpenClawBootstrapInputs,
  type OpenClawBootstrapDraft,
} from "@/lib/openclaw-bootstrap-pack";
import { OpenClawBootstrapStep, type OpenClawBootstrapStage } from "./OpenClawBootstrapStep";

describe("OpenClawBootstrapStep", () => {
  it("renders one form panel while rebuilding workspace files behind it", () => {
    let latestDraft: OpenClawBootstrapDraft | null = null;

    function Harness({ stage }: { stage: OpenClawBootstrapStage }) {
      const inputs = React.useMemo(() => createDefaultOpenClawBootstrapInputs("Tern"), []);
      const [draft, setDraft] = React.useState<OpenClawBootstrapDraft>({
        version: OPENCLAW_BOOTSTRAP_PACK_VERSION,
        inputs,
        files: buildDeterministicOpenClawBootstrapPack(inputs),
        generationSource: "deterministic",
      });
      latestDraft = draft;
      return (
        <OpenClawBootstrapStep
          agentName="Tern"
          draft={draft}
          onChange={setDraft}
          stage={stage}
          wide
        />
      );
    }

    const view = render(<Harness stage="objective" />);

    expect(screen.getByRole("heading", { name: "What do you want to get done?" })).toBeInTheDocument();
    expect(screen.getByText(/It will figure out how to help make it happen/)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Workspace file editor" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Workspace files" })).not.toBeInTheDocument();
    expect(view.container.querySelectorAll('[data-slot="openclaw-bootstrap-step"] > section')).toHaveLength(1);
    expect(document.querySelector('[data-slot="openclaw-bootstrap-step"]')).toHaveClass(
      "min-h-full",
      "xl:h-full",
      "xl:min-h-0",
    );

    expect(screen.getByLabelText("Role and outcome")).toHaveAttribute("maxlength", "300");
    fireEvent.click(screen.getByRole("button", { name: /^Build a product/ }));
    expect(screen.getByLabelText("Role and outcome")).toHaveValue("Build a product. Turn an idea into working software.");
    expect(latestDraft!.files.find((file) => file.name === "AGENTS.md")?.content)
      .toContain("Build a product. Turn an idea into working software.");

    fireEvent.change(screen.getByLabelText("Role and outcome"), {
      target: { value: "Investigate deployments without changing production." },
    });

    expect(screen.getByLabelText("Role and outcome"))
      .toHaveValue("Investigate deployments without changing production.");
    expect(latestDraft!.files.find((file) => file.name === "AGENTS.md")?.content)
      .toContain("Investigate deployments without changing production.");
    expect(latestDraft!.files.find((file) => file.name === "SOUL.md")?.content)
      .toContain("Investigate deployments without changing production.");

    view.rerender(<Harness stage="personality" />);
    expect(screen.getByRole("heading", { name: "How should Tern approach the work?" })).toBeInTheDocument();
    expect(screen.getByLabelText("Working style")).toHaveAttribute("maxlength", "300");

    fireEvent.click(screen.getByRole("button", { name: /^The Operator/ }));
    expect(screen.getByLabelText("Working style")).toHaveValue(
      "Be a relentless operator who moves fast, challenges my assumptions, and does not need much hand-holding.",
    );
    expect(latestDraft!.files.find((file) => file.name === "SOUL.md")?.content)
      .toContain("Be a relentless operator who moves fast, challenges my assumptions, and does not need much hand-holding.");

    const optionalContext = screen.getByText("Personal and work context").closest("details");
    expect(optionalContext).not.toHaveAttribute("open");
    fireEvent.click(optionalContext!.querySelector("summary")!);
    expect(optionalContext).toHaveAttribute("open");
    expect(screen.getByLabelText("Preferred name")).toBeInTheDocument();
  });
});
