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
  expect(authFixtureSource).toContain("record.url !== expectedGatewaySocketUrl");
  expect(authFixtureSource).toContain('page.on("websocket", recordSocket)');
  expect(authFixtureSource).toContain('parsed.method === "connect"');
  expect(authFixtureSource).toContain('typeof auth?.token === "string"');
  expect(authFixtureSource).toContain('parsed.type === "res"');
  expect(authFixtureSource).toContain("connectRequestIds.has(parsed.id)");
  expect(authFixtureSource).toContain("authenticated WebSocket connect observed");
  expect(authFixtureSource).toContain('page.off("websocket", recordSocket)');
});

test("agents gateway observation records from the start rather than watching from the middle", () => {
  // The chat panel connects as soon as the Agent it is already showing turns
  // RUNNING. Listeners attached at the point of use therefore saw only the
  // second, already-paired socket and reported "no cold-browser pairing
  // challenge" for a gateway whose own log shows it challenged and approved --
  // a late observation reported as a product failure. Recording starts before
  // the dashboard is opened and every counter is derived from the recording.
  expect(authFixtureSource.indexOf('page.on("websocket", recordSocket)'))
    .toBeLessThan(authFixtureSource.indexOf('await page.goto("/dashboard/agents?tab=chat"'));
  expect(authFixtureSource).toContain("const drainGatewayObservations = ()");
  expect(authFixtureSource).toContain("for (let index = record.drained; index < record.frames.length; index += 1)");
  expect(authFixtureSource).toContain("drainGatewayObservations();\n        expect(pairingRequiredResponses,");
});

