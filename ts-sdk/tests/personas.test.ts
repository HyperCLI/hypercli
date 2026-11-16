import { afterEach, describe, expect, it, vi } from 'vitest';
import { HTTPClient } from '../src/http.js';
import {
  PersonaError,
  PersonasAPI,
  personaCatalogFromData,
} from '../src/personas.js';
import { APIError } from '../src/errors.js';

const AGENT_ID = '11111111-1111-4111-8111-111111111111';
const MARKDOWN = '# Effective persona: chief-of-staff\n\nExact assembled bytes.\n';
const DIGEST = 'a'.repeat(64);
const CATALOG_DIGEST = 'b'.repeat(64);
const REVISION = `persona-catalog-v1-${CATALOG_DIGEST}`;

function entry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'chief-of-staff',
    description: 'Coordinate current work.',
    artifact: '/personas/chief-of-staff/INDEX.md',
    schema: 1,
    repo_sha: '0123456789abcdef0123456789abcdef01234567',
    sources: {
      'PERSONA.md': { sha256: 'c'.repeat(64) },
      'GUARDRAIL.md': { sha256: 'd'.repeat(64) },
    },
    digest: DIGEST,
    revision: REVISION,
    ...overrides,
  };
}

function catalog() {
  return {
    personas: [entry()],
    catalog: {
      schema: 1,
      repo_sha: '0123456789abcdef0123456789abcdef01234567',
      revision: REVISION,
      digest: CATALOG_DIGEST,
    },
  };
}

function selectedResolution() {
  return {
    agent_id: AGENT_ID,
    user: {
      id: 'user-1',
      avatar_url: null,
      profile: '# Canonical USER\n',
      display_name: null,
    },
    soul: MARKDOWN,
    persona: { name: 'chief-of-staff', revision: REVISION, digest: DIGEST },
  };
}

interface FixtureOptions {
  resolvePayload?: unknown;
  resolveStatus?: number;
}

