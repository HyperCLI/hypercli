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

export interface OpenClawSkillsProviderOptions {
  readFile?: (path: string) => Promise<string>;
  exec?: (command: string) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
}

const MAX_SKILL_DOCUMENT_BYTES = 1024 * 1024;
const MAX_SKILL_RESOURCE_BYTES = 10 * 1024 * 1024;
const SKILL_RESOURCE_WRITE_CHUNK_BYTES = 48 * 1024;
const MAX_SKILL_DIRECTORIES = 64;
const MAX_SKILL_DIRECTORY_PATH_BYTES = 1024;

type OpenClawSkillResourceAction = 'list' | 'read' | 'write-start' | 'write-append' | 'write-finish' | 'write-abort' | 'delete' | 'mkdir';

interface OpenClawSkillResourceCommandInput {
  action: OpenClawSkillResourceAction;
  root: string;
  path: string;
  content?: Uint8Array;
  recursive?: boolean;
  writableRoots?: string[];
  uploadToken?: string;
}

type OpenClawSkillCreateAction = 'create-start' | 'create-append' | 'create-finish' | 'create-abort';

interface OpenClawSkillCreateCommandInput {
  action: OpenClawSkillCreateAction;
  root: string;
  id: string;
  createToken: string;
  directories?: string[];
  content?: Uint8Array;
}

function shellQuoteArgument(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function normalizeAbsolutePath(value: string): string {
  const normalized = value.trim().replace(/\\/g, '/').replace(/\/+$/, '');
  return normalized || '/';
}

function pathIsWithin(path: string, root: string | undefined): boolean {
  if (!root) return false;
  const normalizedPath = normalizeAbsolutePath(path);
  const normalizedRoot = normalizeAbsolutePath(root);
  return normalizedRoot === '/'
    ? normalizedPath.startsWith('/')
    : normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
}

function bytesToBase64(content: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < content.length; offset += 0x8000) {
    binary += String.fromCharCode(...content.subarray(offset, offset + 0x8000));
  }
  return globalThis.btoa(binary);
}

function base64ToBytes(content: string): Uint8Array {
  const binary = globalThis.atob(content);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function validateResourcePath(value: string, allowRoot = false): string {
  if (value.includes('\0')) throw new Error('Skill resource paths cannot contain NUL bytes.');
  const normalized = value.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  if (!normalized) {
    if (allowRoot) return '';
    throw new Error('A skill-relative resource path is required.');
  }
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized) || normalized.startsWith('//')) {
    throw new Error('Skill resource paths must be relative.');
  }
  const segments = normalized.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('Skill resource paths cannot contain empty or traversal segments.');
  }
  return segments.join('/');
}

