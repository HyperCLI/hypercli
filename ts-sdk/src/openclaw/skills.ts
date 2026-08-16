import type {
  GatewaySkillStatusEntry,
  GatewaySkillsInstallResult,
  GatewaySkillsSearchResult,
  GatewaySkillsSkillCardResult,
  GatewaySkillsStatusReport,
  GatewaySkillsUpdateResult,
} from './gateway.js';
import type {
  AgentSkillAvailability,
  AgentSkillCreateRequest,
  AgentSkillCreateResult,
  AgentSkillDocument,
  AgentSkillInstallRequest,
  AgentSkillInstallResult,
  AgentSkillOrigin,
  AgentSkillRequirements,
  AgentSkillResourceAccess,
  AgentSkillResourceEntry,
  AgentSkillSearchItem,
  AgentSkillSummary,
  AgentSkillsProvider,
  AgentSkillsProviderCapabilities,
  AgentSkillUpdate,
} from '../skills.js';

export interface OpenClawSkillsClient {
  skillsStatus(): Promise<GatewaySkillsStatusReport>;
  skillsSkillCard(params: { agentId?: string; skillKey: string }): Promise<GatewaySkillsSkillCardResult>;
  skillsUpdate(params: { skillKey: string; enabled?: boolean; apiKey?: string; env?: Record<string, string> }): Promise<GatewaySkillsUpdateResult>;
  skillsSearch(params?: { query?: string; limit?: number }): Promise<GatewaySkillsSearchResult>;
  skillsInstall(params:
    | { source: 'clawhub'; slug: string; version?: string; force?: boolean }
    | { source: 'upload'; uploadId: string; slug: string; force?: boolean; sha256?: string }
  ): Promise<GatewaySkillsInstallResult>;
}

export interface OpenClawSkillsFileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  last_modified?: string;
  lastModified?: string;
}

export interface OpenClawSkillsFiles {
  list(path?: string): Promise<OpenClawSkillsFileEntry[]>;
  readBytes(path: string): Promise<Uint8Array>;
  writeBytes(path: string, content: Uint8Array): Promise<unknown>;
  delete(path: string, options?: { recursive?: boolean }): Promise<unknown>;
}

const SKILLS_ROOT = '.openclaw/workspace/skills';
const MAX_SKILL_DOCUMENT_BYTES = 1024 * 1024;
const SKILL_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;

function validSkillId(value: string): boolean {
  return SKILL_ID_PATTERN.test(value);
}

function requireSkillId(value: string): string {
  if (!validSkillId(value)) throw new Error('Skill IDs must be lowercase slugs between 1 and 80 characters.');
  return value;
}

function validResourceSkillId(value: string): boolean {
  return Boolean(value)
    && value !== '.'
    && value !== '..'
    && !value.includes('/')
    && !value.includes('\\')
    && !value.includes('\0');
}

function requireResourceSkillId(value: string): string {
  if (!validResourceSkillId(value)) throw new Error('Gateway skill IDs used for files must be one exact path segment.');
  return value;
}

function requireResourcePath(value: string, allowRoot = false): string {
  if (typeof value !== 'string' || value.includes('\0') || value.includes('\\')) {
    throw new Error('Skill resource paths must be exact relative paths.');
  }
  if (!value) {
    if (allowRoot) return '';
    throw new Error('A skill-relative resource path is required.');
  }
  if (value.startsWith('/') || value.endsWith('/')) throw new Error('Skill resource paths must be relative.');
  const segments = value.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('Skill resource paths cannot contain empty or traversal segments.');
  }
  return value;
}

function skillRoot(skillId: string): string {
  return `${SKILLS_ROOT}/${requireResourceSkillId(skillId)}`;
}

function skillPath(skillId: string, resourcePath: string, allowRoot = false): string {
  const root = skillRoot(skillId);
  const relative = requireResourcePath(resourcePath, allowRoot);
  return relative ? `${root}/${relative}` : root;
}

