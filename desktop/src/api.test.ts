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
import { OpenClawAgent } from "../../ts-sdk/src/agents.ts";
import {
  agentAvatarContentType,
  agentSummary,
  agentFiles,
  agentTtsOptions,
  agentVoiceApiUnavailable,
  agentVoiceContentType,
  createRuntimeSession,
  createVoiceTranscriptionSession,
  deleteAgentVoice,
  hasAgentVoice,
  resetSdkClient,
  speechStream,
  startAgent,
  uploadAgentVoice,
  validateAgentAvatarFile,
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

const voiceSessionMock = vi.hoisted(() => ({
  speak: vi.fn(),
  speakClone: vi.fn(),
  close: vi.fn(),
  constructed: [] as Array<{ wsUrl: string; credential: string }>,
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

vi.mock("../../ts-sdk/src/client.ts", () => ({
  HyperCLI: class {
    deployments = deployments;
  },
}));

vi.mock("../../ts-sdk/src/voice-session.ts", () => ({
  VoiceSession: class {
    constructor(options: { wsUrl: string; credential: string }) {
      voiceSessionMock.constructed.push(options);
    }

    async open() {
      return this;
    }

    speak(options: Record<string, unknown>) {
      return voiceSessionMock.speak(options);
    }

    speakClone(options: Record<string, unknown>) {
      return voiceSessionMock.speakClone(options);
    }

    close() {
      voiceSessionMock.close();
    }
  },
}));

const transcriptionSessionMock = vi.hoisted(() => ({
  open: vi.fn(),
  close: vi.fn(),
  constructed: [] as Array<{ wsUrl: string; credential: string; timeoutMs?: number }>,
}));

vi.mock("../../ts-sdk/src/voice-transcription-session.ts", () => ({
  VoiceTranscriptionSession: class {
    constructor(options: { wsUrl: string; credential: string; timeoutMs?: number }) {
      transcriptionSessionMock.constructed.push(options);
    }

    async open() {
      transcriptionSessionMock.open();
      return this;
    }

    close() {
      transcriptionSessionMock.close();
    }
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

  it("states every origin this app can have and lets the SDK merge the rest", async () => {
    deployments.secret.mockResolvedValue({ value: "existing-token" });
    await startAgent("agent-1");
    expect(deployments.startOpenClaw).toHaveBeenCalledWith("agent-1", {
      gatewayToken: "existing-token",
      controlUiAllowedOrigins: ["http://tauri.localhost", "tauri://localhost", "http://localhost:1420"],
    });
    // The stored launch config stays the SDK's problem: this app no longer
    // fetches it to hand-assemble a launchConfig env.
    expect(deployments.storedLaunchConfig).not.toHaveBeenCalled();
    expect(deployments.startOpenClaw.mock.calls[0][1]).not.toHaveProperty("launchConfig");
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

describe("createRuntimeSession (OpenClaw)", () => {
  beforeEach(() => {
    resetSdkClient();
    vi.clearAllMocks();
  });

  it("mints through the pooled gateway lease and returns the created key", async () => {
    const agent = OpenClawAgent.fromDict({
      id: "agent-1",
      user_id: "user-1",
      runtime: "openclaw",
      state: "RUNNING",
    });
    const sessionsCreate = vi.fn(async () => ({ key: "session-new" }));
    const release = vi.fn();
    agent.acquireConnectedGateway = vi.fn(async () => ({
      client: { sessionsCreate },
      release,
    })) as unknown as typeof agent.acquireConnectedGateway;
    deployments.get.mockResolvedValue(agent);

    await expect(createRuntimeSession("agent-1")).resolves.toBe("session-new");
    expect(sessionsCreate).toHaveBeenCalledWith({});
    expect(release).toHaveBeenCalledTimes(1);
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

describe("speechStream", () => {
  beforeEach(() => {
    resetSdkClient();
    vi.clearAllMocks();
    voiceSessionMock.constructed.length = 0;
    voiceSessionMock.speak.mockImplementation(async function* (options: Record<string, unknown>) {
      yield {
        requestId: "rpcm",
        index: 0,
        total: 1,
        audio: new Uint8Array([0, 0]),
        final: true,
        metadata: { format: "pcm", sampleRate: 24000, channels: 1, sampleFormat: "s16le", bytesPerSample: 2 },
        options,
      };
    });
    voiceSessionMock.speakClone.mockImplementation(async function* (options: Record<string, unknown>) {
      yield {
        requestId: "rclone",
        index: 0,
        total: 1,
        audio: new Uint8Array([0, 0]),
        final: true,
        metadata: { format: "pcm" },
        options,
      };
    });
  });

  it("requests chunked pcm and returns metadata-bearing chunks", async () => {
    const stream = await speechStream("Hello", { voice: "serena" });
    const chunks = [];
    for await (const chunk of stream.chunks) chunks.push(chunk);

    expect(voiceSessionMock.constructed[0]).toEqual({
      wsUrl: "wss://api.agents.hypercli.com/ws",
      credential: "test-key",
    });
    expect(voiceSessionMock.speak).toHaveBeenCalledWith({
      text: "Hello",
      voice: "serena",
      format: "pcm",
      chunks: true,
    });
    expect(chunks[0].metadata?.format).toBe("pcm");
    expect(voiceSessionMock.close).toHaveBeenCalledTimes(1);
  });

  it("adds pcm fallback metadata when the stream start metadata is absent", async () => {
    voiceSessionMock.speak.mockImplementation(async function* () {
      yield {
        requestId: "rpcm",
        index: 0,
        total: 1,
        audio: new Uint8Array([0, 0]),
        final: true,
      };
    });

    const stream = await speechStream("Hello");
    const chunks = [];
    for await (const chunk of stream.chunks) chunks.push(chunk);

    expect(chunks[0].metadata).toEqual({
      format: "pcm",
      contentType: "audio/pcm",
      sampleRate: 24000,
      channels: 1,
      sampleFormat: "s16le",
      bytesPerSample: 2,
    });
  });

  it("clones from the agent's reference audio when referenceAudioUrl is set", async () => {
    const referenceUrl = "https://cdn.example/voice-clone-a.wav";
    vi.stubGlobal("fetch", fetchCalls.fn);
    try {
      fetchCalls.fn.mockResolvedValue(new Response(new Uint8Array([9, 8, 7]).buffer, { status: 200 }));

      const stream = await speechStream("Hello", { referenceAudioUrl: referenceUrl });
      for await (const _ of stream.chunks) void _;

      expect(fetchCalls.fn).toHaveBeenCalledTimes(1);
      expect(fetchCalls.fn.mock.calls[0][0]).toBe(referenceUrl);
      expect(voiceSessionMock.speak).not.toHaveBeenCalled();
      expect(voiceSessionMock.speakClone).toHaveBeenCalledWith({
        text: "Hello",
        refAudio: new Uint8Array([9, 8, 7]),
        format: "pcm",
        chunks: true,
      });
      expect(voiceSessionMock.close).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("caches reference bytes per URL across requests", async () => {
    const referenceUrl = "https://cdn.example/voice-clone-cache.wav";
    vi.stubGlobal("fetch", fetchCalls.fn);
    try {
      fetchCalls.fn.mockResolvedValue(new Response(new Uint8Array([5]).buffer, { status: 200 }));

      for (let i = 0; i < 2; i += 1) {
        const stream = await speechStream(`Sentence ${i}.`, { referenceAudioUrl: referenceUrl });
        for await (const _ of stream.chunks) void _;
      }

      expect(fetchCalls.fn).toHaveBeenCalledTimes(1);
      expect(voiceSessionMock.speakClone).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("evicts a failed reference fetch so the next request retries", async () => {
    const referenceUrl = "https://cdn.example/voice-clone-retry.wav";
    vi.stubGlobal("fetch", fetchCalls.fn);
    try {
      fetchCalls.fn.mockRejectedValueOnce(new Error("network down"));
      // The reference fetch fails before any socket is dialled.
      await expect(speechStream("Hi", { referenceAudioUrl: referenceUrl })).rejects.toThrow(/network down/);
      expect(voiceSessionMock.constructed).toHaveLength(0);

      fetchCalls.fn.mockResolvedValue(new Response(new Uint8Array([1]).buffer, { status: 200 }));
      const stream = await speechStream("Hi", { referenceAudioUrl: referenceUrl });
      for await (const _ of stream.chunks) void _;

      expect(fetchCalls.fn).toHaveBeenCalledTimes(2);
      expect(voiceSessionMock.speakClone).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("a voice upload clears cached reference bytes", async () => {
    const referenceUrl = "https://cdn.example/voice-clone-stale.wav";
    vi.stubGlobal("fetch", fetchCalls.fn);
    try {
      fetchCalls.fn.mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === referenceUrl) {
          return new Response(new Uint8Array([3]).buffer, { status: 200 });
        }
        return new Response(JSON.stringify({ id: "agent-1", avatar_audio_url: referenceUrl, s3_key: "k" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      const first = await speechStream("Before.", { referenceAudioUrl: referenceUrl });
      for await (const _ of first.chunks) void _;
      expect(fetchCalls.fn).toHaveBeenCalledTimes(1);

      await uploadAgentVoice("agent-1", new File([new Uint8Array([1])], "clip.mp3", { type: "audio/mpeg" }));

      const second = await speechStream("After.", { referenceAudioUrl: referenceUrl });
      for await (const _ of second.chunks) void _;
      expect(fetchCalls.fn).toHaveBeenCalledTimes(3);
    } finally {
      vi.unstubAllGlobals();
    }
  });

});

describe("createVoiceTranscriptionSession", () => {
  beforeEach(() => {
    transcriptionSessionMock.constructed.length = 0;
    vi.clearAllMocks();
  });

  it("dials the agents WS base with the resolved credential and returns an open session", async () => {
    const session = await createVoiceTranscriptionSession();
    expect(transcriptionSessionMock.constructed[0]).toEqual({
      wsUrl: "wss://api.agents.hypercli.com/ws",
      credential: "test-key",
      timeoutMs: undefined,
    });
    expect(transcriptionSessionMock.open).toHaveBeenCalledTimes(1);
    expect(session).toBeTruthy();
  });

  it("threads a caller timeout through", async () => {
    await createVoiceTranscriptionSession({ timeoutMs: 30_000 });
    expect(transcriptionSessionMock.constructed[0].timeoutMs).toBe(30_000);
  });
});

describe("agentSummary avatar_audio_url", () => {
  // The SDK Agent class carries `avatarAudioUrl` (agents.ts maps the DTO's
  // `avatar_audio_url` at construction); these are plain-object stand-ins.
  const asAgent = (fields: Record<string, unknown>) => fields as never;

  it("passes the field through when the agent carries it", () => {
    const summary = agentSummary(
      asAgent({ ...openClawAgent, avatarAudioUrl: "https://example.com/voice.mp3" }),
    );
    expect(summary.avatar_audio_url).toBe("https://example.com/voice.mp3");
  });

  it("maps absent, null, and blank to no voice", () => {
    expect(agentSummary(asAgent(openClawAgent)).avatar_audio_url).toBeNull();
    expect(agentSummary(asAgent({ ...openClawAgent, avatarAudioUrl: null })).avatar_audio_url).toBeNull();
    expect(agentSummary(asAgent({ ...openClawAgent, avatarAudioUrl: "  " })).avatar_audio_url).toBeNull();
  });

  it("hasAgentVoice is true only for a non-empty url", () => {
    expect(hasAgentVoice(null)).toBe(false);
    expect(hasAgentVoice({ avatar_audio_url: null })).toBe(false);
    expect(hasAgentVoice({ avatar_audio_url: "" })).toBe(false);
    expect(hasAgentVoice({ avatar_audio_url: "https://example.com/voice.mp3" })).toBe(true);
  });
});

describe("agentTtsOptions", () => {
  it("gives unvoiced agents no read-aloud mode", () => {
    expect(agentTtsOptions(null)).toEqual({});
    expect(agentTtsOptions({ avatar_audio_url: null })).toEqual({});
  });

  it("threads avatar_audio_url as the clone reference for voiced agents", () => {
    expect(agentTtsOptions({ avatar_audio_url: "https://example.com/voice.mp3" })).toEqual({
      referenceAudioUrl: "https://example.com/voice.mp3",
    });
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

  it("agentAvatarContentType trusts an accepted image type and falls back to the extension", () => {
    expect(agentAvatarContentType({ type: "image/png", name: "face.bin" })).toBe("image/png");
    expect(agentAvatarContentType({ type: "", name: "Face.JPG" })).toBe("image/jpeg");
    expect(agentAvatarContentType({ type: "application/octet-stream", name: "face.webp" })).toBe("image/webp");
    expect(agentAvatarContentType({ type: "", name: "face.gif" })).toBe("image/gif");
    expect(agentAvatarContentType({ type: "", name: "clip.mp3" })).toBeNull();
    expect(agentAvatarContentType({ type: "", name: "noext" })).toBeNull();
    expect(agentAvatarContentType({ type: "image/svg+xml", name: "face.svg" })).toBeNull();
  });

  it("validateAgentAvatarFile rejects empty and non-image files, accepts picker and drop shapes", () => {
    expect(validateAgentAvatarFile({ size: 0, type: "image/png", name: "face.png" })).toMatch(/empty/);
    expect(validateAgentAvatarFile({ size: 100, type: "audio/mpeg", name: "clip.mp3" })).toMatch(/image/);
    expect(validateAgentAvatarFile({ size: 100, type: "", name: "notes.txt" })).toMatch(/image/);
    expect(validateAgentAvatarFile({ size: 100, type: "image/jpeg", name: "face" })).toBeNull();
    expect(validateAgentAvatarFile({ size: 100, type: "", name: "face.PNG" })).toBeNull();
    expect(validateAgentAvatarFile({ size: 100, type: "image/webp", name: "face.webp" })).toBeNull();
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
