import { describe, expect, it } from "vitest";
import {
  MIC_MIME_PREFERENCE,
  audioContainerExtension,
  micCaptureSupported,
  pickSupportedMimeType,
} from "./mic-capture";

describe("pickSupportedMimeType", () => {
  it("prefers opus-in-webm when everything is supported", () => {
    expect(pickSupportedMimeType(() => true)).toBe("audio/webm;codecs=opus");
  });

  it("falls back to mp4 — the WKWebView answer — when webm is refused", () => {
    expect(pickSupportedMimeType((mimeType) => mimeType === "audio/mp4")).toBe("audio/mp4");
  });

  it("walks the whole preference list before giving up", () => {
    expect(pickSupportedMimeType((mimeType) => mimeType === "audio/webm")).toBe("audio/webm");
    expect(pickSupportedMimeType(() => false)).toBeNull();
  });

  it("honours a custom preference list", () => {
    expect(pickSupportedMimeType(() => true, ["audio/mp4"])).toBe("audio/mp4");
  });

  it("returns null when no MediaRecorder global exists (node test env)", () => {
    expect(typeof MediaRecorder).toBe("undefined");
    expect(pickSupportedMimeType()).toBeNull();
  });

  it("keeps its own preference order stable", () => {
    expect(MIC_MIME_PREFERENCE[0]).toBe("audio/webm;codecs=opus");
  });
});

describe("audioContainerExtension", () => {
  it("maps containers to file extensions", () => {
    expect(audioContainerExtension("audio/webm;codecs=opus")).toBe("webm");
    expect(audioContainerExtension("audio/mp4")).toBe("m4a");
    expect(audioContainerExtension(" Audio/MP4 ")).toBe("m4a");
    expect(audioContainerExtension("audio/ogg")).toBe("bin");
  });
});

describe("micCaptureSupported", () => {
  it("is false without getUserMedia", () => {
    expect(micCaptureSupported({ hasGetUserMedia: false, isTypeSupported: () => true })).toBe(false);
  });

  it("is false when MediaRecorder supports none of the containers", () => {
    expect(micCaptureSupported({ hasGetUserMedia: true, isTypeSupported: () => false })).toBe(false);
  });

  it("is true with getUserMedia and at least one supported container", () => {
    expect(micCaptureSupported({ hasGetUserMedia: true, isTypeSupported: (t) => t === "audio/mp4" })).toBe(true);
  });

  it("is false in the bare node test env (no mediaDevices, no MediaRecorder)", () => {
    expect(micCaptureSupported()).toBe(false);
  });
});
