#!/usr/bin/env node
/**
 * Tinker script: connect to an agent's gateway and log all chat events.
 *
 * Usage:
 *   node tinker-events.mjs <gateway-url> <auth-token> [gateway-token]
 *
 * Example:
 *   node tinker-events.mjs wss://openclaw-myagent.dev.hypercli.com "eyJ..." "gw-token-here"
 *
 * Then send a message in the chat UI and watch the raw events here.
 * Press Ctrl+C to exit.
 */

import { GatewayClient } from "./dist/index.js";

const [,, url, token, gatewayToken] = process.argv;

if (!url || !token) {
  console.error("Usage: node tinker-events.mjs <gateway-url> <auth-token> [gateway-token]");
  process.exit(1);
}

const gw = new GatewayClient({
  url,
  apiKey: token,
  gatewayToken: gatewayToken || undefined,
  autoApprovePairing: true,
  onHello: (hello) => {
    console.log("\n✅ Connected! Hello:", JSON.stringify(hello, null, 2));
    console.log("\n🔍 Listening for events... Send a message in the chat UI.\n");
  },
  onClose: (info) => {
    console.log("\n❌ Disconnected:", info);
  },
});

// Log ALL events with full payloads
gw.onEvent((evt) => {
  const event = evt.event;
  const payload = evt.payload ?? {};

  // Highlight tool-related events
  if (event === "chat.tool_call" || event === "chat.tool_result" ||
      (event === "agent" && String(payload.stream || "") === "tool")) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`🔧 TOOL EVENT: ${event}`);
    console.log(JSON.stringify(payload, null, 2));
    console.log(`${"=".repeat(60)}\n`);
  } else if (event === "chat" && payload.state === "final") {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`📦 FINAL MESSAGE SNAPSHOT:`);
    console.log(JSON.stringify(payload, null, 2));
    console.log(`${"=".repeat(60)}\n`);
  } else {
    // Other events: compact log
    const preview = JSON.stringify(payload).slice(0, 200);
    console.log(`[${event}] ${preview}${preview.length >= 200 ? "..." : ""}`);
  }
});

console.log(`\n🔌 Connecting to ${url}...`);
await gw.connect();

// Keep alive
process.on("SIGINT", () => {
  console.log("\nClosing...");
  gw.close();
  process.exit(0);
});
