import path from "node:path";
import { config as loadEnv } from "dotenv";
import { expect, test, type Download, type Page } from "@playwright/test";

import { installMockGateway } from "./fixtures/mock-openclaw-gateway";
import {
  installAgentChatAuth,
  interceptAgentChatBackend,
  openAgentChatTab,
  sendAgentChatMessage,
} from "./fixtures/agent-chat-harness";

loadEnv({ path: path.resolve(__dirname, ".env"), quiet: true });

const AGENT_ID = "agent-chat-file-media-intercepted";
const AGENT_HOSTNAME = "agent-chat-file-media-intercepted.example.test";
const REEF_ORIGIN = "https://reef-chat-file-media.example.test";
const SYNC_ROOT = "/srv/agent";
const MEDIA_PATH = `${SYNC_ROOT}/workspace/audio/reply.wav`;
const REEF_MEDIA_PATH = "/_reef/files/workspace/audio/reply.wav";

function silentWav(durationSeconds = 2): Buffer {
  const sampleRate = 8_000;
  const channels = 1;
  const bitsPerSample = 8;
  const dataLength = sampleRate * durationSeconds * channels;
  const bytes = Buffer.alloc(44 + dataLength, 128);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(36 + dataLength, 4);
  bytes.write("WAVE", 8, "ascii");
  bytes.write("fmt ", 12, "ascii");
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(channels, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * channels * bitsPerSample / 8, 28);
  bytes.writeUInt16LE(channels * bitsPerSample / 8, 32);
  bytes.writeUInt16LE(bitsPerSample, 34);
  bytes.write("data", 36, "ascii");
  bytes.writeUInt32LE(dataLength, 40);
  return bytes;
}

async function downloadBytes(download: Download): Promise<Buffer> {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function interceptReefMedia(page: Page, expectedBytes: Buffer): Promise<string[]> {
  const requests: string[] = [];

  await page.route(`**/agents/deployments/${AGENT_ID}/files/token`, async (route) => {
    requests.push(new URL(route.request().url()).pathname);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        url: `${REEF_ORIGIN}/_reef`,
        token: "intercepted-reef-token",
        expires_at: "2099-01-01T00:00:00Z",
      }),
    });
  });

  await page.route(`${REEF_ORIGIN}/_reef/**`, async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    requests.push(pathname);
    if (pathname === REEF_MEDIA_PATH) {
      await route.fulfill({ status: 200, contentType: "audio/wav", body: expectedBytes });
      return;
    }
    if (pathname.startsWith("/_reef/directories")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ type: "directory", prefix: "", directories: [], files: [], truncated: false }),
      });
      return;
    }
    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ detail: `Unexpected Reef path: ${pathname}` }),
    });
  });

  return requests;
}

test.describe("Agent chat file media (intercepted Reef)", () => {
  test("plays and downloads media using the same sync-root path as Files", async ({ page }) => {
    const expectedBytes = silentWav();
    await installMockGateway(page, {
      chatScripts: [{
        sessionKey: "*",
        finalText: `Audio ready\nMEDIA:${MEDIA_PATH}`,
        holdFinal: false,
      }],
    });
    await installAgentChatAuth(page);
    await interceptAgentChatBackend(page, {
      agentId: AGENT_ID,
      hostname: AGENT_HOSTNAME,
      syncRoot: SYNC_ROOT,
    });
    const reefRequests = await interceptReefMedia(page, expectedBytes);

    await openAgentChatTab(page, AGENT_ID);
    await sendAgentChatMessage(page, "Create an audio reply");

    const play = page.getByRole("button", { name: "Play reply.wav" });
    await expect(play).toBeEnabled();
    await expect.poll(() => reefRequests.filter((request) => request === REEF_MEDIA_PATH).length).toBeGreaterThan(0);
    expect(reefRequests.some((request) => request.includes(".openclaw/workspace/node/workspace"))).toBe(false);

    await play.click();
    await expect(page.getByRole("button", { name: "Pause reply.wav" })).toBeVisible();

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download reply.wav" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("reply.wav");
    expect(await downloadBytes(download)).toEqual(expectedBytes);
    expect(reefRequests.filter((request) => request === REEF_MEDIA_PATH)).toHaveLength(2);
  });
});
