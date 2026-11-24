import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

describe('TS CLI documentation and generated skill contract', () => {
  it('maps soul/role/user in active docs and generated account skills', () => {
    for (const [path, command] of [
      ['docs/cli/index.mdx', 'hyper soul'],
      ['docs/cli/commands/soul.mdx', 'hyper soul'],
      ['docs/cli/commands/role.mdx', 'hyper role'],
      ['docs/cli/commands/user.mdx', 'hyper user'],
      ['skills/hypercli-account/SKILL.md', 'hyper soul'],
      ['ts-cli/skills/hypercli-account.json', 'hyper soul'],
    ] as const) {
      const text = read(path);
      expect(text, path).toContain(command);
      expect(text, path).not.toContain('hyper agent onboard');
      expect(text, path).not.toContain('hyper agent subscribe');
    }
    const index = read('docs/cli/index.mdx');
    expect(index).toContain('hyper role');
    expect(index).toContain('hyper user');
    for (const path of ['skills/hypercli-account/SKILL.md', 'ts-cli/skills/hypercli-account.json']) {
      expect(read(path), path).not.toContain('hyper role');
      expect(read(path), path).toContain('hyper_persona_resolve');
      expect(read(path), path).toContain('hyper user');
    }
    const canonical = read('docs/cli/commands/agent.mdx');
    expect(canonical).toContain('hyper agent <id> soul');
    expect(canonical).toContain('hyper agent <id> role');
    expect(canonical).not.toContain('hyper agent onboard');
    expect(canonical).not.toContain('hyper agent subscribe');
    const generated = JSON.parse(read('ts-cli/skills/hypercli-account.json'));
    expect(generated.commands).toEqual(expect.arrayContaining([
      'hyper agent <id> soul',
      'hyper configure',
      'hyper wallet balance',
    ]));
    // Grant-code redemption moved to the agents family skill; the account
    // bundle must not carry it.
    expect(generated.commands).not.toContain('hyper agents activate <code>');
    const agentsGenerated = JSON.parse(read('ts-cli/skills/hypercli-agents.json'));
    expect(agentsGenerated.commands).toContain('hyper agents activate <code>');
  });

  it('documents dynamic-only persona discovery and resolution', () => {
    const cli = read('docs/cli/commands/persona.mdx');
    expect(cli).toContain('hyper persona list');
    expect(cli).toContain('hyper persona ls --json');
    expect(cli).toContain('hyper persona resolve --agent <id> --json');
    expect(cli).toContain('--source live');
    expect(cli).toContain('Every list, get, and resolve request goes through the authenticated');
    expect(cli).toContain('does not ship or read a generated');
    expect(cli).toContain('Resolution is always live');
    expect(cli).not.toContain('degraded_offline');
    const sdk = read('docs/ts-sdk/personas.mdx');
    expect(sdk).toContain('client.personas.resolve');
    expect(sdk).toContain('Deployments.accessIdentity()');
    expect(sdk).toContain('UserAPI.getProfile()');
    const navigation = JSON.stringify(JSON.parse(read('docs/docs.json')));
    expect(navigation).toContain('cli/commands/persona');
    expect(navigation).toContain('ts-sdk/personas');
    expect(read('skills/hypercli-account/SKILL.md')).toContain('hyper persona resolve');
    const account = JSON.parse(read('ts-cli/skills/hypercli-account.json'));
    expect(account.commands).toEqual(expect.arrayContaining([
      'hyper persona resolve',
      'hyper persona list',
    ]));
    expect(account.markdown).toContain('no generated persona catalog is installed with the CLI');
  });

  it('routes retired commands to supported interfaces without obsolete installs', () => {
    const navigation = JSON.parse(read('docs/docs.json'));
    const pages = JSON.stringify(navigation);
    expect(pages).toContain('cli/commands/agent-legacy');
    expect(pages).toContain('cli/commands/soul');
    expect(pages).toContain('cli/commands/role');
    expect(read('docs/cli/commands/agent-legacy.mdx')).toContain('Python CLI has been removed');
    for (const path of [
      'docs/cli/skills.mdx',
      'docs/cli/quickstart.mdx',
      'docs/inference/quickstart.mdx',
      'docs/cli/commands/wallet.mdx',
    ]) {
      expect(read(path), path).not.toContain('/cli/commands/agent#embed');
      expect(read(path), path).not.toContain('hypercli-cli');
    }
    expect(read('docs/cli/commands/memory.mdx')).toContain('no `hyper memory import` command');
    expect(read('docs/cli/commands/memory.mdx')).toContain('hyper memory search');
  });

  it('owns only the supported SDKs and TypeScript CLI release', () => {
    const ownership = JSON.parse(read('version-ownership.json'));
    expect(ownership.manifests['py-cli/pyproject.toml']).toBeUndefined();
    expect(ownership.manifests['py-sdk/pyproject.toml']).toBe('app');
    expect(ownership.manifests['ts-cli/package.json']).toBe('app');
  });
});