export function buildOpenClawSkillResourceCommand(input: OpenClawSkillResourceCommandInput): string {
  const payload = {
    action: input.action,
    root: input.root,
    path: input.path,
    content: input.content ? bytesToBase64(input.content) : undefined,
    recursive: input.recursive === true,
    writableRoots: input.writableRoots ?? [],
    uploadToken: input.uploadToken,
    maxBytes: MAX_SKILL_RESOURCE_BYTES,
  };
  const script = [
    'const fs=require("node:fs"),p=require("node:path");',
    `const input=${JSON.stringify(payload)};`,
    'const root=fs.realpathSync(input.root);',
    'const inside=(value)=>value===root||value.startsWith(root+p.sep);',
    'if(input.action.startsWith("write-")||["delete","mkdir"].includes(input.action)){const allowed=input.writableRoots.flatMap((value)=>{try{return [fs.realpathSync(value)];}catch{return [];}});if(!allowed.some((value)=>root===value||root.startsWith(value+p.sep)))throw new Error("Writable skill root escapes the managed skills directories.");}',
    'const target=p.resolve(root,input.path||".");',
    'if(!inside(target))throw new Error("Skill resource path escapes its root.");',
    'const existingReal=(value)=>{const real=fs.realpathSync(value);if(!inside(real))throw new Error("Skill resource symlink escapes its root.");return real;};',
    'const writableTarget=()=>{if(!input.path)throw new Error("Cannot overwrite the skill root.");const parent=existingReal(p.dirname(target));if(!fs.statSync(parent).isDirectory())throw new Error("Skill resource parent is not a directory.");if(fs.existsSync(target)){const item=fs.lstatSync(target);if(item.isSymbolicLink())throw new Error("Cannot overwrite a symbolic link.");existingReal(target);if(!item.isFile())throw new Error("Skill resource is not a regular file.");}return parent;};',
    'const uploadPath=()=>{if(!/^[a-z0-9-]+$/i.test(input.uploadToken||""))throw new Error("Invalid skill upload token.");const parent=writableTarget();const file=p.join(parent,`.hypercli-upload-${input.uploadToken}`);if(!inside(file))throw new Error("Skill upload path escapes its root.");return file;};',
    'if(input.action==="list"){const dir=existingReal(target);const stat=fs.statSync(dir);if(!stat.isDirectory())throw new Error("Skill resource path is not a directory.");const entries=fs.readdirSync(dir,{withFileTypes:true}).flatMap((entry)=>{const child=p.join(dir,entry.name);let real,childStat;try{real=existingReal(child);childStat=fs.statSync(real);}catch{return [];}if(!childStat.isFile()&&!childStat.isDirectory())return [];const relative=p.relative(root,child).split(p.sep).join("/");return [{name:entry.name,path:relative,type:childStat.isDirectory()?"directory":"file",...(childStat.isFile()?{size:childStat.size}:{}) ,lastModified:childStat.mtime.toISOString()}];});process.stdout.write(JSON.stringify(entries));}',
    'else if(input.action==="read"){const file=existingReal(target);const stat=fs.statSync(file);if(!stat.isFile())throw new Error("Skill resource is not a regular file.");if(stat.size>input.maxBytes)throw new Error("Skill resource exceeds the read limit.");process.stdout.write(JSON.stringify({content:fs.readFileSync(file).toString("base64")}));}',
    'else if(input.action==="write-start"){const file=uploadPath();fs.writeFileSync(file,"",{flag:"wx"});process.stdout.write("{}");}',
    'else if(input.action==="write-append"){const file=uploadPath();const item=fs.lstatSync(file);if(item.isSymbolicLink()||!item.isFile())throw new Error("Invalid skill upload file.");const bytes=Buffer.from(input.content||"","base64");if(item.size+bytes.length>input.maxBytes)throw new Error("Skill resource exceeds the write limit.");fs.appendFileSync(file,bytes);process.stdout.write("{}");}',
    'else if(input.action==="write-finish"){const file=uploadPath();const item=fs.lstatSync(file);if(item.isSymbolicLink()||!item.isFile())throw new Error("Invalid skill upload file.");fs.renameSync(file,target);process.stdout.write("{}");}',
    'else if(input.action==="write-abort"){const file=uploadPath();if(fs.existsSync(file)){const item=fs.lstatSync(file);if(item.isFile()||item.isSymbolicLink())fs.unlinkSync(file);}process.stdout.write("{}");}',
    'else if(input.action==="delete"){if(!input.path)throw new Error("Cannot delete the skill root.");if(!fs.existsSync(target))throw new Error("Skill resource does not exist.");const item=fs.lstatSync(target);if(!item.isSymbolicLink())existingReal(target);fs.rmSync(target,{recursive:input.recursive,force:false});process.stdout.write("{}");}',
    'else if(input.action==="mkdir"){if(!input.path)throw new Error("Cannot create the skill root.");const parent=existingReal(p.dirname(target));if(!fs.statSync(parent).isDirectory())throw new Error("Skill resource parent is not a directory.");fs.mkdirSync(target);process.stdout.write("{}");}',
    'else throw new Error("Unsupported skill resource operation.");',
  ].join('');
  return `node -e ${shellQuoteArgument(script)}`;
}

