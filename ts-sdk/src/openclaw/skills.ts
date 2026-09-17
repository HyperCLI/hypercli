import type {
  GatewaySkillStatusEntry,
  GatewaySkillsInstallResult,
  GatewaySkillProposalManifestEntry,
  GatewaySkillsProposalApplyResult,
  GatewaySkillsProposalDecisionParams,
  GatewaySkillsProposalInspectResult,
  GatewaySkillsProposalRejectResult,
  GatewaySkillsReadResult,
  GatewaySkillsSearchResult,
  GatewaySkillsSkillCardResult,
  GatewaySkillsStatusReport,
  GatewaySkillsUpdateResult,
} from './gateway.js';
import type {
  AgentSkillAvailability,
  AgentSkillCardMetadata,
  AgentSkillCreateRequest,
  AgentSkillCreateResult,
  AgentSkillDocument,
  AgentSkillInstallRequest,
  AgentSkillInstallResult,
  AgentSkillOrigin,
  AgentSkillProposalCapabilities,
  AgentSkillProposalDecision,
  AgentSkillProposalInspection,
  AgentSkillProposalsProvider,
  AgentSkillProposalSummary,
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
  skillsRead?(params: { agentId?: string; skillKey: string }): Promise<GatewaySkillsReadResult>;
  supportsMethod?(method: string): boolean;
  skillsUpdate(params: { skillKey: string; enabled?: boolean; apiKey?: string; env?: Record<string, string> }): Promise<GatewaySkillsUpdateResult>;
  skillsSearch(params?: { query?: string; limit?: number }): Promise<GatewaySkillsSearchResult>;
  skillsInstall(params:
    | { source: 'clawhub'; slug: string; version?: string; force?: boolean }
    | { source: 'upload'; uploadId: string; slug: string; force?: boolean; sha256?: string }
  ): Promise<GatewaySkillsInstallResult>;
}

export interface OpenClawSkillProposalsClient {
  supportsMethod(method: string): boolean;
  hasGrantedScope(scope: 'operator.read' | 'operator.admin'): boolean;
  skillsProposalsList(params?: { agentId?: string }): Promise<{ proposals: GatewaySkillProposalManifestEntry[] }>;
  skillsProposalInspect(params: { agentId?: string; proposalId: string }): Promise<GatewaySkillsProposalInspectResult>;
  skillsProposalApply(params: GatewaySkillsProposalDecisionParams): Promise<GatewaySkillsProposalApplyResult>;
  skillsProposalReject(params: GatewaySkillsProposalDecisionParams): Promise<GatewaySkillsProposalRejectResult>;
}

export class OpenClawSkillProposalsProvider implements AgentSkillProposalsProvider {
  constructor(
    private readonly client: OpenClawSkillProposalsClient,
    private readonly agentId?: string,
  ) {}

  get capabilities(): AgentSkillProposalCapabilities {
    const canRead = this.client.hasGrantedScope('operator.read');
    const canAdmin = this.client.hasGrantedScope('operator.admin');
    return {
      list: canRead && this.client.supportsMethod('skills.proposals.list'),
      inspect: canRead && this.client.supportsMethod('skills.proposals.inspect'),
      apply: canAdmin && this.client.supportsMethod('skills.proposals.apply'),
      reject: canAdmin && this.client.supportsMethod('skills.proposals.reject'),
    };
  }

  async list(): Promise<AgentSkillProposalSummary[]> {
    if (!this.capabilities.list) return [];
    const result = await this.client.skillsProposalsList({ agentId: this.agentId });
    const ids = new Set<string>();
    for (const proposal of result.proposals) {
      if (ids.has(proposal.id)) throw new Error(`Duplicate skill proposal ID: ${proposal.id}`);
      ids.add(proposal.id);
    }
    return result.proposals
      .filter((proposal) => proposal.status === 'pending')
      .map((proposal) => ({
        id: proposal.id,
        kind: proposal.kind,
        status: proposal.status,
        title: proposal.title,
        description: proposal.description,
        skillName: proposal.skillName,
        skillKey: proposal.skillKey,
        createdAt: proposal.createdAt,
        updatedAt: proposal.updatedAt,
        scanState: proposal.scanState,
      }));
  }

  async inspect(proposalId: string): Promise<AgentSkillProposalInspection> {
    if (!this.capabilities.inspect) throw new Error('Skill proposal inspection is unavailable.');
    const result = await this.client.skillsProposalInspect({ agentId: this.agentId, proposalId });
    return {
      content: result.content,
      ...(result.revisionHash ? { revision: result.revisionHash } : {}),
    };
  }

  async apply(params: AgentSkillProposalDecision): Promise<void> {
    if (!this.capabilities.apply) throw new Error('Skill proposal approval requires administrator access.');
    await this.client.skillsProposalApply({
      agentId: this.agentId,
      proposalId: params.proposalId,
      ...(params.expectedRevision ? { expectedRevisionHash: params.expectedRevision } : {}),
      ...(params.reason !== undefined ? { reason: params.reason } : {}),
    });
  }

