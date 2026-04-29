import { waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HyperCLIContext, type HyperCLIContextValue } from "@/providers/HyperCLIContext";
import { renderHookWithClient } from "@/test/utils";
import { buildCurrentPlan, buildPlan } from "@/test/factories";
import { usePlans } from "./usePlans";
import type { ReactNode } from "react";

function providerFor(value: Partial<HyperCLIContextValue>) {
  const context: HyperCLIContextValue = {
    deployments: null,
    hyperAgent: null,
    token: null,
    ready: false,
    refreshClients: vi.fn(),
    ...value,
  };

  return function Provider({ children }: { children: ReactNode }) {
    return <HyperCLIContext.Provider value={context}>{children}</HyperCLIContext.Provider>;
  };
}

describe("usePlans", () => {
  it("stays disabled while the SDK is not ready", () => {
    const hyperAgent = {
      plans: vi.fn(),
      currentPlan: vi.fn(),
      agentTypes: vi.fn(),
    };

    const { result } = renderHookWithClient(() => usePlans(), {
      provider: providerFor({ hyperAgent: hyperAgent as any, ready: false }),
    });

    expect(result.current.plans).toEqual([]);
    expect(result.current.currentPlan).toBeNull();
    expect(hyperAgent.plans).not.toHaveBeenCalled();
  });

  it("loads plans, current plan, and agent type catalog from the SDK", async () => {
    const hyperAgent = {
      plans: vi.fn().mockResolvedValue([buildPlan({ id: "pro" })]),
      currentPlan: vi.fn().mockResolvedValue(buildCurrentPlan({ id: "pro" })),
      agentTypes: vi.fn().mockResolvedValue({ types: [{ id: "large" }], plans: [] }),
    };

    const { result } = renderHookWithClient(() => usePlans(), {
      provider: providerFor({ hyperAgent: hyperAgent as any, token: "token", ready: true }),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBeNull();
    expect(result.current.plans[0]?.id).toBe("pro");
    expect(result.current.currentPlan?.id).toBe("pro");
    expect(result.current.typeCatalog?.types[0]?.id).toBe("large");
  });

  it("surfaces SDK query errors", async () => {
    const hyperAgent = {
      plans: vi.fn().mockRejectedValue(new Error("plans failed")),
      currentPlan: vi.fn().mockResolvedValue(buildCurrentPlan()),
      agentTypes: vi.fn().mockResolvedValue({ types: [], plans: [] }),
    };

    const { result } = renderHookWithClient(() => usePlans(), {
      provider: providerFor({ hyperAgent: hyperAgent as any, token: "token", ready: true }),
    });

    await waitFor(() => expect(result.current.error).toContain("plans failed"));
  });

  it("does not load the type catalog until a token is available", async () => {
    const hyperAgent = {
      plans: vi.fn().mockResolvedValue([buildPlan()]),
      currentPlan: vi.fn().mockResolvedValue(buildCurrentPlan()),
      agentTypes: vi.fn(),
    };

    const { result } = renderHookWithClient(() => usePlans(), {
      provider: providerFor({ hyperAgent: hyperAgent as any, token: null, ready: true }),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.typeCatalog).toBeNull();
    expect(hyperAgent.agentTypes).not.toHaveBeenCalled();
  });

  it("surfaces current plan query errors", async () => {
    const hyperAgent = {
      plans: vi.fn().mockResolvedValue([buildPlan()]),
      currentPlan: vi.fn().mockRejectedValue(new Error("current failed")),
      agentTypes: vi.fn().mockResolvedValue({ types: [], plans: [] }),
    };

    const { result } = renderHookWithClient(() => usePlans(), {
      provider: providerFor({ hyperAgent: hyperAgent as any, token: "token", ready: true }),
    });

    await waitFor(() => expect(result.current.error).toContain("current failed"));
  });

  it("invalidates the current plan query on refresh", async () => {
    const currentPlan = vi
      .fn()
      .mockResolvedValueOnce(buildCurrentPlan({ id: "basic" }))
      .mockResolvedValueOnce(buildCurrentPlan({ id: "pro" }));
    const hyperAgent = {
      plans: vi.fn().mockResolvedValue([buildPlan()]),
      currentPlan,
      agentTypes: vi.fn().mockResolvedValue({ types: [], plans: [] }),
    };

    const { result } = renderHookWithClient(() => usePlans(), {
      provider: providerFor({ hyperAgent: hyperAgent as any, token: "token", ready: true }),
    });

    await waitFor(() => expect(result.current.currentPlan?.id).toBe("basic"));
    await result.current.refreshCurrentPlan();
    await waitFor(() => expect(result.current.currentPlan?.id).toBe("pro"));
    expect(currentPlan).toHaveBeenCalledTimes(2);
  });
});