export function buildOpenClawSkillCreateCommand(input: OpenClawSkillCreateCommandInput): string {
  const payload = {
    action: input.action,
    root: input.root,
    id: input.id,
    createToken: input.createToken,
    directories: input.directories ?? [],
    content: input.content ? bytesToBase64(input.content) : undefined,
    maxBytes: MAX_SKILL_DOCUMENT_BYTES,
  };
  const script = [
    'const fs=require("node:fs"),p=require("node:path");',
    `const input=${JSON.stringify(payload)};`,
    'if(!/^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/.test(input.id))throw new Error("Invalid skill identifier.");',
    'if(!/^[a-z0-9-]+$/i.test(input.createToken))throw new Error("Invalid skill create token.");',
    'fs.mkdirSync(input.root,{recursive:true,mode:0o700});',
    'const root=fs.realpathSync(input.root);',
    'if(!fs.statSync(root).isDirectory())throw new Error("Managed skills root is not a directory.");',
    'const inside=(base,value)=>value===base||value.startsWith(base+p.sep);',
    'const target=p.join(root,input.id);',
    'const stage=p.join(root,`.hypercli-create-${input.createToken}`);',
    'if(p.dirname(target)!==root||p.dirname(stage)!==root)throw new Error("Skill create path escapes the managed root.");',
    'const requireStage=()=>{const item=fs.lstatSync(stage);if(item.isSymbolicLink()||!item.isDirectory())throw new Error("Invalid staged skill directory.");const real=fs.realpathSync(stage);if(!inside(root,real))throw new Error("Staged skill directory escapes the managed root.");return real;};',
    'if(input.action==="create-start"){if(fs.existsSync(target))throw new Error("A skill with this ID already exists.");fs.mkdirSync(stage,{mode:0o700});try{const realStage=requireStage();for(const directory of input.directories){const destination=p.resolve(realStage,directory);if(!inside(realStage,destination))throw new Error("Skill directory escapes its root.");fs.mkdirSync(destination,{recursive:true});}fs.writeFileSync(p.join(realStage,"SKILL.md"),"",{flag:"wx",mode:0o600});process.stdout.write("{}");}catch(error){fs.rmSync(stage,{recursive:true,force:true});throw error;}}',
    'else if(input.action==="create-append"){const realStage=requireStage();const file=p.join(realStage,"SKILL.md");const item=fs.lstatSync(file);if(item.isSymbolicLink()||!item.isFile())throw new Error("Invalid staged skill document.");const bytes=Buffer.from(input.content||"","base64");if(item.size+bytes.length>input.maxBytes)throw new Error("Skill document exceeds the write limit.");fs.appendFileSync(file,bytes);process.stdout.write("{}");}',
    'else if(input.action==="create-finish"){const realStage=requireStage();const file=p.join(realStage,"SKILL.md");const item=fs.lstatSync(file);if(item.isSymbolicLink()||!item.isFile()||item.size===0)throw new Error("Skill document is empty or invalid.");if(fs.existsSync(target))throw new Error("A skill with this ID already exists.");fs.renameSync(realStage,target);process.stdout.write(JSON.stringify({skillId:input.id}));}',
    'else if(input.action==="create-abort"){if(fs.existsSync(stage)){const item=fs.lstatSync(stage);if(item.isDirectory()&&!item.isSymbolicLink()){const real=fs.realpathSync(stage);if(inside(root,real))fs.rmSync(real,{recursive:true,force:true});}}process.stdout.write("{}");}',
    'else throw new Error("Unsupported skill create operation.");',
  ].join('');
  return `node -e ${shellQuoteArgument(script)}`;
}

export function buildOpenClawSkillDocumentReadCommand(path: string): string {
  const script = [
    'const fs=require("node:fs");',
    `const file=${JSON.stringify(path)};`,
    'const stat=fs.statSync(file);',
    'if(!stat.isFile())throw new Error("Skill document is not a regular file.");',
    `if(stat.size>${MAX_SKILL_DOCUMENT_BYTES})throw new Error("Skill document exceeds the 1 MiB read limit.");`,
    'process.stdout.write(fs.readFileSync(file,"utf8"));',
  ].join('');
  return `node -e ${shellQuoteArgument(script)}`;
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
  options: { resources?: boolean; workspaceDir?: string; managedSkillsDir?: string } = {},
): AgentSkillSummary {
  const required = requirements(entry.requirements);
  if (required.env.length === 0 && entry.primaryEnv) required.env = [entry.primaryEnv];
  if (required.bins.length === 0) required.bins = entry.install.flatMap((option) => option.bins ?? []);
  const missing = requirements(entry.missing);
  const skillOrigin = origin(entry);
  let resourceAccess: AgentSkillResourceAccess = 'none';
  if (options.resources && entry.baseDir) {
    const managed = pathIsWithin(entry.baseDir, options.managedSkillsDir);
    const workspaceSkills = options.workspaceDir
      ? pathIsWithin(entry.baseDir, `${normalizeAbsolutePath(options.workspaceDir)}/skills`)
      : false;
    resourceAccess = skillOrigin === 'custom' && (managed || workspaceSkills) ? 'read-write' : 'read-only';
  }
  return {
    id: entry.skillKey,
    name: entry.name || entry.skillKey,
    description: entry.description || 'Skill instructions',
    origin: skillOrigin,
    availability: availability(entry),
    enabled: !entry.disabled,
    ready: !entry.disabled && entry.eligible && !entry.blockedByAllowlist && !entry.blockedByAgentFilter,
    documentAvailable: Boolean(entry.filePath || entry.skillCard?.present),
    resourceAccess,
    requirements: required,
    missingRequirements: missing,
    emoji: entry.emoji,
    homepage: entry.homepage,
    installHints: entry.install.map((option) => option.label).filter(Boolean),
  };
}

export class OpenClawSkillsProvider implements AgentSkillsProvider {
  readonly capabilities: AgentSkillsProviderCapabilities;

