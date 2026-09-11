/**
 * `startAgent`'s OpenClaw gateway-token handling and the launch-config
 * construction both branches of START share.
 *
 * The pinned failure: the `OPENCLAW_GATEWAY_TOKEN` read used to sit in a bare
 * `catch {}`, so a transient 401/500/blocked fetch was misread as "no secret"
 * and a freshly minted token was written over a healthy one — invalidating
 * every live gateway session. Only a genuine 404 may mint.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APIError } from "../../ts-sdk/src/errors.ts";
import {
  agentSummary,
  agentFiles,
  agentTtsVoice,
  agentVoiceApiUnavailable,
  agentVoiceContentType,
  deleteAgentVoice,
  hasAgentVoice,
  resetSdkClient,
  startAgent,
  uploadAgentVoice,
  validateAgentVoiceFile,
} from "./api";

const fetchCalls = vi.hoisted(() => ({ fn: vi.fn() }));

const deployments = vi.hoisted(() => ({
  get: vi.fn(),
  secret: vi.fn(),
  setSecret: vi.fn(),
  filesList: vi.fn(),
  storedLaunchConfig: vi.fn(),
  startOpenClaw: vi.fn(),
  startHermesAgent: vi.fn(),
  start: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

vi.mock("../../ts-sdk/src/client.ts", () => ({
  HyperCLI: class {
    deployments = deployments;
  },
}));

vi.mock("./lib/credentials", () => ({
  resolveCredentials: vi.fn(async () => ({
    api_base: "https://api.hypercli.com/agents",
    token: "test-key",
  })),
  usingDevCredentials: vi.fn(() => false),
}));

vi.mock("./lib/endpoints", () => ({
  resolveEndpoints: () => ({
    httpBase: "https://api.hypercli.com/agents",
    apiBase: "https://api.hypercli.com/agents",
    proxied: false,
  }),
}));

const openClawAgent = {
  id: "agent-1",
  name: "claw",
  runtime: "openclaw",
  state: "STOPPED",
  launchEpoch: 1,
  launchConfig: { env: { FOO: "1" } },
};

const hermesAgent = {
  id: "agent-2",
  name: "hermes",
  runtime: "hermes-agent",
  state: "STOPPED",
  launchEpoch: 3,
  launchConfig: { env: {} },
};

/** A complete START replacement config, as `storedLaunchConfig` produces. */
const storedConfig = {
  image: "openclaw:latest",
  env: { FOO: "1" },
  secrets: {},
  routes: {},
  command: [],
  entrypoint: [],
  restart: false,
  sync_root: null,
  sync_uid: null,
  sync_gid: null,
  registry_url: null,
  registry_auth: {},
  runtime_scopes: [],
};

describe("startAgent (OpenClaw) gateway token", () => {
  beforeEach(() => {
    resetSdkClient();
    vi.clearAllMocks();
    deployments.get.mockResolvedValue(openClawAgent);
    deployments.storedLaunchConfig.mockResolvedValue(structuredClone(storedConfig));
    deployments.startOpenClaw.mockResolvedValue({ ...openClawAgent, state: "STARTING" });
    deployments.setSecret.mockResolvedValue({});
  });

  it("mints and writes a token only on a genuine 404", async () => {
    deployments.secret.mockRejectedValue(new APIError(404, "secret not found"));
    await startAgent("agent-1");
    expect(deployments.setSecret).toHaveBeenCalledTimes(1);
    const [, key, minted] = deployments.setSecret.mock.calls[0];
    expect(key).toBe("OPENCLAW_GATEWAY_TOKEN");
    expect(minted).toMatch(/^[0-9a-f]{64}$/);
    // The start carries the same token it just wrote — not a second mint.
    expect(deployments.startOpenClaw).toHaveBeenCalledWith(
      "agent-1",
      expect.objectContaining({ gatewayToken: minted }),
    );
  });

  it.each([
    ["a server error", new APIError(500, "internal")],
    ["an auth rejection", new APIError(401, "invalid api key")],
    ["a blocked fetch", new TypeError("Failed to fetch")],
  ])("aborts without touching the token when the read failed: %s", async (_why, error) => {
    deployments.secret.mockRejectedValue(error);
    await expect(startAgent("agent-1")).rejects.toThrow();
    // Above all: no fresh token may overwrite the unread, possibly healthy one.
    expect(deployments.setSecret).not.toHaveBeenCalled();
    expect(deployments.startOpenClaw).not.toHaveBeenCalled();
  });

  it("reuses the stored token without rewriting it", async () => {
    deployments.secret.mockResolvedValue({
      agent_id: "agent-1",
      key: "OPENCLAW_GATEWAY_TOKEN",
      value: "existing-token",
      launch_epoch: 1,
    });
    await startAgent("agent-1");
    expect(deployments.setSecret).not.toHaveBeenCalled();
    expect(deployments.startOpenClaw).toHaveBeenCalledWith(
      "agent-1",
      expect.objectContaining({ gatewayToken: "existing-token" }),
    );
  });

  it("starts with the complete stored launch config, env merged not replaced", async () => {
    deployments.secret.mockResolvedValue({ value: "existing-token" });
    await startAgent("agent-1");
    const options = deployments.startOpenClaw.mock.calls[0][1];
    expect(options.launchConfig.env.FOO).toBe("1");
    expect(options.launchConfig.env.OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN).toContain("http://tauri.localhost");
    // The complete replacement keys START requires, from the typed producer.
    expect(options.launchConfig.secrets).toEqual({});
    expect(options.launchConfig.registry_auth).toEqual({});
    expect(options.launchConfig.runtime_scopes).toEqual([]);
  });
});

