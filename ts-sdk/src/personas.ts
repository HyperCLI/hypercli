/**
 * Dynamic persona discovery and Backend-owned Agent context resolution.
 *
 * Every method calls the authenticated Agents Backend at request time. The
 * service assembles and verifies INDEX.md; this module never reads, writes, or
 * caches a local prompt projection.
 */
import type { HTTPClient, RequestOverrides } from './http.js';

export const PERSONA_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const PERSONA_DIGEST_PATTERN = /^[0-9a-f]{64}$/;
export const PERSONA_REVISION_PATTERN = /^persona-catalog-v1-[0-9a-f]{64}$/;
const AGENT_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PersonaSourceDigest {
  sha256: string;
}

export interface PersonaCatalogEntry {
  /** Exact persona identifier (`name` in the published catalog schema). */
  id: string;
  /** Published schema name; identical to id. */
  name: string;
  description: string;
  artifact: string;
  schema: number;
  repoSha: string;
  sources: Record<string, PersonaSourceDigest>;
  /** SHA-256 of the exact assembled INDEX.md bytes. */
  digest: string;
  revision: string;
}

export interface PersonaCatalogMetadata {
  schema: number;
  /** Immutable source revision, required even when personas is empty. */
  repoSha: string;
  revision: string;
  digest: string;
}

export interface PersonaCatalog {
  personas: PersonaCatalogEntry[];
  catalog: PersonaCatalogMetadata;
}

export interface PersonaArtifact extends PersonaCatalogEntry {
  /** Exact service-assembled INDEX.md Markdown, not a client-side concatenation. */
  markdown: string;
}

export interface PersonaResolveOptions extends RequestOverrides {
  /** Explicit Agent UUID. Omit only for an exactly bound Agent credential. */
  agentId?: string;
}

export type PersonaResolutionSource = 'persona' | 'canonical';

export interface PersonaResolution {
  agentId: string;
  userId: string;
  /** Canonical User.meta.profile Markdown, including an intentional empty string. */
  user: string;
  /** Selected assembled INDEX.md, or canonical Agent SOUL when selection is absent. */
  soul: string;
  personaId: string | null;
  /** Current catalog revision for a selected persona; null for canonical SOUL. */
  revision: string | null;
  /** Effective INDEX.md SHA-256 for a selected persona; null for canonical SOUL. */
  digest: string | null;
  source: PersonaResolutionSource;
}

export type PersonaErrorCode = 'agent_id_required' | 'persona_invalid_id' | 'persona_invalid';

/** A client-side selection/response failure; Backend HTTP failures remain APIError. */
export class PersonaError extends Error {
  constructor(public readonly code: PersonaErrorCode, message: string) {
    super(message);
    this.name = 'PersonaError';
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new PersonaError('persona_invalid', `Backend persona response has an invalid ${field}`);
  }
  return value;
}

function requiredDigest(value: unknown, field: string): string {
  const digest = requiredString(value, field);
  if (!PERSONA_DIGEST_PATTERN.test(digest)) {
    throw new PersonaError('persona_invalid', `Backend persona response has an invalid ${field}`);
  }
  return digest;
}

function requiredRevision(value: unknown, field: string): string {
  const revision = requiredString(value, field);
  if (!PERSONA_REVISION_PATTERN.test(revision)) {
    throw new PersonaError('persona_invalid', `Backend persona response has an invalid ${field}`);
  }
  return revision;
}

function requiredRepoSha(value: unknown, field: string): string {
  const repoSha = requiredString(value, field);
  if (!/^[0-9a-f]{40}$/.test(repoSha) || repoSha === '0'.repeat(40)) {
    throw new PersonaError('persona_invalid', `Backend persona response has an invalid ${field}`);
  }
  return repoSha;
}

export function assertPersonaId(value: unknown): string {
  if (typeof value !== 'string' || value.length > 64 || !PERSONA_ID_PATTERN.test(value)) {
    throw new PersonaError('persona_invalid_id', 'persona id must be an exact lowercase hyphenated identifier');
  }
  return value;
}

