import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

const fixturesDir = path.resolve(__dirname, "fixtures");
const authFixtureSource = fs.readFileSync(path.join(fixturesDir, "auth.ts"), "utf8");
const subscriptionSpecSource = fs.readFileSync(path.resolve(__dirname, "agents-subscription.spec.ts"), "utf8");
const agentsRunnerSource = fs.readFileSync(
  path.resolve(__dirname, "../../../.github/scripts/run_e2e_agents.sh"),
  "utf8",
);

test("agents launch helper accepts the current workspace empty state", () => {
  expect(authFixtureSource).toContain('return "workspace-selector"');
  expect(authFixtureSource).toContain('return "workspace-empty-state"');
  expect(authFixtureSource).toContain('getByTestId("agent-launch-entry")');
  expect(authFixtureSource).toContain('getByTestId("agent-setup-advanced-toggle")');
  expect(authFixtureSource).toContain('getByTestId("agent-setup-advanced-settings")');
  expect(authFixtureSource).toContain('getByTestId("agent-setup-desktop-toggle")');
  expect(authFixtureSource).toContain('getByTestId("agent-setup-launch")');
  expect(authFixtureSource).not.toContain('locator("xpath=ancestor::button[1]")');
  expect(authFixtureSource).not.toContain("clickPlanLaunchButtonViaDom");
  expect(authFixtureSource).toContain('name: "Team", exact: true');
  expect(authFixtureSource).toContain("expected Team to select medium launch capacity");
});

test("agents launch helper observes an authenticated gateway WebSocket connect", () => {
  expect(authFixtureSource).toContain("deployments.getRoutes(created.id)");
  expect(authFixtureSource).toContain('activeRouteUrl(routes, "desktop", "Desktop")');
  expect(authFixtureSource).toContain("buildBrowserDesktopUrl(desktopBaseUrl!, agentJwt!)");
  expect(authFixtureSource).not.toContain("desktop-${agent.hostname}");
  expect(authFixtureSource).toContain('status?.dns_state ?? ""');
  expect(authFixtureSource).toContain("socketUrl !== expectedGatewaySocketUrl");
  expect(authFixtureSource).toContain('page.on("websocket", observeGatewaySocket)');
  expect(authFixtureSource).toContain('frame.method === "connect"');
  expect(authFixtureSource).toContain('typeof auth?.token === "string"');
  expect(authFixtureSource).toContain('frame?.type === "res"');
  expect(authFixtureSource).toContain("gatewayConnectRequestIds.has(frame.id)");
  expect(authFixtureSource).toContain("authenticated WebSocket connect observed");
  expect(authFixtureSource).toContain('page.off("websocket", observeGatewaySocket)');
});

test("agents launch canary completes one live gateway chat turn", () => {
  expect(authFixtureSource).toContain('frame.method === "chat.send"');
  expect(authFixtureSource).toContain('details?.code === "PAIRING_REQUIRED"');
  // Trusted pairing approval mints an exec token and runs the argv command over
  // the exec WebSocket; there is no POST to the bare /exec path to observe.
  expect(authFixtureSource).toContain("/exec/token`)) pairingApprovalRequests += 1");
  expect(authFixtureSource).toContain('.toBe("final")');
  expect(authFixtureSource).toContain('getByText(replyMarker, { exact: true })');
  expect(authFixtureSource).toContain('name: "Stop reply", exact: true');
  expect(authFixtureSource).toContain('expected the completed chat turn to reuse the authenticated root socket');
  expect(subscriptionSpecSource).toContain('test.use({ trace: "off", video: "off" })');
  expect(subscriptionSpecSource).not.toContain('screenshot: "off"');
  expect(authFixtureSource).toContain('warm hard refresh must not pair again');
  expect(authFixtureSource).toContain('captureStep(page, "agents-12b-chat-completed")');
  expect(subscriptionSpecSource).toContain('expect(stoppedAgent.state).toBe("STOPPED")');
  expect(subscriptionSpecSource).toContain("await deleteClawAgent(page, createdAgentId)");
  expect(subscriptionSpecSource).toContain(".activeSubscriptionCount");
});

test("agents subscription uses the isolated admin-bootstrap identity", () => {
  expect(subscriptionSpecSource).toContain("loginWithAdminBootstrap(page)");
  expect(subscriptionSpecSource).not.toContain("loginWithPrivy(page)");
  expect(authFixtureSource).toContain("BACKEND_API_KEY is required for the isolated agents E2E user");
});

