const AUDIO_RECORDING_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/ogg",
  "audio/mp4",
] as const;

export function getSupportedAudioRecordingMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
    return undefined;
  }

  return AUDIO_RECORDING_MIME_TYPES.find((mimeType) => MediaRecorder.isTypeSupported(mimeType));
}

export function createAudioMediaRecorder(stream: MediaStream): MediaRecorder {
  if (typeof MediaRecorder === "undefined") {
    throw new Error("Audio recording is not available in this browser.");
  }

  const mimeType = getSupportedAudioRecordingMimeType();
  return mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
}