function personaCatalogEntryFromData(value: unknown): PersonaCatalogEntry {
  const data = record(value);
  if (!data) throw new PersonaError('persona_invalid', 'Backend persona entry must be an object');
  const name = assertPersonaId(data.name ?? data.id);
  if (data.id !== undefined && data.id !== name) {
    throw new PersonaError('persona_invalid', `Backend persona id/name mismatch for '${name}'`);
  }
  const description = requiredString(data.description, `description for '${name}'`);
  if (!description.trim() || description.length > 4096) {
    throw new PersonaError('persona_invalid', `Backend persona '${name}' has an invalid description`);
  }
  const artifact = requiredString(data.artifact, `artifact for '${name}'`);
  if (artifact !== `/personas/${name}/INDEX.md`) {
    throw new PersonaError('persona_invalid', `Backend persona '${name}' has an invalid artifact path`);
  }
  if (data.schema !== 1) {
    throw new PersonaError('persona_invalid', `Backend persona '${name}' has an unsupported schema`);
  }
  const repoSha = requiredString(data.repo_sha ?? data.repoSha, `repo_sha for '${name}'`);
  if (!/^[0-9a-f]{40}$/.test(repoSha)) {
    throw new PersonaError('persona_invalid', `Backend persona '${name}' has an invalid repo_sha`);
  }
  const rawSources = record(data.sources);
  if (!rawSources || Object.keys(rawSources).sort().join(',') !== 'GUARDRAIL.md,PERSONA.md') {
    throw new PersonaError('persona_invalid', `Backend persona '${name}' has invalid source digests`);
  }
  const sources: Record<string, PersonaSourceDigest> = {};
  for (const path of ['PERSONA.md', 'GUARDRAIL.md']) {
    const source = record(rawSources[path]);
    if (!source) {
      throw new PersonaError('persona_invalid', `Backend persona '${name}' has invalid source '${path}'`);
    }
    sources[path] = { sha256: requiredDigest(source.sha256, `sources.${path}.sha256`) };
  }
  return {
    id: name,
    name,
    description,
    artifact,
    schema: 1,
    repoSha,
    sources,
    digest: requiredDigest(data.digest, `digest for '${name}'`),
    revision: requiredRevision(data.revision, `revision for '${name}'`),
  };
}

export function personaCatalogFromData(value: unknown): PersonaCatalog {
  const data = record(value);
  const rawEntries = data?.personas;
  if (!Array.isArray(rawEntries)) {
    throw new PersonaError('persona_invalid', 'Backend persona catalog must contain a personas array');
  }
  const rawCatalog = record(data?.catalog);
  if (!rawCatalog || rawCatalog.schema !== 1) {
    throw new PersonaError('persona_invalid', 'Backend persona catalog is missing valid catalog metadata');
  }
  const catalog = {
    schema: 1,
    repoSha: requiredRepoSha(rawCatalog.repo_sha ?? rawCatalog.repoSha, 'catalog.repo_sha'),
    revision: requiredRevision(rawCatalog.revision, 'catalog.revision'),
    digest: requiredDigest(rawCatalog.digest, 'catalog.digest'),
  };
  if (catalog.revision !== `persona-catalog-v1-${catalog.digest}`) {
    throw new PersonaError('persona_invalid', 'Backend persona catalog revision/digest mismatch');
  }
  const personas = rawEntries.map(personaCatalogEntryFromData);
  const ids = new Set<string>();
  let previous = '';
  for (const persona of personas) {
    if (ids.has(persona.id)) {
      throw new PersonaError('persona_invalid', `Backend persona catalog contains duplicate id '${persona.id}'`);
    }
    if (previous && persona.id <= previous) {
      throw new PersonaError('persona_invalid', 'Backend persona catalog is not deterministically ordered');
    }
    if (persona.revision !== catalog.revision) {
      throw new PersonaError('persona_invalid', `Backend persona '${persona.id}' revision does not match its catalog`);
    }
    ids.add(persona.id);
    previous = persona.id;
  }
  return { personas, catalog };
}

