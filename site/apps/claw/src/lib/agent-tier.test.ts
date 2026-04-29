import { describe, expect, it } from "vitest";
import {
  describeAgentTierStartGuidance,
  describeAgentsPageError,
  getAgentSizePresets,
  inferAgentTier,
  parseEntitlementSlotTier,
  titleizeTier,
} from "./agent-tier";
import { buildAgentBudget } from "@/test/factories";
import type { Agent } from "@/app/dashboard/agents/types";

const largeAgent: Pick<Agent, "cpu_millicores" | "memory_mib"> = {
  cpu_millicores: 4000,
  memory_mib: 4096,
};

describe("agent tier helpers", () => {
  it("infers agent tier from budget presets", () => {
    expect(inferAgentTier(largeAgent, buildAgentBudget())).toBe("large");
    expect(inferAgentTier({ cpu_millicores: 1000, memory_mib: 1024 }, null)).toBe("small");
    expect(inferAgentTier({ cpu_millicores: 9000, memory_mib: 1024 }, buildAgentBudget())).toBeNull();
  });

  it("describes a suggested resize when another tier has available capacity", () => {
    const guidance = describeAgentTierStartGuidance(
      largeAgent,
      buildAgentBudget({
        slots: {
          small: { granted: 2, used: 0, available: 2 },
          medium: { granted: 1, used: 0, available: 1 },
          large: { granted: 1, used: 1, available: 0 },
        },
      }),
    );

    expect(guidance).toMatchObject({
      tier: "large",
      suggestedTier: "small",
      title: "Large slot required",
      availableTiers: [
        { tier: "small", available: 2 },
        { tier: "medium", available: 1 },
      ],
    });
    expect(guidance?.message).toContain("2 free Small slots available");
  });

  it("describes exhausted and missing tier capacity", () => {
    const exhausted = describeAgentTierStartGuidance(
      largeAgent,
      buildAgentBudget({
        slots: {
          large: { granted: 1, used: 1, available: 0 },
        },
      }),
    );
    expect(exhausted?.title).toBe("Large slots are fully used");
    expect(exhausted?.suggestedTier).toBeNull();

    const missing = describeAgentTierStartGuidance(
      largeAgent,
      buildAgentBudget({
        slots: {
          large: { granted: 0, used: 0, available: 0 },
        },
      }),
    );
    expect(missing?.message).toContain("does not currently include any Large slots");
  });

  it("parses entitlement errors and normalizes page errors", () => {
    expect(parseEntitlementSlotTier(new Error("No available 'large' entitlement slots"))).toBe("large");
    expect(parseEntitlementSlotTier("No available small entitlement slots")).toBe("small");
    expect(parseEntitlementSlotTier("Other error")).toBeNull();

    expect(describeAgentsPageError(new Error("Agent cluster is not assigned"))).toEqual({
      clusterUnavailable: true,
      message: "Agent cluster assignment is still pending for this account. Try again in a minute.",
    });
    expect(describeAgentsPageError("Boom")).toEqual({
      clusterUnavailable: false,
      message: "Boom",
    });
    expect(describeAgentsPageError("   ")).toEqual({
      clusterUnavailable: false,
      message: "Failed to load agents",
    });
  });

  it("titleizes tier names", () => {
    expect(titleizeTier("extra-large")).toBe("Extra Large");
  });

  it("handles no-op guidance and fallback presets", () => {
    expect(describeAgentTierStartGuidance(null, buildAgentBudget())).toBeNull();
    expect(describeAgentTierStartGuidance(largeAgent, null)).toBeNull();
    expect(describeAgentTierStartGuidance({ cpu_millicores: 9000, memory_mib: 4096 }, buildAgentBudget())).toBeNull();
    expect(
      describeAgentTierStartGuidance(
        { cpu_millicores: 1000, memory_mib: 1024 },
        buildAgentBudget({
          slots: {
            small: { granted: 1, used: 0, available: 1 },
          },
        }),
      ),
    ).toBeNull();

    expect(getAgentSizePresets(null).medium).toEqual({
      cpu_millicores: 2000,
      memory_mib: 2048,
    });
    expect(
      getAgentSizePresets(
        buildAgentBudget({
          size_presets: {
            tiny: { cpu: 0, memory: 0 },
          },
        }),
      ).tiny,
    ).toEqual({ cpu_millicores: 0, memory_mib: 0 });
  });
});
