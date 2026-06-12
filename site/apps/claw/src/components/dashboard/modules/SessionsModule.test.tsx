import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SessionsModule } from "./SessionsModule";

describe("SessionsModule", () => {
  it("marks sessions started from connected chat channels", () => {
    render(
      <SessionsModule
        sessions={[
          {
            key: "telegram:489595440",
            clientMode: "openclaw",
            clientDisplayName: "Telegram DM",
            createdAt: 1,
            lastMessageAt: 30,
            sourceChannelId: "telegram",
          },
          {
            key: "session-openai",
            clientMode: "openclaw",
            clientDisplayName: "Model-side session",
            createdAt: 1,
            lastMessageAt: 20,
            sourceChannelId: "openai",
          },
        ]}
      />,
    );

    expect(screen.getByTitle("Telegram channel")).toBeInTheDocument();
    expect(screen.queryByTitle("OpenAI channel")).not.toBeInTheDocument();
    expect(screen.getByText("Telegram")).toBeInTheDocument();
    expect(screen.getByText("Model-side session")).toBeInTheDocument();
  });
});
