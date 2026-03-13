/**
 * OpenClaw Gateway WebSocket Client
 *
 * Connects to an agent's OpenClaw gateway over WebSocket for real-time
 * configuration, chat, session management, and file operations.
 *
 * Protocol: OpenClaw Gateway v3
 */

import { getPublicKeyAsync, signAsync, utils as edUtils } from "@noble/ed25519";

export interface GatewayOptions {
  /** WebSocket URL (wss://openclaw-{agent}.hypercli.com) */
  url: string;
  /** Optional legacy query token for edge/proxy auth. Gateway auth uses `gatewayToken`. */
  token?: string;
  /** Shared gateway auth token used in the WebSocket connect handshake. */
  gatewayToken?: string;
  /** Deployment id used for trusted pairing approval via agent exec. */
  deploymentId?: string;
  /** HyperCLI API bearer token used for trusted pairing approval via agent exec. */
  apiKey?: string;
  /** HyperCLI API base URL used for trusted pairing approval via agent exec. */
  apiBase?: string;
  /** Automatically approve first-time browser pairing using trusted agent exec. */
  autoApprovePairing?: boolean;
  /** Client ID (default: "openclaw-control-ui") */
  clientId?: string;
  /** Client mode (default: "webchat") */
  clientMode?: string;
  /** Optional client display name */
  clientDisplayName?: string;
  /** Client version sent to the gateway */
  clientVersion?: string;
  /** Client platform sent to the gateway */
  platform?: string;
  /** Optional client instance ID */
  instanceId?: string;
  /** Optional gateway capability list */
  caps?: string[];
  /** Origin header (default: "https://hypercli.com") */
  origin?: string;
  /** Default RPC timeout in ms (default: 15000) */
  timeout?: number;
  /** Called after a successful hello-ok response */
  onHello?: (hello: Record<string, any>) => void;
  /** Called after the socket closes */
  onClose?: (info: GatewayCloseInfo) => void;
  /** Called when an event sequence gap is detected */
  onGap?: (info: { expected: number; received: number }) => void;
  /** Called when a browser device pairing request is pending or updated. */
  onPairing?: (pairing: GatewayPairingState | null) => void;
}

export interface GatewayEvent {
  type: string;
  event: string;
  payload: Record<string, any>;
  seq?: number;
}

export interface ChatEvent {
  type: "content" | "thinking" | "tool_call" | "tool_result" | "done" | "error";
  text?: string;
  data?: Record<string, any>;
}

export interface ChatAttachment {
  type: string;
  mimeType: string;
  content: string;
  fileName?: string;
}

export interface GatewayCloseInfo {
  code: number;
  reason: string;
  error?: GatewayErrorShape | null;
}

export interface GatewayPairingState {
  requestId: string;
  role: string;
  gatewayUrl: string;
  deviceId?: string;
  status: "pending" | "approving" | "approved" | "failed";
  updatedAtMs: number;
  error?: string;
}

export type GatewayEventHandler = (event: GatewayEvent) => void;

type PendingRequest = {
  resolve: (value: any) => void;
  reject: (err: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
};

type DeviceTokenEntry = {
  token: string;
  role: string;
  scopes: string[];
  updatedAtMs: number;
};

type DeviceAuthStore = {
  version: 1;
  deviceId?: string;
  publicKey?: string;
  privateKey?: string;
  createdAtMs?: number;
  tokens?: Record<string, DeviceTokenEntry>;
  pendingPairings?: Record<string, GatewayPairingState>;
};

type DeviceIdentityRecord = {
  deviceId: string;
  publicKey: string;
  privateKey: string;
  createdAtMs?: number;
};

type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

type NavigatorLike = {
  platform?: string;
  userAgent?: string;
  language?: string;
};

type GatewayErrorShape = {
  code: string;
  message: string;
  details?: unknown;
};

class GatewayRequestError extends Error {
  readonly gatewayCode: string;
  readonly details?: unknown;

  constructor(error: GatewayErrorShape) {
    super(error.message);
    this.name = "GatewayRequestError";
    this.gatewayCode = error.code;
    this.details = error.details;
  }
}

const PROTOCOL_VERSION = 3;
const DEFAULT_TIMEOUT = 15_000;
const CHAT_TIMEOUT = 120_000;
const RECONNECT_CLOSE_CODE = 4008;
const DEFAULT_CLIENT_ID = "openclaw-control-ui";
const DEFAULT_CLIENT_MODE = "webchat";
const DEFAULT_CLIENT_VERSION = "@hypercli/sdk";
const DEFAULT_CAPS = ["tool-events"];
const CONNECT_TIMER_MS = 750;
const INITIAL_BACKOFF_MS = 800;
const MAX_BACKOFF_MS = 15_000;
const BACKOFF_MULTIPLIER = 1.7;
const OPERATOR_ROLE = "operator";
const OPERATOR_SCOPES = ["operator.admin", "operator.approvals", "operator.pairing"];
const STORAGE_KEY = "openclaw.device.auth.v1";
const CONNECT_ERROR_PAIRING_REQUIRED = "PAIRING_REQUIRED";
const CONNECT_ERROR_DEVICE_TOKEN_MISMATCH = "AUTH_DEVICE_TOKEN_MISMATCH";
const VALID_CLIENT_IDS = new Set([
  "webchat-ui",
  "openclaw-control-ui",
  "webchat",
  "cli",
  "gateway-client",
  "openclaw-macos",
  "openclaw-ios",
  "openclaw-android",
  "node-host",
  "test",
  "fingerprint",
  "openclaw-probe",
]);
const VALID_CLIENT_MODES = new Set([
  "webchat",
  "cli",
  "ui",
  "backend",
  "node",
  "probe",
  "test",
]);

let memoryDeviceAuthStore: DeviceAuthStore | null = null;

function makeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = Math.random() * 16 | 0;
    return (char === "x" ? random : (random & 0x3) | 0x8).toString(16);
  });
}

