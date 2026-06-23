import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AgentLogsPanel } from "./AgentLogsPanel";

describe("AgentLogsPanel", () => {
  it("uses logs-specific copy while connecting", () => {
    render(<AgentLogsPanel status="connecting" logs={[]} logBoxRef={createRef<HTMLDivElement>()} />);

    expect(screen.getByText("Connecting logs")).toBeInTheDocument();
    expect(screen.getByText("Opening the runtime log stream.")).toBeInTheDocument();
    expect(screen.queryByText("Connecting gateway")).not.toBeInTheDocument();
  });

  it("uses logs-specific copy while reconnecting", () => {
    render(<AgentLogsPanel status="reconnecting" logs={[]} logBoxRef={createRef<HTMLDivElement>()} />);

    expect(screen.getByText("Reconnecting logs")).toBeInTheDocument();
    expect(screen.getByText("Restoring the runtime log stream.")).toBeInTheDocument();
    expect(screen.queryByText("Reconnecting gateway")).not.toBeInTheDocument();
  });

  it("uses logs-specific copy while waiting", () => {
    render(<AgentLogsPanel status="disconnected" logs={[]} logBoxRef={createRef<HTMLDivElement>()} />);

    expect(screen.getByText("Waiting for logs")).toBeInTheDocument();
    expect(screen.getByText("Logs will attach when the runtime is ready.")).toBeInTheDocument();
    expect(screen.queryByText("Waiting for gateway")).not.toBeInTheDocument();
  });

  it("uses neutral empty copy after the log stream connects", () => {
    render(<AgentLogsPanel status="connected" logs={[]} logBoxRef={createRef<HTMLDivElement>()} />);

    expect(screen.getByText("Connected. Waiting for log lines.")).toBeInTheDocument();
    expect(screen.queryByText(/Gateway connected/i)).not.toBeInTheDocument();
  });
});
