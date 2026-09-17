import { describe, expect, it, vi } from 'vitest';

import {
  OpenClawSkillProposalsProvider,
  OpenClawSkillsProvider,
  normalizeOpenClawSkill,
  type OpenClawSkillsClient,
  type OpenClawSkillsFiles,
  type OpenClawSkillProposalsClient,
} from '../src/openclaw/skills.js';
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
    skillsStatus: vi.fn(async () => ({
      agentId: 'default',
      workspaceDir: '/home/node/.openclaw/workspace',
      managedSkillsDir: '/home/node/.openclaw/skills',
      skills: [statusEntry({ skillCard: { present: true, path: '/provider/card.md', sizeBytes: 12 } })],
    })),
    skillsSkillCard: vi.fn(async ({ skillKey }) => ({
      schema: 'openclaw.skills.skill-card.v1',
      skillKey,
      path: '/provider/SKILL.md',
      sizeBytes: 12,
      content: '# Weather',
    })),
    skillsUpdate: vi.fn(async ({ skillKey }) => ({ ok: true, skillKey, config: {} })),
    skillsSearch: vi.fn(async () => ({ results: [] })),
    skillsInstall: vi.fn(async (request) => ({ ok: true, slug: 'slug' in request ? request.slug : undefined })),
    ...overrides,
  };
}

function agentFiles(overrides: Partial<OpenClawSkillsFiles> = {}): OpenClawSkillsFiles {
  return {
    list: vi.fn(async () => []),
    readBytes: vi.fn(async () => new Uint8Array()),
    writeBytes: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
    ...overrides,
  };
}

function workspaceSkill(overrides: Partial<GatewaySkillStatusEntry> = {}): GatewaySkillStatusEntry {
  return statusEntry({
    source: 'workspace',
    bundled: false,
    baseDir: '/home/node/.openclaw/workspace/skills/weather',
    filePath: '/home/node/.openclaw/workspace/skills/weather/SKILL.md',
    ...overrides,
  });
}

