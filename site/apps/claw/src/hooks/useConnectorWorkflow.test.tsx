import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AgentConnectorsProvider } from "@hypercli.com/sdk/connectors";
import type { GatewayEphemeralChatOptions } from "@hypercli.com/sdk/openclaw/gateway";

import { CONNECTOR_WORKFLOW_PROMPT_REVISION, CONNECTOR_WORKFLOW_SCHEMA_ID } from "@/lib/connector-workflow";
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
  const connectorId = prompt.match(/Plan a (telegram|discord|slack|whatsapp) connector/)?.[1] ?? "telegram";
  const fingerprint = Array.from(prompt.matchAll(/"runtimeFingerprint":"([^"]+)"/g)).at(-1)?.[1];
  return JSON.stringify({
    schema: CONNECTOR_WORKFLOW_SCHEMA_ID,
    connectorId,
    runtimeFingerprint: fingerprint,
    summary: `Connect ${connectorId}.`,
    steps: [
      { id: "open", title: "Open setup", instructions: "Open the official setup page.", kind: "instruction", url: `https://${connectorId}.com` },
      { id: "create", title: "Create connection", instructions: "Create the connection.", kind: "instruction" },
      { id: "configure", title: "Configure access", instructions: "Configure access in the protected fields.", kind: "input" },
      { id: "verify", title: "Verify connection", instructions: "Check the connection status.", kind: "verify" },
    ],
  });
}

