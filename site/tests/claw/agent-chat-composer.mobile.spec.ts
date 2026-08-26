import { expect, test, type Locator } from "@playwright/test";

import {
  interceptAgentChatBackend,
  installAgentChatAuth,
  openAgentChatTab,
  sendAgentChatMessage,
} from "./fixtures/agent-chat-harness";
import { installMockGateway } from "./fixtures/mock-openclaw-gateway";

const AGENT_ID = "agent-chat-composer-intercepted";
const AGENT_HOSTNAME = "agent-chat-composer-intercepted.example.test";

async function expectMobileTouchTargets(composerRegion: Locator): Promise<void> {
  const controls = await composerRegion.getByRole("button").all();
  expect(controls.length).toBeGreaterThan(0);
  for (const control of controls) {
    const bounds = await control.boundingBox();
    if (!bounds) throw new Error("Expected composer control to be visible");
    expect(bounds.height).toBeGreaterThanOrEqual(44);
    expect(bounds.width).toBeGreaterThanOrEqual(44);
  }
}

test("keeps the mobile composer usable across crowded states", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await installMockGateway(page, {
    chatScripts: [{
      finalText: "The responsive review is complete.",
      holdFinal: true,
    }],
  });
  await installAgentChatAuth(page);
  await interceptAgentChatBackend(page, {
    agentId: AGENT_ID,
    hostname: AGENT_HOSTNAME,
  });
  await openAgentChatTab(page, AGENT_ID);

  const composer = page.getByTestId("agent-chat-composer");
  const composerRegion = page.getByTestId("agent-chat-composer-region");
  await expectMobileTouchTargets(composerRegion);
  await expect(composerRegion).toHaveScreenshot("composer-narrow-mobile.png", {
    animations: "disabled",
  });

  const longDraft = Array.from(
    { length: 14 },
    (_, index) => `Draft line ${index + 1}: preserve every part of this message.`,
  ).join("\n");
  await composer.fill(longDraft);
  await expect.poll(() => composer.evaluate((element) => ({
    heightWithinCap: element.clientHeight <= 160,
    overflowY: getComputedStyle(element).overflowY,
    scrollable: element.scrollHeight > element.clientHeight,
  }))).toEqual({
    heightWithinCap: true,
    overflowY: "auto",
    scrollable: true,
  });
  await composer.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect.poll(() => composer.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await expect(composerRegion).toHaveScreenshot("composer-multiline-mobile.png", {
    animations: "disabled",
  });

  await sendAgentChatMessage(page, "Continue with the responsive review");
  await expect(page.getByRole("button", { name: "Stop reply" })).toBeVisible();
  await expectMobileTouchTargets(composerRegion);
  await expect(composerRegion).toHaveScreenshot("composer-sending-mobile.png", {
    animations: "disabled",
  });

  await page.getByRole("button", { name: "Stop reply" }).click();
  await expect(page.getByRole("button", { name: "Stop reply" })).toBeHidden();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  await composer.fill("Composer text remains readable at 200 percent.");
  await expect.poll(() => composerRegion.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return bounds.top >= 0 && bounds.bottom <= window.innerHeight;
  })).toBe(true);
  await expect(composerRegion).toHaveScreenshot("composer-200-percent-text.png", {
    animations: "disabled",
  });
});
