import { describe, expect, it, vi } from 'vitest';
import { exec as execCallback } from 'node:child_process';
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { buildOpenClawSkillDocumentReadCommand, OpenClawSkillsProvider, normalizeOpenClawSkill, type OpenClawSkillsClient } from '../src/openclaw/skills.js';
import type { GatewaySkillStatusEntry } from '../src/openclaw/gateway.js';

function statusEntry(overrides: Partial<GatewaySkillStatusEntry> = {}): GatewaySkillStatusEntry {
  return {
    name: 'Weather',
    description: 'Check weather forecasts.',
    source: 'bundled',
    bundled: true,
    filePath: '/provider/weather/SKILL.md',
    baseDir: '/provider/weather',
    skillKey: 'weather',
    always: false,
    disabled: false,
    blockedByAllowlist: false,
    blockedByAgentFilter: false,
    eligible: true,
    modelVisible: true,
    userInvocable: true,
    commandVisible: true,
    requirements: { env: ['WEATHER_API_KEY'], bins: ['curl'] },
    missing: {},
    configChecks: [],
    install: [],
    ...overrides,
  };
}

function client(overrides: Partial<OpenClawSkillsClient> = {}): OpenClawSkillsClient {
  return {
    skillsStatus: vi.fn(async () => ({ agentId: 'default', workspaceDir: '/workspace', managedSkillsDir: '/managed', skills: [statusEntry({ skillCard: { present: true, path: '/provider/card.md', sizeBytes: 12 } })] })),
    skillsSkillCard: vi.fn(async ({ skillKey }) => ({ schema: 'openclaw.skills.skill-card.v1', skillKey, path: '/provider/SKILL.md', sizeBytes: 12, content: '# Weather' })),
    skillsUpdate: vi.fn(async ({ skillKey }) => ({ ok: true, skillKey, config: {} })),
    skillsSearch: vi.fn(async () => ({ results: [] })),
    skillsInstall: vi.fn(async (request) => ({ ok: true, slug: 'slug' in request ? request.slug : undefined })),
    ...overrides,
  };
}

const execShell = promisify(execCallback);

async function localExec(command: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  try {
    const result = await execShell(command, { maxBuffer: 20 * 1024 * 1024 });
    return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failure = error as Error & { code?: number; stdout?: string; stderr?: string };
    return { exitCode: typeof failure.code === 'number' ? failure.code : 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? failure.message };
  }
}

