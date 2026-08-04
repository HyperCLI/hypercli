import path from "node:path";
import { config as loadEnv } from "dotenv";
import { test } from "@playwright/test";
import { loginWithPrivy } from "./fixtures/auth";

loadEnv({ path: path.resolve(__dirname, ".env"), quiet: true });

test("watch login exchange traffic", async ({ page }) => {
  test.setTimeout(240_000);
  const traffic: string[] = [];
  page.on("response", (r) => {
    const u = r.url();
    if (u.includes("/auth/") || u.includes("/api/")) traffic.push(`${r.status()} ${u.slice(0, 130)}`);
  });
  page.on("requestfailed", (r) => {
    if (r.url().includes("/auth/") || r.url().includes("/api/")) traffic.push(`FAILED ${r.failure()?.errorText} ${r.url().slice(0, 130)}`);
  });
  page.on("console", (m) => { if (m.type() === "error") console.log("console.error:", m.text().slice(0, 180)); });

  const navs: string[] = [];
  page.on("framenavigated", (f) => { if (f === page.mainFrame()) navs.push(f.url()); });

  try {
    await loginWithPrivy(page, { forceOtp: true });
    console.log("LOGIN COMPLETED OK");
  } catch (err) {
    console.log("LOGIN FAILED:", err instanceof Error ? err.message.split("\n")[0] : String(err));
  }

  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(5000);
    const s = await page.evaluate(() => ({
      url: location.href,
      claw: Boolean(localStorage.getItem("claw_auth_token")),
      app: Boolean(localStorage.getItem("app_auth_token")),
      cookie: document.cookie.includes("auth_token="),
    })).catch(() => ({ url: "NAV" }));
    console.log(`t=${(i + 1) * 5}s`, JSON.stringify(s));
  }
  console.log("--- navs ---");
  navs.slice(0, 25).forEach((n) => console.log(n));
  console.log("--- traffic ---");
  traffic.slice(0, 40).forEach((t) => console.log(t));
});