describe('OpenClawSkillsProvider', () => {
  it('normalizes provider-specific status and card availability', () => {
    expect(normalizeOpenClawSkill(statusEntry({ skillCard: { present: true, path: '/provider/card.md', sizeBytes: 12 } }))).toMatchObject({
      id: 'weather',
      origin: 'built-in',
      availability: 'active',
      enabled: true,
      ready: true,
      documentAvailable: false,
      resourceAccess: 'none',
      requirements: { env: ['WEATHER_API_KEY'], bins: ['curl'], os: [] },
      skillCard: { path: '/provider/card.md', sizeBytes: 12 },
    });
    expect(normalizeOpenClawSkill(statusEntry({ eligible: false }), 'none', true)).toMatchObject({
      availability: 'needs-setup',
      documentAvailable: true,
      ready: false,
    });
    expect(normalizeOpenClawSkill(statusEntry({ source: 'plugin', bundled: false }))).toMatchObject({ origin: 'extension' });
  });

  it('exposes AgentFiles resources and creation without recovery or directory creation', () => {
    const provider = new OpenClawSkillsProvider(client(), agentFiles());
    const gatewayOnlyProvider = new OpenClawSkillsProvider(client());

    expect(provider.capabilities).toEqual({
      readDocument: true,
      configure: true,
      searchRegistry: true,
      installRegistry: true,
      installUpload: false,
      resources: true,
      createSkill: true,
      recoverSkill: false,
    });
    expect(provider).not.toHaveProperty('listRecoveryCandidates');
    expect(provider).not.toHaveProperty('recoverSkill');
    expect(provider).not.toHaveProperty('createResourceDirectory');
    expect(gatewayOnlyProvider.capabilities).toMatchObject({
      resources: false,
      createSkill: false,
      recoverSkill: false,
    });
  });

  it('rejects files operations immediately when AgentFiles is absent', async () => {
    const sdk = client();
    const provider = new OpenClawSkillsProvider(sdk);

    await expect(provider.createSkill({ id: 'new-skill', content: '# New' })).rejects.toThrow(/Agent files are unavailable/i);
    await expect(provider.listResources('weather')).rejects.toThrow(/Agent files are unavailable/i);
    await expect(provider.readResource('weather', 'SKILL.md')).rejects.toThrow(/Agent files are unavailable/i);
    await expect(provider.writeResource('weather', 'SKILL.md', new Uint8Array())).rejects.toThrow(/Agent files are unavailable/i);
    await expect(provider.deleteResource('weather', 'SKILL.md')).rejects.toThrow(/Agent files are unavailable/i);
    expect(sdk.skillsStatus).not.toHaveBeenCalled();
  });

  it('keeps catalog, document, update, search, and install operations on Gateway', async () => {
    const sdk = client({
      supportsMethod: vi.fn((method) => method === 'skills.read'),
      skillsRead: vi.fn(async ({ skillKey }) => ({
        schema: 'openclaw.skills.read.v1',
        skillKey,
        path: '/provider/weather/SKILL.md',
        source: 'openclaw-bundled',
        sizeBytes: 13,
        content: '# Weather\n',
      })),
      skillsSearch: vi.fn(async () => ({
        results: [{ score: 1, slug: 'release-helper', displayName: 'Release Helper', summary: 'Prepare releases.' }],
      })),
    });
    const files = agentFiles();
    const provider = new OpenClawSkillsProvider(sdk, files);

    await expect(provider.list()).resolves.toEqual([expect.objectContaining({ id: 'weather', documentAvailable: true, resourceAccess: 'none' })]);
    await expect(provider.readDocument('weather')).resolves.toEqual({
      skillId: 'weather', content: '# Weather\n', sizeBytes: 13, path: '/provider/weather/SKILL.md',
    });
    await provider.update('weather', { enabled: false });
    await expect(provider.search('release')).resolves.toEqual([expect.objectContaining({ id: 'release-helper' })]);
    await expect(provider.install({ source: 'registry', id: 'release-helper' })).resolves.toMatchObject({ ok: true, skillId: 'release-helper' });

    expect(sdk.skillsUpdate).toHaveBeenCalledWith({ skillKey: 'weather', enabled: false });
    expect(sdk.skillsRead).toHaveBeenCalledWith({ agentId: 'default', skillKey: 'weather' });
    expect(sdk.skillsSkillCard).not.toHaveBeenCalled();
    expect(sdk.skillsInstall).toHaveBeenCalledWith({ source: 'clawhub', slug: 'release-helper', version: undefined, force: undefined });
    expect(files.list).not.toHaveBeenCalled();
  });

  it('keeps Gateway skill identifiers opaque outside local AgentFiles operations', async () => {
    const sdk = client({
      skillsStatus: vi.fn(async () => ({
        agentId: 'default',
        workspaceDir: '/home/node/.openclaw/workspace',
        managedSkillsDir: '/managed',
        skills: [
          workspaceSkill({
            skillKey: 'Plugin:Weather',
            baseDir: '/home/node/.openclaw/workspace/skills/Plugin:Weather',
            filePath: '/home/node/.openclaw/workspace/skills/Plugin:Weather/SKILL.md',
          }),
          statusEntry({ skillKey: 'Vendor/Release.Helper', skillCard: { present: true } }),
        ],
      })),
      skillsSearch: vi.fn(async () => ({
        results: [{ score: 1, slug: 'Vendor/Release.Helper', displayName: 'Release Helper' }],
      })),
    });
    const files = agentFiles({ readBytes: vi.fn(async () => new Uint8Array([4])) });
    const provider = new OpenClawSkillsProvider(sdk, files);

    await expect(provider.list()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'Plugin:Weather', resourceAccess: 'read-write' }),
      expect.objectContaining({ id: 'Vendor/Release.Helper', resourceAccess: 'none' }),
    ]));
    await expect(provider.readDocument('Plugin:Weather')).resolves.toMatchObject({ skillId: 'Plugin:Weather' });
    await expect(provider.readResource('Plugin:Weather', 'SKILL.md')).resolves.toEqual(new Uint8Array([4]));
    expect(files.readBytes).toHaveBeenCalledWith(
      '.openclaw/workspace/skills/Plugin:Weather/SKILL.md',
      { maxBytes: 256_000 },
    );
    expect(files.readBytes).toHaveBeenCalledWith('.openclaw/workspace/skills/Plugin:Weather/SKILL.md');
    await expect(provider.readResource('Vendor/Release.Helper', 'SKILL.md')).rejects.toThrow(/unavailable/i);
    expect(files.readBytes).toHaveBeenCalledTimes(2);
    await provider.update('Plugin:Weather', { enabled: true });
    await expect(provider.search('release')).resolves.toEqual([expect.objectContaining({ id: 'Vendor/Release.Helper' })]);
    await provider.install({ source: 'registry', id: 'Vendor/Release.Helper' });

    expect(sdk.skillsSkillCard).not.toHaveBeenCalled();
    expect(sdk.skillsUpdate).toHaveBeenCalledWith({ skillKey: 'Plugin:Weather', enabled: true });
    expect(sdk.skillsInstall).toHaveBeenCalledWith({
      source: 'clawhub', slug: 'Vendor/Release.Helper', version: undefined, force: undefined,
    });
  });

  it('creates SKILL.md with one exact bounded AgentFiles write after the Gateway collision check', async () => {
    const sdk = client({
      skillsStatus: vi.fn(async () => ({
        agentId: 'default', workspaceDir: '/home/node/.openclaw/workspace', managedSkillsDir: '/managed', skills: [],
      })),
    });
    const files = agentFiles();
    const provider = new OpenClawSkillsProvider(sdk, files);
    const content = '---\nname: release-helper\n---\n# Release Helper\n';

    await expect(provider.createSkill({ id: 'release-helper', content })).resolves.toEqual({ skillId: 'release-helper' });
    expect(sdk.skillsStatus).toHaveBeenCalledTimes(1);
    expect(files.writeBytes).toHaveBeenCalledTimes(1);
    expect(files.writeBytes).toHaveBeenCalledWith(
      '.openclaw/workspace/skills/release-helper/SKILL.md',
      new TextEncoder().encode(content),
    );
  });

  it('rejects invalid creation, requested directories, and Gateway collisions before writing', async () => {
    const files = agentFiles();
    const provider = new OpenClawSkillsProvider(client(), files);

    await expect(provider.createSkill({ id: '../escape', content: '# Bad' })).rejects.toThrow(/lowercase slugs/i);
    await expect(provider.createSkill({ id: 'new-skill', content: '# New', directories: ['scripts'] })).rejects.toThrow(/directories cannot be created/i);
    await expect(provider.createSkill({ id: 'weather', content: '# Duplicate' })).rejects.toThrow(/already exists/i);
    expect(files.writeBytes).not.toHaveBeenCalled();
  });

  it('maps workspace resource prefixes and performs exact AgentFiles CRUD', async () => {
    const sdk = client({
      skillsStatus: vi.fn(async () => ({
        agentId: 'default',
        workspaceDir: '/home/node/.openclaw/workspace',
        managedSkillsDir: '/managed',
        skills: [workspaceSkill()],
      })),
    });
    const bytes = new Uint8Array([1, 2, 3]);
    const files = agentFiles({
      list: vi.fn(async () => [{
        name: 'api.md',
        path: '.openclaw/workspace/skills/weather/references/api.md',
        type: 'file',
        size: 3,
        last_modified: '2026-08-16T00:00:00Z',
      }, {
        name: 'examples',
        path: '.openclaw/workspace/skills/weather/references/examples/',
        type: 'directory',
      }]),
      readBytes: vi.fn(async () => bytes),
    });
    const provider = new OpenClawSkillsProvider(sdk, files);

    await expect(provider.list()).resolves.toEqual([expect.objectContaining({ id: 'weather', resourceAccess: 'read-write' })]);
    await expect(provider.listResources('weather', 'references')).resolves.toEqual([
      {
        name: 'api.md',
        path: 'references/api.md',
        type: 'file',
        size: 3,
        lastModified: '2026-08-16T00:00:00Z',
      },
      {
        name: 'examples',
        path: 'references/examples',
        type: 'directory',
        size: undefined,
        lastModified: undefined,
      },
    ]);
    await expect(provider.readResource('weather', 'references/api.md')).resolves.toBe(bytes);
    await expect(provider.readResource('weather', 'references/ value .md')).resolves.toBe(bytes);
    await provider.writeResource('weather', 'references/api.md', bytes);
    await provider.deleteResource('weather', 'references/api.md');

    expect(files.list).toHaveBeenCalledWith('.openclaw/workspace/skills/weather/references');
    expect(files.readBytes).toHaveBeenCalledWith('.openclaw/workspace/skills/weather/references/api.md');
    expect(files.readBytes).toHaveBeenCalledWith('.openclaw/workspace/skills/weather/references/ value .md');
    expect(files.writeBytes).toHaveBeenCalledWith('.openclaw/workspace/skills/weather/references/api.md', bytes);
    expect(files.delete).toHaveBeenCalledWith('.openclaw/workspace/skills/weather/references/api.md', undefined);
  });

  it.each(['../secret', '/absolute', 'references//api.md', './SKILL.md', 'SKILL.md/', 'dir\\file', 'SKILL.md\0secret']) (
    'rejects an unconfined resource path before AgentFiles access: %s',
    async (path) => {
      const sdk = client({
        skillsStatus: vi.fn(async () => ({
          agentId: 'default',
          workspaceDir: '/home/node/.openclaw/workspace',
          managedSkillsDir: '/managed',
          skills: [workspaceSkill()],
        })),
      });
      const files = agentFiles();
      const provider = new OpenClawSkillsProvider(sdk, files);
      await provider.list();

      await expect(provider.readResource('weather', path)).rejects.toThrow(/relative|traversal|exact/i);
      expect(files.readBytes).not.toHaveBeenCalled();
    },
  );

  it('denies files for a safe segment that is not in the current Gateway list', async () => {
    const sdk = client();
    const files = agentFiles();
    const provider = new OpenClawSkillsProvider(sdk, files);

    await expect(provider.readResource('unknown-skill', 'SKILL.md')).rejects.toThrow(/unavailable/i);
    expect(sdk.skillsStatus).toHaveBeenCalledTimes(1);
    expect(files.readBytes).not.toHaveBeenCalled();
  });

  it('rejects file-list entries outside the requested skill directory', async () => {
    const sdk = client({
      skillsStatus: vi.fn(async () => ({
        agentId: 'default',
        workspaceDir: '/home/node/.openclaw/workspace',
        managedSkillsDir: '/managed',
        skills: [workspaceSkill()],
      })),
    });
    const provider = new OpenClawSkillsProvider(sdk, agentFiles({
      list: vi.fn(async () => [{ name: 'secret', path: 'secret', type: 'file' }]),
    }));

    await expect(provider.listResources('weather')).rejects.toThrow(/outside/i);
  });

  it('lists every opaque Gateway ID and gates files only by safe segment structure', async () => {
    const sdk = client({
      skillsStatus: vi.fn(async () => ({
        agentId: 'default',
        workspaceDir: '/home/node/.openclaw/workspace',
        managedSkillsDir: '/managed',
        skills: [
          statusEntry({ skillKey: '../bad' }),
          statusEntry({
            skillKey: 'vendor.skill_v2',
            source: 'workspace',
            bundled: false,
            baseDir: '/home/node/.openclaw/workspace/skills/vendor.skill_v2',
            filePath: '/home/node/.openclaw/workspace/skills/vendor.skill_v2/SKILL.md',
          }),
        ],
      })),
    });

    const files = agentFiles({ readBytes: vi.fn(async () => new Uint8Array([7])) });
    const provider = new OpenClawSkillsProvider(sdk, files);
    await expect(provider.list()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: '../bad', resourceAccess: 'none' }),
      expect.objectContaining({ id: 'vendor.skill_v2', resourceAccess: 'read-write' }),
    ]));
    await expect(provider.readResource('vendor.skill_v2', 'SKILL.md')).resolves.toEqual(new Uint8Array([7]));
    expect(files.readBytes).toHaveBeenCalledWith('.openclaw/workspace/skills/vendor.skill_v2/SKILL.md');
    await expect(provider.readResource('../bad', 'SKILL.md')).rejects.toThrow(/unavailable/i);
    expect(files.readBytes).toHaveBeenCalledTimes(1);
  });

  it('keeps managed skill resources read-only', async () => {
    const sdk = client({
      skillsStatus: vi.fn(async () => ({
        agentId: 'default',
        workspaceDir: '/home/node/.openclaw/workspace',
        managedSkillsDir: '/home/node/managed',
        skills: [workspaceSkill({
          source: 'managed',
          baseDir: '/home/node/managed/weather',
          filePath: '/home/node/managed/weather/SKILL.md',
        })],
      })),
    });
    const files = agentFiles();
    const provider = new OpenClawSkillsProvider(sdk, files, { syncRoot: '/home/node' });

    await expect(provider.list()).resolves.toEqual([
      expect.objectContaining({ id: 'weather', resourceAccess: 'read-only' }),
    ]);
    await expect(provider.writeResource('weather', 'SKILL.md', new Uint8Array([1]))).rejects.toThrow(/read-only/i);
    expect(files.writeBytes).not.toHaveBeenCalled();
  });

  it('rejects duplicate Gateway skill keys before exposing ambiguous resources', async () => {
    const sdk = client({
      skillsStatus: vi.fn(async () => ({
        agentId: 'default',
        workspaceDir: '/home/node/.openclaw/workspace',
        managedSkillsDir: '/managed',
        skills: [statusEntry(), statusEntry({ filePath: '/other/weather/SKILL.md' })],
      })),
    });

    await expect(new OpenClawSkillsProvider(sdk, agentFiles()).list()).rejects.toThrow(/duplicate.*weather/i);
  });

  it('bounds fallback SKILL.md reads and writes and rejects invalid UTF-8', async () => {
    const sdk = client({
      skillsStatus: vi.fn(async () => ({
        agentId: 'default',
        workspaceDir: '/home/node/.openclaw/workspace',
        managedSkillsDir: '/managed',
        skills: [workspaceSkill()],
      })),
    });
    const files = agentFiles({
      readBytes: vi.fn(async () => new Uint8Array([0xff])),
    });
    const provider = new OpenClawSkillsProvider(sdk, files);

    await expect(provider.readDocument('weather')).rejects.toThrow(/UTF-8/i);
    expect(files.readBytes).toHaveBeenCalledWith(
      '.openclaw/workspace/skills/weather/SKILL.md',
      { maxBytes: 256_000 },
    );
    await expect(provider.writeResource('weather', 'SKILL.md', new Uint8Array(256_001))).rejects.toThrow(/256 KB/i);
    expect(files.writeBytes).not.toHaveBeenCalled();
  });
});

