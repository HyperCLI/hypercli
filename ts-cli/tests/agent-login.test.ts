/**
 * Tests for `hyper agents login` (src/commands/agent-login.ts).
 *
 * The log-parsing/polling utils (stripAnsi, URL/code extraction, pollLog)
 * are pure and tested directly. Command-level tests ride the same
 * CommandContext seam as tests/agents.test.ts: a mock Deployments whose exec
 * is scripted by pod-side state, so nothing touches the network.
 */

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Agent, AgentExecResult, HyperCLI } from '@hypercli.com/sdk';
import * as login from '../src/commands/agent-login.js';
import { CliError, UsageError } from '../src/core/errors.js';
import { createOutput } from '../src/core/output.js';
import type { CommandContext } from '../src/core/types.js';

const ID_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';

let stdoutSpy: ReturnType<typeof vi.spyOn>;
let stderrSpy: ReturnType<typeof vi.spyOn>;
let stdoutChunks: string[];
let stderrChunks: string[];

const stdout = () => stdoutChunks.join('');
const stderr = () => stderrChunks.join('');

beforeEach(() => {
  stdoutChunks = [];
  stderrChunks = [];
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    stdoutChunks.push(String(chunk));
    return true;
  }) as typeof stdoutSpy;
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    stderrChunks.push(String(chunk));
    return true;
  }) as typeof stderrSpy;
});

afterEach(() => {
  stdoutSpy.mockRestore();
  stderrSpy.mockRestore();
  vi.unstubAllEnvs();
});

// ---------- pure log helpers ----------

describe('stripAnsi', () => {
  it('removes CSI color/reset sequences', () => {
    expect(login.stripAnsi('\x1b[32mhello\x1b[0m world')).toBe('hello world');
  });

  it('removes OSC hyperlink sequences and charset escapes', () => {
    const osc = '\x1b]8;;https://auth.openai.com\x07text\x1b]8;;\x07';
    expect(login.stripAnsi(osc)).toBe('text');
    expect(login.stripAnsi('\x1b(Bplain')).toBe('plain');
  });

  it('leaves plain text untouched', () => {
    expect(login.stripAnsi('Successfully logged in')).toBe('Successfully logged in');
  });
});

describe('extractCodexDeviceAuth', () => {
  it('finds the URL and one-time code in a realistic device-auth log', () => {
    const log = [
      '\x1b[1mOpenAI Codex\x1b[0m',
      '',
      'To log in, visit https://auth.openai.com/codex/device in your browser',
      'and enter code A1B2-C3D4E.',
    ].join('\n');
    expect(login.extractCodexDeviceAuth(log)).toEqual({
      url: 'https://auth.openai.com/codex/device',
      code: 'A1B2-C3D4E',
    });
  });

  it('returns a partial result when only the URL has landed', () => {
    const out = login.extractCodexDeviceAuth('visit https://auth.openai.com/codex/device now');
    expect(out.url).toBe('https://auth.openai.com/codex/device');
    expect(out.code).toBeUndefined();
  });

  it('returns nothing for an empty log', () => {
    expect(login.extractCodexDeviceAuth('')).toEqual({ url: undefined, code: undefined });
  });
});

describe('codexDeviceAuthOutcome', () => {
  it('detects success and failure', () => {
    expect(login.codexDeviceAuthOutcome('Successfully logged in as user@example.com')).toBe('success');
    expect(login.codexDeviceAuthOutcome('error: device code expired')).toBe('failed');
    expect(login.codexDeviceAuthOutcome('still waiting...')).toBeUndefined();
  });
});