  private readonly entries = new Map<string, GatewaySkillStatusEntry>();
  private readonly resourceAccess = new Map<string, AgentSkillResourceAccess>();
  private writableRoots: string[] = [];
  private agentId: string | undefined;

  constructor(
    private readonly client: OpenClawSkillsClient,
    private readonly options: OpenClawSkillsProviderOptions = {},
  ) {
    this.capabilities = {
      readDocument: true,
      configure: true,
      searchRegistry: true,
      installRegistry: true,
      installUpload: false,
      resources: Boolean(options.exec),
      createSkill: Boolean(options.exec),
    };
  }

  async list(): Promise<AgentSkillSummary[]> {
    const report = await this.client.skillsStatus();
    this.agentId = report.agentId;
    this.entries.clear();
    this.resourceAccess.clear();
    this.writableRoots = [report.managedSkillsDir, report.workspaceDir ? `${normalizeAbsolutePath(report.workspaceDir)}/skills` : undefined]
      .filter((path): path is string => Boolean(path));
    report.skills.forEach((entry) => this.entries.set(entry.skillKey, entry));
    const summaries = report.skills.map((entry) => normalizeOpenClawSkill(entry, {
      resources: this.capabilities.resources,
      workspaceDir: report.workspaceDir,
      managedSkillsDir: report.managedSkillsDir,
    }));
    summaries.forEach((summary) => this.resourceAccess.set(summary.id, summary.resourceAccess));
    return summaries.sort((a, b) => a.name.localeCompare(b.name));
  }

  async readDocument(skillId: string): Promise<AgentSkillDocument | null> {
    if (this.entries.size === 0) await this.list();
    const entry = this.entries.get(skillId);
    if (!entry) return null;

    let fileReadError: unknown = null;
    if (entry.filePath && this.options.readFile) {
      try {
        const content = await this.options.readFile(entry.filePath);
        return { skillId, content };
      } catch (error) {
        fileReadError = error;
      }
    }

    if (entry.filePath && this.options.exec) {
      try {
        const result = await this.options.exec(buildOpenClawSkillDocumentReadCommand(entry.filePath));
        if (result.exitCode !== 0) throw new Error(result.stderr || `Could not read ${skillId} instructions.`);
        return { skillId, content: result.stdout };
      } catch (error) {
        fileReadError = error;
      }
    }

    if (!entry.skillCard?.present) {
      if (fileReadError) throw fileReadError;
      return null;
    }
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
    if (!this.options.exec) throw new Error('Creating skills is unavailable for this agent.');
    const id = request.id.trim();
    if (!/^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/.test(id)) {
      throw new Error('Skill IDs must be lowercase slugs between 1 and 80 characters.');
    }
    if (!request.content.trim()) throw new Error('SKILL.md cannot be empty.');
    const content = new globalThis.TextEncoder().encode(request.content);
    if (content.length > MAX_SKILL_DOCUMENT_BYTES) throw new Error('SKILL.md exceeds the 1 MiB write limit.');
    if ((request.directories?.length ?? 0) > MAX_SKILL_DIRECTORIES) {
      throw new Error(`A skill can contain at most ${MAX_SKILL_DIRECTORIES} empty directories during creation.`);
    }
    const directories = [...new Set((request.directories ?? []).map((path) => validateResourcePath(path)))]
      .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
    for (const directory of directories) {
      if (new globalThis.TextEncoder().encode(directory).length > MAX_SKILL_DIRECTORY_PATH_BYTES) {
        throw new Error('Skill directory paths cannot exceed 1 KiB.');
      }
      if (directory.split('/').some((segment) => segment.toLowerCase() === 'skill.md')) {
        throw new Error('SKILL.md must be a file, not a directory.');
      }
    }

    const report = await this.client.skillsStatus();
    if (report.skills.some((skill) => skill.skillKey === id)) throw new Error('A skill with this ID already exists.');
    if (!report.managedSkillsDir?.trim()) throw new Error('The managed skills directory is unavailable.');
    const createToken = globalThis.crypto.randomUUID();
    const baseInput = { root: report.managedSkillsDir, id, createToken };
    let staged = false;
    try {
      await this.executeCreate({ action: 'create-start', ...baseInput, directories });
      staged = true;
      for (let offset = 0; offset < content.length; offset += SKILL_RESOURCE_WRITE_CHUNK_BYTES) {
        await this.executeCreate({
          action: 'create-append',
          ...baseInput,
          content: content.subarray(offset, offset + SKILL_RESOURCE_WRITE_CHUNK_BYTES),
        });
      }
      const result = await this.executeCreate<AgentSkillCreateResult>({ action: 'create-finish', ...baseInput });
      this.entries.clear();
      this.resourceAccess.clear();
      this.writableRoots = [];
      return result;
    } catch (error) {
      if (staged) await this.executeCreate({ action: 'create-abort', ...baseInput }).catch(() => undefined);
      throw error;
    }
  }