test("agents launch canary completes one live gateway chat turn", () => {
  expect(authFixtureSource).toContain('parsed.method === "chat.send"');
  expect(authFixtureSource).toContain('details?.code === "PAIRING_REQUIRED"');
  // Trusted pairing approval mints an exec token and runs the argv command over
  // the exec WebSocket; there is no POST to the bare /exec path to observe.
  expect(authFixtureSource).toContain("const execTokenPath = `/deployments/${created.id}/exec/token`");
  expect(authFixtureSource).toContain("pairingApprovalRequests = recordedPostPaths.filter");
  expect(authFixtureSource).toContain('.toBe("final")');
  expect(authFixtureSource).toContain('getByText(replyMarker, { exact: true })');
  expect(authFixtureSource).toContain('name: "Stop reply", exact: true');
  expect(authFixtureSource).toContain('expected the completed chat turn to reuse the authenticated root socket');
  expect(subscriptionSpecSource).toContain('test.use({ trace: "off", video: "off" })');
  expect(subscriptionSpecSource).not.toContain('screenshot: "off"');
  expect(authFixtureSource).toContain('warm hard refresh must not pair again');
  expect(authFixtureSource).toContain('captureStep(page, "agents-12b-chat-completed")');
  expect(subscriptionSpecSource).toContain('expect(stoppedAgent.state).toBe("STOPPED")');
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
  expect(authFixtureSource).toContain("if (isNonFatalLaunchNotice(message)) {");
  // The same banner renders Agents API failures verbatim, so an unconverged
  // route arrives as traefik's plain-text 404. That is a statement about the
  // edge, not a verdict on the launch -- ridden out, then reported as itself.
  expect(authFixtureSource).toContain("if (isUnroutedEdgeBody(message)) {");
  expect(authFixtureSource).toContain("never cleared an unconverged-edge error");
  expect(authFixtureSource).not.toContain('start: false');
  expect(subscriptionSpecSource).toContain("stopClawAgentThroughUi(page, createdAgentId)");
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

test("agents subscription stops and deletes the Agent through the interface", () => {
  // Creating the Agent was already driven through the launch wizard; stopping
  // and deleting it were not, which left the UI delete path -- the one a user
  // actually takes, and the one that gates on the Agent being stopped -- with
  // no coverage at all in a suite that has been leaking Agents.
  expect(subscriptionSpecSource).toContain("stopClawAgentThroughUi(page, createdAgentId)");
  expect(subscriptionSpecSource).toContain("deleteClawAgentThroughUi(page, createdAgentId)");
  expect(authFixtureSource).toContain('page.getByTestId("agent-stop")');
  expect(authFixtureSource).toContain('page.getByTestId("agent-danger-delete")');
  expect(authFixtureSource).toContain('getByTestId("agent-danger-delete-confirm")');
  // The Danger Zone control staying disabled until the Agent is stopped is the
  // assertion, not an inconvenience to be worked around.
  expect(authFixtureSource).toContain("expected Delete agent to become enabled once the Agent is stopped");
  // The API delete survives only as the teardown backstop.
  expect(subscriptionSpecSource).toContain("deleteClawAgent(page, leakedAgentId)");
  expect(subscriptionSpecSource).not.toContain("await deleteClawAgent(page, createdAgentId)");
});

test("agents launch creates through the UI unless a spec names the shortcut", () => {
  // The wizard is the subject, so driving it is the default; the API create
  // stays reachable for specs about something else, but only when the call
  // site says so.
  expect(authFixtureSource).toContain('const createVia = options.createVia ?? "ui"');
  expect(authFixtureSource).toContain('if (createVia === "api") {');
  expect(authFixtureSource).toContain("deployments.createOpenClaw({");
  expect(subscriptionSpecSource).not.toContain("createVia");
});

test("agents launch captures the Agent's own log before teardown deletes it", () => {
  // A readiness failure is usually a statement about the runtime, and teardown
  // removes the pod, its namespace and its log moments later. Whatever the run
  // did not print is unrecoverable, so the capture has to happen before the
  // delete, not after someone notices.
  expect(authFixtureSource).toContain("async function captureAgentDiagnosticLog");
  // Ordering against the readiness-failure teardown specifically -- the
  // pre-start cleanup path deletes too, and earlier in the file.
  expect(authFixtureSource.indexOf("captureAgentDiagnosticLog(page, deployments, created.id"))
    .toBeLessThan(authFixtureSource.indexOf("[agents-launch] cleaned up failed agent"));
  // The persisted projection runs behind batched ingest, so the live buffer is
  // the source that actually reaches the gateway startup lines.
  expect(authFixtureSource).toContain("deployments.logsToken(agentId)");
  expect(authFixtureSource).toContain('frame?.event === "history_end"');
  // Agent logs carry tokens; every line goes through the same redaction the
  // deployment diagnostics use.
  expect(authFixtureSource).toContain("sanitizeDeploymentDiagnosticText(line)");
});

test("agents teardown asks for the transition the Backend admits", () => {
  // DELETE is admitted only from STOPPED/ARCHIVED, and STOP only from
  // STARTING/RUNNING. These specs delete Agents they just launched, so leading
  // with DELETE spent every teardown rediscovering that through a 409 -- after
  // paying the full transient-retry budget to get there.
  expect(authFixtureSource).toContain("const DELETABLE_DEPLOYMENT_STATES");
  expect(authFixtureSource).toContain("const STOPPABLE_DEPLOYMENT_STATES");
  expect(authFixtureSource).toContain("async function settleDeploymentForDelete");
  expect(authFixtureSource.indexOf("await settleDeploymentForDelete(deployments, agentId);"))
    .toBeLessThan(authFixtureSource.indexOf("await settledAgentsCall(() => deployments.delete(agentId)"));
  // The wait rides the epoch the STOP was accepted under, not the one read
  // before it.
  expect(authFixtureSource).toContain("Number(accepted.launchEpoch ?? accepted.launch_epoch ?? 0)");
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

test("agents launch requires the Agent to still be running when the turn is done", () => {
  // waitRunning accepts the first RUNNING sighting, so a runtime that dies at
  // boot and flaps RUNNING -> FAILED -> STOPPED reaches the gateway assertions
  // as an unexplained connection error instead of a failed launch.
  expect(authFixtureSource).toContain("expected the Agent to still be RUNNING under the launch epoch it started on");
  expect(authFixtureSource).toContain("`RUNNING@${acceptedLaunchEpoch}`");
});

test("agents launch diagnostics preserve accepted and terminal state evidence", () => {
  expect(authFixtureSource).toContain("[agents-launch] start accepted");
  expect(authFixtureSource).toContain("createdLaunchEpoch");
  expect(authFixtureSource).toContain("acceptedLaunchEpoch");
  expect(authFixtureSource).toContain("agentError: latest.error ?? null");
  expect(authFixtureSource).toContain("waitError: error instanceof Error");
});

test("agents subscription earns its plan by clicking the trial, not by seeding or buying", () => {
  // The identity is bootstrapped with a login and nothing else. It earns its
  // plan in the browser, by clicking the trial offer, because that is a real
  // product surface nothing else covers -- and because a Stripe checkout
  // redirect cannot return to a localhost run. Purchase belongs in a billing
  // spec, and neither a seeded grant nor a checkout may grow back here.
  expect(subscriptionSpecSource).toContain("startClawTeamTrialThroughUi(page)");
  expect(subscriptionSpecSource).toContain("a fresh identity must start with no plan");
  expect(subscriptionSpecSource).toContain("expected the Team trial entitlement");
  expect(subscriptionSpecSource).toContain('expect(beforeSummary.effectivePlanId).toBe("team")');
  // A trial is an entitlement, not a subscription: a Stripe subscription
  // appearing here would mean something bought a plan.
  expect(subscriptionSpecSource).toContain("expect(beforeSummary.activeSubscriptionCount).toBe(0)");
  expect(subscriptionSpecSource).not.toContain("completeStripeCheckout");
  expect(subscriptionSpecSource).not.toContain("cancelStripeSubscription");
  expect(subscriptionSpecSource).not.toContain("Purchase Team");
  // The trial must be claimed through the UI control, not posted directly.
  expect(authFixtureSource).toContain('page.goto("/trial"');
  expect(authFixtureSource).toContain('page.locator("#claim-trial-button")');
  expect(authFixtureSource).toContain('page.locator("#trial-claim-success")');
  expect(authFixtureSource).toContain('pathname.endsWith("/plans/trial")');
  // Deletion is proven by an APPLICATION 404: the Backend stamps deleted_at and
  // then hides the row from its owner, so absence is the contract a client can
  // observe. The discrimination matters -- an unrouted-edge 404 must never be
  // mistaken for a deleted Agent.
  expect(authFixtureSource).toContain("if (isDeploymentAbsentError(error)) return \"DELETED\"");
  // Deleting the Agent must hand its slot back.
  expect(subscriptionSpecSource).toContain("slotInventory?.medium?.available");
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
