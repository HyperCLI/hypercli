import { describe, expect, it } from "vitest";

import { slackOAuthResultMessage } from "./page";

describe("slackOAuthResultMessage", () => {
  it("explains workspace ownership conflicts", () => {
    expect(slackOAuthResultMessage(false, "workspace_already_connected")).toContain(
      "already connected to another HyperCLI account",
    );
  });

  it("keeps the normal success copy", () => {
    expect(slackOAuthResultMessage(true, null)).toBe("Returning to settings in 10 seconds.");
  });
});
