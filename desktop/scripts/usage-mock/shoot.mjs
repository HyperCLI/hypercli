import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, "..", "..", "test-results", "usage-mock.png");
const base = process.env.MOCK_URL ?? "http://localhost:5199";

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 900, height: 1400 },
  deviceScaleFactor: 2,
});
await page.goto(`${base}/scripts/usage-mock/index.html`, { waitUntil: "networkidle" });
await page.waitForSelector("text=Account usage", { timeout: 15000 });
await page.waitForSelector("text=Usage by agent", { timeout: 15000 });
await page.waitForTimeout(400);
await page.locator(".modal-card").screenshot({ path: out });
await browser.close();
console.log(out);