describe("startAgent (Hermes)", () => {  beforeEach(() => {
    resetSdkClient();
    vi.clearAllMocks();
    deployments.get.mockResolvedValue(hermesAgent);
    deployments.storedLaunchConfig.mockResolvedValue(structuredClone(storedConfig));
    deployments.startHermesAgent.mockResolvedValue({ ...hermesAgent, state: "STARTING" });
  });

  it("hands startHermesAgent exactly what storedLaunchConfig produced", async () => {
    await startAgent("agent-2");
    expect(deployments.startHermesAgent).toHaveBeenCalledTimes(1);
    const [id, options] = deployments.startHermesAgent.mock.calls[0];
    expect(id).toBe("agent-2");
    expect(Object.keys(options)).toEqual(["launchConfig"]);
    expect(options.launchConfig).toEqual(storedConfig);
    // No gateway token is minted for Hermes.
    expect(deployments.secret).not.toHaveBeenCalled();
    expect(deployments.setSecret).not.toHaveBeenCalled();
  });
});

describe("agent files", () => {
  beforeEach(() => {
    resetSdkClient();
    vi.clearAllMocks();
  });

  it("explains the hidden 404 from a desktop key without file-token access", async () => {
    deployments.filesList.mockRejectedValue(new APIError(404, "Agent not found"));

    await expect(agentFiles("agent-1")).rejects.toThrow(/sign in again/i);
    expect(deployments.filesList).toHaveBeenCalledWith("agent-1", "");
  });
});

describe("agentSummary avatar_audio_url", () => {
  // Plain-object agents, as the SDK class surfaces them (it keeps known
  // fields only, so the raw snake_case value reaches us only in tests and
  // during the backend rollout).
  const asAgent = (fields: Record<string, unknown>) => fields as never;

  it("passes the field through when the agent carries it", () => {
    const summary = agentSummary(
      asAgent({ ...openClawAgent, avatar_audio_url: "https://example.com/voice.mp3" }),
    );
    expect(summary.avatar_audio_url).toBe("https://example.com/voice.mp3");
  });

  it("accepts a camelCase field, as a future SDK Agent class would expose", () => {
    const summary = agentSummary(
      asAgent({ ...openClawAgent, avatarAudioUrl: "https://example.com/voice.mp3" }),
    );
    expect(summary.avatar_audio_url).toBe("https://example.com/voice.mp3");
  });

  it("maps absent, null, and blank to no voice", () => {
    expect(agentSummary(asAgent(openClawAgent)).avatar_audio_url).toBeNull();
    expect(agentSummary(asAgent({ ...openClawAgent, avatar_audio_url: null })).avatar_audio_url).toBeNull();
    expect(agentSummary(asAgent({ ...openClawAgent, avatar_audio_url: "  " })).avatar_audio_url).toBeNull();
  });

  it("hasAgentVoice is true only for a non-empty url", () => {
    expect(hasAgentVoice(null)).toBe(false);
    expect(hasAgentVoice({ avatar_audio_url: null })).toBe(false);
    expect(hasAgentVoice({ avatar_audio_url: "" })).toBe(false);
    expect(hasAgentVoice({ avatar_audio_url: "https://example.com/voice.mp3" })).toBe(true);
  });
});

describe("agentTtsVoice", () => {
  it("returns nothing until the voice socket takes a voice reference", () => {
    // The one-line seam: when speak() (or speakClone) accepts the agent's
    // reference url, this becomes `agent.avatar_audio_url` and every
    // read-aloud call site picks it up unchanged.
    expect(agentTtsVoice(null)).toBeUndefined();
    expect(agentTtsVoice({ avatar_audio_url: "https://example.com/voice.mp3" })).toBeUndefined();
  });
});

