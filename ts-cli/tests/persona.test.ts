import { describe, expect, it, vi } from 'vitest';
import persona from '../src/commands/persona.js';
import { parseUniversal } from '../src/core/argv.js';
import { UsageError } from '../src/core/errors.js';
import { createOutput } from '../src/core/output.js';
import type { CommandContext } from '../src/core/types.js';
import { APIError, PersonaError, type PersonaArtifact, type PersonaResolution } from '@hypercli.com/sdk';

const ID = '11111111-1111-4111-8111-111111111111';
const DIGEST = 'a'.repeat(64);
const CATALOG_DIGEST = 'b'.repeat(64);
const REVISION = `persona-catalog-v1-${CATALOG_DIGEST}`;

function artifact(markdown = '# Live assembled INDEX\n'): PersonaArtifact {
  return {
    id: 'chief-of-staff',
    name: 'chief-of-staff',
    description: 'Coordinate work.',
    artifact: '/personas/chief-of-staff/INDEX.md',
    schema: 1,
    sources: {},
    digest: DIGEST,
    revision: REVISION,
    markdown,
  };
}

function resolution(overrides: Partial<PersonaResolution> = {}): PersonaResolution {
  const selected = artifact();
  return {
    agentId: ID,
    userId: 'user-1',
    user: '# Canonical USER\n',
    soul: selected.markdown,
    personaId: selected.id,
    revision: selected.revision,
    digest: selected.digest,
    source: 'persona',
    ...overrides,
  };
}

function clientFixture() {
  const personas = {
    list: vi.fn(async () => ({
      personas: [artifact()],
      catalog: {
        schema: 1,
        revision: REVISION,
        digest: CATALOG_DIGEST,
      },
    })),
    get: vi.fn(async () => artifact()),
    resolve: vi.fn(async () => resolution()),
  };
  return { client: { personas }, personas };
}

async function invoke(args: string[], clientOrError?: unknown) {
  const format = parseUniversal(args).format;
  const captured = { stdout: '', stderr: '' };
  const stdoutWrite = process.stdout.write.bind(process.stdout);
  const stderrWrite = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((chunk: unknown) => {
    captured.stdout += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: unknown) => {
    captured.stderr += String(chunk);
    return true;
  }) as typeof process.stderr.write;
  const ctx: CommandContext = {
    client: async () => {
      if (clientOrError instanceof Error) throw clientOrError;
      if (clientOrError) return clientOrError as never;
      throw new Error('this persona path must not construct a client');
    },
    output: createOutput(format),
    format,
  };
  try {
    await persona.run(ctx, args);
    return captured;
  } finally {
    process.stdout.write = stdoutWrite;
    process.stderr.write = stderrWrite;
  }
}

describe('hyper persona list|ls', () => {
  it('always lists the dynamic Backend catalog', async () => {
    const { client, personas } = clientFixture();
    const result = await invoke(['list', '--json'], client);
    expect(personas.list).toHaveBeenCalledOnce();
    const payload = JSON.parse(result.stdout);
    expect(payload.source).toBe('live');
    expect(payload).not.toHaveProperty('degraded_offline');
    expect(payload.personas.map((entry: { name: string }) => entry.name)).toEqual(['chief-of-staff']);
    expect(payload.catalog.digest).toBe(CATALOG_DIGEST);
    expect(result.stderr).toBe('');
  });

  it('aliases ls and labels human discovery as live', async () => {
    const { client, personas } = clientFixture();
    const result = await invoke(['ls'], client);
    expect(personas.list).toHaveBeenCalledOnce();
    expect(result.stdout).toContain('chief-of-staff');
    expect(result.stdout).toContain('SOURCE');
    expect(result.stdout).toContain('live');
  });

  it('accepts --source live as an explicit dynamic-source selector', async () => {
    const { client, personas } = clientFixture();
    const result = await invoke(['list', '--source', 'live', '--json'], client);
    expect(personas.list).toHaveBeenCalledOnce();
    expect(JSON.parse(result.stdout).source).toBe('live');
  });

  it('surfaces a live list failure without an empty/static fallback', async () => {
    const { client, personas } = clientFixture();
    personas.list.mockRejectedValue(new Error('catalog unavailable'));
    await expect(invoke(['list'], client)).rejects.toThrow(/list personas failed/);
  });

  it('rejects offline/static sources before constructing a client', async () => {
    await expect(invoke(['list', '--source', 'offline'])).rejects.toThrow(UsageError);
    await expect(invoke(['list', '--source', 'bundle'])).rejects.toThrow(UsageError);
  });
});

