import { describe, expect, it } from "vitest";
import { scanSourceText } from "./check-api-boundary.mjs";

describe("check-api-boundary", () => {
  it("allows official SDK usage and SDK fakes", () => {
    const source = `
      import { HyperAgent } from "@hypercli.com/sdk/agent";

      const hyperAgent = { plans: async () => [] };
      await hyperAgent.plans();
      new HyperAgent(http, token);
    `;

    expect(scanSourceText(source)).toEqual([]);
  });

  it("rejects app-level network access and local API wrappers", () => {
    const source = `
      import axios from "axios";
      import { wrapAxiosWithPayment } from "@x402/axios";
      import { clawFetch, agentApiFetch } from "@/lib/api";

      await fetch("/agents/plans");
      new XMLHttpRequest();
      navigator.sendBeacon("/analytics", "ok");
      await clawFetch("/usage", token);
      await agentApiFetch("/billing/payments", token);
      new WebSocket("/gateway");
      new EventSource("/events");
    `;

    expect(scanSourceText(source).map((violation) => violation.rule)).toEqual([
      "raw axios import",
      "x402 axios import",
      "clawFetch",
      "agentApiFetch",
      "raw fetch",
      "XMLHttpRequest",
      "sendBeacon",
      "clawFetch",
      "agentApiFetch",
      "raw WebSocket",
      "raw EventSource",
    ]);
  });

  it("ignores forbidden call names inside comments and strings", () => {
    const source = `
      // await fetch("/agents/plans");
      const sample = "new WebSocket(this.url)";
      const block = \`new EventSource("/events")\`;
    `;

    expect(scanSourceText(source)).toEqual([]);
  });
});