describe('OpenClawSkillProposalsProvider', () => {
  function proposalsClient(overrides: Partial<OpenClawSkillProposalsClient> = {}): OpenClawSkillProposalsClient {
    return {
      supportsMethod: vi.fn(() => true),
      hasGrantedScope: vi.fn(() => true),
      skillsProposalsList: vi.fn(async () => ({ proposals: [] })),
      skillsProposalInspect: vi.fn(),
      skillsProposalApply: vi.fn(),
      skillsProposalReject: vi.fn(),
      ...overrides,
    };
  }

  it('allows review but fails closed on mutation without administrator scope', async () => {
    const client = proposalsClient({
      hasGrantedScope: vi.fn((scope) => scope === 'operator.read'),
    });
    const provider = new OpenClawSkillProposalsProvider(client);

    expect(provider.capabilities).toEqual({ list: true, inspect: true, apply: false, reject: false });
    await expect(provider.apply({ proposalId: 'weather' })).rejects.toThrow(/administrator/i);
    expect(client.skillsProposalApply).not.toHaveBeenCalled();
  });

  it('forwards one revision-bound approval to the Gateway', async () => {
    const apply = vi.fn(async () => ({ record: {}, targetSkillFile: 'SKILL.md' } as never));
    const client = proposalsClient({ skillsProposalApply: apply });
    const provider = new OpenClawSkillProposalsProvider(client);

    await provider.apply({
      proposalId: 'weather-20260824-abcdef0123',
      expectedRevision: 'a'.repeat(64),
    });
    expect(apply).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledWith({
      agentId: undefined,
      proposalId: 'weather-20260824-abcdef0123',
      expectedRevisionHash: 'a'.repeat(64),
    });
  });

  it('maps runtime inspection metadata to the generic proposal contract', async () => {
    const inspect = vi.fn(async () => ({
      record: {} as never,
      content: '# Weather\n',
      revisionHash: 'a'.repeat(64),
    }));
    const provider = new OpenClawSkillProposalsProvider(proposalsClient({ skillsProposalInspect: inspect }));

    await expect(provider.inspect('weather')).resolves.toEqual({
      content: '# Weather\n',
      revision: 'a'.repeat(64),
    });
    expect(inspect).toHaveBeenCalledWith({ agentId: undefined, proposalId: 'weather' });
  });

  it('rejects duplicate proposal IDs before selecting the wrong review', async () => {
    const duplicate = {
      id: 'weather',
      kind: 'create' as const,
      status: 'pending' as const,
      title: 'Weather',
      description: 'Weather skill',
      skillName: 'Weather',
      skillKey: 'weather',
      createdAt: '2026-08-24T12:00:00.000Z',
      updatedAt: '2026-08-24T12:00:00.000Z',
      scanState: 'clean' as const,
    };
    const client = proposalsClient({
      skillsProposalsList: vi.fn(async () => ({ proposals: [duplicate, duplicate] })),
    });

    await expect(new OpenClawSkillProposalsProvider(client).list()).rejects.toThrow(/duplicate.*weather/i);
  });

  it('returns only pending proposals for review', async () => {
    const base = {
      id: 'weather',
      kind: 'create' as const,
      title: 'Weather',
      description: 'Weather skill',
      skillName: 'Weather',
      skillKey: 'weather',
      createdAt: '2026-08-24T12:00:00.000Z',
      updatedAt: '2026-08-24T12:00:00.000Z',
      scanState: 'clean' as const,
    };
    const client = proposalsClient({
      skillsProposalsList: vi.fn(async () => ({
        proposals: [
          { ...base, status: 'pending' as const },
          { ...base, id: 'applied-weather', status: 'applied' as const },
        ],
      })),
    });

    await expect(new OpenClawSkillProposalsProvider(client).list()).resolves.toEqual([
      expect.objectContaining({ id: 'weather', status: 'pending' }),
    ]);
  });
});
