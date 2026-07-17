import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithClient } from "@/test/utils";
import { SkillDraftTestBanner } from "./SkillDraftTestBanner";

const testSession = {
  id: "release-helper:session-test",
  draftId: "release-helper",
  revisionId: "release-helper:abc123",
  skillId: "release-helper",
  skillName: "Release Helper",
  requestedSessionKey: "session-test",
  testedAt: 1,
};

describe("SkillDraftTestBanner", () => {
  it("opens the draft and saves it from the test session", async () => {
    const onOpenDraft = vi.fn();
    const onSaveDraft = vi.fn(async () => undefined);
    renderWithClient(<SkillDraftTestBanner testSession={testSession} onOpenDraft={onOpenDraft} onSaveDraft={onSaveDraft} />);

    expect(screen.getByText("Testing draft: Release Helper")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /open draft/i }));
    fireEvent.click(screen.getByRole("button", { name: /save to agent/i }));

    expect(onOpenDraft).toHaveBeenCalledOnce();
    await waitFor(() => expect(onSaveDraft).toHaveBeenCalledOnce());
  });
});
