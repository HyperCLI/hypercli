import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

const fixturesDir = path.resolve(__dirname, "fixtures");
const authFixtureSource = fs.readFileSync(path.join(fixturesDir, "auth.ts"), "utf8");
const subscriptionSpecSource = fs.readFileSync(path.resolve(__dirname, "agents-subscription.spec.ts"), "utf8");

test("agents launch helper accepts the current workspace empty state", () => {
  expect(authFixtureSource).toContain('return "workspace-selector"');
  expect(authFixtureSource).toContain('return "workspace-empty-state"');
  expect(authFixtureSource).toContain("name: /^Launch an agent\\b/i");
  expect(authFixtureSource).toContain("await findLastVisible(workspaceEmptyStateLaunchButton");
  expect(authFixtureSource).toContain('name: "Team", exact: true');
  expect(authFixtureSource).toContain("expected Team to select medium launch capacity");
});

test("agents launch helper observes an authenticated gateway WebSocket connect", () => {
  expect(authFixtureSource).toContain('page.on("websocket", observeGatewaySocket)');
  expect(authFixtureSource).toContain('frame.method === "connect"');
  expect(authFixtureSource).toContain('typeof auth?.token === "string"');
  expect(authFixtureSource).toContain('frame?.type === "res"');
  expect(authFixtureSource).toContain("gatewayConnectRequestIds.has(frame.id)");
  expect(authFixtureSource).toContain("authenticated WebSocket connect observed");
  expect(authFixtureSource).toContain('page.off("websocket", observeGatewaySocket)');
});

test("agents subscription retry permits immutable canceled history", () => {
  expect(subscriptionSpecSource).toContain("beforeSummary.activeSubscriptions).toHaveLength(0)");
  expect(subscriptionSpecSource).toContain("filter((subscription) => subscription.isCurrent)");
  expect(subscriptionSpecSource).not.toContain("beforeSummary.subscriptions ?? []).toHaveLength(0)");
});

test("agents subscription observes the public deployment transition wire", () => {
  expect(subscriptionSpecSource).toContain('pathname !== "/ws/deployments"');
  expect(subscriptionSpecSource).toContain('socket.on("framereceived"');
  expect(subscriptionSpecSource).toContain('frame.type === "ready"');
  expect(subscriptionSpecSource).toContain("beforeCreate: async () =>");
  expect(subscriptionSpecSource).toContain('toEqual({ type: "ready" })');
  expect(subscriptionSpecSource).toContain('frame.type === "deployment.transition"');
  expect(subscriptionSpecSource).toContain("frame.agent_id === createdAgentId");
  expect(subscriptionSpecSource).not.toContain("deployment_id");
  expect(subscriptionSpecSource).toContain("const allowedKeys = new Set([");
  expect(subscriptionSpecSource).toContain('expect(Number.isInteger(transition.launch_epoch)).toBe(true)');
});