describe('extractClaudeOAuthUrl', () => {
  it('finds the authorize URL in realistic claude auth login output', () => {
    const log = [
      '\x1b[2mClaude Code requires login\x1b[0m',
      'Visit the following URL to authenticate:',
      'https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a&response_type=code&redirect_uri=https%3A%2F%2Fexample.com%2Fcallback&code_challenge=abc_123',
    ].join('\n');
    expect(login.extractClaudeOAuthUrl(log)).toBe(
      'https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a&response_type=code&redirect_uri=https%3A%2F%2Fexample.com%2Fcallback&code_challenge=abc_123',
    );
  });

  it('returns undefined when the URL has not landed yet', () => {
    expect(login.extractClaudeOAuthUrl('starting login...')).toBeUndefined();
  });
});

describe('claudePasteOutcome', () => {
  it('detects the terminal states', () => {
    expect(login.claudePasteOutcome('Login successful')).toBe('success');
    expect(login.claudePasteOutcome('\x1b[31mLogin failed: invalid code\x1b[0m')).toBe('failed');
    expect(login.claudePasteOutcome('waiting for browser callback')).toBeUndefined();
  });
});

describe('claudeStatusLoggedIn', () => {
  it('parses the claude auth status JSON document', () => {
    expect(login.claudeStatusLoggedIn('{"loggedIn": true, "authMethod": "claude.ai"}')).toBe(true);
    expect(login.claudeStatusLoggedIn('{\n  "loggedIn": true\n}')).toBe(true);
  });

  it('tolerates the JSON embedded in noisier output', () => {
    expect(login.claudeStatusLoggedIn('\x1b[2mstatus:\x1b[0m { "loggedIn": true }')).toBe(true);
  });

  it('rejects logged-out and malformed payloads', () => {
    expect(login.claudeStatusLoggedIn('{"loggedIn": false}')).toBe(false);
    expect(login.claudeStatusLoggedIn('not json')).toBe(false);
  });
});

describe('shQuote', () => {
  it('single-quotes and escapes embedded quotes', () => {
    expect(login.shQuote('abc123#state')).toBe(`'abc123#state'`);
    expect(login.shQuote(`it's`)).toBe(`'it'\\''s'`);
  });
});

// ---------- pollLog ----------

describe('pollLog', () => {
  const fast = { minIntervalMs: 1, maxIntervalMs: 2, sleep: async () => {} };

  it('keeps polling through null reads until extract hits', async () => {
    const pages: Array<string | null> = [null, null, 'nothing yet', 'url is here'];
    let page = 0;
    const read = vi.fn(async () => pages[Math.min(page++, pages.length - 1)]);
    const hit = await login.pollLog({
      ...fast,
      read,
      extract: (text) => (text.includes('url is here') ? 'HIT' : undefined),
      deadlineAtMs: Date.now() + 60_000,
      waitingFor: 'a url',
    });
    expect(hit).toBe('HIT');
    expect(read).toHaveBeenCalledTimes(4);
  });

  it('throws at the deadline when nothing matches', async () => {
    await expect(
      login.pollLog({
        ...fast,
        read: async () => 'no match',
        extract: () => undefined,
        deadlineAtMs: Date.now() + 20,
        waitingFor: 'a url',
      }),
    ).rejects.toThrow(/timed out waiting for a url/);
  });

  it('aborts immediately when the fail extractor reports', async () => {
    await expect(
      login.pollLog({
        ...fast,
        read: async () => 'sh: 1: codex: command not found',
        extract: () => undefined,
        fail: (text) => (/command not found/.test(text) ? 'launcher failed' : undefined),
        deadlineAtMs: Date.now() + 60_000,
        waitingFor: 'a url',
      }),
    ).rejects.toThrow(/aborted waiting for a url: launcher failed/);
  });

  it('tolerates transient read errors and gives up after repeated failures', async () => {
    let calls = 0;
    await expect(
      login.pollLog({
        ...fast,
        read: async () => {
          calls += 1;
          throw new Error('boom');
        },
        extract: () => undefined,
        deadlineAtMs: Date.now() + 60_000,
        waitingFor: 'a url',
      }),
    ).rejects.toThrow(/log poll failed repeatedly/);
    expect(calls).toBeGreaterThanOrEqual(5);
  });
});