  private async resourceEntry(skillId: string): Promise<GatewaySkillStatusEntry & { baseDir: string }> {
    if (this.entries.size === 0) await this.list();
    const entry = this.entries.get(skillId);
    if (!entry?.baseDir) throw new Error(`Skill resources are unavailable for ${skillId}.`);
    if (!this.options.exec) throw new Error('Skill resources are unavailable for this agent.');
    return entry as GatewaySkillStatusEntry & { baseDir: string };
  }

  private async executeResource<T>(input: OpenClawSkillResourceCommandInput): Promise<T> {
    if (!this.options.exec) throw new Error('Skill resources are unavailable for this agent.');
    const result = await this.options.exec(buildOpenClawSkillResourceCommand(input));
    if (result.exitCode !== 0) throw new Error(result.stderr || 'Skill resource operation failed.');
    try {
      return JSON.parse(result.stdout || '{}') as T;
    } catch {
      throw new Error('Skill resource operation returned an invalid response.');
    }
  }

  private async executeCreate<T = Record<string, never>>(input: OpenClawSkillCreateCommandInput): Promise<T> {
    if (!this.options.exec) throw new Error('Creating skills is unavailable for this agent.');
    const result = await this.options.exec(buildOpenClawSkillCreateCommand(input));
    if (result.exitCode !== 0) throw new Error(result.stderr || 'Skill creation failed.');
    try {
      return JSON.parse(result.stdout || '{}') as T;
    } catch {
      throw new Error('Skill creation returned an invalid response.');
    }
  }

  private assertWritable(skillId: string): void {
    if (this.resourceAccess.get(skillId) !== 'read-write') {
      throw new Error('This skill is read-only.');
    }
  }

  async listResources(skillId: string, path = ''): Promise<AgentSkillResourceEntry[]> {
    const entry = await this.resourceEntry(skillId);
    const relativePath = validateResourcePath(path, true);
    return this.executeResource<AgentSkillResourceEntry[]>({ action: 'list', root: entry.baseDir, path: relativePath });
  }

  async readResource(skillId: string, path: string): Promise<Uint8Array> {
    const entry = await this.resourceEntry(skillId);
    const relativePath = validateResourcePath(path);
    const result = await this.executeResource<{ content: string }>({ action: 'read', root: entry.baseDir, path: relativePath });
    return base64ToBytes(result.content);
  }

  async writeResource(skillId: string, path: string, content: Uint8Array): Promise<void> {
    const entry = await this.resourceEntry(skillId);
    this.assertWritable(skillId);
    const relativePath = validateResourcePath(path);
    if (content.length > MAX_SKILL_RESOURCE_BYTES) throw new Error('Skill resource exceeds the 10 MiB write limit.');
    const uploadToken = globalThis.crypto.randomUUID();
    const baseInput = { root: entry.baseDir, path: relativePath, writableRoots: this.writableRoots, uploadToken };
    try {
      await this.executeResource({ action: 'write-start', ...baseInput });
      for (let offset = 0; offset < content.length; offset += SKILL_RESOURCE_WRITE_CHUNK_BYTES) {
        await this.executeResource({
          action: 'write-append',
          ...baseInput,
          content: content.subarray(offset, offset + SKILL_RESOURCE_WRITE_CHUNK_BYTES),
        });
      }
      await this.executeResource({ action: 'write-finish', ...baseInput });
    } catch (error) {
      await this.executeResource({ action: 'write-abort', ...baseInput }).catch(() => undefined);
      throw error;
    }
  }

  async deleteResource(skillId: string, path: string, options?: { recursive?: boolean }): Promise<void> {
    const entry = await this.resourceEntry(skillId);
    this.assertWritable(skillId);
    const relativePath = validateResourcePath(path);
    await this.executeResource({ action: 'delete', root: entry.baseDir, path: relativePath, recursive: options?.recursive, writableRoots: this.writableRoots });
  }

  async createResourceDirectory(skillId: string, path: string): Promise<void> {
    const entry = await this.resourceEntry(skillId);
    this.assertWritable(skillId);
    const relativePath = validateResourcePath(path);
    await this.executeResource({ action: 'mkdir', root: entry.baseDir, path: relativePath, writableRoots: this.writableRoots });
  }
}
