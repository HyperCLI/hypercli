import { afterEach, describe, expect, it, vi } from "vitest";

import { createAudioMediaRecorder, getSupportedAudioRecordingMimeType } from "./audio-recorder";

class MockMediaRecorder {
  static isTypeSupported = vi.fn((_mimeType: string) => false);

  mimeType: string;

  constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
    this.mimeType = options?.mimeType ?? "";
  }
}

describe("audio recorder helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    MockMediaRecorder.isTypeSupported.mockReset();
  });

  it("chooses the first supported browser MIME type", () => {
    MockMediaRecorder.isTypeSupported.mockImplementation((mimeType) => mimeType === "audio/ogg;codecs=opus");
    vi.stubGlobal("MediaRecorder", MockMediaRecorder);

    expect(getSupportedAudioRecordingMimeType()).toBe("audio/ogg;codecs=opus");
    expect(createAudioMediaRecorder({} as MediaStream).mimeType).toBe("audio/ogg;codecs=opus");
  });

  it("falls back to the browser default when no preferred MIME type is supported", () => {
    MockMediaRecorder.isTypeSupported.mockReturnValue(false);
    vi.stubGlobal("MediaRecorder", MockMediaRecorder);

    expect(getSupportedAudioRecordingMimeType()).toBeUndefined();
    expect(createAudioMediaRecorder({} as MediaStream).mimeType).toBe("");
  });
});