describe('OpenClawSkillsProvider', () => {
  it('normalizes provider-specific status into generic availability', () => {
    expect(normalizeOpenClawSkill(statusEntry())).toMatchObject({
      id: 'weather',
      origin: 'built-in',
      availability: 'active',
      enabled: true,
      ready: true,
      documentAvailable: true,
      requirements: { env: ['WEATHER_API_KEY'], bins: ['curl'], os: [] },
    });
    expect(normalizeOpenClawSkill(statusEntry({ eligible: false }))).toMatchObject({
      availability: 'needs-setup',
      enabled: true,
      ready: false,
    });
    expect(normalizeOpenClawSkill(statusEntry({ source: 'plugin', bundled: false }))).toMatchObject({ origin: 'extension' });
  });

  it('adapts catalog, document, update, search, and registry install operations', async () => {
    const sdk = client({
      skillsSearch: vi.fn(async () => ({ results: [{ score: 1, slug: 'release-helper', displayName: 'Release Helper', summary: 'Prepare releases.' }] })),
    });
    const provider = new OpenClawSkillsProvider(sdk);

    await expect(provider.list()).resolves.toEqual([expect.objectContaining({ id: 'weather' })]);
    await expect(provider.readDocument('weather')).resolves.toEqual({ skillId: 'weather', content: '# Weather', sizeBytes: 12 });
    await provider.update('weather', { enabled: false });
    await expect(provider.search('release')).resolves.toEqual([expect.objectContaining({ id: 'release-helper' })]);
    await expect(provider.install({ source: 'registry', id: 'release-helper' })).resolves.toMatchObject({ ok: true, skillId: 'release-helper' });

    expect(sdk.skillsUpdate).toHaveBeenCalledWith({ skillKey: 'weather', enabled: false });
    expect(sdk.skillsSkillCard).toHaveBeenCalledWith({ agentId: 'default', skillKey: 'weather' });
    expect(sdk.skillsInstall).toHaveBeenCalledWith({ source: 'clawhub', slug: 'release-helper', version: undefined, force: undefined });
  });

  it('reads the exact status-reported file path before using a skill-card fallback', async () => {
    const sdk = client({
      skillsStatus: vi.fn(async () => ({
        agentId: 'default',
        workspaceDir: '/home/node/.openclaw/workspace',
        managedSkillsDir: '/home/node/.openclaw/skills',
        skills: [statusEntry({
          source: 'openclaw-extra',
          bundled: false,
          skillKey: 'browser-automation',
          filePath: '/home/node/.openclaw/plugin-skills/browser-automation/SKILL.md',
          baseDir: '/home/node/.openclaw/plugin-skills/browser-automation',
          skillCard: undefined,
        })],
      })),
    });
    const readFile = vi.fn(async () => '# Browser Automation');
    const provider = new OpenClawSkillsProvider(sdk, { readFile });

    await provider.list();
    await expect(provider.readDocument('browser-automation')).resolves.toMatchObject({
      skillId: 'browser-automation',
      content: '# Browser Automation',
    });
    expect(readFile).toHaveBeenCalledWith('/home/node/.openclaw/plugin-skills/browser-automation/SKILL.md');
    expect(sdk.skillsSkillCard).not.toHaveBeenCalled();
  });

  it('surfaces a file read failure when no skill card is available', async () => {
    const sdk = client({
      skillsStatus: vi.fn(async () => ({
        agentId: 'default',
        workspaceDir: '/workspace',
        managedSkillsDir: '/managed',
        skills: [statusEntry({ skillCard: undefined })],
      })),
    });
    const provider = new OpenClawSkillsProvider(sdk, { readFile: vi.fn(async () => { throw new Error('file API unavailable'); }) });

    await provider.list();
    await expect(provider.readDocument('weather')).rejects.toThrow('file API unavailable');
  });

  it.each([
    ['/app/skills/weather/SKILL.md', '# Weather'],
    ['/home/node/.openclaw/plugin-skills/browser-automation/SKILL.md', '# Browser Automation'],
  ])('reads status-reported paths through the safe exec fallback: %s', async (filePath, content) => {
    const sdk = client({
      skillsStatus: vi.fn(async () => ({
        agentId: 'default',
        workspaceDir: '/home/node/.openclaw/workspace',
        managedSkillsDir: '/home/node/.openclaw/skills',
        skills: [statusEntry({ filePath, baseDir: filePath.replace(/\/SKILL\.md$/, ''), skillCard: undefined })],
      })),
    });
    const exec = vi.fn(async () => ({ exitCode: 0, stdout: content, stderr: '' }));
    const provider = new OpenClawSkillsProvider(sdk, { exec });

    await provider.list();
    await expect(provider.readDocument('weather')).resolves.toEqual({ skillId: 'weather', content });
    expect(exec).toHaveBeenCalledWith(buildOpenClawSkillDocumentReadCommand(filePath));
    expect(sdk.skillsSkillCard).not.toHaveBeenCalled();
  });

  it('shell-quotes status paths without evaluating substitutions or quotes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openclaw-quote-'));
    const filePath = join(root, "skill-'$(printf injected).md");
    await writeFile(filePath, '# Safely quoted');

    try {
      const command = buildOpenClawSkillDocumentReadCommand(filePath);
      expect(command).toContain("node -e '");
      expect(await localExec(command)).toMatchObject({ exitCode: 0, stdout: '# Safely quoted' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('classifies only managed custom skills as writable', async () => {
    const sdk = client({
      skillsStatus: vi.fn(async () => ({
        agentId: 'default',
        workspaceDir: '/home/node/.openclaw/workspace',
        managedSkillsDir: '/home/node/.openclaw/skills',
        skills: [
          statusEntry(),
          statusEntry({ skillKey: 'browser', source: 'plugin', bundled: false, baseDir: '/app/extensions/browser' }),
          statusEntry({ skillKey: 'managed', source: 'managed', bundled: false, baseDir: '/home/node/.openclaw/skills/managed' }),
          statusEntry({ skillKey: 'registry', source: 'clawhub', bundled: false, baseDir: '/home/node/.openclaw/workspace/skills/registry' }),
          statusEntry({ skillKey: 'outside', source: 'custom', bundled: false, baseDir: '/tmp/outside' }),
        ],
      })),
    });
    const provider = new OpenClawSkillsProvider(sdk, { exec: localExec });

    await expect(provider.list()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'weather', resourceAccess: 'read-only' }),
      expect.objectContaining({ id: 'browser', resourceAccess: 'read-only' }),
      expect.objectContaining({ id: 'managed', resourceAccess: 'read-write' }),
      expect.objectContaining({ id: 'registry', resourceAccess: 'read-only' }),
      expect.objectContaining({ id: 'outside', resourceAccess: 'read-only' }),
    ]));
    expect(provider.capabilities.resources).toBe(true);
    expect(provider.capabilities.createSkill).toBe(true);
  });

  it('atomically creates a managed skill with its empty directories', async () => {
    const managedRoot = await mkdtemp(join(tmpdir(), 'openclaw-create-'));
    const sdk = client({
      skillsStatus: vi.fn(async () => ({
        agentId: 'default',
        workspaceDir: join(managedRoot, 'workspace'),
        managedSkillsDir: managedRoot,
        skills: [],
      })),
    });
    const provider = new OpenClawSkillsProvider(sdk, { exec: localExec });
    const content = '---\nname: release-helper\ndescription: Prepare releases.\n---\n# Release Helper\n';

    try {
      await expect(provider.createSkill({
        id: 'release-helper',
        content,
        directories: ['scripts', 'references/api'],
      })).resolves.toEqual({ skillId: 'release-helper' });
      await expect(readFile(join(managedRoot, 'release-helper/SKILL.md'), 'utf8')).resolves.toBe(content);
      await expect(stat(join(managedRoot, 'release-helper/scripts'))).resolves.toMatchObject({});
      await expect(stat(join(managedRoot, 'release-helper/references/api'))).resolves.toMatchObject({});
      expect((await readdir(managedRoot)).filter((name) => name.startsWith('.hypercli-create-'))).toEqual([]);
    } finally {
      await rm(managedRoot, { recursive: true, force: true });
    }
  });

  it('finds loose workspace skill files without absorbing existing child skills', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openclaw-recovery-scan-'));
    const workspaceDir = join(root, 'workspace');
    const skillsRoot = join(workspaceDir, 'skills');
    const managedSkillsDir = join(root, 'managed');
    await mkdir(join(skillsRoot, 'scripts'), { recursive: true });
    await mkdir(join(skillsRoot, 'existing-skill'), { recursive: true });
    await writeFile(join(skillsRoot, 'SKILL.md'), '---\nname: chat-helper\ndescription: Created through chat.\n---\n# Chat Helper\n');
    await writeFile(join(skillsRoot, 'notes.txt'), 'notes');
    await writeFile(join(skillsRoot, 'existing-skill/SKILL.md'), '# Existing');
    const provider = new OpenClawSkillsProvider(client({
      skillsStatus: vi.fn(async () => ({ agentId: 'default', workspaceDir, managedSkillsDir, skills: [] })),
    }), { exec: localExec });

    try {
      await expect(provider.listRecoveryCandidates()).resolves.toEqual([
        expect.objectContaining({
          id: 'workspace-skills-root',
          name: 'chat-helper',
          description: 'Created through chat.',
          suggestedSkillId: 'chat-helper',
          entries: expect.arrayContaining([
            expect.objectContaining({ path: 'scripts', type: 'directory', selectable: true, selectedByDefault: true }),
            expect.objectContaining({ path: 'notes.txt', type: 'file', selectable: true, selectedByDefault: false }),
            expect.objectContaining({ path: 'existing-skill', selectable: false, reason: 'This folder is already a separate skill.' }),
          ]),
        }),
      ]);
      expect(provider.capabilities.recoverSkill).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('keeps a provider-reported loose root skill out of the normal editable catalog', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openclaw-recovery-catalog-'));
    const workspaceDir = join(root, 'workspace');
    const skillsRoot = join(workspaceDir, 'skills');
    const managedSkillsDir = join(root, 'managed');
    await mkdir(skillsRoot, { recursive: true });
    await writeFile(join(skillsRoot, 'SKILL.md'), '---\nname: chat-helper\n---\n# Chat Helper\n');
    const looseEntry = statusEntry({
      skillKey: 'chat-helper',
      name: 'Chat Helper',
      source: 'workspace',
      bundled: false,
      baseDir: skillsRoot,
      filePath: join(skillsRoot, 'SKILL.md'),
    });
    const provider = new OpenClawSkillsProvider(client({
      skillsStatus: vi.fn(async () => ({ agentId: 'default', workspaceDir, managedSkillsDir, skills: [looseEntry, statusEntry()] })),
    }), { exec: localExec });

    try {
      await expect(provider.list()).resolves.toEqual([expect.objectContaining({ id: 'weather' })]);
      expect(normalizeOpenClawSkill(looseEntry, { resources: true, workspaceDir, managedSkillsDir })).toMatchObject({ resourceAccess: 'none' });
      await expect(provider.listRecoveryCandidates()).resolves.toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('recovers selected loose workspace resources and leaves unrelated entries in place', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openclaw-recovery-'));
    const workspaceDir = join(root, 'workspace');
    const skillsRoot = join(workspaceDir, 'skills');
    const managedSkillsDir = join(root, 'managed');
    await mkdir(join(skillsRoot, 'scripts'), { recursive: true });
    await mkdir(join(skillsRoot, 'assets/empty'), { recursive: true });
    await mkdir(join(skillsRoot, 'existing-skill'), { recursive: true });
    const content = '---\nname: chat-helper\ndescription: Created through chat.\n---\n# Chat Helper\n';
    await writeFile(join(skillsRoot, 'SKILL.md'), content);
    await writeFile(join(skillsRoot, 'scripts/run.sh'), '#!/bin/sh\n');
    await writeFile(join(skillsRoot, 'assets/icon.bin'), Buffer.from([0, 1, 2, 255]));
    await writeFile(join(skillsRoot, 'notes.txt'), 'leave me');
    await writeFile(join(skillsRoot, 'existing-skill/SKILL.md'), '# Existing');
    const provider = new OpenClawSkillsProvider(client({
      skillsStatus: vi.fn(async () => ({ agentId: 'default', workspaceDir, managedSkillsDir, skills: [] })),
    }), { exec: localExec });

    try {
      await expect(provider.recoverSkill({
        candidateId: 'workspace-skills-root',
        skillId: 'chat-helper',
        paths: ['scripts', 'assets'],
      })).resolves.toEqual({ skillId: 'chat-helper' });
      await expect(readFile(join(managedSkillsDir, 'chat-helper/SKILL.md'), 'utf8')).resolves.toBe(content);
      await expect(readFile(join(managedSkillsDir, 'chat-helper/scripts/run.sh'), 'utf8')).resolves.toBe('#!/bin/sh\n');
      await expect(readFile(join(managedSkillsDir, 'chat-helper/assets/icon.bin'))).resolves.toEqual(Buffer.from([0, 1, 2, 255]));
      await expect(stat(join(managedSkillsDir, 'chat-helper/assets/empty'))).resolves.toMatchObject({});
      await expect(readFile(join(skillsRoot, 'notes.txt'), 'utf8')).resolves.toBe('leave me');
      await expect(readFile(join(skillsRoot, 'existing-skill/SKILL.md'), 'utf8')).resolves.toBe('# Existing');
      await expect(stat(join(skillsRoot, 'SKILL.md'))).rejects.toThrow();
      expect((await readdir(managedSkillsDir)).filter((name) => name.startsWith('.hypercli-recover-'))).toEqual([]);
      expect((await readdir(skillsRoot)).filter((name) => name.startsWith('.hypercli-recover-'))).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not overwrite collisions or recover unsafe sibling folders', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openclaw-recovery-safety-'));
    const workspaceDir = join(root, 'workspace');
    const skillsRoot = join(workspaceDir, 'skills');
    const managedSkillsDir = join(root, 'managed');
    await mkdir(join(skillsRoot, 'nested'), { recursive: true });
    await mkdir(join(managedSkillsDir, 'chat-helper'), { recursive: true });
    await writeFile(join(skillsRoot, 'SKILL.md'), '# Loose');
    await writeFile(join(skillsRoot, 'nested/SKILL.md'), '# Separate');
    await writeFile(join(managedSkillsDir, 'chat-helper/SKILL.md'), '# Managed');
    const provider = new OpenClawSkillsProvider(client({
      skillsStatus: vi.fn(async () => ({ agentId: 'default', workspaceDir, managedSkillsDir, skills: [] })),
    }), { exec: localExec });

    try {
      await expect(provider.recoverSkill({ candidateId: 'workspace-skills-root', skillId: 'chat-helper', paths: [] })).rejects.toThrow(/already exists/i);
      await expect(readFile(join(skillsRoot, 'SKILL.md'), 'utf8')).resolves.toBe('# Loose');
      await expect(readFile(join(managedSkillsDir, 'chat-helper/SKILL.md'), 'utf8')).resolves.toBe('# Managed');
      await rm(join(managedSkillsDir, 'chat-helper'), { recursive: true });
      await expect(provider.recoverSkill({ candidateId: 'workspace-skills-root', skillId: 'chat-helper', paths: ['nested'] })).rejects.toThrow(/contains another skill/i);
      await expect(readFile(join(skillsRoot, 'nested/SKILL.md'), 'utf8')).resolves.toBe('# Separate');
      await expect(stat(join(managedSkillsDir, 'chat-helper'))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('restores quarantined workspace files when managed staging fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openclaw-recovery-rollback-'));
    const workspaceDir = join(root, 'workspace');
    const skillsRoot = join(workspaceDir, 'skills');
    const managedSkillsDir = join(root, 'managed');
    await mkdir(join(skillsRoot, 'scripts'), { recursive: true });
    await mkdir(managedSkillsDir);
    await writeFile(join(skillsRoot, 'SKILL.md'), '# Loose');
    await writeFile(join(skillsRoot, 'scripts/run.sh'), '#!/bin/sh\n');
    await chmod(managedSkillsDir, 0o500);
    const provider = new OpenClawSkillsProvider(client({
      skillsStatus: vi.fn(async () => ({ agentId: 'default', workspaceDir, managedSkillsDir, skills: [] })),
    }), { exec: localExec });

    try {
      await expect(provider.recoverSkill({ candidateId: 'workspace-skills-root', skillId: 'chat-helper', paths: ['scripts'] })).rejects.toThrow();
      await expect(readFile(join(skillsRoot, 'SKILL.md'), 'utf8')).resolves.toBe('# Loose');
      await expect(readFile(join(skillsRoot, 'scripts/run.sh'), 'utf8')).resolves.toBe('#!/bin/sh\n');
      expect((await readdir(skillsRoot)).filter((name) => name.startsWith('.hypercli-recover-'))).toEqual([]);
    } finally {
      await chmod(managedSkillsDir, 0o700);
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects catalog and filesystem collisions without overwriting them', async () => {
    const managedRoot = await mkdtemp(join(tmpdir(), 'openclaw-create-collision-'));
    await mkdir(join(managedRoot, 'hidden-skill'));
    await writeFile(join(managedRoot, 'hidden-skill/SKILL.md'), '# Existing');
    const statusCollisionExec = vi.fn(localExec);
    const statusCollision = new OpenClawSkillsProvider(client({
      skillsStatus: vi.fn(async () => ({
        agentId: 'default', workspaceDir: '/workspace', managedSkillsDir: managedRoot, skills: [statusEntry()],
      })),
    }), { exec: statusCollisionExec });
    const filesystemCollision = new OpenClawSkillsProvider(client({
      skillsStatus: vi.fn(async () => ({
        agentId: 'default', workspaceDir: '/workspace', managedSkillsDir: managedRoot, skills: [],
      })),
    }), { exec: localExec });

    try {
      await expect(statusCollision.createSkill({ id: 'weather', content: '# New' })).rejects.toThrow(/already exists/i);
      expect(statusCollisionExec).not.toHaveBeenCalled();
      await expect(filesystemCollision.createSkill({ id: 'hidden-skill', content: '# New' })).rejects.toThrow(/already exists/i);
      await expect(readFile(join(managedRoot, 'hidden-skill/SKILL.md'), 'utf8')).resolves.toBe('# Existing');
    } finally {
      await rm(managedRoot, { recursive: true, force: true });
    }
  });

  it('validates authored skill paths before executing and cleans failed staging', async () => {
    const managedRoot = await mkdtemp(join(tmpdir(), 'openclaw-create-cleanup-'));
    const exec = vi.fn(async (command: string) => exec.mock.calls.length === 2
      ? { exitCode: 1, stdout: '', stderr: 'simulated append failure' }
      : localExec(command));
    const provider = new OpenClawSkillsProvider(client({
      skillsStatus: vi.fn(async () => ({
        agentId: 'default', workspaceDir: '/workspace', managedSkillsDir: managedRoot, skills: [],
      })),
    }), { exec });

    try {
      await expect(provider.createSkill({ id: '../escape', content: '# Invalid' })).rejects.toThrow(/lowercase slugs/i);
      await expect(provider.createSkill({ id: 'valid-skill', content: '# Invalid', directories: ['../escape'] })).rejects.toThrow(/traversal/i);
      expect(exec).not.toHaveBeenCalled();
      await expect(provider.createSkill({ id: 'valid-skill', content: '# Valid' })).rejects.toThrow('simulated append failure');
      expect((await readdir(managedRoot)).filter((name) => name.startsWith('.hypercli-create-'))).toEqual([]);
      await expect(stat(join(managedRoot, 'valid-skill'))).rejects.toThrow();
    } finally {
      await rm(managedRoot, { recursive: true, force: true });
    }
  });

  it('lists, reads, writes, creates, and deletes managed skill resources', async () => {
    const managedRoot = await mkdtemp(join(tmpdir(), 'openclaw-managed-'));
    const skillRoot = join(managedRoot, 'weather');
    await mkdir(skillRoot);
    await writeFile(join(skillRoot, 'SKILL.md'), '# Weather');
    const sdk = client({
      skillsStatus: vi.fn(async () => ({
        agentId: 'default',
        workspaceDir: join(managedRoot, 'workspace'),
        managedSkillsDir: managedRoot,
        skills: [statusEntry({ source: 'managed', bundled: false, baseDir: skillRoot, filePath: join(skillRoot, 'SKILL.md') })],
      })),
    });
    const provider = new OpenClawSkillsProvider(sdk, { exec: localExec });

    try {
      await provider.list();
      await expect(provider.listResources('weather')).resolves.toEqual([
        expect.objectContaining({ name: 'SKILL.md', path: 'SKILL.md', type: 'file', size: 9 }),
      ]);
      await expect(provider.readResource('weather', 'SKILL.md')).resolves.toEqual(Uint8Array.from(Buffer.from('# Weather')));
      await provider.createResourceDirectory('weather', 'references');
      const binaryContent = Uint8Array.from({ length: 100_000 }, (_, index) => index % 256);
      await provider.writeResource('weather', 'references/api.bin', binaryContent);
      await expect(readFile(join(skillRoot, 'references/api.bin'))).resolves.toEqual(Buffer.from(binaryContent));
      await provider.deleteResource('weather', 'references', { recursive: true });
      await expect(readFile(join(skillRoot, 'references/api.bin'))).rejects.toThrow();
    } finally {
      await rm(managedRoot, { recursive: true, force: true });
    }
  });

  it('rejects traversal and read-only writes before resource execution', async () => {
    const exec = vi.fn(localExec);
    const provider = new OpenClawSkillsProvider(client(), { exec });
    await provider.list();

    await expect(provider.readResource('weather', '../secret')).rejects.toThrow(/traversal/i);
    await expect(provider.writeResource('weather', 'SKILL.md', new Uint8Array())).rejects.toThrow(/read-only/i);
    expect(exec).not.toHaveBeenCalled();
  });

  it('omits and rejects symlinks that escape the skill root', async () => {
    const managedRoot = await mkdtemp(join(tmpdir(), 'openclaw-symlink-'));
    const skillRoot = join(managedRoot, 'weather');
    const outsideFile = join(managedRoot, 'outside.txt');
    await mkdir(skillRoot);
    await writeFile(outsideFile, 'secret');
    await symlink(outsideFile, join(skillRoot, 'escape.txt'));
    const provider = new OpenClawSkillsProvider(client({
      skillsStatus: vi.fn(async () => ({
        agentId: 'default',
        workspaceDir: join(managedRoot, 'workspace'),
        managedSkillsDir: managedRoot,
        skills: [statusEntry({ source: 'managed', bundled: false, baseDir: skillRoot })],
      })),
    }), { exec: localExec });

    try {
      await provider.list();
      await expect(provider.listResources('weather')).resolves.toEqual([]);
      await expect(provider.readResource('weather', 'escape.txt')).rejects.toThrow(/symlink escapes/i);
    } finally {
      await rm(managedRoot, { recursive: true, force: true });
    }
  });

  it('rejects writes when a managed skill root symlinks outside its writable root', async () => {
    const managedRoot = await mkdtemp(join(tmpdir(), 'openclaw-root-link-'));
    const outsideRoot = await mkdtemp(join(tmpdir(), 'openclaw-outside-'));
    const linkedRoot = join(managedRoot, 'linked');
    await writeFile(join(outsideRoot, 'SKILL.md'), '# Outside');
    await symlink(outsideRoot, linkedRoot);
    const provider = new OpenClawSkillsProvider(client({
      skillsStatus: vi.fn(async () => ({
        agentId: 'default',
        workspaceDir: join(managedRoot, 'workspace'),
        managedSkillsDir: managedRoot,
        skills: [statusEntry({ source: 'managed', bundled: false, baseDir: linkedRoot })],
      })),
    }), { exec: localExec });

    try {
      await expect(provider.list()).resolves.toEqual([expect.objectContaining({ resourceAccess: 'read-write' })]);
      await expect(provider.writeResource('weather', 'SKILL.md', Uint8Array.from(Buffer.from('# Changed')))).rejects.toThrow(/escapes the managed/i);
      await expect(readFile(join(outsideRoot, 'SKILL.md'), 'utf8')).resolves.toBe('# Outside');
    } finally {
      await rm(managedRoot, { recursive: true, force: true });
      await rm(outsideRoot, { recursive: true, force: true });
    }
  });
});