// ---------- command-level harness ----------

function agentRecord(runtime: string): Agent {
  return {
    id: ID_A,
    userId: 'user-1',
    state: 'RUNNING',
    name: 'alpha',
    handle: null,
    displayName: 'alpha',
    avatarUrl: null,
    runtime,
    hostname: 'alpha.hypercli.run',
    cpu: 2,
    memory: 4,
    requestedSize: null,
    tags: [],
    launchEpoch: 1,
    agentSlotId: null,
    clusterId: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: null,
    startedAt: null,
    stoppedAt: null,
    archivedAt: null,
    jwtToken: null,
    meta: null,
    routes: {},
    launchConfig: null,
    publicUrl: null,
    desktopUrl: null,
    shellUrl: null,
  } as unknown as Agent;
}

interface ScriptedDeployments {
  exec: ReturnType<typeof vi.fn>;
  cpTo: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  list: ReturnType<typeof vi.fn>;
  calls: string[][];
}

function scriptedDeployments(
  runtime: string,
  script: (argv: string[], state: { cats: Record<string, number> }) => AgentExecResult,
): ScriptedDeployments {
  const calls: string[][] = [];
  const state = { cats: {} as Record<string, number> };
  const exec = vi.fn(async (_id: string, argv: string[]) => {
    calls.push(argv);
    if (argv[0] === 'cat') {
      const path = argv[1];
      state.cats[path] = (state.cats[path] ?? 0) + 1;
    }
    return script(argv, state);
  });
  return {
    exec,
    cpTo: vi.fn(async () => ({})),
    get: vi.fn(async () => agentRecord(runtime)),
    list: vi.fn(async () => [agentRecord(runtime)]),
    calls,
  };
}

function fakeCtx(d: ScriptedDeployments, format: 'json' | 'table' = 'json'): CommandContext {
  const client = { deployments: d } as unknown as HyperCLI;
  return { client: async () => client, output: createOutput(format), format, dev: false };
}

const OK: AgentExecResult = { exitCode: 0, stdout: '', stderr: '' };

async function runErr(ctx: CommandContext, args: string[]): Promise<unknown> {
  return login.cmdAgentsLogin(ctx, args).then(
    () => null,
    (e: unknown) => e,
  );
}

// ---------- command-level: refusals ----------

describe('hyper agents login refusals', () => {
  it('refuses unsupported runtimes with their native-path hint', async () => {
    const d = scriptedDeployments('opencode', () => OK);
    const err = await runErr(fakeCtx(d), [ID_A]);
    expect(err).toBeInstanceOf(CliError);
    expect(String(err)).toContain(`runtime 'opencode' has no login flow`);
    expect(String(err)).toContain(`opencode auth login -p openai -m "ChatGPT Pro/Plus (headless)"`);
    expect(d.exec).not.toHaveBeenCalled();
  });

  it('refuses --key-stdin on codex as not yet supported', async () => {
    const d = scriptedDeployments('codex', () => OK);
    const err = await runErr(fakeCtx(d), [ID_A, '--key-stdin']);
    expect(err).toBeInstanceOf(CliError);
    expect(String(err)).toContain('--key-stdin is not yet supported');
    expect(String(err)).toContain('--flow device-auth');
    expect(d.exec).not.toHaveBeenCalled();
  });

  it('prints the env advisory for --key-stdin on claude-code without exec', async () => {
    const d = scriptedDeployments('claude-code', () => OK);
    await login.cmdAgentsLogin(fakeCtx(d), [ID_A, '--key-stdin']);
    const payload = JSON.parse(stdout().trim().split('\n').pop() as string) as Record<string, unknown>;
    expect(payload.loggedIn).toBe(false);
    expect(payload.flow).toBe('env');
    expect(String(payload.detail)).toContain('CLAUDE_CODE_OAUTH_TOKEN');
    expect(stderr()).toContain('CLAUDE_CODE_OAUTH_TOKEN');
    expect(d.exec).not.toHaveBeenCalled();
  });

  it('gates host-creds behind --from-host-creds', async () => {
    const d = scriptedDeployments('claude-code', () => OK);
    const err = await runErr(fakeCtx(d), [ID_A, '--flow', 'host-creds']);
    expect(err).toBeInstanceOf(UsageError);
    expect(String(err)).toContain('--from-host-creds');
    expect(d.cpTo).not.toHaveBeenCalled();
  });

  it('rejects --from-host-creds on non-claude runtimes', async () => {
    const d = scriptedDeployments('codex', () => OK);
    expect(await runErr(fakeCtx(d), [ID_A, '--from-host-creds'])).toBeInstanceOf(UsageError);
  });
});