describe("useConnectorWorkflow", () => {
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

  it("regenerates when the connector setup state changes", async () => {
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

    await expect(result.current.generateConnectorWorkflow("telegram")).resolves.toEqual(
      expect.objectContaining({ summary: "Connect Telegram." }),
    );
    configured = true;
    await expect(result.current.generateConnectorWorkflow("telegram")).resolves.toEqual(
      expect.objectContaining({ summary: "Verify Telegram." }),
    );

    expect(runEphemeralPrompt).toHaveBeenCalledTimes(2);
  });

  it("regenerates an unconfigured connector workflow when all structured links are missing", async () => {
    let call = 0;
    const runEphemeralPrompt = vi.fn(async (prompt: string) => {
      call += 1;
      const fingerprint = Array.from(prompt.matchAll(/"runtimeFingerprint":"([^"]+)"/g)).at(-1)?.[1];
      return JSON.stringify({
        schema: CONNECTOR_WORKFLOW_SCHEMA_ID,
        connectorId: "telegram",
        runtimeFingerprint: fingerprint,
        summary: "Connect Telegram.",
        steps: call > 1 ? [{
          id: "open",
          title: "Open setup",
          instructions: "Open the official setup destination.",
          kind: "instruction",
          url: "https://telegram.org",
        }, {
          id: "create",
          title: "Create bot",
          instructions: "Create the bot.",
          kind: "instruction",
        }, {
          id: "token",
          title: "Enter token",
          instructions: "Use the protected field.",
          kind: "input",
          inputSlots: ["telegram.botToken"],
        }, {
          id: "verify",
          title: "Verify connection",
          instructions: "Check runtime status.",
          kind: "verify",
          operation: "telegram.verify",
        }] : [{
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

    await expect(result.current.generateConnectorWorkflow("telegram")).resolves.toEqual(
      expect.objectContaining({ steps: expect.arrayContaining([expect.objectContaining({ url: "https://telegram.org" })]) }),
    );
    expect(runEphemeralPrompt).toHaveBeenCalledTimes(2);
    expect(runEphemeralPrompt.mock.calls.every(([prompt]) => !prompt.startsWith("/fast on\n"))).toBe(true);
    expect(runEphemeralPrompt.mock.calls[1]?.[0]).toContain("Correction required");
  });

  it("regroups adjacent steps that repeat the same external destination", async () => {
    let call = 0;
    const runEphemeralPrompt = vi.fn(async (prompt: string) => {
      call += 1;
      const fingerprint = Array.from(prompt.matchAll(/"runtimeFingerprint":"([^"]+)"/g)).at(-1)?.[1];
      return JSON.stringify({
        schema: CONNECTOR_WORKFLOW_SCHEMA_ID,
        connectorId: "slack",
        runtimeFingerprint: fingerprint,
        summary: "Connect a communication workspace.",
        steps: call === 1 ? [{
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
        }] : [{
          id: "create-app",
          title: "Create an app",
          instructions: "Open the official configuration page and create the app there.",
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

    const workflow = await result.current.generateConnectorWorkflow("slack");

    expect(runEphemeralPrompt).toHaveBeenCalledTimes(2);
    expect(runEphemeralPrompt.mock.calls[1]?.[0]).toContain("repeat the same destination");
    expect(workflow.steps.map((step) => step.id)).toEqual(["create-app", "enter-token", "verify"]);
    expect(workflow.steps.filter((step) => step.url)).toHaveLength(1);
  });

  it("retries when the first response is malformed", async () => {
    let call = 0;
    const runEphemeralPrompt = vi.fn(async (prompt: string) => {
      call += 1;
      if (call === 1) return "not json";
      const fingerprint = Array.from(prompt.matchAll(/"runtimeFingerprint":"([^"]+)"/g)).at(-1)?.[1];
      return JSON.stringify({
        schema: CONNECTOR_WORKFLOW_SCHEMA_ID,
        connectorId: "telegram",
        runtimeFingerprint: fingerprint,
        summary: "Connect Telegram.",
        steps: [
          { id: "open", title: "Open setup", instructions: "Open the official page.", kind: "instruction", url: "https://telegram.org" },
          { id: "create", title: "Create bot", instructions: "Create the bot.", kind: "instruction" },
          { id: "token", title: "Enter token", instructions: "Use the protected field.", kind: "input", inputSlots: ["telegram.botToken"] },
          { id: "verify", title: "Verify", instructions: "Check status.", kind: "verify", operation: "telegram.verify" },
        ],
      });
    });
    const { result } = renderHook(() => useConnectorWorkflow({
      provider: provider(),
      scopeKey: "agent:test",
      runEphemeralPrompt,
      runShellProposal: vi.fn(),
    }));

    await expect(result.current.generateConnectorWorkflow("telegram")).resolves.toEqual(
      expect.objectContaining({ steps: expect.arrayContaining([expect.objectContaining({ url: "https://telegram.org" })]) }),
    );
    expect(runEphemeralPrompt).toHaveBeenCalledTimes(2);
    expect(runEphemeralPrompt.mock.calls.every(([prompt]) => !prompt.startsWith("/fast on\n"))).toBe(true);
    expect(runEphemeralPrompt.mock.calls.every(([, options]) => options?.fastMode === true)).toBe(true);
    expect(runEphemeralPrompt.mock.calls[1]?.[0]).toContain("Retry required");
  });

  it("keeps a validated guide when optional link enrichment fails", async () => {
    let call = 0;
    const runEphemeralPrompt = vi.fn(async (prompt: string) => {
      call += 1;
      if (call > 1) return "correction failed";
      const fingerprint = Array.from(prompt.matchAll(/"runtimeFingerprint":"([^"]+)"/g)).at(-1)?.[1];
      return JSON.stringify({
        schema: CONNECTOR_WORKFLOW_SCHEMA_ID,
        connectorId: "telegram",
        runtimeFingerprint: fingerprint,
        summary: "Connect Telegram.",
        steps: [{ id: "configure", title: "Configure bot", instructions: "Follow the setup flow.", kind: "instruction" }],
      });
    });
    const { result } = renderHook(() => useConnectorWorkflow({
      provider: provider(),
      scopeKey: "agent:test",
      runEphemeralPrompt,
      runShellProposal: vi.fn(),
    }));

    await expect(result.current.generateConnectorWorkflow("telegram")).resolves.toEqual(
      expect.objectContaining({ steps: [expect.objectContaining({ id: "configure" })] }),
    );
    expect(runEphemeralPrompt).toHaveBeenCalledTimes(2);
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
  });

  it("preloads unconfigured channel workflows serially and reuses the cache on demand", async () => {
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
    expect(runEphemeralPrompt).toHaveBeenCalledTimes(1);

    for (let expectedCalls = 2; expectedCalls <= 4; expectedCalls += 1) {
      await act(async () => pending.shift()?.());
      await waitFor(() => expect(runEphemeralPrompt).toHaveBeenCalledTimes(expectedCalls));
    }
    await act(async () => pending.shift()?.());
    await waitFor(() => expect(active).toBe(0));

    await expect(result.current.generateConnectorWorkflow("telegram")).resolves.toEqual(
      expect.objectContaining({ connectorId: "telegram" }),
    );
    expect(runEphemeralPrompt).toHaveBeenCalledTimes(4);
    expect(maxActive).toBe(1);
  });

  it("does not preload configured channels", async () => {
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

    expect(runEphemeralPrompt).not.toHaveBeenCalled();
  });

  it("aborts active preload work when interactive chat becomes busy", async () => {
    const connectorsProvider = channelProvider();
    let capturedSignal: GatewayEphemeralChatOptions["signal"];
    const runEphemeralPrompt = vi.fn((_prompt: string, options?: GatewayEphemeralChatOptions) => new Promise<string>((_resolve, reject) => {
      capturedSignal = options?.signal;
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
      await result.current.preloadConnectorWorkflows(["telegram"]);
    });
    await waitFor(() => expect(runEphemeralPrompt).toHaveBeenCalledTimes(1));

    rerender({ blocked: true });

    await waitFor(() => expect(capturedSignal?.aborted).toBe(true));
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

    await expect(result.current.generateConnectorWorkflow("telegram")).resolves.toEqual(
      expect.objectContaining({ connectorId: "telegram" }),
    );
    rerender({ scopeKey: "agent:two" });
    await expect(result.current.generateConnectorWorkflow("telegram")).resolves.toEqual(
      expect.objectContaining({ connectorId: "telegram" }),
    );

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
