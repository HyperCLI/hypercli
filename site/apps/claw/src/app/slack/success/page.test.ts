import { describe, expect, it } from "vitest";

import { normalizeSlackOAuthError, slackOAuthResultMessage } from "./page";

describe("slackOAuthResultMessage", () => {
  it("explains workspace ownership conflicts", () => {
    expect(slackOAuthResultMessage(false, "workspace_already_connected")).toContain(
      "already connected to another HyperCLI account",
    );
  });

  it("keeps the normal success copy", () => {
    expect(slackOAuthResultMessage(true, null)).toBe("Returning to settings in 10 seconds.");
  });

  it("does not surface raw OAuth query details in the recovery copy", () => {
    expect(slackOAuthResultMessage(false, "access_denied&code=private-code")).toBe(
      "Returning to settings in 10 seconds so you can retry or inspect status.",
    );
  });

  it("only forwards recognized OAuth outcomes", () => {
    expect(normalizeSlackOAuthError("access_denied")).toBe("access_denied");
    expect(normalizeSlackOAuthError("code=private-code&body={raw}")).toBeNull();
  });
});