// ---------- command-level: codex device-auth ----------

describe('hyper agents login (codex device-auth)', () => {
  function codexScript(argv: string[], state: { cats: Record<string, number> }): AgentExecResult {
    if (argv[0] === 'sh') return { exitCode: 0, stdout: '4210\n', stderr: '' };
    if (argv[0] === 'cat') {
      const n = state.cats['/tmp/devauth.log'];
      if (n === 1) {
        return {
          exitCode: 0,
          stdout: '\x1b[1mCodex\x1b[0m\nOpen https://auth.openai.com/codex/device and enter code ABCD-EF12G\n',
          stderr: '',
        };
      }
      return { exitCode: 0, stdout: 'Successfully logged in', stderr: '' };
    }
    if (argv[0] === 'codex' && argv[1] === 'login') {
      return { exitCode: 0, stdout: 'Logged in using ChatGPT\n', stderr: '' };
    }
    return OK;
  }

  it('announces the URL+code as JSON, then finishes loggedIn:true', async () => {
    const d = scriptedDeployments('codex', codexScript);
    await login.cmdAgentsLogin(fakeCtx(d), [ID_A]);

    const lines = stdout().trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines[0]).toEqual({ url: 'https://auth.openai.com/codex/device', code: 'ABCD-EF12G' });
    const final = lines[lines.length - 1];
    expect(final.loggedIn).toBe(true);
    expect(final.flow).toBe('device-auth');
    expect(final.runtime).toBe('codex');
    expect(final.agent_id).toBe(ID_A);

    const launcher = d.calls.find((argv) => argv[0] === 'sh');
    expect(launcher?.[1]).toBe('-c');
    expect(launcher?.[2]).toContain('setsid nohup codex login --device-auth');
    expect(stderr()).toContain('waiting for the codex device-auth code');
  });

  it('fails when the log reports failure instead of success', async () => {
    const d = scriptedDeployments('codex', (argv, state) => {
      if (argv[0] === 'sh') return OK;
      if (argv[0] === 'cat') {
        return state.cats['/tmp/devauth.log'] === 1
          ? { exitCode: 0, stdout: 'https://auth.openai.com/codex/device code ABCD-EF12G', stderr: '' }
          : { exitCode: 0, stdout: 'error: device code expired', stderr: '' };
      }
      return OK;
    });
    const err = await runErr(fakeCtx(d), [ID_A]);
    expect(err).toBeInstanceOf(CliError);
    expect(String(err)).toContain('device-auth failed or the code expired');
  });
});

// ---------- command-level: claude-code paste-back ----------

