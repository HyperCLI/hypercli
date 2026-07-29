import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AgentTerminalPanel } from "./AgentTerminalPanel";

describe("AgentTerminalPanel", () => {
  it("uses shell-specific copy while connecting", () => {
    render(<AgentTerminalPanel status="connecting" terminalReady={false} terminalError={null} shellBoxRef={createRef<HTMLDivElement>()} />);

    expect(screen.getByText("Connecting shell")).toBeInTheDocument();
    expect(screen.getByText("Opening a terminal session.")).toBeInTheDocument();
    expect(screen.queryByText("Connecting gateway")).not.toBeInTheDocument();
  });

  it("uses shell-specific copy while reconnecting", () => {
    render(<AgentTerminalPanel status="reconnecting" terminalReady={false} terminalError={null} shellBoxRef={createRef<HTMLDivElement>()} />);

    expect(screen.getByText("Reconnecting shell")).toBeInTheDocument();
    expect(screen.getByText("Restoring the terminal session.")).toBeInTheDocument();
    expect(screen.queryByText("Reconnecting gateway")).not.toBeInTheDocument();
  });

  it("uses shell-specific copy while waiting", () => {
    render(<AgentTerminalPanel status="disconnected" terminalReady={false} terminalError={null} shellBoxRef={createRef<HTMLDivElement>()} />);

    expect(screen.getByText("Waiting for shell")).toBeInTheDocument();
    expect(screen.getByText("The terminal will attach when the runtime is ready.")).toBeInTheDocument();
    expect(screen.queryByText("Waiting for gateway")).not.toBeInTheDocument();
  });

  it("keeps the loading state visible until the terminal is attached", () => {
    render(<AgentTerminalPanel status="connected" terminalReady={false} terminalError={null} shellBoxRef={createRef<HTMLDivElement>()} />);

    expect(screen.getByText("Preparing shell")).toBeInTheDocument();
    expect(screen.getByText("Attaching the terminal.")).toBeInTheDocument();
  });

  it("shows a terminal loading failure", () => {
    render(
      <AgentTerminalPanel
        status="connected"
        terminalReady={false}
        terminalError="The terminal could not be loaded."
        shellBoxRef={createRef<HTMLDivElement>()}
      />,
    );

    expect(screen.getByText("Unable to load shell")).toBeInTheDocument();
    expect(screen.getByText("The terminal could not be loaded.")).toBeInTheDocument();
    expect(screen.getByRole("alert", { name: /unable to load shell the terminal could not be loaded/i })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /agent workspace loading/i })).not.toBeInTheDocument();
  });

  it("removes a hidden prewarmed terminal from keyboard navigation", () => {
    const { container } = render(
      <AgentTerminalPanel
        status="connected"
        terminalReady
        terminalError={null}
        shellBoxRef={createRef<HTMLDivElement>()}
        visible={false}
      />,
    );

    expect(container.firstElementChild).toHaveAttribute("inert");
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });

  it("does not animate the loading state while the terminal is hidden", () => {
    render(
      <AgentTerminalPanel
        status="connecting"
        terminalReady={false}
        terminalError={null}
        shellBoxRef={createRef<HTMLDivElement>()}
        visible={false}
      />,
    );

    expect(screen.queryByText("Connecting shell")).not.toBeInTheDocument();
    expect(screen.queryByText("Opening a terminal session.")).not.toBeInTheDocument();
  });
});