test("agents launch canary exercises the canonical lifecycle contract", () => {
  expect(authFixtureSource).toContain(
    "expect.objectContaining({ launch_config: expect.objectContaining({ image: expect.any(String) }) })"
  );
  expect(authFixtureSource).toContain("acceptedStart?.launchEpoch ?? acceptedStart?.launch_epoch");
  expect(authFixtureSource).toContain("waitRunning(created.id, timeout, 5_000, acceptedLaunchEpoch)");
  expect(authFixtureSource).toContain("waitForBrowserAgentStartOrLaunchError(page, timeout)");
  // Starter files stage alongside the start, so a files-failed banner is a
  // warning on a launching Agent and must not be read as a failed launch.
  expect(authFixtureSource).toContain("if (!isNonFatalLaunchNotice(message))");
  expect(authFixtureSource).not.toContain('start: false');
  expect(subscriptionSpecSource).toContain("stopClawAgentAndWaitStopped(page, createdAgentId)");
  expect(authFixtureSource).toContain('["STOPPED"]');
});

test("agents E2E rides out edge windows instead of believing an unrouted 404", () => {
  // Cloudflare resolves every host under the agent wildcard, so traefik answers
  // an unconverged route with its plain-text 404. Only the body separates that
  // from an application 404, and reading one as the other is what leaks an
  // Agent (teardown then 409s on "User still owns non-deleted Agents").
  expect(authFixtureSource).toContain('const UNROUTED_EDGE_BODY = "404 page not found"');
  expect(authFixtureSource).toContain("function isUnroutedEdgeBody");
  expect(authFixtureSource).toContain("function isDeploymentAbsentError");
  expect(authFixtureSource).toContain("if (isUnroutedEdgeBody(message)) return false;");
  expect(authFixtureSource).toContain("if (isDeploymentAbsentError(error)) return;");
  expect(authFixtureSource).toContain("function settledAgentsCall");
  expect(authFixtureSource).toContain("status === 404 && isUnroutedEdgeBody(body)");
  // The desktop probe waits out convergence, but any other verdict from
  // lagoon-auth is reported rather than buried under the timeout.
  expect(authFixtureSource).toContain("answered a non-transient failure for /_jwt_auth");
  expect(authFixtureSource).toContain("did not converge at the edge within");
});

test("agents launch verifies the desktop route without pre-empting the chat turn", () => {
  // The desktop route is a second host for the same Agent and is not on the
  // path this suite exists to cover. It stays a hard assertion, but it runs
  // after the message round-trip so an edge convergence window on that host
  // cannot mask whether the gateway ever answered.
  expect(authFixtureSource).toContain("if (enableDesktop) await verifyDesktopAuthRoute(running, acceptedLaunchEpoch)");
  expect(authFixtureSource.indexOf('captureStep(page, "agents-12b-chat-completed")'))
    .toBeLessThan(authFixtureSource.indexOf("if (enableDesktop) await verifyDesktopAuthRoute("));
});

test("agents subscription adopts the Agent before it is known to be healthy", () => {
  // Readiness failures throw out of the launch helper; an Agent the spec was
  // never told about is one its `finally` cannot delete.
  expect(authFixtureSource).toContain("onAgentCreated?: (agentId: string) => void");
  expect(authFixtureSource).toContain("noteAgentCreated(created)");
  expect(subscriptionSpecSource).toContain("onAgentCreated: (agentId) => {");
  expect(subscriptionSpecSource).toContain("Agents E2E cleanup failed");
  expect(subscriptionSpecSource).not.toContain("await deleteClawAgent(page, createdAgentId).catch(() => {})");
});

test("agents launch diagnostics preserve accepted and terminal state evidence", () => {
  expect(authFixtureSource).toContain("[agents-launch] start accepted");
  expect(authFixtureSource).toContain("createdLaunchEpoch");
  expect(authFixtureSource).toContain("acceptedLaunchEpoch");
  expect(authFixtureSource).toContain("agentError: latest.error ?? null");
  expect(authFixtureSource).toContain("waitError: error instanceof Error");
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

test("agents Docker runner leads with the lifecycle canary and retains regression coverage", () => {
  expect(agentsRunnerSource).toContain("tests/claw/agents-e2e-contract.spec.ts");
  expect(agentsRunnerSource).toContain("tests/claw/agents-subscription.spec.ts");
  expect(agentsRunnerSource).not.toContain("@hypercli/console");
  expect(agentsRunnerSource).toContain("mobile-chromium");
  expect(agentsRunnerSource).toContain("agents-chat-navigation.spec.ts");
  expect(agentsRunnerSource).toContain('rm -rf "${SITE_ROOT}/tests/claw/screenshots"');
  expect(agentsRunnerSource).toContain('mkdir -p "${SITE_ROOT}/tests/claw/screenshots"');
  expect(agentsRunnerSource.indexOf('rm -rf "${SITE_ROOT}/tests/claw/screenshots"'))
    .toBeLessThan(agentsRunnerSource.indexOf("trap on_exit EXIT"));
  expect(agentsRunnerSource).toContain('cp -r "${SITE_ROOT}/tests/claw/screenshots" "${dest}/screenshots"');
});
