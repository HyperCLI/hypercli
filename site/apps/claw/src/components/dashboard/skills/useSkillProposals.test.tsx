import { act, renderHook, waitFor } from "@testing-library/react";
import type { AgentSkillProposalsProvider, AgentSkillProposalSummary } from "@hypercli.com/sdk/skills";
import { describe, expect, it, vi } from "vitest";

import { useSkillProposals } from "./useSkillProposals";

function proposal(id: string): AgentSkillProposalSummary {
  return {
    id,
    kind: "create",
    status: "pending",
    title: id,
    description: `Description for ${id}`,
    skillName: id,
    skillKey: id,
    createdAt: "2026-08-24T12:00:00.000Z",
    updatedAt: "2026-08-24T12:00:00.000Z",
    scanState: "clean",
  };
}

function provider(overrides: Partial<AgentSkillProposalsProvider> = {}) {
  return {
    capabilities: { list: true, inspect: true, apply: true, reject: true },
    list: vi.fn(async () => []),
    inspect: vi.fn(),
    apply: vi.fn(),
    reject: vi.fn(),
    ...overrides,
  } as AgentSkillProposalsProvider;
}

describe("useSkillProposals", () => {
  it("does not request proposals when the gateway does not advertise listing", async () => {
    const list = vi.fn();
    const unavailable = provider({
      capabilities: { list: false, inspect: false, apply: false, reject: false },
      list,
    });
    const { result } = renderHook(() => useSkillProposals({ enabled: true, connected: true, provider: unavailable }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.proposals).toEqual([]);
    expect(list).not.toHaveBeenCalled();
  });

  it("ignores an old agent response after the provider changes", async () => {
    let resolveOld: ((value: AgentSkillProposalSummary[]) => void) | undefined;
    const oldProvider = provider({
      list: vi.fn(() => new Promise<AgentSkillProposalSummary[]>((resolve) => { resolveOld = resolve; })),
    });
    const nextProvider = provider({
      list: vi.fn(async () => [proposal("new-agent-skill")]),
    });
    const { result, rerender } = renderHook(
      ({ currentProvider }) => useSkillProposals({ enabled: true, connected: true, provider: currentProvider }),
      { initialProps: { currentProvider: oldProvider } },
    );

    await waitFor(() => expect(oldProvider.list).toHaveBeenCalledOnce());
    rerender({ currentProvider: nextProvider });
    await waitFor(() => expect(result.current.proposals.map((item) => item.id)).toEqual(["new-agent-skill"]));
    await act(async () => { resolveOld?.([proposal("old-agent-skill")]); });
    expect(result.current.proposals.map((item) => item.id)).toEqual(["new-agent-skill"]);
  });

  it("refreshes the manifest only after a successful approval", async () => {
    const list = vi.fn()
      .mockResolvedValueOnce([proposal("pending-skill")])
      .mockResolvedValueOnce([]);
    const apply = vi.fn(async () => undefined);
    const active = provider({ list, apply });
    const { result } = renderHook(() => useSkillProposals({ enabled: true, connected: true, provider: active }));
    await waitFor(() => expect(result.current.proposals).toHaveLength(1));

    await act(async () => { await result.current.apply("pending-skill", "a".repeat(64)); });
    expect(apply).toHaveBeenCalledWith({ proposalId: "pending-skill", expectedRevision: "a".repeat(64) });
    expect(result.current.proposals).toEqual([]);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("keeps the pending manifest when approval fails", async () => {
    const list = vi.fn(async () => [proposal("pending-skill")]);
    const apply = vi.fn(async () => { throw new Error("revision conflict"); });
    const active = provider({ list, apply });
    const { result } = renderHook(() => useSkillProposals({ enabled: true, connected: true, provider: active }));
    await waitFor(() => expect(result.current.proposals).toHaveLength(1));

    await expect(result.current.apply("pending-skill", "a".repeat(64))).rejects.toThrow(/revision conflict/i);
    expect(result.current.proposals.map((item) => item.id)).toEqual(["pending-skill"]);
    expect(list).toHaveBeenCalledOnce();
  });

  it("does not report a confirmed approval as failed when the follow-up refresh fails", async () => {
    const list = vi.fn()
      .mockResolvedValueOnce([proposal("pending-skill")])
      .mockRejectedValueOnce(new Error("refresh unavailable"));
    const apply = vi.fn(async () => undefined);
    const active = provider({ list, apply });
    const { result } = renderHook(() => useSkillProposals({ enabled: true, connected: true, provider: active }));
    await waitFor(() => expect(result.current.proposals).toHaveLength(1));

    await act(async () => { await result.current.apply("pending-skill", "a".repeat(64)); });
    expect(result.current.proposals).toEqual([]);
    expect(result.current.error).toMatch(/refresh unavailable/i);
  });
});
