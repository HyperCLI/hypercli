import { describe, expect, it } from "vitest";

import {
  CUSTOM_INTEGRATION_MATCH_SCHEMA,
  CUSTOM_INTEGRATION_RUN_SCHEMA,
  buildCustomIntegrationAgentPrompt,
  buildCustomIntegrationMatch,
  containsLikelySecret,
  customIntegrationActivityLabel,
  parseCustomIntegrationRunResult,
} from "./custom-integration-agent";

const request = {
  serviceName: "Notion",
  connectionType: "auto" as const,
  workflow: "Read shared pages and create project notes.",
  documentationUrl: "https://developers.notion.com/",
};

function response(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schema: CUSTOM_INTEGRATION_RUN_SCHEMA,
    status: "complete",
    summary: "Notion tooling is installed and the workspace connection is ready.",
    completed: ["Installed the official Notion CLI.", "Verified the configured workspace connection."],
    userSteps: [],
    ...overrides,
  });
}

describe("custom integration agent contract", () => {
  it("builds a local confirmation without running an agent", () => {
    expect(buildCustomIntegrationMatch(request)).toEqual({
      schema: CUSTOM_INTEGRATION_MATCH_SCHEMA,
      serviceName: "Notion",
      connectionType: "auto",
      documentationUrl: "https://developers.notion.com/",
      intendedUse: "Read shared pages and create project notes.",
    });
    expect(buildCustomIntegrationMatch({ ...request, workflow: "", documentationUrl: "" }).intendedUse).toContain("no specific workflow was requested");
  });

  it("builds a scoped execution prompt with explicit stop conditions", () => {
    const confirmedMatch = buildCustomIntegrationMatch(request);
    const prompt = buildCustomIntegrationAgentPrompt(request, {
      confirmedMatch,
      previousResult: parseCustomIntegrationRunResult(response({
        status: "needs_user_action",
        summary: "Authorization is required.",
        completed: ["Installed the official Notion CLI."],
        userSteps: [{ id: "authorize-notion", title: "Authorize Notion", instructions: "Finish authorization in Notion.", url: "https://www.notion.so/my-integrations", actionLabel: "Open Notion" }],
      })),
      confirmedStepIds: ["authorize-notion"],
    });

    expect(prompt).toContain("install official required packages or plugins");
    expect(prompt).toContain("Never start an interactive command");
    expect(prompt).toContain("Never read, print, infer, repeat, or return credential values");
    expect(prompt).toContain("Never ask the user to paste, send, share, or enter a credential");
    expect(prompt).toContain("Do not reinterpret it or substitute another product");
    expect(prompt).toContain("unique lowercase kebab-case");
    expect(prompt).toContain("actionLabel is allowed only");
    expect(prompt).toContain('"serviceName":"Notion"');
    expect(prompt).toContain('"confirmedMatch":{"schema":"hypercli.custom-integration-match.v1"');
    expect(prompt).toContain('"confirmedStepIds":["authorize-notion"]');
    expect(prompt).toContain('"status":"complete"');
    expect(prompt).toContain('"userSteps":[]');
    expect(() => buildCustomIntegrationAgentPrompt(request, {
      confirmedMatch: { ...confirmedMatch, serviceName: "Notion Calendar" },
    })).toThrow(/confirmed integration match is invalid/i);
  });

  it("rejects secret-shaped input and unsafe documentation URLs", () => {
    const genericSecret = `secret_${"A".repeat(26)}`;
    const secretKeyName = ["SECRET", "KEY"].join("_");
    const assignedSecret = "s".repeat(20);
    const stripeSecret = ["sk", "live", "A".repeat(30)].join("_");
    const stripeWebhookSecret = ["whsec", "A".repeat(30)].join("_");
    const npmToken = ["npm", "A".repeat(32)].join("_");
    const githubToken = ["github", "pat", "A".repeat(32)].join("_");
    const jwt = [`eyJ${"a".repeat(11)}`, "a".repeat(12), "a".repeat(12)].join(".");

    expect(() => buildCustomIntegrationMatch({ ...request, workflow: `token: ${genericSecret}` })).toThrow(/credential or secret/i);
    expect(() => buildCustomIntegrationMatch({ ...request, documentationUrl: "http://developers.notion.com" })).toThrow(/HTTPS URL/i);
    expect(() => buildCustomIntegrationMatch({ ...request, documentationUrl: "https://localhost/docs" })).toThrow(/HTTPS URL/i);
    expect(() => buildCustomIntegrationMatch({ ...request, documentationUrl: "https://developers.notion.com/?token=secret-value" })).toThrow(/credential|authorization values/i);
    expect(containsLikelySecret("NOTION_API_TOKEN is missing")).toBe(false);
    expect(containsLikelySecret(`NOTION_API_TOKEN=${genericSecret}`)).toBe(true);
    expect(containsLikelySecret(`${secretKeyName}=${assignedSecret}`)).toBe(true);
    expect(containsLikelySecret(JSON.stringify({ [secretKeyName]: assignedSecret }))).toBe(true);
    expect(containsLikelySecret(stripeSecret)).toBe(true);
    expect(containsLikelySecret(stripeWebhookSecret)).toBe(true);
    expect(containsLikelySecret(npmToken)).toBe(true);
    expect(containsLikelySecret(githubToken)).toBe(true);
    expect(containsLikelySecret(jwt)).toBe(true);
  });

  it("parses completed and user-action results without exposing extra fields", () => {
    expect(parseCustomIntegrationRunResult(response()).status).toBe("complete");
    const needsAction = parseCustomIntegrationRunResult(response({
      status: "needs_user_action",
      summary: "Notion authorization is the only remaining step.",
      userSteps: [{ id: "authorize-notion", title: "Authorize Notion", instructions: "Choose the pages this agent may access.", url: "https://www.notion.so/my-integrations", actionLabel: "Open Notion" }],
    }));
    expect(needsAction.userSteps).toEqual([expect.objectContaining({ id: "authorize-notion", actionLabel: "Open Notion" })]);
    expect(() => parseCustomIntegrationRunResult(response({ debug: "raw tool output" }))).toThrow(/unsupported setup result/i);
  });

  it("rejects inconsistent, unsafe, and credential-bearing results", () => {
    expect(() => parseCustomIntegrationRunResult(response({ userSteps: [{ id: "extra", title: "Extra", instructions: "Do this." }] }))).toThrow(/Completed setup/i);
    expect(() => parseCustomIntegrationRunResult(response({ status: "needs_user_action", userSteps: [] }))).toThrow(/at least one step/i);
    expect(() => parseCustomIntegrationRunResult(response({ summary: "Use token: secret_ABCDEFGHIJKLMNOPQRSTUVWXYZ" }))).toThrow(/credential or secret/i);
    expect(() => parseCustomIntegrationRunResult(response({ completed: ["Updated /home/agent/private/config.json"] }))).toThrow(/private path/i);
    expect(() => parseCustomIntegrationRunResult(response({ completed: ["Updated \"/opt/custom/config.json\"."] }))).toThrow(/private path/i);
    expect(() => parseCustomIntegrationRunResult(response({ completed: ["Updated /.env"] }))).toThrow(/private path/i);
    expect(() => parseCustomIntegrationRunResult(response({ summary: "stdout: connected as private-user" }))).toThrow(/command output/i);
    expect(() => parseCustomIntegrationRunResult(response({ summary: '{"stdout":"connected as private-user"}' }))).toThrow(/command output/i);
    expect(() => parseCustomIntegrationRunResult(response({ completed: ["npm install private-package"] }))).toThrow(/command output/i);
    expect(() => parseCustomIntegrationRunResult(response({ completed: ["Ran `npm install private-package`."] }))).toThrow(/command output/i);
    expect(() => parseCustomIntegrationRunResult(response({
      status: "needs_user_action",
      userSteps: [{ id: "paste-key", title: "Provide access", instructions: "Paste your API key into the workflow field." }],
    }))).toThrow(/disclose a credential/i);
    expect(() => parseCustomIntegrationRunResult(response({
      status: "needs_user_action",
      userSteps: [{ id: "copy-key", title: "Provide access", instructions: "Copy your API key into this card.", url: "https://notion.so/settings" }],
    }))).toThrow(/disclose a credential/i);
    expect(parseCustomIntegrationRunResult(response({
      status: "needs_user_action",
      userSteps: [{ id: "external-key", title: "Finish secure setup", instructions: "Paste your API key into the verified service form.", url: "https://notion.so/settings" }],
    })).userSteps).toHaveLength(1);
    expect(() => parseCustomIntegrationRunResult(response({
      status: "needs_user_action",
      userSteps: [{ id: "Invalid ID", title: "Authorize", instructions: "Complete authorization on the service page." }],
    }))).toThrow(/id is invalid/i);
    expect(() => parseCustomIntegrationRunResult(response({
      status: "needs_user_action",
      userSteps: [{ id: "authorize", title: "Authorize", instructions: "Complete authorization on the service page.", actionLabel: "Open setup" }],
    }))).toThrow(/requires a URL/i);
    expect(() => parseCustomIntegrationRunResult(response({
      status: "needs_user_action",
      userSteps: [{ id: "login", title: "Log in", instructions: "Open the page.", url: "https://user:pass@notion.so/login" }],
    }))).toThrow(/without embedded credentials/i);
    expect(() => parseCustomIntegrationRunResult(response({
      status: "needs_user_action",
      userSteps: [{ id: "login", title: "Log in", instructions: "Open the page.", url: "https://notion.so/login?code=private-value" }],
    }))).toThrow(/authorization values/i);
  });

  it("maps tool events to sanitized progress labels", () => {
    expect(customIntegrationActivityLabel({ type: "tool_call", data: { name: "npm_install", args: { secret: "hidden" } } })).toBe("Installing required tools");
    expect(customIntegrationActivityLabel({ type: "tool_call", data: { name: "Shell", args: { command: "private" } } })).toBe("Running workspace setup");
    expect(customIntegrationActivityLabel({ type: "tool_result", data: { result: "private output" } })).toBe("Checking completed work");
    expect(customIntegrationActivityLabel({ type: "done" })).toBeNull();
  });
});