function normalizeClientId(value: string | undefined): string {
  const normalized = value?.trim().toLowerCase();
  return normalized && VALID_CLIENT_IDS.has(normalized) ? normalized : DEFAULT_CLIENT_ID;
}

function normalizeClientMode(value: string | undefined): string {
  const normalized = value?.trim().toLowerCase();
  return normalized && VALID_CLIENT_MODES.has(normalized) ? normalized : DEFAULT_CLIENT_MODE;
}

function getNavigatorLike(): NavigatorLike | null {
  const maybeNavigator = (globalThis as typeof globalThis & { navigator?: NavigatorLike }).navigator;
  return maybeNavigator ?? null;
}

function resolvePlatform(value: string | undefined): string {
  const normalized = value?.trim();
  if (normalized) return normalized;
  const browserNavigator = getNavigatorLike();
  if (browserNavigator?.platform) return browserNavigator.platform;
  if (typeof process !== "undefined" && process.platform) return process.platform;
  return "web";
}

function inferBrowserName(userAgent: string | undefined): string | null {
  const ua = userAgent ?? "";
  if (!ua) return null;
  if (/Firefox\//i.test(ua)) return "Firefox";
  if (/Edg\//i.test(ua)) return "Edge";
  if (/Chrome\//i.test(ua) && !/Edg\//i.test(ua)) return "Chrome";
  if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) return "Safari";
  return null;
}

function inferPlatformName(platform: string): string | null {
  const normalized = platform.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.includes("mac")) return "macOS";
  if (normalized.includes("win")) return "Windows";
  if (normalized.includes("linux")) return "Linux";
  if (normalized.includes("iphone") || normalized.includes("ipad") || normalized.includes("ios")) {
    return "iOS";
  }
  if (normalized.includes("android")) return "Android";
  return platform.trim();
}

function resolveBrowserHost(): string | null {
  const browserWindow = (globalThis as typeof globalThis & {
    window?: { location?: { hostname?: string } };
  }).window;
  const hostname = browserWindow?.location?.hostname?.trim();
  return hostname || null;
}

function resolveClientDisplayName(value: string | undefined, platform: string): string {
  const provided = value?.trim();
  if (provided) return provided;
  const browserName = inferBrowserName(resolveUserAgent());
  const platformName = inferPlatformName(platform);
  const host = resolveBrowserHost();
  const details = [browserName, platformName ? `on ${platformName}` : null]
    .filter(Boolean)
    .join(" ");
  if (details && host) {
    return `Hyper Agent Web (${details}, ${host})`;
  }
  if (details) {
    return `Hyper Agent Web (${details})`;
  }
  if (host) {
    return `Hyper Agent Web (${host})`;
  }
  return "Hyper Agent Web";
}

function normalizeScopes(scopes: string[] | undefined): string[] {
  if (!Array.isArray(scopes)) {
    return [];
  }
  const unique = new Set<string>();
  for (const scope of scopes) {
    const normalized = scope.trim();
    if (normalized) unique.add(normalized);
  }
  return [...unique].sort();
}

function getStorage(): StorageLike | null {
  const storage = (globalThis as typeof globalThis & { localStorage?: StorageLike }).localStorage;
  return storage ?? null;
}

function readDeviceAuthStore(): DeviceAuthStore | null {
  const storage = getStorage();
  if (!storage) {
    return memoryDeviceAuthStore;
  }
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DeviceAuthStore;
    return parsed?.version === 1 && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function writeDeviceAuthStore(store: DeviceAuthStore): void {
  const normalized: DeviceAuthStore = {
    version: 1,
    ...(store.deviceId ? { deviceId: store.deviceId } : {}),
    ...(store.publicKey ? { publicKey: store.publicKey } : {}),
    ...(store.privateKey ? { privateKey: store.privateKey } : {}),
    ...(typeof store.createdAtMs === "number" ? { createdAtMs: store.createdAtMs } : {}),
    ...(store.tokens ? { tokens: store.tokens } : {}),
    ...(store.pendingPairings ? { pendingPairings: store.pendingPairings } : {}),
  };
  const storage = getStorage();
  if (!storage) {
    memoryDeviceAuthStore = normalized;
    return;
  }
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    memoryDeviceAuthStore = normalized;
  }
}

function loadStoredDeviceToken(deviceId: string, role: string): DeviceTokenEntry | null {
  const store = readDeviceAuthStore();
  if (!store || store.deviceId !== deviceId || !store.tokens) return null;
  const entry = store.tokens[role.trim()];
  return entry && typeof entry.token === "string" ? entry : null;
}

function storeStoredDeviceToken(params: {
  deviceId: string;
  role: string;
  token: string;
  scopes?: string[];
}): DeviceTokenEntry {
  const role = params.role.trim();
  const existing = readDeviceAuthStore();
  const next: DeviceAuthStore = {
    version: 1,
    ...(existing?.deviceId ? { deviceId: existing.deviceId } : {}),
    ...(existing?.publicKey ? { publicKey: existing.publicKey } : {}),
    ...(existing?.privateKey ? { privateKey: existing.privateKey } : {}),
    ...(typeof existing?.createdAtMs === "number" ? { createdAtMs: existing.createdAtMs } : {}),
    ...(existing?.pendingPairings ? { pendingPairings: existing.pendingPairings } : {}),
    tokens: {
      ...(existing?.tokens ?? {}),
      [role]: {
        token: params.token,
        role,
        scopes: normalizeScopes(params.scopes),
        updatedAtMs: Date.now(),
      },
    },
  };
  if (!next.deviceId) {
    next.deviceId = params.deviceId;
  }
  writeDeviceAuthStore(next);
  return next.tokens?.[role] as DeviceTokenEntry;
}

function clearStoredDeviceToken(deviceId: string, role: string): void {
  const store = readDeviceAuthStore();
  if (!store || store.deviceId !== deviceId || !store.tokens) return;
  const normalizedRole = role.trim();
  if (!store.tokens[normalizedRole]) return;
  const nextTokens = { ...store.tokens };
  delete nextTokens[normalizedRole];
  writeDeviceAuthStore({
    version: 1,
    ...(store.deviceId ? { deviceId: store.deviceId } : {}),
    ...(store.publicKey ? { publicKey: store.publicKey } : {}),
    ...(store.privateKey ? { privateKey: store.privateKey } : {}),
    ...(typeof store.createdAtMs === "number" ? { createdAtMs: store.createdAtMs } : {}),
    ...(store.pendingPairings ? { pendingPairings: store.pendingPairings } : {}),
    tokens: nextTokens,
  });
}

function pairingStoreKey(gatewayUrl: string, role: string): string {
  return `${gatewayUrl.trim()}|${role.trim()}`;
}

function loadPendingPairing(gatewayUrl: string, role: string): GatewayPairingState | null {
  const store = readDeviceAuthStore();
  const key = pairingStoreKey(gatewayUrl, role);
  return store?.pendingPairings?.[key] ?? null;
}

function storePendingPairing(pairing: GatewayPairingState): GatewayPairingState {
  const existing = readDeviceAuthStore();
  const key = pairingStoreKey(pairing.gatewayUrl, pairing.role);
  writeDeviceAuthStore({
    version: 1,
    ...(existing?.deviceId ? { deviceId: existing.deviceId } : {}),
    ...(existing?.publicKey ? { publicKey: existing.publicKey } : {}),
    ...(existing?.privateKey ? { privateKey: existing.privateKey } : {}),
    ...(typeof existing?.createdAtMs === "number" ? { createdAtMs: existing.createdAtMs } : {}),
    ...(existing?.tokens ? { tokens: existing.tokens } : {}),
    pendingPairings: {
      ...(existing?.pendingPairings ?? {}),
      [key]: pairing,
    },
  });
  return pairing;
}

function clearPendingPairing(gatewayUrl: string, role: string): void {
  const store = readDeviceAuthStore();
  if (!store?.pendingPairings) return;
  const key = pairingStoreKey(gatewayUrl, role);
  if (!store.pendingPairings[key]) return;
  const nextPendingPairings = { ...store.pendingPairings };
  delete nextPendingPairings[key];
  writeDeviceAuthStore({
    version: 1,
    ...(store.deviceId ? { deviceId: store.deviceId } : {}),
    ...(store.publicKey ? { publicKey: store.publicKey } : {}),
    ...(store.privateKey ? { privateKey: store.privateKey } : {}),
    ...(typeof store.createdAtMs === "number" ? { createdAtMs: store.createdAtMs } : {}),
    ...(store.tokens ? { tokens: store.tokens } : {}),
    ...(Object.keys(nextPendingPairings).length > 0 ? { pendingPairings: nextPendingPairings } : {}),
  });
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64Url(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  }
  const encoder = globalThis as typeof globalThis & { btoa?: (value: string) => string };
  if (typeof encoder.btoa !== "function") {
    throw new Error("base64 encoder unavailable");
  }
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return encoder
    .btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(padded, "base64"));
  }
  const decoder = globalThis as typeof globalThis & { atob?: (encoded: string) => string };
  if (typeof decoder.atob !== "function") {
    throw new Error("base64 decoder unavailable");
  }
  const binary = decoder.atob(padded);
  const output = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    output[index] = binary.charCodeAt(index);
  }
  return output;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("crypto.subtle is required for device auth");
  }
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return bytesToHex(new Uint8Array(digest));
}

