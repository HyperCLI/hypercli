import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentConnectorsProvider } from "@hypercli.com/sdk/connectors";
import type { GatewayEphemeralChatOptions } from "@hypercli.com/sdk/openclaw/gateway";

import {
  buildPreloadedConnectorWorkflow,
  CONNECTOR_WORKFLOW_PROMPT_REVISION,
  CONNECTOR_WORKFLOW_SCHEMA_ID,
  type ConnectorId,
  type ConnectorWorkflow,
} from "@/lib/connector-workflow";
import {
  CONNECTOR_WORKFLOW_REFRESH_INTERVAL_MS,
  connectorWorkflowEntryIsFresh,
  connectorWorkflowStorageKey,
  readStoredConnectorWorkflows,
} from "@/lib/connector-workflow-cache";
import { useConnectorWorkflow } from "./useConnectorWorkflow";

function provider(): AgentConnectorsProvider {
  return {
    runtime: { provider: "openclaw", version: "1.2.3", capabilities: ["channels"] },
    list: vi.fn(async () => [{
      connectorId: "telegram",
      configured: false,
      authenticated: false,
      usable: false,
      setupModes: ["config" as const],
    }]),
    startSetup: vi.fn(),
    pollSetup: vi.fn(),
    configure: vi.fn(),
  };
}

function channelProvider(configuredIds: ReadonlySet<string> = new Set()): AgentConnectorsProvider {
  return {
    runtime: { provider: "openclaw", version: "1.2.3", capabilities: ["channels"] },
    list: vi.fn(async (options) => {
      const connectorId = options?.connectorId ?? "telegram";
      const configured = configuredIds.has(connectorId);
      return [{
        connectorId,
        configured,
        authenticated: configured,
        usable: configured,
        setupModes: ["config" as const],
      }];
    }),
    startSetup: vi.fn(),
    pollSetup: vi.fn(),
    configure: vi.fn(),
  };
}

function workflowResponse(prompt: string): string {
  const connectorId = prompt.match(/Plan a (github|telegram|discord|slack|whatsapp) connector/)?.[1] ?? "telegram";
  const fingerprint = Array.from(prompt.matchAll(/"runtimeFingerprint":"([^"]+)"/g)).at(-1)?.[1];
  const officialUrl = {
    github: "https://github.com/settings/installations",
    telegram: "https://telegram.org",
    discord: "https://discord.com",
    slack: "https://api.slack.com/apps",
    whatsapp: "https://www.whatsapp.com",
  }[connectorId];
  return JSON.stringify({
    schema: CONNECTOR_WORKFLOW_SCHEMA_ID,
    connectorId,
    runtimeFingerprint: fingerprint,
    summary: `Connect ${connectorId}.`,
    steps: [
      { id: "open", title: "Open setup", instructions: "Open the official setup page.", kind: "instruction", url: officialUrl },
      { id: "create", title: "Create connection", instructions: "Create the connection.", kind: "instruction" },
      { id: "configure", title: "Configure access", instructions: "Configure access in the protected fields.", kind: "input" },
      { id: "verify", title: "Verify connection", instructions: "Check the connection status.", kind: "verify" },
    ],
  });
}

function serializedWorkflow(workflow: ConnectorWorkflow): string {
  return JSON.stringify({
    ...workflow,
    steps: workflow.steps.map(({ approvalRequired: _approvalRequired, ...step }) => step),
  });
}