export function personaArtifactFromData(value: unknown): PersonaArtifact {
  const data = record(value);
  if (!data) throw new PersonaError('persona_invalid', 'Backend persona artifact must be an object');
  // Backend and MCP publish the flat {...entry, markdown} shape.
  const entry = personaCatalogEntryFromData(data);
  const markdown = data.markdown;
  if (typeof markdown !== 'string') {
    throw new PersonaError('persona_invalid', `Backend persona '${entry.id}' is missing assembled Markdown`);
  }
  return { ...entry, markdown };
}

function personaResolutionFromData(value: unknown, requestedAgentId?: string): PersonaResolution {
  const data = record(value);
  if (!data) throw new PersonaError('persona_invalid', 'Backend persona resolution must be an object');
  const agentId = requiredString(data.agent_id ?? data.agentId, 'resolution.agent_id');
  if (!AGENT_UUID_PATTERN.test(agentId)) {
    throw new PersonaError('persona_invalid', 'Backend persona resolution has an invalid agent_id');
  }
  const sameRequestedAgent = requestedAgentId === undefined || agentId === requestedAgentId || (
    AGENT_UUID_PATTERN.test(requestedAgentId) && agentId.toLowerCase() === requestedAgentId.toLowerCase()
  );
  if (!sameRequestedAgent) {
    throw new PersonaError(
      'persona_invalid',
      `Backend resolved Agent '${agentId}' for exact request '${requestedAgentId}'`,
    );
  }

  // The Backend owns the same canonical profile/null/legacy precedence as
  // GET /users/profile. Do not reconstruct USER from persona or Agent metadata.
  const rawUser = record(data.user);
  const userId = requiredString(rawUser?.id, 'resolution.user.id');
  const profile = rawUser?.profile;
  const soul = data.soul;
  if (typeof profile !== 'string' || typeof soul !== 'string') {
    throw new PersonaError('persona_invalid', 'Backend persona resolution must contain string USER and SOUL');
  }

  const rawPersona = data.persona;
  if (rawPersona === null) {
    return {
      agentId,
      userId,
      user: profile,
      soul,
      personaId: null,
      revision: null,
      digest: null,
      source: 'canonical',
    };
  }
  const receipt = record(rawPersona);
  if (!receipt) throw new PersonaError('persona_invalid', 'Backend selected-persona receipt must be an object');
  const personaId = assertPersonaId(receipt.name);
  return {
    agentId,
    userId,
    user: profile,
    soul,
    personaId,
    revision: requiredRevision(receipt.revision, 'resolution.persona.revision'),
    digest: requiredDigest(receipt.digest, 'resolution.persona.digest'),
    source: 'persona',
  };
}

export class PersonasAPI {
  constructor(private readonly http: HTTPClient) {}

  /** Read the current authorized discovery catalog through the Backend. */
  async list(options: RequestOverrides = {}): Promise<PersonaCatalog> {
    const data = await this.http.get('/personas', undefined, options);
    return personaCatalogFromData(data);
  }

  /** Read one exact ID and its current service-assembled INDEX.md through the Backend. */
  async get(id: string, options: RequestOverrides = {}): Promise<PersonaArtifact> {
    const exactId = assertPersonaId(id);
    const data = await this.http.get(`/personas/${encodeURIComponent(exactId)}`, undefined, options);
    const artifact = personaArtifactFromData(data);
    if (artifact.id !== exactId) {
      throw new PersonaError(
        'persona_invalid',
        `Backend returned persona '${artifact.id}' for exact request '${exactId}'`,
      );
    }
    return artifact;
  }

  /**
   * Resolve current USER + effective SOUL through the single Backend resolver.
   * It owns exact bound-Agent inference, owner authorization, metadata rereads,
   * canonical USER/SOUL precedence, and no-fallback error behavior.
   */
  async resolve(options: PersonaResolveOptions = {}): Promise<PersonaResolution> {
    const { agentId, ...overrides } = options;
    if (agentId !== undefined && (typeof agentId !== 'string' || agentId.trim().length === 0)) {
      throw new PersonaError('agent_id_required', 'agentId must not be blank');
    }
    const data = await this.http.get(
      '/personas/resolve',
      agentId === undefined ? undefined : { agent_id: agentId },
      overrides,
    );
    return personaResolutionFromData(data, agentId);
  }
}