describe('hyper persona get', () => {
  it('fetches and prints exact dynamic INDEX.md bytes', async () => {
    const { client, personas } = clientFixture();
    const result = await invoke(['get', 'chief-of-staff'], client);
    expect(result.stdout).toBe('# Live assembled INDEX\n');
    expect(personas.get).toHaveBeenCalledExactlyOnceWith('chief-of-staff');
  });

  it('returns live metadata and Markdown in JSON', async () => {
    const { client, personas } = clientFixture();
    const result = await invoke([
      'get', 'chief-of-staff', '--source', 'live', '--json',
    ], client);
    expect(personas.get).toHaveBeenCalledExactlyOnceWith('chief-of-staff');
    expect(JSON.parse(result.stdout)).toMatchObject({
      name: 'chief-of-staff', markdown: '# Live assembled INDEX\n', digest: DIGEST,
      source: 'live',
    });
  });

  it('forwards an exact unknown ID to Backend rather than expanding a prefix', async () => {
    const { client, personas } = clientFixture();
    personas.get.mockRejectedValue(new PersonaError('persona_invalid', 'persona_not_found'));
    await expect(invoke(['get', 'chief'], client)).rejects.toThrow(/persona_not_found/);
    expect(personas.get).toHaveBeenCalledExactlyOnceWith('chief');
  });

  it('rejects an offline get without constructing a client', async () => {
    await expect(invoke(['get', 'chief-of-staff', '--source', 'offline'])).rejects.toThrow(UsageError);
  });
});

describe('hyper persona resolve', () => {
  it('returns selected live INDEX.md and canonical USER with explicit agent semantics', async () => {
    const { client, personas } = clientFixture();
    const result = await invoke(['resolve', '--agent', ID, '--json'], client);
    expect(personas.resolve).toHaveBeenCalledExactlyOnceWith({ agentId: ID });
    expect(JSON.parse(result.stdout)).toMatchObject({
      agent_id: ID,
      user: '# Canonical USER\n',
      soul: '# Live assembled INDEX\n',
      persona: 'chief-of-staff',
      revision: REVISION,
      digest: DIGEST,
      source: 'persona',
    });
  });

  it('returns canonical default SOUL + USER when selection is unset', async () => {
    const { client, personas } = clientFixture();
    personas.resolve.mockResolvedValue(resolution({
      soul: '# Canonical SOUL\n', personaId: null, revision: null, digest: null, source: 'canonical',
    }));
    const result = await invoke(['resolve', '--json'], client);
    expect(personas.resolve).toHaveBeenCalledExactlyOnceWith({ agentId: undefined });
    expect(JSON.parse(result.stdout)).toMatchObject({
      user: '# Canonical USER\n', soul: '# Canonical SOUL\n',
      persona: null, revision: null, digest: null, source: 'canonical',
    });
  });

  it('renders both documents in human mode without replacing either', async () => {
    const { client } = clientFixture();
    const result = await invoke(['resolve'], client);
    expect(result.stdout).toContain('--- USER ---\n# Canonical USER\n');
    expect(result.stdout).toContain('--- SOUL: persona chief-of-staff');
    expect(result.stdout).toContain('# Live assembled INDEX\n');
  });

  it('surfaces invalid selections without a default-SOUL/static fallback', async () => {
    const { client, personas } = clientFixture();
    personas.resolve.mockRejectedValue(new PersonaError('persona_invalid_id', 'blank persona selector'));
    await expect(invoke(['resolve'], client)).rejects.toMatchObject({
      name: 'CliError', message: 'persona_invalid_id: blank persona selector',
    });
  });

  it('maps an unbound credential to the explicit --agent usage error', async () => {
    const { client, personas } = clientFixture();
    personas.resolve.mockRejectedValue(new APIError(400, 'agent_id is required unless the key is bound to exactly one Agent'));
    await expect(invoke(['resolve'], client)).rejects.toMatchObject({
      name: 'UsageError', exitCode: 2, message: expect.stringContaining('--agent <id>'),
    });
  });

  it('has no offline resolve/source escape hatch', async () => {
    await expect(invoke(['resolve', '--source', 'offline'])).rejects.toThrow(UsageError);
    await expect(invoke(['resolve', '--source', 'live'])).rejects.toThrow(UsageError);
  });
});

describe('offline persona help', () => {
  it.each([
    ['--help'],
    ['list', '--help'],
    ['ls', '--help'],
    ['get', '--help'],
    ['resolve', '--help'],
  ])('%s does not construct a client', async (...args) => {
    const result = await invoke(args);
    expect(result.stdout).toContain('hyper persona');
    expect(result.stderr).toBe('');
  });
});