async function loadOrCreateDeviceIdentity(): Promise<DeviceIdentityRecord> {
  const store = readDeviceAuthStore();
  if (
    store?.version === 1 &&
    typeof store.deviceId === "string" &&
    typeof store.publicKey === "string" &&
    typeof store.privateKey === "string"
  ) {
    const derivedId = await sha256Hex(base64UrlToBytes(store.publicKey));
    if (derivedId !== store.deviceId) {
      writeDeviceAuthStore({
        ...store,
        version: 1,
        deviceId: derivedId,
      });
      return {
        deviceId: derivedId,
        publicKey: store.publicKey,
        privateKey: store.privateKey,
        createdAtMs: store.createdAtMs,
      };
    }
    return {
      deviceId: store.deviceId,
      publicKey: store.publicKey,
      privateKey: store.privateKey,
      createdAtMs: store.createdAtMs,
    };
  }

  const privateKeyBytes = edUtils.randomSecretKey();
  const publicKeyBytes = await getPublicKeyAsync(privateKeyBytes);
  const deviceId = await sha256Hex(publicKeyBytes);
  const identity: DeviceIdentityRecord = {
    deviceId,
    publicKey: bytesToBase64Url(publicKeyBytes),
    privateKey: bytesToBase64Url(privateKeyBytes),
    createdAtMs: Date.now(),
  };
  writeDeviceAuthStore({
    version: 1,
    ...identity,
    ...(store?.tokens ? { tokens: store.tokens } : {}),
  });
  return identity;
}

