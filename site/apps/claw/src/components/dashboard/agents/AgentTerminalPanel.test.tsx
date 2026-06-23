import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AgentTerminalPanel } from "./AgentTerminalPanel";

describe("AgentTerminalPanel", () => {
  it("uses shell-specific copy while connecting", () => {
    render(<AgentTerminalPanel status="connecting" shellBoxRef={createRef<HTMLDivElement>()} />);

    expect(screen.getByText("Connecting shell")).toBeInTheDocument();
    expect(screen.getByText("Opening a terminal session.")).toBeInTheDocument();
    expect(screen.queryByText("Connecting gateway")).not.toBeInTheDocument();
  });

  it("uses shell-specific copy while reconnecting", () => {
    render(<AgentTerminalPanel status="reconnecting" shellBoxRef={createRef<HTMLDivElement>()} />);

    expect(screen.getByText("Reconnecting shell")).toBeInTheDocument();
    expect(screen.getByText("Restoring the terminal session.")).toBeInTheDocument();
    expect(screen.queryByText("Reconnecting gateway")).not.toBeInTheDocument();
  });

  it("uses shell-specific copy while waiting", () => {
    render(<AgentTerminalPanel status="disconnected" shellBoxRef={createRef<HTMLDivElement>()} />);

    expect(screen.getByText("Waiting for shell")).toBeInTheDocument();
    expect(screen.getByText("The terminal will attach when the runtime is ready.")).toBeInTheDocument();
    expect(screen.queryByText("Waiting for gateway")).not.toBeInTheDocument();
  });
});
