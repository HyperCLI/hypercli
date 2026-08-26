import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Agent } from "@/app/dashboard/agents/types";
import { AgentDisplayNameEditor } from "./AgentDisplayNameEditor";

const agent = {
  id: "agent-1",
  name: "Research Agent",
  displayName: "Research Agent",
  state: "RUNNING",
} as Agent;

describe("AgentDisplayNameEditor", () => {
  it("requests access before saving and preserves the draft when blocked", () => {
    const onUpdate = vi.fn(async () => undefined);
    const onRequestProductUse = vi.fn(() => false);
    render(
      <AgentDisplayNameEditor
        agent={agent}
        onUpdate={onUpdate}
        onRequestProductUse={onRequestProductUse}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit agent display name" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Agent display name" }), {
      target: { value: "Growth Agent" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save agent display name" }));

    expect(onRequestProductUse).toHaveBeenCalledOnce();
    expect(onUpdate).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Agent display name" })).toHaveValue("Growth Agent");
  });
});