describe("agent voice reference audio", () => {
  beforeEach(() => {
    fetchCalls.fn.mockReset();
    vi.stubGlobal("fetch", fetchCalls.fn);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const okBody = { id: "agent-1", avatar_audio_url: "https://example.com/voice.mp3", s3_key: "k" };
  const okResponse = () =>
    new Response(JSON.stringify(okBody), { status: 200, headers: { "Content-Type": "application/json" } });

  it("agentVoiceContentType trusts an accepted type and falls back to the extension", () => {
    expect(agentVoiceContentType({ type: "audio/mpeg", name: "clip.bin" })).toBe("audio/mpeg");
    expect(agentVoiceContentType({ type: "audio/mp4;codecs=mp4a", name: "clip.m4a" })).toBe("audio/mp4");
    expect(agentVoiceContentType({ type: "", name: "Clip.WAV" })).toBe("audio/wav");
    expect(agentVoiceContentType({ type: "application/octet-stream", name: "clip.mp3" })).toBe("audio/mpeg");
    expect(agentVoiceContentType({ type: "video/mp4", name: "clip.mov" })).toBe("video/mp4");
    expect(agentVoiceContentType({ type: "", name: "clip.flac" })).toBeNull();
  });

  it("validateAgentVoiceFile rejects empty, oversized, and unrecognizable files", () => {
    expect(validateAgentVoiceFile({ size: 0, type: "audio/mpeg", name: "clip.mp3" })).toMatch(/empty/);
    expect(validateAgentVoiceFile({ size: 16 * 1024 * 1024, type: "audio/mpeg", name: "clip.mp3" })).toMatch(/15 MB/);
    expect(validateAgentVoiceFile({ size: 100, type: "image/png", name: "clip.png" })).toMatch(/audio or video/);
    expect(validateAgentVoiceFile({ size: 100, type: "", name: "clip.m4a" })).toBeNull();
    expect(validateAgentVoiceFile({ size: 100, type: "video/webm", name: "clip.webm" })).toBeNull();
  });

  it("uploadAgentVoice POSTs raw bytes to the avatar-audio route with the resolved content type", async () => {
    fetchCalls.fn.mockResolvedValue(okResponse());
    const file = new File([new Uint8Array([1, 2, 3])], "clip.m4a", { type: "" });
    const result = await uploadAgentVoice("agent-1", file);
    expect(result).toEqual({ id: "agent-1", avatar_audio_url: "https://example.com/voice.mp3" });
    expect(fetchCalls.fn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchCalls.fn.mock.calls[0];
    expect(url).toBe("https://api.hypercli.com/agents/deployments/agent-1/avatar-audio");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("audio/mp4");
    expect(init.headers.Authorization).toBe("Bearer test-key");
    expect(init.body).toBeInstanceOf(Uint8Array);
  });

  it("deleteAgentVoice issues DELETE on the avatar-audio route", async () => {
    fetchCalls.fn.mockResolvedValue(
      new Response(JSON.stringify({ id: "agent-1", avatar_audio_url: null, s3_key: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const result = await deleteAgentVoice("agent-1");
    expect(result).toEqual({ id: "agent-1", avatar_audio_url: null });
    const [url, init] = fetchCalls.fn.mock.calls[0];
    expect(url).toBe("https://api.hypercli.com/agents/deployments/agent-1/avatar-audio");
    expect(init.method).toBe("DELETE");
  });

  it.each([404, 405])(
    "a %i from the avatar-audio route reports unavailable instead of throwing",
    async (status) => {
      fetchCalls.fn.mockResolvedValue(
        new Response(JSON.stringify({ detail: "not found" }), { status }),
      );
      const file = new File([new Uint8Array([1])], "clip.mp3", { type: "audio/mpeg" });
      const result = await uploadAgentVoice("agent-1", file);
      expect(result.unavailable).toBe(true);
      expect(result.avatar_audio_url).toBeNull();
      expect(agentVoiceApiUnavailable()).toBe(true);
    },
  );

  it("other failures still throw", async () => {
    fetchCalls.fn.mockResolvedValue(new Response(JSON.stringify({ detail: "nope" }), { status: 500 }));
    const file = new File([new Uint8Array([1])], "clip.mp3", { type: "audio/mpeg" });
    await expect(uploadAgentVoice("agent-1", file)).rejects.toBeInstanceOf(APIError);
  });

  it("uploadAgentVoice rejects when no content type resolves, before any fetch", async () => {
    const file = new File([new Uint8Array([1])], "clip.flac", { type: "" });
    await expect(uploadAgentVoice("agent-1", file)).rejects.toThrow(/unsupported/i);
    expect(fetchCalls.fn).not.toHaveBeenCalled();
  });
});