  async reject(params: AgentSkillProposalDecision): Promise<void> {
    if (!this.capabilities.reject) throw new Error('Skill proposal rejection requires administrator access.');
    await this.client.skillsProposalReject({
      agentId: this.agentId,
      proposalId: params.proposalId,
      ...(params.expectedRevision ? { expectedRevisionHash: params.expectedRevision } : {}),
      ...(params.reason !== undefined ? { reason: params.reason } : {}),
    });
  }
}

export interface OpenClawSkillsProviderOptions {
  /** Absolute runtime path represented by the root of AgentFiles. */
  syncRoot?: string;
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
  readBytes(path: string, options?: { maxBytes?: number }): Promise<Uint8Array>;
  writeBytes(path: string, content: Uint8Array): Promise<unknown>;
  delete(path: string, options?: { recursive?: boolean }): Promise<unknown>;
}

const DEFAULT_SYNC_ROOT = '/home/node';
const MAX_SKILL_DOCUMENT_BYTES = 256_000;
const SKILL_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;

function validSkillId(value: string): boolean {
  return SKILL_ID_PATTERN.test(value);
}

function requireSkillId(value: string): string {
  if (!validSkillId(value)) throw new Error('Skill IDs must be lowercase slugs between 1 and 80 characters.');
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

function requireAbsolutePath(value: string, label: string): string {
  if (!value.startsWith('/') || value.includes('\\') || value.includes('\0')) {
    throw new Error(`${label} must be an absolute POSIX path.`);
  }
  const normalized = value.length > 1 && value.endsWith('/') ? value.slice(0, -1) : value;
  if (normalized.split('/').slice(1).some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error(`${label} contains an invalid path segment.`);
  }
  return normalized;
}

function isWithin(root: string, path: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

function relativeToSyncRoot(path: string, syncRoot: string): string | null {
  if (!isWithin(syncRoot, path) || path === syncRoot) return null;
  return requireResourcePath(path.slice(syncRoot.length + 1));
}

interface ResolvedSkillFiles {
  access: AgentSkillResourceAccess;
  documentPath: string;
  root: string;
}

function resolveSkillFiles(
  entry: GatewaySkillStatusEntry,
  report: GatewaySkillsStatusReport,
  syncRoot: string,
): ResolvedSkillFiles | null {
  try {
    const filePath = requireAbsolutePath(entry.filePath, 'Gateway skill filePath');
    if (!filePath.endsWith('/SKILL.md')) return null;
    const workspaceSkillsDir = `${requireAbsolutePath(report.workspaceDir, 'Gateway workspaceDir')}/skills`;
    const managedSkillsDir = requireAbsolutePath(report.managedSkillsDir, 'Gateway managedSkillsDir');
    const access: AgentSkillResourceAccess = isWithin(workspaceSkillsDir, filePath)
      ? 'read-write'
      : isWithin(managedSkillsDir, filePath)
        ? 'read-only'
        : 'none';
    if (access === 'none') return null;
    const documentPath = relativeToSyncRoot(filePath, syncRoot);
    const rootPath = filePath.slice(0, -'/SKILL.md'.length);
    const root = relativeToSyncRoot(rootPath, syncRoot);
    return documentPath && root ? { access, documentPath, root } : null;
  } catch {
    return null;
  }
}

function skillPath(root: string, resourcePath: string, allowRoot = false): string {
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
  documentAvailable = false,
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
    documentAvailable,
    resourceAccess: access,
    requirements: required,
    missingRequirements: requirements(entry.missing),
    emoji: entry.emoji,
    homepage: entry.homepage,
    installHints: entry.install.map((option) => option.label).filter(Boolean),
    ...(entry.skillCard && typeof entry.skillCard.path === 'string' && typeof entry.skillCard.sizeBytes === 'number' ? {
      skillCard: {
        path: entry.skillCard.path,
        sizeBytes: entry.skillCard.sizeBytes,
      } satisfies AgentSkillCardMetadata,
    } : {}),
  };
}

export class OpenClawSkillsProvider implements AgentSkillsProvider {
  private readonly entries = new Map<string, GatewaySkillStatusEntry>();
  private readonly access = new Map<string, AgentSkillResourceAccess>();
  private readonly resolvedFiles = new Map<string, ResolvedSkillFiles>();
  private readonly syncRoot: string;
  private agentId: string | undefined;

  constructor(
    private readonly client: OpenClawSkillsClient,
    private readonly files?: OpenClawSkillsFiles,
    options: OpenClawSkillsProviderOptions = {},
  ) {
    this.syncRoot = requireAbsolutePath(options.syncRoot ?? DEFAULT_SYNC_ROOT, 'OpenClaw AgentFiles sync root');
  }

  get capabilities(): AgentSkillsProviderCapabilities {
    return {
      readDocument: Boolean(this.files) || this.supportsReadRpc(),
      configure: true,
      searchRegistry: true,
      installRegistry: true,
      installUpload: false,
      resources: Boolean(this.files),
      createSkill: Boolean(this.files),
      recoverSkill: false,
    };
  }

  private supportsReadRpc(): boolean {
    return Boolean(
      this.client.skillsRead
      && this.client.supportsMethod?.('skills.read') === true,
    );
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
    this.resolvedFiles.clear();
    return report.skills
      .map((entry) => {
        if (this.entries.has(entry.skillKey)) {
          throw new Error(`Duplicate OpenClaw skill key: ${entry.skillKey}`);
        }
        const resolved = resolveSkillFiles(entry, report, this.syncRoot);
        const access = this.files && resolved ? resolved.access : 'none';
        this.entries.set(entry.skillKey, entry);
        this.access.set(entry.skillKey, access);
        if (resolved) this.resolvedFiles.set(entry.skillKey, resolved);
        return normalizeOpenClawSkill(
          entry,
          access,
          Boolean(resolved && this.files) || this.supportsReadRpc(),
        );
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async readDocument(skillId: string): Promise<AgentSkillDocument | null> {
    if (this.entries.size === 0) await this.list();
    const entry = this.entries.get(skillId);
    if (!entry) return null;
    if (this.supportsReadRpc()) {
      const document = await this.client.skillsRead!({ agentId: this.agentId, skillKey: skillId });
      return {
        skillId,
        content: document.content,
        sizeBytes: document.sizeBytes,
        path: document.path,
      };
    }
    const resolved = this.resolvedFiles.get(skillId);
    if (!resolved || !this.files) return null;
    const content = await this.files.readBytes(resolved.documentPath, { maxBytes: MAX_SKILL_DOCUMENT_BYTES });
    if (content.byteLength > MAX_SKILL_DOCUMENT_BYTES) {
      throw new Error('SKILL.md exceeds the 256 KB read limit.');
    }
    let decoded: string;
    try {
      decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(content);
    } catch {
      throw new Error('SKILL.md must contain valid UTF-8 text.');
    }
    if (decoded.includes('\0')) throw new Error('SKILL.md cannot contain null bytes.');
    return {
      skillId,
      content: decoded,
      sizeBytes: content.byteLength,
      path: resolved.documentPath,
    };
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
      throw new Error('SKILL.md exceeds the 256 KB write limit.');
    }
    if ((request.directories?.length ?? 0) > 0) {
      throw new Error('Skill directories cannot be created through Agent files.');
    }
    const report = await this.client.skillsStatus();
    if (report.skills.some((entry) => entry.skillKey === id)) throw new Error('A skill with this ID already exists.');
    const workspaceDir = requireAbsolutePath(report.workspaceDir, 'Gateway workspaceDir');
    const documentPath = relativeToSyncRoot(`${workspaceDir}/skills/${id}/SKILL.md`, this.syncRoot);
    if (!documentPath) throw new Error('The Gateway workspace is outside the AgentFiles sync root.');
    await files.writeBytes(
      documentPath,
      new TextEncoder().encode(request.content),
    );
    this.entries.clear();
    this.access.clear();
    this.resolvedFiles.clear();
    return { skillId: id };
  }

  private async requireAccess(skillId: string): Promise<AgentSkillResourceAccess> {
    if (this.entries.size === 0) await this.list();
    const access = this.access.get(skillId) ?? 'none';
    if (access === 'none') throw new Error(`Skill resources are unavailable for ${skillId}.`);
    return access;
  }

  private async requireWritableAccess(skillId: string): Promise<void> {
    const access = await this.requireAccess(skillId);
    if (access !== 'read-write') throw new Error(`Skill resources are read-only for ${skillId}.`);
  }

  private requireResolvedFiles(skillId: string): ResolvedSkillFiles {
    const resolved = this.resolvedFiles.get(skillId);
    if (!resolved) throw new Error(`Skill resources are unavailable for ${skillId}.`);
    return resolved;
  }

  async listResources(skillId: string, path = ''): Promise<AgentSkillResourceEntry[]> {
    const files = this.requireFiles();
    await this.requireAccess(skillId);
    const relative = requireResourcePath(path, true);
    const root = this.requireResolvedFiles(skillId).root;
    const entries = await files.list(skillPath(root, relative, true));
    return entries.map((entry) => mapResourceEntry(entry, root, relative));
  }

  async readResource(skillId: string, path: string): Promise<Uint8Array> {
    const files = this.requireFiles();
    await this.requireAccess(skillId);
    return files.readBytes(skillPath(this.requireResolvedFiles(skillId).root, path));
  }

  async writeResource(skillId: string, path: string, content: Uint8Array): Promise<void> {
    const files = this.requireFiles();
    await this.requireWritableAccess(skillId);
    if (path === 'SKILL.md' && content.byteLength > MAX_SKILL_DOCUMENT_BYTES) {
      throw new Error('SKILL.md exceeds the 256 KB write limit.');
    }
    await files.writeBytes(skillPath(this.requireResolvedFiles(skillId).root, path), content);
  }

  async deleteResource(skillId: string, path: string, options?: { recursive?: boolean }): Promise<void> {
    const files = this.requireFiles();
    await this.requireWritableAccess(skillId);
    await files.delete(skillPath(this.requireResolvedFiles(skillId).root, path), options);
  }
}