async function signDevicePayload(privateKey: string, payload: string): Promise<string> {
  const signature = await signAsync(new TextEncoder().encode(payload), base64UrlToBytes(privateKey));
  return bytesToBase64Url(signature);
}

function buildDeviceAuthPayload(params: {
  deviceId: string;
  clientId: string;
  clientMode: string;
  role: string;
  scopes: string[];
  signedAtMs: number;
  token?: string | null;
  nonce: string;
}): string {
  return [
    "v2",
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    params.scopes.join(","),
    String(params.signedAtMs),
    params.token ?? "",
    params.nonce,
  ].join("|");
}

function toCloseError(error: unknown): GatewayErrorShape | null {
  if (error instanceof GatewayRequestError) {
    return {
      code: error.gatewayCode,
      message: error.message,
      details: error.details,
    };
  }
  if (error instanceof Error) {
    return {
      code: "UNAVAILABLE",
      message: error.message,
    };
  }
  return null;
}

function readConnectErrorCode(error: unknown): string | null {
  if (!(error instanceof GatewayRequestError)) return null;
  const details = error.details;
  if (!details || typeof details !== "object" || Array.isArray(details)) return null;
  const code = (details as { code?: unknown }).code;
  return typeof code === "string" && code.trim() ? code.trim() : null;
}

function readConnectPairingRequestId(error: unknown): string | null {
  if (!(error instanceof GatewayRequestError)) return null;
  const details = error.details;
  if (!details || typeof details !== "object" || Array.isArray(details)) return null;
  const requestId = (details as { requestId?: unknown }).requestId;
  return typeof requestId === "string" && requestId.trim() ? requestId.trim() : null;
}

function isSocketOpen(ws: WebSocket | null): boolean {
  return Boolean(ws && ws.readyState === 1);
}

function resolveUserAgent(): string | undefined {
  return getNavigatorLike()?.userAgent;
}

function resolveLocale(): string | undefined {
  return getNavigatorLike()?.language;
}

export class GatewayClient {
  private url: string;
  private token?: string;
  private gatewayToken?: string;
  private deploymentId?: string;
  private apiKey?: string;
  private apiBase?: string;
  private autoApprovePairing: boolean;
  private clientId: string;
  private clientMode: string;
  private clientDisplayName?: string;
  private clientVersion: string;
  private clientPlatform: string;
  private clientInstanceId?: string;
  private caps: string[];
  private origin: string;
  private defaultTimeout: number;
  private ws: WebSocket | null = null;
  private pending = new Map<string, PendingRequest>();
  private eventHandlers = new Set<GatewayEventHandler>();
  private connected = false;
  private closed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private backoffMs = INITIAL_BACKOFF_MS;
  private connectNonce: string | null = null;
  private connectSent = false;
  private pendingConnectError: GatewayErrorShape | null = null;
  private pairingState: GatewayPairingState | null = null;
  private autoApproveAttemptedRequestIds = new Set<string>();
  private lastSeq: number | null = null;
  private connectPromise: Promise<void> | null = null;
  private resolveConnectPromise: (() => void) | null = null;
  private rejectConnectPromise: ((error: unknown) => void) | null = null;
  private _version: string | null = null;
  private _protocol: number | null = null;
  onDisconnect: (() => void) | null = null;

  constructor(options: GatewayOptions) {
    this.url = options.url;
    this.token = options.token?.trim() || undefined;
    this.gatewayToken = options.gatewayToken?.trim() || undefined;
    this.deploymentId = options.deploymentId?.trim() || undefined;
    this.apiKey = options.apiKey?.trim() || undefined;
    this.apiBase = options.apiBase?.trim().replace(/\/$/, "") || undefined;
    this.autoApprovePairing = options.autoApprovePairing === true;
    this.clientId = normalizeClientId(options.clientId);
    this.clientMode = normalizeClientMode(options.clientMode);
    this.clientVersion = options.clientVersion?.trim() || DEFAULT_CLIENT_VERSION;
    this.clientPlatform = resolvePlatform(options.platform);
    this.clientDisplayName = resolveClientDisplayName(options.clientDisplayName, this.clientPlatform);
    this.clientInstanceId = options.instanceId?.trim() || makeId();
    this.caps = Array.isArray(options.caps)
      ? options.caps.map((cap) => cap.trim()).filter(Boolean)
      : [...DEFAULT_CAPS];
    this.origin = options.origin ?? "https://hypercli.com";
    this.defaultTimeout = options.timeout ?? DEFAULT_TIMEOUT;
    this.onHello = options.onHello;
    this.onClose = options.onClose;
    this.onGap = options.onGap;
    this.onPairing = options.onPairing;
    this.pairingState = loadPendingPairing(this.url, OPERATOR_ROLE);
  }

