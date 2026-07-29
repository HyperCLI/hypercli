import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  OPENCLAW_BOOTSTRAP_PACK_VERSION,
  buildDeterministicOpenClawBootstrapPack,
  createDefaultOpenClawBootstrapInputs,
  type OpenClawBootstrapDraft,
  type OpenClawBootstrapFile,
} from "@/lib/openclaw-bootstrap-pack";

import { OpenClawBootstrapStep } from "./OpenClawBootstrapStep";

describe("OpenClawBootstrapStep", () => {
  it("keeps edits made while assisted generation is pending", async () => {
    let resolveGeneration!: (files: OpenClawBootstrapFile[]) => void;
    const pendingGeneration = new Promise<OpenClawBootstrapFile[]>((resolve) => {
      resolveGeneration = resolve;
    });
    const onGenerate = vi.fn(() => pendingGeneration);

    function Harness() {
      const inputs = React.useMemo(() => createDefaultOpenClawBootstrapInputs("Tern"), []);
      const [draft, setDraft] = React.useState<OpenClawBootstrapDraft>({
        version: OPENCLAW_BOOTSTRAP_PACK_VERSION,
        inputs,
        files: buildDeterministicOpenClawBootstrapPack(inputs),
        generationSource: "deterministic",
      });
      return (
        <OpenClawBootstrapStep
          agentName="Tern"
          draft={draft}
          onChange={setDraft}
          onGenerate={onGenerate}
        />
      );
    }

    render(<Harness />);
    await waitFor(() => expect(onGenerate).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText("What should it help with?"), {
      target: { value: "Investigate deployments without changing production." },
    });

    const modelFiles = buildDeterministicOpenClawBootstrapPack(
      createDefaultOpenClawBootstrapInputs("Tern"),
    ).map((file) => (
      file.name === "AGENTS.md" ? { ...file, content: "# AGENTS.md\n\nStale model result." } : file
    ));
    await act(async () => resolveGeneration(modelFiles));

    expect(screen.getByLabelText("What should it help with?"))
      .toHaveValue("Investigate deployments without changing production.");
    const agentsPreview = screen.getByLabelText("AGENTS.md preview") as HTMLTextAreaElement;
    expect(agentsPreview.value).toContain("Investigate deployments without changing production.");
    expect(agentsPreview.value).not.toContain("Stale model result.");
  });
});
