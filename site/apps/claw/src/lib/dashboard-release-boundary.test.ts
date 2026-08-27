import { describe, expect, it } from "vitest";

import {
  DASHBOARD_RELEASE_AVAILABILITY,
  SCHEDULED_MANAGER_ENABLED,
  isDashboardReleaseSurfaceAvailable,
  normalizeDashboardReleaseSearchParams,
  type DashboardReleaseAvailability,
} from "./dashboard-release-boundary";

const ALL_AVAILABLE: DashboardReleaseAvailability = {
  "hermes-launcher": true,
  "knowledge-hub": true,
  members: true,
};

const ALL_DISABLED: DashboardReleaseAvailability = {
  "hermes-launcher": false,
  "knowledge-hub": false,
  members: false,
};

describe("DASHBOARD_RELEASE_AVAILABILITY", () => {
  it("ships the Schedule manager as a coming-soon preview", () => {
    expect(SCHEDULED_MANAGER_ENABLED).toBe(false);
  });

  it("ships with Hermes launcher, Knowledge Hub, and Members disabled for this release", () => {
    expect(DASHBOARD_RELEASE_AVAILABILITY).toEqual({
      "hermes-launcher": false,
      "knowledge-hub": false,
      members: false,
    });
  });

  it("exposes exactly the three gated surfaces", () => {
    expect(Object.keys(DASHBOARD_RELEASE_AVAILABILITY).sort()).toEqual(["hermes-launcher", "knowledge-hub", "members"]);
  });
});

describe("isDashboardReleaseSurfaceAvailable", () => {
  it("reports all surfaces unavailable under the shipped policy", () => {
    expect(isDashboardReleaseSurfaceAvailable("hermes-launcher")).toBe(false);
    expect(isDashboardReleaseSurfaceAvailable("knowledge-hub")).toBe(false);
    expect(isDashboardReleaseSurfaceAvailable("members")).toBe(false);
  });

  it("reports surfaces available when the injected availability allows them", () => {
    expect(isDashboardReleaseSurfaceAvailable("hermes-launcher", ALL_AVAILABLE)).toBe(true);
    expect(isDashboardReleaseSurfaceAvailable("knowledge-hub", ALL_AVAILABLE)).toBe(true);
    expect(isDashboardReleaseSurfaceAvailable("members", ALL_AVAILABLE)).toBe(true);
  });

  it("supports re-enabling a single surface independently", () => {
    const knowledgeOnly: DashboardReleaseAvailability = { "hermes-launcher": false, "knowledge-hub": true, members: false };
    expect(isDashboardReleaseSurfaceAvailable("knowledge-hub", knowledgeOnly)).toBe(true);
    expect(isDashboardReleaseSurfaceAvailable("hermes-launcher", knowledgeOnly)).toBe(false);
    expect(isDashboardReleaseSurfaceAvailable("members", knowledgeOnly)).toBe(false);
  });
});

