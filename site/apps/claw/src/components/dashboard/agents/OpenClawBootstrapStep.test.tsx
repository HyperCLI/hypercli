import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
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
  it("renders real per-file FSM progress and keeps structured edits in the parent draft", () => {
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
        />
      );
    }

    render(<Harness />);

    expect(screen.getByText("AGENTS.md ready")).toBeInTheDocument();
    expect(screen.getByText("Generating SOUL.md")).toBeInTheDocument();
    expect(screen.getByText("USER.md queued")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restart generation" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("What should it help with?"), {
      target: { value: "Investigate deployments without changing production." },
    });

    expect(screen.getByLabelText("What should it help with?"))
      .toHaveValue("Investigate deployments without changing production.");
    expect((screen.getByLabelText("AGENTS.md preview") as HTMLTextAreaElement).value)
      .toContain("Investigate deployments without changing production.");

    fireEvent.click(screen.getByRole("button", { name: "Restart generation" }));
    expect(onRegenerate).toHaveBeenCalledTimes(1);
  });
});