function mapResourceEntry(
  entry: OpenClawSkillsFileEntry,
  root: string,
  listedPath: string,
): AgentSkillResourceEntry {
  if (entry.type === 'directory') {
    if (!entry.path.endsWith('/') || entry.path.endsWith('//')) {
      throw new Error('Agent files returned an invalid skill directory path.');
    }
  } else if (entry.path.endsWith('/')) {
    throw new Error('Agent files returned an invalid skill file path.');
  }
  const rawPath = requireResourcePath(entry.type === 'directory' ? entry.path.slice(0, -1) : entry.path);
  if (!rawPath.startsWith(`${root}/`)) {
    throw new Error('Agent files returned an entry outside the requested skill directory.');
  }
  const relative = rawPath.slice(root.length + 1);
  const path = requireResourcePath(relative);
  const separator = path.lastIndexOf('/');
  const parent = separator >= 0 ? path.slice(0, separator) : '';
  const name = separator >= 0 ? path.slice(separator + 1) : path;
  if (parent !== listedPath || entry.name !== name) {
    throw new Error('Agent files returned an entry outside the requested skill directory.');
  }
  return {
    name,
    path,
    type: entry.type,
    size: entry.size,
    lastModified: entry.lastModified ?? entry.last_modified,
  };
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  }
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  if (value && typeof value === 'object') return Object.keys(value as Record<string, unknown>);
  return [];
}

function requirements(value: Record<string, unknown> | undefined): AgentSkillRequirements {
  return {
    env: stringList(value?.env),
    bins: stringList(value?.bins),
    os: stringList(value?.os),
  };
}

function origin(entry: GatewaySkillStatusEntry): AgentSkillOrigin {
  if (entry.bundled) return 'built-in';
  const source = entry.source.trim().toLowerCase();
  if (source.includes('plugin') || source.includes('extension')) return 'extension';
  if (source.includes('clawhub') || source.includes('catalog') || source.includes('registry')) return 'registry';
  if (source.includes('custom') || source.includes('managed') || source.includes('workspace')) return 'custom';
  return 'unknown';
}

function availability(entry: GatewaySkillStatusEntry): AgentSkillAvailability {
  if (entry.disabled) return 'disabled';
  if (entry.blockedByAllowlist || entry.blockedByAgentFilter) return 'blocked';
  if (!entry.eligible) return 'needs-setup';
  return 'active';
}

export function normalizeOpenClawSkill(
  entry: GatewaySkillStatusEntry,
  access: AgentSkillResourceAccess = 'none',
): AgentSkillSummary {
  const required = requirements(entry.requirements);
  if (required.env.length === 0 && entry.primaryEnv) required.env = [entry.primaryEnv];
  if (required.bins.length === 0) required.bins = entry.install.flatMap((option) => option.bins ?? []);
  return {
    id: entry.skillKey,
    name: entry.name || entry.skillKey,
    description: entry.description || 'Skill instructions',
    origin: origin(entry),
    availability: availability(entry),
    enabled: !entry.disabled,
    ready: !entry.disabled && entry.eligible && !entry.blockedByAllowlist && !entry.blockedByAgentFilter,
    documentAvailable: Boolean(entry.skillCard?.present),
    resourceAccess: access,
    requirements: required,
    missingRequirements: requirements(entry.missing),
    emoji: entry.emoji,
    homepage: entry.homepage,
    installHints: entry.install.map((option) => option.label).filter(Boolean),
  };
}

export class OpenClawSkillsProvider implements AgentSkillsProvider {
  readonly capabilities: AgentSkillsProviderCapabilities;

  private readonly entries = new Map<string, GatewaySkillStatusEntry>();
  private readonly access = new Map<string, AgentSkillResourceAccess>();
  private agentId: string | undefined;

  constructor(
    private readonly client: OpenClawSkillsClient,
    private readonly files?: OpenClawSkillsFiles,
  ) {
    this.capabilities = {
      readDocument: true,
      configure: true,
      searchRegistry: true,
      installRegistry: true,
      installUpload: false,
      resources: Boolean(files),
      createSkill: Boolean(files),
      recoverSkill: false,
    };
  }

  private requireFiles(): OpenClawSkillsFiles {
    if (!this.files) throw new Error('Agent files are unavailable.');
    return this.files;
  }

