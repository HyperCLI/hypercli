import { expect } from "vitest";

import { createIntegrationClient, integrationDescribe, integrationIt } from "./helpers.js";
import type { VoiceAudioMetadata } from "../../src/voice-session.js";

function uint32le(value: number): number[] {
  return [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff];
}

function uint16le(value: number): number[] {
  return [value & 0xff, (value >> 8) & 0xff];
}

function wavFromPcm(pcm: Uint8Array, metadata: VoiceAudioMetadata): Uint8Array {
  const sampleRate = metadata.sampleRate ?? 24000;
  const channels = metadata.channels ?? 1;
  const bytesPerSample = metadata.bytesPerSample ?? 2;
  const bitsPerSample = bytesPerSample * 8;
  const byteRate = sampleRate * channels * bytesPerSample;
  const blockAlign = channels * bytesPerSample;
  const header = new Uint8Array([
    0x52, 0x49, 0x46, 0x46,
    ...uint32le(36 + pcm.byteLength),
    0x57, 0x41, 0x56, 0x45,
    0x66, 0x6d, 0x74, 0x20,
    ...uint32le(16),
    ...uint16le(1),
    ...uint16le(channels),
    ...uint32le(sampleRate),
    ...uint32le(byteRate),
    ...uint16le(blockAlign),
    ...uint16le(bitsPerSample),
    0x64, 0x61, 0x74, 0x61,
    ...uint32le(pcm.byteLength),
  ]);
  const wav = new Uint8Array(header.byteLength + pcm.byteLength);
  wav.set(header, 0);
  wav.set(pcm, header.byteLength);
  return wav;
}

integrationDescribe("TS SDK integration: voice", () => {
  integrationIt("streams PCM TTS with metadata and transcribes the generated audio", async () => {
    const client = createIntegrationClient();
    const text = "The quick brown fox jumps over the lazy dog.";
    const chunks = [];

    for await (const chunk of client.voice.ttsStream({
      text,
      voice: "serena",
      responseFormat: "pcm",
      timeoutMs: 120_000,
    })) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBeGreaterThan(0);
    const metadata = chunks[0].metadata;
    expect(metadata).toMatchObject({
      format: "pcm",
      contentType: "audio/pcm",
      sampleRate: expect.any(Number),
      channels: expect.any(Number),
      sampleFormat: "s16le",
      bytesPerSample: 2,
    });

    const totalBytes = chunks.reduce((sum, chunk) => sum + chunk.audio.byteLength, 0);
    expect(totalBytes).toBeGreaterThan(0);
    const pcm = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      pcm.set(chunk.audio, offset);
      offset += chunk.audio.byteLength;
    }

    const wav = wavFromPcm(pcm, metadata ?? {});
    const transcript = await client.voice.transcribe({
      audio: wav,
      filename: "hypercli-voice-integration.wav",
      contentType: "audio/wav",
      language: "en",
      responseFormat: "json",
      signal: AbortSignal.timeout(120_000),
    });

    const normalized = transcript.text.toLowerCase();
    expect(normalized).toContain("quick");
    expect(normalized).toContain("brown");
    expect(normalized).toContain("fox");
  }, 240_000);
});
