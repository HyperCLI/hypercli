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
    for (const path of ['docs/cli/index.mdx', 'skills/hypercli-account/SKILL.md', 'ts-cli/skills/hypercli-account.json']) {
      expect(read(path), path).toContain('hyper role');
      expect(read(path), path).toContain('hyper user');
    }
    const canonical = read('docs/cli/commands/agent.mdx');
    expect(canonical).toContain('hyper agent <id> soul');
    expect(canonical).toContain('hyper agent <id> role');
    expect(canonical).not.toContain('hyper agent onboard');
    expect(canonical).not.toContain('hyper agent subscribe');
    const generated = JSON.parse(read('ts-cli/skills/hypercli-account.json'));
    expect(generated.commands).toEqual(expect.arrayContaining([
      'hyper soul [--agent <id>] [-f <file>|-]',
      'hyper role [--agent <id>] [value]',
      'hyper agents activate <code>',
    ]));
  });

  it('keeps legacy references separate and avoids dead embed links', () => {
    const navigation = JSON.parse(read('docs/docs.json'));
    const pages = JSON.stringify(navigation);
    expect(pages).toContain('cli/commands/agent-legacy');
    expect(pages).toContain('cli/commands/soul');
    expect(pages).toContain('cli/commands/role');
    expect(read('docs/cli/commands/agent-legacy.mdx')).toContain('end-of-life');
    for (const path of [
      'docs/cli/skills.mdx',
      'docs/cli/quickstart.mdx',
      'docs/inference/quickstart.mdx',
      'docs/cli/commands/wallet.mdx',
    ]) {
      expect(read(path), path).not.toContain('/cli/commands/agent#embed');
      expect(read(path), path).toContain('/cli/commands/agent-legacy');
    }
  });

  it('marks py-cli excluded from release projections', () => {
    expect(read('docs/versioning.md')).toContain('**Excluded** from managed projections and future syncs');
    expect(read('version-ownership.json')).toContain('"py-cli/pyproject.toml": "excluded:');
  });
});