describe("useConnectorWorkflow", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });
  it("exposes starting guidance for every prompt-driven integration before generation", () => {
    const runEphemeralPrompt = vi.fn(async (prompt: string) => workflowResponse(prompt));
    const { result } = renderHook(() => useConnectorWorkflow({
      provider: channelProvider(),
      scopeKey: "agent:starting-guidance",
      runEphemeralPrompt,
      runShellProposal: vi.fn(),
    }));

    expect(Object.keys(result.current.connectorWorkflows)).toEqual([
      "github",
      "telegram",
      "discord",
      "slack",
      "whatsapp",
    ]);
    expect(result.current.connectorWorkflows.slack?.summary).toMatch(/Socket Mode/i);
    expect(result.current.connectorWorkflows.telegram?.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ inputSlots: expect.arrayContaining(["telegram.botToken"]) }),
    ]));
    expect(runEphemeralPrompt).not.toHaveBeenCalled();
  });

  it("keeps an identical checked response and only advances its check metadata", async () => {
    const runEphemeralPrompt = vi.fn(async (prompt: string) => {
      const connectorId = prompt.match(/Plan a (\w+) connector/)?.[1] as ConnectorId;
      const fingerprint = Array.from(prompt.matchAll(/"runtimeFingerprint":"([^"]+)"/g)).at(-1)?.[1] ?? "missing";
      return serializedWorkflow(buildPreloadedConnectorWorkflow(connectorId, fingerprint));
    });
    const { result } = renderHook(() => useConnectorWorkflow({
      provider: channelProvider(),
      scopeKey: "agent:unchanged-preload",
      runEphemeralPrompt,
      runShellProposal: vi.fn(),
    }));
    const original = result.current.connectorWorkflows.slack;

    await act(async () => {
      await result.current.preloadConnectorWorkflows(["slack"]);
    });
    await waitFor(() => expect(runEphemeralPrompt).toHaveBeenCalledOnce());
    await waitFor(() => expect(result.current.connectorWorkflows.slack).toBe(original));

    const stored = JSON.parse(window.localStorage.getItem(
      connectorWorkflowStorageKey("agent:unchanged-preload"),
    ) ?? "{}") as { entries?: Record<string, { lastCheckedAt?: number; source?: string }> };
    expect(stored.entries?.slack).toEqual(expect.objectContaining({
      source: "preloaded",
      revision: CONNECTOR_WORKFLOW_PROMPT_REVISION,
      lastCheckedAt: expect.any(Number),
    }));
    expect(stored.entries?.slack?.lastCheckedAt).toBeGreaterThan(0);
  });

  it("keeps valid cached integrations when another cached workflow is malformed", () => {
    const validSlack = buildPreloadedConnectorWorkflow("slack", "openclaw:cached");
    window.localStorage.setItem(connectorWorkflowStorageKey("agent:partial-cache"), JSON.stringify({
      version: 1,
      entries: {
        telegram: {
          workflow: { schema: "invalid" },
          lastCheckedAt: Date.now(),
          source: "generated",
          revision: CONNECTOR_WORKFLOW_PROMPT_REVISION,
        },
        slack: {
          workflow: validSlack,
          lastCheckedAt: Date.now(),
          source: "generated",
          revision: CONNECTOR_WORKFLOW_PROMPT_REVISION,
        },
      },
    }));

    const entries = readStoredConnectorWorkflows("agent:partial-cache");
    expect(entries.telegram).toBeUndefined();
    expect(entries.slack?.workflow).toEqual(validSlack);
    expect(connectorWorkflowEntryIsFresh(entries.slack)).toBe(true);
    expect(connectorWorkflowEntryIsFresh({
      ...entries.slack!,
      revision: CONNECTOR_WORKFLOW_PROMPT_REVISION - 1,
    })).toBe(false);
  });
  it("caches a validated workflow for the current runtime", async () => {
    const connectorsProvider = provider();
    const runEphemeralPrompt = vi.fn(async (prompt: string) => {
      const fingerprint = Array.from(prompt.matchAll(/"runtimeFingerprint":"([^"]+)"/g)).at(-1)?.[1];
      return JSON.stringify({
        schema: CONNECTOR_WORKFLOW_SCHEMA_ID,
        connectorId: "telegram",
        runtimeFingerprint: fingerprint,
        summary: "Connect Telegram.",
        steps: [
          { id: "open", title: "Open setup", instructions: "Open the official setup page.", kind: "instruction", url: "https://telegram.org" },
          { id: "create", title: "Create bot", instructions: "Create the bot.", kind: "instruction" },
          { id: "token", title: "Add token", instructions: "Enter it securely.", kind: "input", inputSlots: ["telegram.botToken"] },
          { id: "verify", title: "Verify connection", instructions: "Check the connection.", kind: "verify", operation: "telegram.verify" },
        ],
      });
    });
    const { result } = renderHook(() => useConnectorWorkflow({
      provider: connectorsProvider,
      scopeKey: "agent:test",
      runEphemeralPrompt,
      runShellProposal: vi.fn(),
    }));

    await act(async () => {
      await result.current.generateConnectorWorkflow("telegram");
      await result.current.generateConnectorWorkflow("telegram");
    });

    expect(runEphemeralPrompt).toHaveBeenCalledTimes(1);
    expect(connectorsProvider.list).toHaveBeenCalledWith({ connectorId: "telegram" });
    expect(runEphemeralPrompt.mock.calls[0]?.[0]).not.toMatch(/^\/fast on\n/);
    expect(runEphemeralPrompt.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      fastMode: true,
      timeoutMs: 120_000,
    }));
    expect(runEphemeralPrompt.mock.calls[0]?.[0]).toContain(`Prompt revision: ${CONNECTOR_WORKFLOW_PROMPT_REVISION}`);
  });

  it("reuses loaded guidance when connector setup state changes", async () => {
    let configured = false;
    const mutableProvider = provider();
    vi.mocked(mutableProvider.list).mockImplementation(async () => [{
      connectorId: "telegram",
      configured,
      authenticated: configured,
      usable: configured,
      setupModes: ["config"],
    }]);
    const runEphemeralPrompt = vi.fn(async (prompt: string) => {
      const fingerprint = Array.from(prompt.matchAll(/"runtimeFingerprint":"([^"]+)"/g)).at(-1)?.[1];
      return JSON.stringify({
        schema: CONNECTOR_WORKFLOW_SCHEMA_ID,
        connectorId: "telegram",
        runtimeFingerprint: fingerprint,
        summary: configured ? "Verify Telegram." : "Connect Telegram.",
        steps: configured ? [
          { id: "verify", title: "Verify", instructions: "Check status.", kind: "verify", operation: "telegram.verify" },
        ] : [
          { id: "open", title: "Open setup", instructions: "Open the official page.", kind: "instruction", url: "https://telegram.org" },
          { id: "create", title: "Create bot", instructions: "Create the bot.", kind: "instruction" },
          { id: "token", title: "Enter token", instructions: "Use the protected field.", kind: "input", inputSlots: ["telegram.botToken"] },
          { id: "verify", title: "Verify", instructions: "Check status.", kind: "verify", operation: "telegram.verify" },
        ],
      });
    });
    const { result } = renderHook(() => useConnectorWorkflow({
      provider: mutableProvider,
      scopeKey: "agent:test",
      runEphemeralPrompt,
      runShellProposal: vi.fn(),
    }));

    let firstWorkflow: Awaited<ReturnType<typeof result.current.generateConnectorWorkflow>> | undefined;
    await act(async () => {
      firstWorkflow = await result.current.generateConnectorWorkflow("telegram");
    });
    expect(firstWorkflow).toEqual(expect.objectContaining({ summary: "Connect Telegram." }));
    configured = true;
    await expect(result.current.generateConnectorWorkflow("telegram")).resolves.toEqual(
      expect.objectContaining({ summary: "Connect Telegram." }),
    );

    expect(runEphemeralPrompt).toHaveBeenCalledTimes(1);
  });

  it("restores an agent workflow after the hook remounts without regenerating", async () => {
    const runEphemeralPrompt = vi.fn(async (prompt: string) => workflowResponse(prompt));
    const firstProvider = channelProvider();
    const first = renderHook(() => useConnectorWorkflow({
      provider: firstProvider,
      scopeKey: "agent:persisted",
      runEphemeralPrompt,
      runShellProposal: vi.fn(),
    }));

    await act(async () => {
      await first.result.current.generateConnectorWorkflow("slack");
    });
    expect(first.result.current.connectorWorkflows.slack).toEqual(
      expect.objectContaining({ connectorId: "slack" }),
    );
    first.unmount();

    const replacementProvider = channelProvider(new Set(["slack"]));
    replacementProvider.runtime = { provider: "openclaw", version: "9.9.9", capabilities: ["changed"] };
    const second = renderHook(() => useConnectorWorkflow({
      provider: replacementProvider,
      scopeKey: "agent:persisted",
      runEphemeralPrompt,
      runShellProposal: vi.fn(),
    }));

    expect(second.result.current.connectorWorkflows.slack).toEqual(
      expect.objectContaining({ connectorId: "slack" }),
    );
    await expect(second.result.current.generateConnectorWorkflow("slack")).resolves.toEqual(
      expect.objectContaining({ connectorId: "slack" }),
    );
    expect(runEphemeralPrompt).toHaveBeenCalledTimes(1);
    expect(replacementProvider.list).not.toHaveBeenCalled();
    second.unmount();
  });

  it("keeps stale guidance visible while one weekly refresh replaces it", async () => {
    let now = 1_800_000_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    let resolveRefresh: ((value: string) => void) | null = null;
    let call = 0;
    const runEphemeralPrompt = vi.fn((prompt: string) => {
      call += 1;
      if (call === 1) return Promise.resolve(workflowResponse(prompt));
      return new Promise<string>((resolve) => {
        resolveRefresh = (value) => resolve(value);
      });
    });
    const { result } = renderHook(() => useConnectorWorkflow({
      provider: channelProvider(),
      scopeKey: "agent:weekly",
      runEphemeralPrompt,
      runShellProposal: vi.fn(),
    }));

    await act(async () => {
      await result.current.generateConnectorWorkflow("slack");
    });
    const original = result.current.connectorWorkflows.slack;
    now += CONNECTOR_WORKFLOW_REFRESH_INTERVAL_MS + 1;
    let refresh: Promise<unknown> | undefined;
    act(() => {
      refresh = result.current.generateConnectorWorkflow("slack");
    });
    await waitFor(() => expect(runEphemeralPrompt).toHaveBeenCalledTimes(2));
    expect(result.current.connectorWorkflows.slack).toEqual(original);

    const refreshedResponse = JSON.parse(workflowResponse(runEphemeralPrompt.mock.calls[1]![0]));
    refreshedResponse.summary = "Updated weekly Slack guidance.";
    await act(async () => {
      resolveRefresh?.(JSON.stringify(refreshedResponse));
      await refresh;
    });
    expect(result.current.connectorWorkflows.slack?.summary).toBe("Updated weekly Slack guidance.");
  });

  it("does not automatically refresh persisted guidance when its weekly check is due", async () => {
    let now = 1_800_000_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const runEphemeralPrompt = vi.fn(async (prompt: string) => workflowResponse(prompt));
    const first = renderHook(() => useConnectorWorkflow({
      provider: channelProvider(),
      scopeKey: "agent:auto-weekly",
      runEphemeralPrompt,
      runShellProposal: vi.fn(),
    }));
    await act(async () => {
      await first.result.current.generateConnectorWorkflow("discord");
    });
    first.unmount();

    now += CONNECTOR_WORKFLOW_REFRESH_INTERVAL_MS + 1;
    const second = renderHook(() => useConnectorWorkflow({
      provider: channelProvider(),
      scopeKey: "agent:auto-weekly",
      runEphemeralPrompt,
      runShellProposal: vi.fn(),
    }));

    expect(second.result.current.connectorWorkflows.discord).toEqual(
      expect.objectContaining({ connectorId: "discord" }),
    );
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(runEphemeralPrompt).toHaveBeenCalledTimes(1);
    second.unmount();
  });

  it("retains stale guidance and suppresses repeated refreshes after a weekly refresh fails", async () => {
    let now = 1_800_000_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    let call = 0;
    const runEphemeralPrompt = vi.fn(async (prompt: string) => {
      call += 1;
      if (call === 1) return workflowResponse(prompt);
      throw new Error("temporary generation failure");
    });
    const { result } = renderHook(() => useConnectorWorkflow({
      provider: channelProvider(),
      scopeKey: "agent:stale-fallback",
      runEphemeralPrompt,
      runShellProposal: vi.fn(),
    }));

    await act(async () => {
      await result.current.generateConnectorWorkflow("telegram");
    });
    const original = result.current.connectorWorkflows.telegram;
    now += CONNECTOR_WORKFLOW_REFRESH_INTERVAL_MS + 1;
    await act(async () => {
      await expect(result.current.generateConnectorWorkflow("telegram")).rejects.toThrow("temporary generation failure");
    });
    expect(result.current.connectorWorkflows.telegram).toEqual(original);
    await expect(result.current.generateConnectorWorkflow("telegram")).resolves.toEqual(original);
    expect(runEphemeralPrompt).toHaveBeenCalledTimes(2);
  });

  it("persists only validated workflow content in the agent-scoped cache", async () => {
    const runEphemeralPrompt = vi.fn(async (prompt: string) => workflowResponse(prompt));
    const { result } = renderHook(() => useConnectorWorkflow({
      provider: channelProvider(),
      scopeKey: "agent:storage",
      runEphemeralPrompt,
      runShellProposal: vi.fn(),
    }));

    await act(async () => {
      await result.current.generateConnectorWorkflow("telegram");
    });

    const stored = window.localStorage.getItem(connectorWorkflowStorageKey("agent:storage"));
    expect(stored).toContain(CONNECTOR_WORKFLOW_SCHEMA_ID);
    expect(stored).not.toContain("bot-token-secret");
    expect(window.localStorage.getItem(connectorWorkflowStorageKey("agent:other"))).toBeNull();
  });

  it("rejects a single response without structured links instead of requesting a correction", async () => {
    const runEphemeralPrompt = vi.fn(async (prompt: string) => {
      const fingerprint = Array.from(prompt.matchAll(/"runtimeFingerprint":"([^"]+)"/g)).at(-1)?.[1];
      return JSON.stringify({
        schema: CONNECTOR_WORKFLOW_SCHEMA_ID,
        connectorId: "telegram",
        runtimeFingerprint: fingerprint,
        summary: "Connect Telegram.",
        steps: [{
          id: "create",
          title: "Create bot",
          instructions: "Open the official setup destination.",
          kind: "instruction",
        }],
      });
    });
    const { result } = renderHook(() => useConnectorWorkflow({
      provider: provider(),
      scopeKey: "agent:test",
      runEphemeralPrompt,
      runShellProposal: vi.fn(),
    }));

    await expect(result.current.generateConnectorWorkflow("telegram")).rejects.toThrow(/omitted every structured external URL/i);
    expect(runEphemeralPrompt).toHaveBeenCalledTimes(1);
    expect(runEphemeralPrompt.mock.calls[0]?.[1]?.fastMode).toBe(true);
  });

  it("rejects repeated adjacent destinations without requesting a correction", async () => {
    const runEphemeralPrompt = vi.fn(async (prompt: string) => {
      const fingerprint = Array.from(prompt.matchAll(/"runtimeFingerprint":"([^"]+)"/g)).at(-1)?.[1];
      return JSON.stringify({
        schema: CONNECTOR_WORKFLOW_SCHEMA_ID,
        connectorId: "slack",
        runtimeFingerprint: fingerprint,
        summary: "Connect a communication workspace.",
        steps: [{
          id: "open-destination",
          title: "Open the setup destination",
          instructions: "Open the official configuration page.",
          kind: "instruction",
          url: "https://api.slack.com/apps",
        }, {
          id: "create-app",
          title: "Create an app",
          instructions: "Create the app from the configuration page.",
          kind: "action",
          url: "https://api.slack.com/apps",
        }, {
          id: "enter-token",
          title: "Enter the protected value",
          instructions: "Use the protected field.",
          kind: "input",
          inputSlots: ["slack.botToken"],
        }, {
          id: "verify",
          title: "Verify the connection",
          instructions: "Check runtime status.",
          kind: "verify",
          operation: "slack.verify",
        }],
      });
    });
    const { result } = renderHook(() => useConnectorWorkflow({
      provider: channelProvider(),
      scopeKey: "agent:test",
      runEphemeralPrompt,
      runShellProposal: vi.fn(),
    }));

    await expect(result.current.generateConnectorWorkflow("slack")).rejects.toThrow(/repeats the same external destination/i);
    expect(runEphemeralPrompt).toHaveBeenCalledTimes(1);
  });

  it("rejects a malformed single response without retrying automatically", async () => {
    const runEphemeralPrompt = vi.fn(async () => "not json");
    const { result } = renderHook(() => useConnectorWorkflow({
      provider: provider(),
      scopeKey: "agent:test",
      runEphemeralPrompt,
      runShellProposal: vi.fn(),
    }));

    await expect(result.current.generateConnectorWorkflow("telegram")).rejects.toThrow(/one bare JSON object/i);
    expect(runEphemeralPrompt).toHaveBeenCalledTimes(1);
    expect(runEphemeralPrompt.mock.calls[0]?.[1]?.fastMode).toBe(true);
  });

  it("starts one new one-shot request only after an explicit manual retry", async () => {
    let call = 0;
    const runEphemeralPrompt = vi.fn(async (prompt: string) => {
      call += 1;
      return call === 1 ? "not json" : workflowResponse(prompt);
    });
    const { result } = renderHook(() => useConnectorWorkflow({
      provider: provider(),
      scopeKey: "agent:test",
      runEphemeralPrompt,
      runShellProposal: vi.fn(),
    }));

    await expect(result.current.generateConnectorWorkflow("telegram")).rejects.toThrow(/one bare JSON object/i);
    let retriedWorkflow: Awaited<ReturnType<typeof result.current.generateConnectorWorkflow>> | undefined;
    await act(async () => {
      retriedWorkflow = await result.current.generateConnectorWorkflow("telegram");
    });
    expect(retriedWorkflow).toEqual(expect.objectContaining({ connectorId: "telegram" }));
    expect(runEphemeralPrompt).toHaveBeenCalledTimes(2);
    expect(runEphemeralPrompt.mock.calls.every(([, options]) => options?.fastMode === true)).toBe(true);
  });

  it("rejects planning tool activity", async () => {
    const runEphemeralPrompt = vi.fn(async (_prompt: string, options?: { onEvent?: (event: { type: "tool_call" }) => void | Promise<void> }) => {
      await options?.onEvent?.({ type: "tool_call" });
      return "unreachable";
    });
    const { result } = renderHook(() => useConnectorWorkflow({
      provider: provider(),
      scopeKey: "agent:test",
      runEphemeralPrompt,
      runShellProposal: vi.fn(),
    }));

    await expect(result.current.generateConnectorWorkflow("telegram")).rejects.toThrow(/attempted to use a tool/i);
    expect(runEphemeralPrompt).toHaveBeenCalledTimes(1);
  });

  it("preloads all four channel workflows in isolated sessions and reuses active and settled work on demand", async () => {
    const connectorsProvider = channelProvider();
    const pending: Array<() => void> = [];
    let active = 0;
    let maxActive = 0;
    const runEphemeralPrompt = vi.fn((prompt: string) => new Promise<string>((resolve) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      pending.push(() => {
        active -= 1;
        resolve(workflowResponse(prompt));
      });
    }));
    const { result } = renderHook(() => useConnectorWorkflow({
      provider: connectorsProvider,
      scopeKey: "agent:preload",
      runEphemeralPrompt,
      runShellProposal: vi.fn(),
    }));

    await act(async () => {
      await result.current.preloadConnectorWorkflows(["telegram", "discord", "slack", "whatsapp"]);
    });
    expect(runEphemeralPrompt).toHaveBeenCalledTimes(4);

    const activeTelegram = result.current.generateConnectorWorkflow("telegram");
    expect(runEphemeralPrompt).toHaveBeenCalledTimes(4);
    await act(async () => pending.shift()?.());
    await expect(activeTelegram).resolves.toEqual(expect.objectContaining({ connectorId: "telegram" }));
    await act(async () => {
      pending.splice(0).forEach((resolve) => resolve());
    });
    await waitFor(() => expect(active).toBe(0));

    await expect(result.current.generateConnectorWorkflow("telegram")).resolves.toEqual(
      expect.objectContaining({ connectorId: "telegram" }),
    );
    expect(runEphemeralPrompt).toHaveBeenCalledTimes(4);
    expect(maxActive).toBe(4);
  });

  it("starts demanded guidance without cancelling unrelated active preloads", async () => {
    const connectorsProvider = channelProvider();
    const pending = new Map<string, () => void>();
    const signals = new Map<string, AbortSignal | undefined>();
    const runEphemeralPrompt = vi.fn((prompt: string, options?: GatewayEphemeralChatOptions) => new Promise<string>((resolve) => {
      const connectorId = prompt.match(/Plan a (github|telegram|discord|slack|whatsapp) connector/)?.[1] ?? "telegram";
      signals.set(connectorId, options?.signal);
      pending.set(connectorId, () => resolve(workflowResponse(prompt)));
    }));
    const { result } = renderHook(() => useConnectorWorkflow({
      provider: connectorsProvider,
      scopeKey: "agent:demand",
      runEphemeralPrompt,
      runShellProposal: vi.fn(),
    }));

    await act(async () => {
      await result.current.preloadConnectorWorkflows(["telegram", "discord", "whatsapp"]);
    });
    expect(runEphemeralPrompt).toHaveBeenCalledTimes(3);

    const demanded = result.current.generateConnectorWorkflow("whatsapp");
    await waitFor(() => expect(runEphemeralPrompt).toHaveBeenCalledTimes(3));
    expect(signals.get("telegram")?.aborted).toBe(false);
    expect(signals.get("discord")?.aborted).toBe(false);
    expect(signals.get("whatsapp")?.aborted).toBe(false);

    await act(async () => pending.get("whatsapp")?.());
    await expect(demanded).resolves.toEqual(expect.objectContaining({ connectorId: "whatsapp" }));
    await act(async () => {
      pending.get("telegram")?.();
      pending.get("discord")?.();
    });
  });

  it("checks configured channels against their preloaded guidance", async () => {
    const connectorsProvider = channelProvider(new Set(["telegram", "slack"]));
    const runEphemeralPrompt = vi.fn(async (prompt: string) => workflowResponse(prompt));
    const { result } = renderHook(() => useConnectorWorkflow({
      provider: connectorsProvider,
      scopeKey: "agent:configured",
      runEphemeralPrompt,
      runShellProposal: vi.fn(),
    }));

    await act(async () => {
      await result.current.preloadConnectorWorkflows(["telegram", "slack"]);
    });

    expect(runEphemeralPrompt).toHaveBeenCalledTimes(2);
    expect(runEphemeralPrompt.mock.calls.every(([prompt]) => prompt.includes('"configured":true'))).toBe(true);
  });

  it("does not retry a completed invalid preload response", async () => {
    const runEphemeralPrompt = vi.fn(async () => "not json");
    const { result } = renderHook(() => useConnectorWorkflow({
      provider: channelProvider(),
      scopeKey: "agent:invalid-preload",
      runEphemeralPrompt,
      runShellProposal: vi.fn(),
    }));

    await act(async () => {
      await result.current.preloadConnectorWorkflows(["telegram"]);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(runEphemeralPrompt).toHaveBeenCalledTimes(1);
  });

  it("retries only interrupted preload work after interactive chat becomes idle", async () => {
    const connectorsProvider = channelProvider();
    const capturedSignals: Array<GatewayEphemeralChatOptions["signal"]> = [];
    const runEphemeralPrompt = vi.fn((_prompt: string, options?: GatewayEphemeralChatOptions) => new Promise<string>((_resolve, reject) => {
      capturedSignals.push(options?.signal);
      options?.signal?.addEventListener("abort", () => {
        const error = new Error("cancelled");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    }));
    const { result, rerender } = renderHook(({ blocked }) => useConnectorWorkflow({
      provider: connectorsProvider,
      scopeKey: "agent:busy",
      backgroundBlocked: blocked,
      runEphemeralPrompt,
      runShellProposal: vi.fn(),
    }), { initialProps: { blocked: false } });

    await act(async () => {
      await result.current.preloadConnectorWorkflows(["telegram", "discord"]);
    });
    await waitFor(() => expect(runEphemeralPrompt).toHaveBeenCalledTimes(2));

    rerender({ blocked: true });

    await waitFor(() => expect(capturedSignals.every((signal) => signal?.aborted)).toBe(true));
    rerender({ blocked: false });
    await waitFor(() => expect(runEphemeralPrompt).toHaveBeenCalledTimes(4));
  });

  it("starts fresh preload work immediately after the provider reconnects", async () => {
    const firstProvider = channelProvider();
    const secondProvider = channelProvider();
    const firstSignals: AbortSignal[] = [];
    let call = 0;
    const runEphemeralPrompt = vi.fn((prompt: string, options?: GatewayEphemeralChatOptions) => {
      call += 1;
      if (call > 2) return Promise.resolve(workflowResponse(prompt));
      return new Promise<string>((_resolve, reject) => {
        if (options?.signal) firstSignals.push(options.signal);
        options?.signal?.addEventListener("abort", () => {
          const error = new Error("cancelled");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      });
    });
    const { result, rerender } = renderHook(({ connectorsProvider }) => useConnectorWorkflow({
      provider: connectorsProvider,
      scopeKey: "agent:reconnect",
      runEphemeralPrompt,
      runShellProposal: vi.fn(),
    }), { initialProps: { connectorsProvider: firstProvider } });

    await act(async () => {
      await result.current.preloadConnectorWorkflows(["telegram", "discord"]);
    });
    expect(runEphemeralPrompt).toHaveBeenCalledTimes(2);

    rerender({ connectorsProvider: secondProvider });
    await waitFor(() => expect(firstSignals.every((signal) => signal.aborted)).toBe(true));
    await act(async () => {
      await result.current.preloadConnectorWorkflows(["telegram", "discord"]);
    });

    await waitFor(() => expect(runEphemeralPrompt).toHaveBeenCalledTimes(4));
  });

  it("ignores a superseded provider response that resolves after replacement guidance", async () => {
    const firstProvider = channelProvider();
    const secondProvider = channelProvider();
    let resolveFirst: ((value: string) => void) | undefined;
    let resolveSecond: ((value: string) => void) | undefined;
    const runEphemeralPrompt = vi.fn((prompt: string) => new Promise<string>((resolve) => {
      const respond = (summary: string) => {
        const response = JSON.parse(workflowResponse(prompt)) as { summary: string };
        response.summary = summary;
        resolve(JSON.stringify(response));
      };
      if (runEphemeralPrompt.mock.calls.length === 1) resolveFirst = respond;
      else resolveSecond = respond;
    }));
    const { result, rerender } = renderHook(({ connectorsProvider }) => useConnectorWorkflow({
      provider: connectorsProvider,
      scopeKey: "agent:provider-race",
      runEphemeralPrompt,
      runShellProposal: vi.fn(),
    }), { initialProps: { connectorsProvider: firstProvider } });

    await act(async () => {
      await result.current.preloadConnectorWorkflows(["telegram"]);
    });
    await waitFor(() => expect(runEphemeralPrompt).toHaveBeenCalledOnce());

    rerender({ connectorsProvider: secondProvider });
    await act(async () => {
      await result.current.preloadConnectorWorkflows(["telegram"]);
    });
    await waitFor(() => expect(runEphemeralPrompt).toHaveBeenCalledTimes(2));

    await act(async () => resolveSecond?.("Replacement provider guidance."));
    await waitFor(() => expect(result.current.connectorWorkflows.telegram?.summary).toBe("Replacement provider guidance."));
    await act(async () => resolveFirst?.("Superseded provider guidance."));
    expect(result.current.connectorWorkflows.telegram?.summary).toBe("Replacement provider guidance.");
  });

  it("does not reuse settled workflows across agent scopes", async () => {
    const connectorsProvider = channelProvider();
    const runEphemeralPrompt = vi.fn(async (prompt: string) => workflowResponse(prompt));
    const { result, rerender } = renderHook(({ scopeKey }) => useConnectorWorkflow({
      provider: connectorsProvider,
      scopeKey,
      runEphemeralPrompt,
      runShellProposal: vi.fn(),
    }), { initialProps: { scopeKey: "agent:one" } });

    await act(async () => {
      await result.current.generateConnectorWorkflow("telegram");
    });
    rerender({ scopeKey: "agent:two" });
    await act(async () => {
      await result.current.generateConnectorWorkflow("telegram");
    });

    expect(runEphemeralPrompt).toHaveBeenCalledTimes(2);
  });

  it("does not preload from a failed connector inventory read", async () => {
    const connectorsProvider = channelProvider();
    vi.mocked(connectorsProvider.list).mockRejectedValue(new Error("status unavailable"));
    const runEphemeralPrompt = vi.fn(async (prompt: string) => workflowResponse(prompt));
    const { result } = renderHook(() => useConnectorWorkflow({
      provider: connectorsProvider,
      scopeKey: "agent:inventory-error",
      runEphemeralPrompt,
      runShellProposal: vi.fn(),
    }));

    await act(async () => {
      await result.current.preloadConnectorWorkflows(["telegram", "discord"]);
    });

    expect(runEphemeralPrompt).not.toHaveBeenCalled();
  });
});