describe('hyper agents login (claude-code paste-back)', () => {
  it('announces the URL, pipes the pasted code through the fifo, verifies, and cleans up', async () => {
    const d = scriptedDeployments('claude-code', (argv, state) => {
      const body = argv[2] ?? '';
      if (argv[0] === 'sh' && body.includes('mkfifo')) return OK;
      if (argv[0] === 'sh' && body.includes('pkill')) return OK;
      if (argv[0] === 'sh' && body.includes('printf')) return OK;
      if (argv[0] === 'cat') {
        return state.cats['/tmp/clin.log'] === 1
          ? {
              exitCode: 0,
              stdout: '\x1b[2mWaiting for browser login\x1b[0m\nhttps://claude.com/cai/oauth/authorize?code=true&client_id=abc&code_challenge=xyz\n',
              stderr: '',
            }
          : { exitCode: 0, stdout: 'Login successful', stderr: '' };
      }
      if (argv[0] === 'claude') {
        return { exitCode: 0, stdout: '{"loggedIn": true, "authMethod": "claude.ai"}', stderr: '' };
      }
      return OK;
    });

    const readInput = vi.fn(async () => `code'me#state9`);
    await login.cmdAgentsLogin(fakeCtx(d), [ID_A], { readInput });

    const lines = stdout().trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines[0]).toEqual({ url: 'https://claude.com/cai/oauth/authorize?code=true&client_id=abc&code_challenge=xyz' });
    expect(lines[lines.length - 1].loggedIn).toBe(true);

    const fifoWrite = d.calls.find((argv) => argv[0] === 'sh' && (argv[2] ?? '').includes('printf'));
    expect(fifoWrite?.[2]).toBe(`printf '%s\\n' 'code'\\''me#state9' > /tmp/clinf`);

    // The fifo launcher and the cleanup both ran.
    expect(d.calls.some((argv) => (argv[2] ?? '').includes('mkfifo /tmp/clinf'))).toBe(true);
    const cleanup = d.calls.find((argv) => (argv[2] ?? '').includes('pkill'));
    expect(cleanup?.[2]).toContain('rm -f /tmp/clinf /tmp/clin.log');

    expect(stderr()).toContain('--from-host-creds'); // the default-flow hint
    expect(readInput).toHaveBeenCalledTimes(1);
  });
});

// ---------- command-level: claude-code host-creds ----------

describe('hyper agents login (claude-code host-creds)', () => {
  it('copies the local credentials up sync-root-relative, then mv+chmod into place', async () => {
    const home = mkdtempSync(join(tmpdir(), 'hyper-login-'));
    mkdirSync(join(home, '.claude'));
    writeFileSync(join(home, '.claude', '.credentials.json'), '{"oauthAccount":{}}');
    vi.stubEnv('HOME', home);

    const d = scriptedDeployments('claude-code', (argv) => {
      const body = argv[2] ?? '';
      if (argv[0] === 'sh' && body.includes('mv /home/node/.credentials.json')) return OK;
      if (argv[0] === 'claude') return { exitCode: 0, stdout: '{"loggedIn": true}', stderr: '' };
      return OK;
    });

    await login.cmdAgentsLogin(fakeCtx(d), [ID_A, '--from-host-creds']);

    expect(d.cpTo).toHaveBeenCalledWith(ID_A, join(home, '.claude', '.credentials.json'), '.credentials.json');
    const mv = d.calls.find((argv) => (argv[2] ?? '').includes('mv /home/node/.credentials.json'));
    expect(mv?.[2]).toContain('chmod 600 /home/node/.claude/.credentials.json');

    const final = JSON.parse(stdout().trim().split('\n').pop() as string) as Record<string, unknown>;
    expect(final.loggedIn).toBe(true);
    expect(final.flow).toBe('host-creds');
  });

  it('refuses cleanly when no local credentials exist', async () => {
    const home = mkdtempSync(join(tmpdir(), 'hyper-login-empty-'));
    vi.stubEnv('HOME', home);
    const d = scriptedDeployments('claude-code', () => OK);
    const err = await runErr(fakeCtx(d), [ID_A, '--from-host-creds']);
    expect(err).toBeInstanceOf(CliError);
    expect(String(err)).toContain('no local Claude credentials');
    expect(d.cpTo).not.toHaveBeenCalled();
  });
});
