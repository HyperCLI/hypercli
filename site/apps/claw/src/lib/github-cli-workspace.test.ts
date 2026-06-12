import { describe, expect, it } from "vitest";

import type { ChatMessage } from "./openclaw-chat";
import {
  extractGitHubAgentSetupStatus,
  GITHUB_AGENT_SETUP_PROMPT,
  GITHUB_AGENT_VERIFY_PROMPT,
  GITHUB_CLI_DEVICE_URL,
  isManagedGitHubAuthUnsupportedError,
  shouldHideGitHubAgentSetupMessage,
} from "./github-cli-workspace";

describe("github-cli-workspace", () => {
  it("builds an agent setup prompt that avoids pasted tokens and sudo", () => {
    expect(GITHUB_AGENT_SETUP_PROMPT).toContain("Use your shell/process tools");
    expect(GITHUB_AGENT_SETUP_PROMPT).toContain("Do not ask me for a token");
    expect(GITHUB_AGENT_SETUP_PROMPT).toContain("Do not use sudo");
    expect(GITHUB_AGENT_SETUP_PROMPT).toContain("Do not assume this is a Windows gateway");
    expect(GITHUB_AGENT_SETUP_PROMPT).toContain("do not use PowerShell, cmd.exe, winget, choco, or Windows paths");
    expect(GITHUB_AGENT_SETUP_PROMPT).toContain("command -v gh && gh --version");
    expect(GITHUB_AGENT_SETUP_PROMPT).toContain("uname -a");
    expect(GITHUB_AGENT_SETUP_PROMPT).toContain("test -r /etc/os-release && cat /etc/os-release");
    expect(GITHUB_AGENT_SETUP_PROMPT).toContain("@@hypercli.ui-action/v1 integration.github.device-code <CODE> https://github.com/login/device");
    expect(GITHUB_AGENT_SETUP_PROMPT).toContain("@@hypercli.ui-action/v1 integration.github.ready <GITHUB_LOGIN>");
  });

  it("builds an agent verification prompt for focus-return checks", () => {
    expect(GITHUB_AGENT_VERIFY_PROMPT).toContain("Check whether GitHub CLI authentication is ready in this workspace.");
    expect(GITHUB_AGENT_VERIFY_PROMPT).toContain("gh auth status");
    expect(GITHUB_AGENT_VERIFY_PROMPT).toContain("gh api user --jq .login");
    expect(GITHUB_AGENT_VERIFY_PROMPT).toContain("@@hypercli.ui-action/v1 integration.github.ready <GITHUB_LOGIN>");
    expect(GITHUB_AGENT_VERIFY_PROMPT).toContain("@@hypercli.ui-action/v1 integration.github.progress device-code");
  });

  it("extracts progress and device codes from assistant markers", () => {
    const messages: ChatMessage[] = [
      {
        role: "assistant",
        content: [
          '@@hypercli.ui-action/v1 integration.github.progress authenticating "Starting GitHub device authorization"',
          "@@hypercli.ui-action/v1 integration.github.device-code 8BCD-83A2 https://github.com/login/device",
        ].join("\n"),
      },
    ];

    expect(extractGitHubAgentSetupStatus(messages)).toEqual(expect.objectContaining({
      phase: "device-code",
      progressDetail: "Starting GitHub device authorization",
      userCode: "8BCD-83A2",
      verificationUri: GITHUB_CLI_DEVICE_URL,
    }));
  });

  it("extracts ready and failure markers from assistant messages", () => {
    expect(extractGitHubAgentSetupStatus([
      { role: "assistant", content: "@@hypercli.ui-action/v1 integration.github.ready octocat" },
    ])).toEqual(expect.objectContaining({
      phase: "ready",
      accountDisplayName: "octocat",
    }));

    expect(extractGitHubAgentSetupStatus([
      { role: "assistant", content: '@@hypercli.ui-action/v1 integration.github.failed "GitHub authorization expired"' },
    ])).toEqual(expect.objectContaining({
      phase: "failed",
      failedMessage: "GitHub authorization expired",
    }));
  });

  it("derives device code and ready state from command activity", () => {
    const messages: ChatMessage[] = [
      {
        role: "assistant",
        content: "I am setting that up.",
        toolCalls: [
          {
            name: "shell",
            args: "gh auth login --web",
            result: "First copy your one-time code: 4F43-A4D3\nOpen https://github.com/login/device",
          },
          {
            name: "shell",
            args: "gh auth status",
            result: "Logged in to github.com account octocat (/home/node/.config/gh/hosts.yml)",
          },
        ],
      },
    ];

    expect(extractGitHubAgentSetupStatus(messages)).toEqual(expect.objectContaining({
      phase: "ready",
      userCode: "4F43-A4D3",
      verificationUri: GITHUB_CLI_DEVICE_URL,
      accountDisplayName: "octocat",
      recentCommands: expect.arrayContaining([
        expect.objectContaining({ label: "Starting GitHub authorization" }),
        expect.objectContaining({ label: "Checking GitHub auth" }),
      ]),
    }));
  });

  it("derives ready state from common GitHub verification outputs", () => {
    expect(extractGitHubAgentSetupStatus([
      {
        role: "assistant",
        content: "Checking GitHub now.",
        toolCalls: [{ name: "shell", args: "gh auth status", result: "✓ Logged in to github.com as octocat" }],
      },
    ])).toEqual(expect.objectContaining({
      phase: "ready",
      accountDisplayName: "octocat",
    }));

    expect(extractGitHubAgentSetupStatus([
      {
        role: "assistant",
        content: "Checking GitHub now.",
        toolCalls: [{ name: "shell", args: "gh api user --jq .login", result: "octocat\n" }],
      },
    ])).toEqual(expect.objectContaining({
      phase: "ready",
      accountDisplayName: "octocat",
    }));
  });

  it("derives ready state from leaked natural authentication success text", () => {
    expect(extractGitHubAgentSetupStatus([
      {
        role: "assistant",
        content: "Authenticated! The gh auth login process completed successfully as frankMolinaDev. Let me verify with the standard checks:",
      },
    ])).toEqual(expect.objectContaining({
      phase: "ready",
      accountDisplayName: "frankMolinaDev",
    }));
  });

  it("redacts token-shaped values from command activity and failure messages", () => {
    const status = extractGitHubAgentSetupStatus([
      {
        role: "assistant",
        content: '@@hypercli.ui-action/v1 integration.github.failed "bad token ghp_abcdefghijklmnopqrstuvwxyz123456"',
        toolCalls: [
          {
            name: "shell",
            args: "gh auth status ghp_abcdefghijklmnopqrstuvwxyz123456",
            result: "github_pat_abcdefghijklmnopqrstuvwxyz1234567890 failed",
          },
        ],
      },
    ]);

    expect(status.failedMessage).toBe("bad token [redacted-token]");
    expect(status.recentCommands[0].command).not.toContain("ghp_");
    expect(status.recentCommands[0].result).not.toContain("github_pat_");
  });

  it("detects unsupported managed auth errors", () => {
    expect(isManagedGitHubAuthUnsupportedError(new Error("unknown method: integrations.auth.start"))).toBe(true);
    expect(isManagedGitHubAuthUnsupportedError(new Error("method not found: integrations.auth.start"))).toBe(true);
    expect(isManagedGitHubAuthUnsupportedError(new Error("unknown method: files.read"))).toBe(false);
    expect(isManagedGitHubAuthUnsupportedError(new Error("method not found: files.read"))).toBe(false);
    expect(isManagedGitHubAuthUnsupportedError(new Error("GitHub authorization denied"))).toBe(false);
  });

  it("hides only GitHub setup/auth transcript messages", () => {
    expect(shouldHideGitHubAgentSetupMessage({
      role: "user",
      content: "Set up GitHub in this workspace.",
    })).toBe(true);
    expect(shouldHideGitHubAgentSetupMessage({
      role: "user",
      content: "Check GitHub connection in this workspace.",
    })).toBe(true);
    expect(shouldHideGitHubAgentSetupMessage({
      role: "assistant",
      content: "@@hypercli.ui-action/v1 integration.github.device-code 8BCD-83A2 https://github.com/login/device",
    })).toBe(true);
    expect(shouldHideGitHubAgentSetupMessage({
      role: "assistant",
      content: "Starting auth",
      toolCalls: [{ name: "shell", args: "gh auth login --web", result: "Open https://github.com/login/device and enter 8BCD-83A2" }],
    })).toBe(true);
    expect(shouldHideGitHubAgentSetupMessage({
      role: "assistant",
      content: "gh is missing. Installing from the official GitHub CLI release for Debian 12 (bookworm) x86_64.",
    })).toBe(true);
    expect(shouldHideGitHubAgentSetupMessage({
      role: "assistant",
      content: "Authenticated! The gh auth login process completed successfully as frankMolinaDev. Let me verify with the standard checks:",
    })).toBe(true);

    expect(shouldHideGitHubAgentSetupMessage({
      role: "user",
      content: "Can you check the README while GitHub is connecting?",
    })).toBe(false);
    expect(shouldHideGitHubAgentSetupMessage({
      role: "assistant",
      content: "I can inspect the repository issues.",
      toolCalls: [{ name: "shell", args: "gh issue list --limit 5", result: "no open issues" }],
    })).toBe(false);
  });
});