describe("normalizeDashboardReleaseSearchParams", () => {
  it("returns null when nothing needs to change", () => {
    expect(normalizeDashboardReleaseSearchParams(new URLSearchParams(""))).toBeNull();
    expect(normalizeDashboardReleaseSearchParams(new URLSearchParams("view=overview"))).toBeNull();
    expect(normalizeDashboardReleaseSearchParams(new URLSearchParams("settings=profile"))).toBeNull();
  });

  it("strips section=knowledge-hub along with legacy and current collection params", () => {
    const normalized = normalizeDashboardReleaseSearchParams(
      new URLSearchParams("section=knowledge-hub&collectionId=col-1&domainId=legacy-1"),
    );
    expect(normalized).not.toBeNull();
    expect(normalized?.toString()).toBe("");
  });

  it("strips section=members but preserves unrelated params", () => {
    const normalized = normalizeDashboardReleaseSearchParams(
      new URLSearchParams("section=members&agentId=agent-1&session=main"),
    );
    expect(normalized?.get("section")).toBeNull();
    expect(normalized?.get("agentId")).toBe("agent-1");
    expect(normalized?.get("session")).toBe("main");
  });

  it("strips settings=members while preserving the settings view", () => {
    const normalized = normalizeDashboardReleaseSearchParams(
      new URLSearchParams("view=settings&settings=members&agentId=agent-1"),
    );
    expect(normalized?.get("settings")).toBeNull();
    expect(normalized?.get("view")).toBe("settings");
    expect(normalized?.get("agentId")).toBe("agent-1");
  });

  it("strips the Collections settings section while Knowledge Hub is disabled", () => {
    const normalized = normalizeDashboardReleaseSearchParams(
      new URLSearchParams("view=settings&settings=workspace&agentId=agent-1"),
    );
    expect(normalized?.get("settings")).toBeNull();
    expect(normalized?.get("view")).toBe("settings");
    expect(normalized?.get("agentId")).toBe("agent-1");
  });

  it("strips the Collections-backed shared knowledge section while Knowledge Hub is disabled", () => {
    // section=knowledge routes to SharedKnowledgeSection, whose content is
    // entirely Collection-scoped. While Knowledge Hub is hidden the Workspace
    // provider performs no transport, so the section can only render permanent
    // Collection copy and a misleading "not connected" error. The URL
    // normalizer must strip it exactly like section=knowledge-hub.
    const normalized = normalizeDashboardReleaseSearchParams(
      new URLSearchParams("section=knowledge&agentId=agent-1&collectionId=col-1&domainId=legacy-1"),
    );
    expect(normalized?.get("section")).toBeNull();
    expect(normalized?.get("agentId")).toBe("agent-1");
    expect(normalized?.get("collectionId")).toBeNull();
    expect(normalized?.get("domainId")).toBeNull();

    // The dormant section must remain routable when the surface is re-enabled.
    expect(
      normalizeDashboardReleaseSearchParams(
        new URLSearchParams("section=knowledge&agentId=agent-1"),
        ALL_AVAILABLE,
      ),
    ).toBeNull();
  });

  it("tolerates surrounding whitespace in disabled surface values", () => {
    const withWhitespace = normalizeDashboardReleaseSearchParams(
      new URLSearchParams("section=%20members%20"),
    );
    expect(withWhitespace?.get("section")).toBeNull();

    const hubWhitespace = normalizeDashboardReleaseSearchParams(
      new URLSearchParams("section=+knowledge-hub+&collectionId=col-1"),
    );
    expect(hubWhitespace?.get("section")).toBeNull();
    expect(hubWhitespace?.get("collectionId")).toBeNull();

    const settingsWhitespace = normalizeDashboardReleaseSearchParams(
      new URLSearchParams("view=settings&settings=%09members"),
    );
    expect(settingsWhitespace?.get("settings")).toBeNull();
    expect(settingsWhitespace?.get("view")).toBe("settings");
  });

  it("keeps collectionId and domainId when the requested section is unrelated to Knowledge Hub", () => {
    expect(
      normalizeDashboardReleaseSearchParams(new URLSearchParams("section=activity&collectionId=col-1")),
    ).toBeNull();
    expect(
      normalizeDashboardReleaseSearchParams(new URLSearchParams("collectionId=col-1&domainId=d-1")),
    ).toBeNull();
    // members section must not drop collection params it does not own.
    const normalized = normalizeDashboardReleaseSearchParams(
      new URLSearchParams("section=members&collectionId=col-1"),
    );
    expect(normalized?.get("section")).toBeNull();
    expect(normalized?.get("collectionId")).toBe("col-1");
  });

  it("handles both disabled surfaces in a single combined URL", () => {
    const normalized = normalizeDashboardReleaseSearchParams(
      new URLSearchParams("section=knowledge-hub&settings=members&collectionId=col-1&view=settings"),
    );
    expect(normalized?.get("section")).toBeNull();
    expect(normalized?.get("settings")).toBeNull();
    expect(normalized?.get("collectionId")).toBeNull();
    expect(normalized?.get("view")).toBe("settings");
  });

  it("does not rewrite URLs when every surface is available", () => {
    expect(
      normalizeDashboardReleaseSearchParams(
        new URLSearchParams("section=knowledge-hub&collectionId=col-1&settings=workspace"),
        ALL_AVAILABLE,
      ),
    ).toBeNull();
    expect(
      normalizeDashboardReleaseSearchParams(
        new URLSearchParams("section=members&settings=members&view=settings"),
        ALL_AVAILABLE,
      ),
    ).toBeNull();
  });

  it("only strips surfaces whose availability is disabled", () => {
    const knowledgeOnly: DashboardReleaseAvailability = { "hermes-launcher": false, "knowledge-hub": true, members: false };
    expect(
      normalizeDashboardReleaseSearchParams(new URLSearchParams("section=knowledge-hub&collectionId=c"), knowledgeOnly),
    ).toBeNull();
    const membersStripped = normalizeDashboardReleaseSearchParams(
      new URLSearchParams("section=members&collectionId=c"),
      knowledgeOnly,
    );
    expect(membersStripped?.get("section")).toBeNull();
    expect(membersStripped?.get("collectionId")).toBe("c");

    const membersOnly: DashboardReleaseAvailability = { "hermes-launcher": false, "knowledge-hub": false, members: true };
    const hubStripped = normalizeDashboardReleaseSearchParams(
      new URLSearchParams("section=knowledge-hub&settings=members&domainId=d"),
      membersOnly,
    );
    expect(hubStripped?.get("section")).toBeNull();
    expect(hubStripped?.get("domainId")).toBeNull();
    expect(hubStripped?.get("settings")).toBe("members");
  });

  it("accepts any URLSearchParams-like source (toString only)", () => {
    const fake = { toString: () => "section=members&agentId=agent-9" };
    const normalized = normalizeDashboardReleaseSearchParams(fake);
    expect(normalized?.get("section")).toBeNull();
    expect(normalized?.get("agentId")).toBe("agent-9");
  });

  it("matches disabled surfaces case-sensitively so unknown casings are left to section resolvers", () => {
    // "Members" is not a known section; the normalizer must not strip params it
    // does not own. resolveDashboardView/section resolvers already reject it.
    expect(normalizeDashboardReleaseSearchParams(new URLSearchParams("section=Members"), ALL_DISABLED)).toBeNull();
  });

  it("strips both section=members and settings=members from the same URL", () => {
    const normalized = normalizeDashboardReleaseSearchParams(
      new URLSearchParams("section=members&settings=members&view=settings&agentId=agent-1"),
    );
    expect(normalized?.get("section")).toBeNull();
    expect(normalized?.get("settings")).toBeNull();
    expect(normalized?.get("view")).toBe("settings");
    expect(normalized?.get("agentId")).toBe("agent-1");
  });

  it("does not treat an empty section or settings value as a disabled surface", () => {
    expect(normalizeDashboardReleaseSearchParams(new URLSearchParams("section="))).toBeNull();
    expect(normalizeDashboardReleaseSearchParams(new URLSearchParams("settings="))).toBeNull();
    expect(normalizeDashboardReleaseSearchParams(new URLSearchParams("section=&settings="))).toBeNull();
  });

  it("strips tab-encoded whitespace around disabled surface values", () => {
    // %09 is a horizontal tab; URLSearchParams decodes it before trim().
    const tabbed = normalizeDashboardReleaseSearchParams(
      new URLSearchParams("section=%09knowledge-hub%09&collectionId=col-1"),
    );
    expect(tabbed?.get("section")).toBeNull();
    expect(tabbed?.get("collectionId")).toBeNull();
  });

  it("preserves collectionId and domainId when knowledge-hub is enabled but no section is present", () => {
    // Orphaned collection params without section=knowledge-hub are not owned by
    // the release boundary and must survive normalization.
    expect(
      normalizeDashboardReleaseSearchParams(
        new URLSearchParams("collectionId=col-1&domainId=d-1"),
        ALL_AVAILABLE,
      ),
    ).toBeNull();
  });

  it("preserves collectionId when knowledge-hub is enabled and section=knowledge-hub is present", () => {
    expect(
      normalizeDashboardReleaseSearchParams(
        new URLSearchParams("section=knowledge-hub&collectionId=col-1&domainId=d-1"),
        ALL_AVAILABLE,
      ),
    ).toBeNull();
  });

  it("strips knowledge-hub params even when the availability object is frozen", () => {
    const frozen = Object.freeze({ "hermes-launcher": false, "knowledge-hub": false, members: true }) as DashboardReleaseAvailability;
    const normalized = normalizeDashboardReleaseSearchParams(
      new URLSearchParams("section=knowledge-hub&collectionId=col-1"),
      frozen,
    );
    expect(normalized?.get("section")).toBeNull();
    expect(normalized?.get("collectionId")).toBeNull();
  });
});
