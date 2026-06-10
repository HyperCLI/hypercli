import { describe, expect, it } from "vitest";

import { buildJourneyBriefPrompt, buildJourneyPrompt } from "./journey-prompt-builder";

describe("journey prompt builder", () => {
  it("includes the preferred name in the first brief prompt", () => {
    const result = buildJourneyBriefPrompt({
      agentName: "Marlow",
      preferredName: "Ada",
      starterDirection: "Track project follow-ups",
    });

    expect(result.completionEvent).toBe("brief-started");
    expect(result.completionDayId).toBe("brief");
    expect(result.prompt).toContain("You are helping shape Marlow into a useful teammate.");
    expect(result.prompt).toContain("Address the user as: Ada");
    expect(result.prompt).toContain("Starting direction: Track project follow-ups");
  });

  it("marks empty mission fields as missing", () => {
    const result = buildJourneyPrompt({
      dayId: "sources",
      values: {
        source: " ",
        whyTrust: "Latest decision note",
      },
    });

    expect(result.prompt).toContain("Why this source matters: Latest decision note");
    expect(result.prompt).toContain("Missing details:");
    expect(result.prompt).toContain("- Source");
    expect(result.prompt).toContain("- What to look for");
    expect(result.prompt).toContain("- What to ignore");
  });

  it("does not treat placeholder examples as submitted data", () => {
    const result = buildJourneyPrompt({ dayId: "brief", values: {} });

    expect(result.prompt).toContain("No mission details provided yet.");
    expect(result.prompt).toContain("- Role or duty");
    expect(result.prompt).not.toContain("Keep the project moving and catch follow-ups.");
    expect(result.prompt).not.toContain("Clear summaries, risks, owners, and next steps.");
  });

  it("adds capability guidance only when a capability is selected", () => {
    const withoutCapability = buildJourneyPrompt({
      dayId: "real-work",
      capabilityContext: { hasImageAttachment: true },
    });
    const withCapability = buildJourneyPrompt({
      dayId: "real-work",
      selectedCapabilityId: "understand-images",
      capabilityContext: { hasImageAttachment: true },
    });

    expect(withoutCapability.prompt).not.toContain("Capability guidance:");
    expect(withCapability.prompt).toContain("Capability guidance:");
    expect(withCapability.prompt).toContain("Capability to consider: Understand image context");
    expect(withCapability.prompt).toContain("Current context includes an image attachment.");
    expect(withCapability.receiptText).toBe("Vision is now part of this mission.");
  });

  it("returns the mission completion event for each Journey day", () => {
    expect(buildJourneyPrompt({ dayId: "brief" }).completionEvent).toBe("brief-started");
    expect(buildJourneyPrompt({ dayId: "sources" }).completionEvent).toBe("source-added");
    expect(buildJourneyPrompt({ dayId: "rules" }).completionEvent).toBe("rules-confirmed");
    expect(buildJourneyPrompt({ dayId: "real-work" }).completionEvent).toBe("chat-sent");
    expect(buildJourneyPrompt({ dayId: "understanding" }).completionEvent).toBe("reviewed-understanding");
    expect(buildJourneyPrompt({ dayId: "connections" }).completionEvent).toBe("integrations-opened");
    expect(buildJourneyPrompt({ dayId: "repeatable" }).completionEvent).toBe("workflow-drafted");
  });
});