  private readonly onHello?: (hello: Record<string, any>) => void;
  private readonly onClose?: (info: GatewayCloseInfo) => void;
  private readonly onGap?: (info: { expected: number; received: number }) => void;
  private readonly onPairing?: (pairing: GatewayPairingState | null) => void;

  get version() {
    return this._version;
  }

  get protocol() {
    return this._protocol;
  }

  get isConnected() {
    return this.connected;
  }

  get pendingPairing() {
    return this.pairingState;
  }

  /** Subscribe to server-sent events */
  onEvent(handler: GatewayEventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  /** Connect and keep reconnecting until stopped */
  connect(): Promise<void> {
    return this.start();
  }

  start(): Promise<void> {
    this.closed = false;
    if (this.connected) {
      return Promise.resolve();
    }
    if (!this.connectPromise) {
      this.connectPromise = new Promise<void>((resolve, reject) => {
        this.resolveConnectPromise = resolve;
        this.rejectConnectPromise = reject;
      });
    }
    this.openSocket();
    return this.connectPromise;
  }

  /** Close permanently and stop reconnecting */
  close(): void {
    this.stop();
  }

  stop(): void {
    this.closed = true;
    this.connected = false;
    this.connectSent = false;
    this.connectNonce = null;
    this.pendingConnectError = null;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.close();
    }
    this.flushPending(new Error("gateway client stopped"));
    if (this.rejectConnectPromise) {
      this.rejectConnectPromise(new Error("gateway client stopped"));
    }
    this.connectPromise = null;
    this.resolveConnectPromise = null;
    this.rejectConnectPromise = null;
  }

  private updatePairingState(pairing: GatewayPairingState | null): void {
    this.pairingState = pairing;
    if (pairing) {
      storePendingPairing(pairing);
    } else {
      clearPendingPairing(this.url, OPERATOR_ROLE);
    }
    this.onPairing?.(pairing);
  }

  private canAutoApprovePairing(): boolean {
    return Boolean(
      this.autoApprovePairing &&
      this.deploymentId &&
      this.apiKey &&
      this.apiBase &&
      typeof fetch === "function",
    );
  }