  async list(): Promise<AgentSkillSummary[]> {
    const report = await this.client.skillsStatus();
    this.agentId = report.agentId;
    this.entries.clear();
    this.access.clear();
    return report.skills
      .map((entry) => {
        const access = this.files && validResourceSkillId(entry.skillKey) ? 'read-write' : 'none';
        this.entries.set(entry.skillKey, entry);
        this.access.set(entry.skillKey, access);
        return normalizeOpenClawSkill(entry, access);
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async readDocument(skillId: string): Promise<AgentSkillDocument | null> {
    if (this.entries.size === 0) await this.list();
    const entry = this.entries.get(skillId);
    if (!entry?.skillCard?.present) return null;
    const card = await this.client.skillsSkillCard({ agentId: this.agentId, skillKey: skillId });
    return { skillId, content: card.content, sizeBytes: card.sizeBytes };
  }

  async update(skillId: string, update: AgentSkillUpdate): Promise<void> {
    await this.client.skillsUpdate({ skillKey: skillId, ...update });
  }

  async search(query: string, limit?: number): Promise<AgentSkillSearchItem[]> {
    const result = await this.client.skillsSearch({ query, limit });
    return result.results.map((item) => ({
      id: item.slug,
      name: item.displayName || item.slug,
      description: item.summary,
      version: item.version,
      owner: item.owner?.displayName || item.ownerHandle,
    }));
  }

  async install(request: AgentSkillInstallRequest): Promise<AgentSkillInstallResult> {
    const result = request.source === 'registry'
      ? await this.client.skillsInstall({ source: 'clawhub', slug: request.id, version: request.version, force: request.force })
      : await this.client.skillsInstall({ source: 'upload', uploadId: request.uploadId, slug: request.id, force: request.force, sha256: request.sha256 });
    return {
      ok: result.ok,
      skillId: result.slug ?? request.id,
      message: result.message,
      warnings: result.warnings,
    };
  }

  async createSkill(request: AgentSkillCreateRequest): Promise<AgentSkillCreateResult> {
    const files = this.requireFiles();
    const id = requireSkillId(request.id);
    if (!request.content.trim()) throw new Error('SKILL.md cannot be empty.');
    if (new TextEncoder().encode(request.content).length > MAX_SKILL_DOCUMENT_BYTES) {
      throw new Error('SKILL.md exceeds the 1 MiB write limit.');
    }
    if ((request.directories?.length ?? 0) > 0) {
      throw new Error('Skill directories cannot be created through Agent files.');
    }
    const report = await this.client.skillsStatus();
    if (report.skills.some((entry) => entry.skillKey === id)) throw new Error('A skill with this ID already exists.');
    await files.writeBytes(
      `${skillRoot(id)}/SKILL.md`,
      new TextEncoder().encode(request.content),
    );
    this.entries.clear();
    this.access.clear();
    return { skillId: id };
  }

  private async requireAccess(skillId: string): Promise<AgentSkillResourceAccess> {
    const id = requireResourceSkillId(skillId);
    if (this.entries.size === 0) await this.list();
    const access = this.access.get(id) ?? 'none';
    if (access === 'none') throw new Error(`Skill resources are unavailable for ${id}.`);
    return access;
  }

  async listResources(skillId: string, path = ''): Promise<AgentSkillResourceEntry[]> {
    const files = this.requireFiles();
    await this.requireAccess(skillId);
    const relative = requireResourcePath(path, true);
    const root = skillRoot(skillId);
    const entries = await files.list(skillPath(skillId, relative, true));
    return entries.map((entry) => mapResourceEntry(entry, root, relative));
  }

  async readResource(skillId: string, path: string): Promise<Uint8Array> {
    const files = this.requireFiles();
    await this.requireAccess(skillId);
    return files.readBytes(skillPath(skillId, path));
  }

  async writeResource(skillId: string, path: string, content: Uint8Array): Promise<void> {
    const files = this.requireFiles();
    await this.requireAccess(skillId);
    await files.writeBytes(skillPath(skillId, path), content);
  }

  async deleteResource(skillId: string, path: string, options?: { recursive?: boolean }): Promise<void> {
    const files = this.requireFiles();
    await this.requireAccess(skillId);
    await files.delete(skillPath(skillId, path), options);
  }
}