function fixture(options: FixtureOptions = {}) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes('/personas/chief-of-staff')) {
      return Response.json({ ...entry(), markdown: MARKDOWN });
    }
    if (url.includes('/personas/resolve')) {
      const status = options.resolveStatus ?? 200;
      return Response.json(status === 200
        ? options.resolvePayload ?? selectedResolution()
        : { detail: 'persona_catalog_unavailable' }, { status });
    }
    if (url.endsWith('/personas')) {
      return Response.json(catalog());
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  const api = new PersonasAPI(new HTTPClient('https://api.example.test/agents', 'secret', 1000));
  return { api, calls, fetchMock };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('live persona discovery', () => {
  it('lists the authorized Backend catalog with source and revision metadata', async () => {
    const { api, calls } = fixture();
    const result = await api.list({ retries: 1 });
    expect(result.personas).toHaveLength(1);
    expect(result.personas[0]).toMatchObject({
      id: 'chief-of-staff',
      name: 'chief-of-staff',
      repoSha: '0123456789abcdef0123456789abcdef01234567',
      digest: DIGEST,
      revision: REVISION,
    });
    expect(result.catalog.digest).toBe(CATALOG_DIGEST);
    expect(calls.map(call => call.url)).toEqual(['https://api.example.test/agents/personas']);
    expect(calls[0].init?.headers).toMatchObject({ Authorization: 'Bearer secret' });
  });

  it('gets exact assembled Markdown without ID normalization', async () => {
    const { api, calls } = fixture();
    const artifact = await api.get('chief-of-staff', { retries: 1 });
    expect(artifact.markdown).toBe(MARKDOWN);
    expect(calls[0].url).toBe('https://api.example.test/agents/personas/chief-of-staff');
    await expect(api.get('Chief-of-Staff', { retries: 1 })).rejects.toMatchObject({
      code: 'persona_invalid_id',
    });
    await expect(api.get('chief_of_staff', { retries: 1 })).rejects.toMatchObject({
      code: 'persona_invalid_id',
    });
    expect(calls).toHaveLength(1);
  });

  it('rejects unpublished nested envelopes and mismatched flat IDs', async () => {
    const { api, fetchMock } = fixture();
    for (const envelope of ['persona', 'entry', 'metadata']) {
      fetchMock.mockImplementation(async () => Response.json({ [envelope]: entry(), markdown: MARKDOWN }));
      await expect(api.get('chief-of-staff', { retries: 1 })).rejects.toThrow(PersonaError);
    }
    fetchMock.mockImplementation(async () => Response.json({ ...entry({ name: 'other' }), markdown: MARKDOWN }));
    await expect(api.get('chief-of-staff', { retries: 1 })).rejects.toThrow(PersonaError);
  });

  it('rejects duplicate, unordered, and revision-mismatched catalog entries', async () => {
    const duplicate = catalog();
    duplicate.personas.push(entry());
    expect(() => personaCatalogFromData(duplicate)).toThrow(/duplicate id/);
    const unordered = catalog();
    unordered.personas = [entry({ name: 'zeta', artifact: '/personas/zeta/INDEX.md' }), entry()];
    expect(() => personaCatalogFromData(unordered)).toThrow(/ordered/);
    const mismatched = catalog();
    mismatched.personas[0].revision = `persona-catalog-v1-${'e'.repeat(64)}`;
    expect(() => personaCatalogFromData(mismatched)).toThrow(/does not match/);
  });
});

describe('Backend persona resolution', () => {
  it('uses the bound-Agent resolver and returns current INDEX.md plus canonical USER', async () => {
    const { api, calls } = fixture();
    const result = await api.resolve({ retries: 1 });
    expect(calls.map(call => call.url)).toEqual(['https://api.example.test/agents/personas/resolve']);
    expect(result).toEqual({
      agentId: AGENT_ID,
      userId: 'user-1',
      user: '# Canonical USER\n',
      soul: MARKDOWN,
      personaId: 'chief-of-staff',
      revision: REVISION,
      digest: DIGEST,
      source: 'persona',
    });
  });

  it('passes an explicit Agent UUID to the same Backend resolver', async () => {
    const { api, calls } = fixture();
    await api.resolve({ agentId: AGENT_ID, retries: 1 });
    expect(calls.map(call => call.url)).toEqual([
      `https://api.example.test/agents/personas/resolve?agent_id=${AGENT_ID}`,
    ]);
  });

  it('returns canonical SOUL + USER with a null selection receipt', async () => {
    const payload = selectedResolution();
    const { api, calls } = fixture({
      resolvePayload: { ...payload, soul: '# Canonical SOUL\n', persona: null },
    });
    const result = await api.resolve({ retries: 1 });
    expect(result).toEqual({
      agentId: AGENT_ID,
      userId: 'user-1',
      user: '# Canonical USER\n',
      soul: '# Canonical SOUL\n',
      personaId: null,
      revision: null,
      digest: null,
      source: 'canonical',
    });
    // In particular, the SDK does not issue a second catalog/artifact request.
    expect(calls).toHaveLength(1);
  });

  it('preserves intentional empty canonical USER and SOUL', async () => {
    const payload = selectedResolution();
    const { api } = fixture({
      resolvePayload: {
        ...payload,
        user: { ...payload.user, profile: '' },
        soul: '',
        persona: null,
      },
    });
    await expect(api.resolve({ retries: 1 })).resolves.toMatchObject({ user: '', soul: '' });
  });

  it('rereads the Backend on every resolve instead of caching a prompt snapshot', async () => {
    const first = selectedResolution();
    const second = {
      ...first,
      soul: '# Changed canonical SOUL\n',
      persona: null,
    };
    const { api, fetchMock } = fixture();
    fetchMock
      .mockImplementationOnce(async () => Response.json(first))
      .mockImplementationOnce(async () => Response.json(second));
    await expect(api.resolve({ retries: 1 })).resolves.toMatchObject({ source: 'persona', soul: MARKDOWN });
    await expect(api.resolve({ retries: 1 })).resolves.toMatchObject({ source: 'canonical', soul: '# Changed canonical SOUL\n' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects a blank explicit Agent before any request', async () => {
    const { api, fetchMock } = fixture();
    await expect(api.resolve({ agentId: ' ', retries: 1 })).rejects.toMatchObject({
      code: 'agent_id_required',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects malformed selected receipts and wrong-Agent responses', async () => {
    const selected = selectedResolution();
    const { api } = fixture({
      resolvePayload: { ...selected, persona: { name: 'chief-of-staff' } },
    });
    await expect(api.resolve({ retries: 1 })).rejects.toThrow(PersonaError);

    const wrong = fixture({ resolvePayload: { ...selected, agent_id: '22222222-2222-4222-8222-222222222222' } });
    await expect(wrong.api.resolve({ agentId: AGENT_ID, retries: 1 })).rejects.toThrow(/wrong|exact request/i);
  });

  it('rejects malformed USER rather than substituting an empty/static profile', async () => {
    const { api } = fixture({ resolvePayload: { ...selectedResolution(), user: {} } });
    await expect(api.resolve({ retries: 1 })).rejects.toThrow(PersonaError);
  });

  it('propagates selected artifact failure without returning canonical SOUL', async () => {
    const { api } = fixture({ resolveStatus: 503 });
    const failure = api.resolve({ retries: 1 });
    await expect(failure).rejects.toBeInstanceOf(APIError);
    await expect(failure).rejects.toMatchObject({ statusCode: 503, detail: 'persona_catalog_unavailable' });
  });
});