  private async approvePairingRequest(requestId: string): Promise<void> {
    if (!this.canAutoApprovePairing()) {
      throw new Error("autoApprovePairing requires deploymentId, apiKey, apiBase, and fetch()");
    }
    const response = await fetch(
      `${this.apiBase}/deployments/${encodeURIComponent(this.deploymentId as string)}/exec`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          command: `openclaw devices approve ${requestId}`,
          timeout: 30,
        }),
      },
    );
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Pairing approval failed: ${response.status} ${errorText}`);
    }
    const payload = await response.json() as {
      exitCode?: number;
      exit_code?: number;
      stdout?: string;
      stderr?: string;
    };
    if ((payload.exitCode ?? payload.exit_code ?? 1) !== 0) {
      throw new Error(payload.stderr?.trim() || payload.stdout?.trim() || "pairing approval command failed");
    }
  }

  private openSocket(): void {
    if (this.closed || this.ws) return;
    if (typeof WebSocket === "undefined") {
      throw new Error("WebSocket is not available in this environment");
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const wsUrl = this.token
      ? `${this.url}${this.url.includes("?") ? "&" : "?"}token=${encodeURIComponent(this.token)}`
      : this.url;
    const ws = new WebSocket(wsUrl);
    this.ws = ws;

    ws.onopen = () => {
      this.queueConnect();
    };

    ws.onmessage = (event: { data?: unknown }) => {
      this.handleMessage(String(event.data ?? ""));
    };

    ws.onerror = () => {
      // Close handling covers retries and surfaced errors.
    };

    ws.onclose = (event: { code?: number; reason?: string }) => {
      this.handleClose(ws, event.code ?? 1006, String(event.reason ?? ""));
    };
  }

  private queueConnect(): void {
    this.connectNonce = null;
    this.connectSent = false;
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
    }
    this.connectTimer = setTimeout(() => {
      if (!this.ws || !isSocketOpen(this.ws) || this.closed || this.connectSent) {
        return;
      }
      if (!this.connectNonce) {
        this.pendingConnectError = {
          code: "CONNECT_CHALLENGE_TIMEOUT",
          message: "gateway connect challenge timeout",
        };
        this.ws.close(RECONNECT_CLOSE_CODE, "connect challenge timeout");
      }
    }, CONNECT_TIMER_MS);
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer) {
      return;
    }
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * BACKOFF_MULTIPLIER, MAX_BACKOFF_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
  }

  private flushPending(error: Error): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private handleClose(ws: WebSocket, code: number, reason: string): void {
    if (this.ws !== ws) {
      return;
    }
    this.ws = null;
    this.connected = false;
    this.connectSent = false;
    this.connectNonce = null;
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
    const error = this.pendingConnectError;
    this.pendingConnectError = null;
    this.flushPending(new Error(`gateway closed (${code}): ${reason || "no reason"}`));
    this.onClose?.({ code, reason, error });
    if (!this.closed) {
      this.onDisconnect?.();
      this.scheduleReconnect();
    }
  }

  private async sendConnect(): Promise<void> {
    if (this.connectSent || !this.ws || !isSocketOpen(this.ws)) {
      return;
    }
    const nonce = this.connectNonce?.trim() ?? "";
    if (!nonce) {
      this.pendingConnectError = {
        code: "DEVICE_AUTH_NONCE_REQUIRED",
        message: "gateway connect challenge missing nonce",
      };
      this.ws.close(RECONNECT_CLOSE_CODE, "connect challenge missing nonce");
      return;
    }

    this.connectSent = true;
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }

    let identity: DeviceIdentityRecord | null = null;
    try {
      identity = await loadOrCreateDeviceIdentity();
      const storedDeviceToken = loadStoredDeviceToken(identity.deviceId, OPERATOR_ROLE)?.token;
      const authToken = storedDeviceToken ?? this.gatewayToken;
      const signedAtMs = Date.now();
      const payload = buildDeviceAuthPayload({
        deviceId: identity.deviceId,
        clientId: this.clientId,
        clientMode: this.clientMode,
        role: OPERATOR_ROLE,
        scopes: OPERATOR_SCOPES,
        signedAtMs,
        token: authToken ?? null,
        nonce,
      });
      const signature = await signDevicePayload(identity.privateKey, payload);

      const params: Record<string, any> = {
        minProtocol: PROTOCOL_VERSION,
        maxProtocol: PROTOCOL_VERSION,
        client: {
          id: this.clientId,
          ...(this.clientDisplayName ? { displayName: this.clientDisplayName } : {}),
          version: this.clientVersion,
          platform: this.clientPlatform,
          mode: this.clientMode,
          ...(this.clientInstanceId ? { instanceId: this.clientInstanceId } : {}),
        },
        role: OPERATOR_ROLE,
        scopes: [...OPERATOR_SCOPES],
        device: {
          id: identity.deviceId,
          publicKey: identity.publicKey,
          signature,
          signedAt: signedAtMs,
          nonce,
        },
        caps: this.caps,
        ...(authToken
          ? {
              auth: {
                ...(authToken ? { token: authToken } : {}),
              },
            }
          : {}),
        ...(resolveUserAgent() ? { userAgent: resolveUserAgent() } : {}),
        ...(resolveLocale() ? { locale: resolveLocale() } : {}),
      };

      const hello = await this.sendRawRequest<Record<string, any>>(
        "connect",
        params,
        this.defaultTimeout,
        true,
      );

      if (hello?.auth?.deviceToken) {
        storeStoredDeviceToken({
          deviceId: identity.deviceId,
          role: hello.auth.role ?? OPERATOR_ROLE,
          token: hello.auth.deviceToken,
          scopes: hello.auth.scopes ?? [],
        });
      }

      this._version = hello?.server?.version ?? hello?.version ?? null;
      this._protocol = hello?.protocol ?? null;
      this.connected = true;
      this.pendingConnectError = null;
      this.backoffMs = INITIAL_BACKOFF_MS;
      this.updatePairingState(null);

      if (this.resolveConnectPromise) {
        this.resolveConnectPromise();
      }
      this.connectPromise = null;
      this.resolveConnectPromise = null;
      this.rejectConnectPromise = null;

      this.onHello?.(hello);
    } catch (error) {
      this.pendingConnectError = toCloseError(error);
      const detailCode = readConnectErrorCode(error);
      const requestId = readConnectPairingRequestId(error);
      if (
        identity &&
        (detailCode === CONNECT_ERROR_PAIRING_REQUIRED ||
          detailCode === CONNECT_ERROR_DEVICE_TOKEN_MISMATCH)
      ) {
        clearStoredDeviceToken(identity.deviceId, OPERATOR_ROLE);
      }
      if (detailCode === CONNECT_ERROR_PAIRING_REQUIRED && requestId) {
        this.updatePairingState({
          requestId,
          role: OPERATOR_ROLE,
          gatewayUrl: this.url,
          ...(identity ? { deviceId: identity.deviceId } : {}),
          status: "pending",
          updatedAtMs: Date.now(),
        });
        if (this.canAutoApprovePairing() && !this.autoApproveAttemptedRequestIds.has(requestId)) {
          this.autoApproveAttemptedRequestIds.add(requestId);
          try {
            this.updatePairingState({
              requestId,
              role: OPERATOR_ROLE,
              gatewayUrl: this.url,
              ...(identity ? { deviceId: identity.deviceId } : {}),
              status: "approving",
              updatedAtMs: Date.now(),
            });
            await this.approvePairingRequest(requestId);
            this.updatePairingState({
              requestId,
              role: OPERATOR_ROLE,
              gatewayUrl: this.url,
              ...(identity ? { deviceId: identity.deviceId } : {}),
              status: "approved",
              updatedAtMs: Date.now(),
            });
            this.pendingConnectError = {
              code: "PAIRING_APPROVED",
              message: "Pairing approved, reconnecting",
            };
          } catch (approvalError) {
            this.pendingConnectError = toCloseError(approvalError);
            this.updatePairingState({
              requestId,
              role: OPERATOR_ROLE,
              gatewayUrl: this.url,
              ...(identity ? { deviceId: identity.deviceId } : {}),
              status: "failed",
              updatedAtMs: Date.now(),
              error: approvalError instanceof Error ? approvalError.message : String(approvalError),
            });
          }
        }
      }
      if (this.ws) {
        this.ws.close(RECONNECT_CLOSE_CODE, "connect failed");
      }
    }
  }

  private handleMessage(raw: string): void {
    let message: Record<string, any>;
    try {
      message = JSON.parse(raw) as Record<string, any>;
    } catch {
      return;
    }

    if (message.type === "event") {
      const gatewayEvent = message as GatewayEvent;
      if (gatewayEvent.event === "connect.challenge") {
        const nonce =
          gatewayEvent.payload && typeof gatewayEvent.payload.nonce === "string"
            ? gatewayEvent.payload.nonce.trim()
            : "";
        if (!nonce) {
          this.pendingConnectError = {
            code: "DEVICE_AUTH_NONCE_REQUIRED",
            message: "gateway connect challenge missing nonce",
          };
          this.ws?.close(RECONNECT_CLOSE_CODE, "connect challenge missing nonce");
          return;
        }
        this.connectNonce = nonce;
        void this.sendConnect();
        return;
      }

      if (typeof gatewayEvent.seq === "number") {
        if (this.lastSeq !== null && gatewayEvent.seq > this.lastSeq + 1) {
          this.onGap?.({ expected: this.lastSeq + 1, received: gatewayEvent.seq });
        }
        this.lastSeq = gatewayEvent.seq;
      }

      for (const handler of this.eventHandlers) {
        try {
          handler(gatewayEvent);
        } catch {
          // Event handlers are isolated from the socket lifecycle.
        }
      }
      return;
    }

    if (message.type !== "res") {
      return;
    }

    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }
    this.pending.delete(message.id);
    clearTimeout(pending.timer);

    if (message.ok) {
      pending.resolve(message.payload);
      return;
    }

    pending.reject(
      new GatewayRequestError({
        code: message.error?.code ?? "UNAVAILABLE",
        message: message.error?.message ?? "gateway request failed",
        details: message.error?.details,
      }),
    );
  }

  private sendRawRequest<T>(
    method: string,
    params: Record<string, any> = {},
    timeout = this.defaultTimeout,
    allowBeforeHello = false,
  ): Promise<T> {
    if (!this.ws || !isSocketOpen(this.ws)) {
      return Promise.reject(new Error("gateway not connected"));
    }
    if (!allowBeforeHello && !this.connected) {
      return Promise.reject(new Error("gateway not connected"));
    }

    const id = makeId();
    const request = { type: "req", id, method, params };
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`RPC timeout: ${method}`));
      }, timeout);

      this.pending.set(id, { resolve, reject, timer });
      this.ws?.send(JSON.stringify(request));
    });
  }

  // ---------------------------------------------------------------------------
  // RPC
  // ---------------------------------------------------------------------------

  private rpc(method: string, params: Record<string, any> = {}, timeout?: number): Promise<any> {
    return this.sendRawRequest(method, params, timeout ?? this.defaultTimeout);
  }

  request<T = any>(method: string, params: Record<string, any> = {}, timeout?: number): Promise<T> {
    return this.rpc(method, params, timeout);
  }

  // ---------------------------------------------------------------------------
  // Config
  // ---------------------------------------------------------------------------

  async configGet(): Promise<Record<string, any>> {
    const res = await this.rpc("config.get");
    if (res?.parsed) return res.parsed;
    if (res?.raw) {
      try {
        return JSON.parse(res.raw);
      } catch {
        // Fall through to the raw payload.
      }
    }
    return res?.config ?? res ?? {};
  }

  async configSchema(): Promise<Record<string, any>> {
    return this.rpc("config.schema");
  }

  async configPatch(patch: Record<string, any>): Promise<void> {
    await this.rpc("config.patch", { patch });
  }

  async configSet(config: Record<string, any>): Promise<void> {
    await this.rpc("config.set", { config });
  }

  async modelsList(): Promise<any[]> {
    const res = await this.rpc("models.list");
    return res?.models ?? res ?? [];
  }

  // ---------------------------------------------------------------------------
  // Sessions
  // ---------------------------------------------------------------------------

  async sessionsList(): Promise<any[]> {
    const res = await this.rpc("sessions.list");
    return res?.sessions ?? res ?? [];
  }

  async sessionsPreview(sessionKey: string, limit = 20): Promise<any[]> {
    const res = await this.rpc("sessions.preview", { sessionKey, limit });
    return res?.messages ?? res ?? [];
  }

  async chatHistory(sessionKey?: string, limit = 50): Promise<any[]> {
    const params: Record<string, any> = { limit };
    if (sessionKey) params.sessionKey = sessionKey;
    const res = await this.rpc("chat.history", params);
    return res?.messages ?? res ?? [];
  }

  async chatAbort(sessionKey?: string): Promise<void> {
    const params: Record<string, any> = {};
    if (sessionKey) params.sessionKey = sessionKey;
    await this.rpc("chat.abort", params);
  }

  async sendChat(
    message: string,
    sessionKey = "main",
    agentId?: string,
    attachments?: ChatAttachment[],
  ): Promise<any> {
    const params: Record<string, any> = {
      message,
      sessionKey,
      idempotencyKey: makeId(),
    };
    if (agentId) params.agentId = agentId;
    if (attachments && attachments.length > 0) params.attachments = attachments;
    return this.rpc("chat.send", params, CHAT_TIMEOUT);
  }

  async sessionsReset(sessionKey: string): Promise<void> {
    await this.rpc("sessions.reset", { sessionKey });
  }

  // ---------------------------------------------------------------------------
  // Chat (streaming via events)
  // ---------------------------------------------------------------------------

  async *chatSend(message: string, sessionKey: string): AsyncGenerator<ChatEvent> {
    if (!this.connected || !this.ws) {
      throw new Error("Not connected");
    }

    const id = makeId();
    const req = {
      type: "req",
      id,
      method: "chat.send",
      params: {
        message,
        sessionKey,
        idempotencyKey: makeId(),
      },
    };

    const events: ChatEvent[] = [];
    let resolveWait: (() => void) | null = null;
    let done = false;
    let error: Error | null = null;

    // Temporary event handler for chat events
    const handler: GatewayEventHandler = (evt) => {
      if (evt.event?.startsWith("chat.")) {
        const payload = evt.payload ?? {};
        if (evt.event === "chat.content") {
          events.push({ type: "content", text: payload.text ?? "" });
        } else if (evt.event === "chat.thinking") {
          events.push({ type: "thinking", text: payload.text ?? "" });
        } else if (evt.event === "chat.tool_call") {
          events.push({ type: "tool_call", data: payload });
        } else if (evt.event === "chat.tool_result") {
          events.push({ type: "tool_result", data: payload });
        } else if (evt.event === "chat.done") {
          events.push({ type: "done" });
          done = true;
        } else if (evt.event === "chat.error") {
          events.push({ type: "error", text: payload.message ?? "Unknown error" });
          done = true;
        }
        resolveWait?.();
      }
    };

    this.eventHandlers.add(handler);

    // Also listen for the RPC response
    const timer = setTimeout(() => {
      this.pending.delete(id);
      error = new Error("Chat timeout");
      done = true;
      resolveWait?.();
    }, CHAT_TIMEOUT);

    this.pending.set(id, {
      resolve: () => {
        clearTimeout(timer);
        done = true;
        resolveWait?.();
      },
      reject: (rejection: unknown) => {
        clearTimeout(timer);
        error = rejection instanceof Error ? rejection : new Error(String(rejection));
        done = true;
        resolveWait?.();
      },
      timer,
    });

    this.ws.send(JSON.stringify(req));

    try {
      while (!done || events.length > 0) {
        if (events.length > 0) {
          yield events.shift()!;
        } else if (!done) {
          await new Promise<void>((resolve) => {
            resolveWait = resolve;
          });
          resolveWait = null;
        }
      }
      if (error) throw error;
    } finally {
      clearTimeout(timer);
      this.eventHandlers.delete(handler);
      this.pending.delete(id);
    }
  }

  // ---------------------------------------------------------------------------
  // Files (agent workspace files)
  // ---------------------------------------------------------------------------

  async filesList(agentId: string = "main"): Promise<any[]> {
    const res = await this.rpc("agents.files.list", { agentId });
    return res?.files ?? [];
  }

  async fileGet(agentId: string, name: string): Promise<string> {
    const res = await this.rpc("agents.files.get", { agentId, name });
    return res?.content ?? "";
  }

  async fileSet(agentId: string, name: string, content: string): Promise<void> {
    await this.rpc("agents.files.set", { agentId, name, content });
  }

  // ---------------------------------------------------------------------------
  // Agents
  // ---------------------------------------------------------------------------

  async agentsList(): Promise<any[]> {
    const res = await this.rpc("agents.list");
    const agents = res?.agents ?? res ?? [];
    return Array.isArray(agents)
      ? agents.map((agent: any) => ({ ...agent, id: agent?.agentId ?? agent?.id }))
      : [];
  }

  // ---------------------------------------------------------------------------
  // Cron
  // ---------------------------------------------------------------------------

  async cronList(): Promise<any[]> {
    const res = await this.rpc("cron.list");
    return res?.jobs ?? res ?? [];
  }

  async cronAdd(job: Record<string, any>): Promise<any> {
    return this.rpc("cron.add", { job });
  }

  async cronRemove(jobId: string): Promise<void> {
    await this.rpc("cron.remove", { jobId });
  }

  async execApprove(execId: string): Promise<void> {
    await this.rpc("exec.approve", { execId });
  }

  async execDeny(execId: string): Promise<void> {
    await this.rpc("exec.deny", { execId });
  }

  // ---------------------------------------------------------------------------
  // Status
  // ---------------------------------------------------------------------------

  async status(): Promise<Record<string, any>> {
    return this.rpc("status");
  }
}
