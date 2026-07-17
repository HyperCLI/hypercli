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
  AgentSkillRecoverRequest,
  AgentSkillRecoverResult,
  AgentSkillRecoveryCandidate,
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
const MAX_SKILL_RECOVERY_ENTRIES = 2048;
const MAX_SKILL_RECOVERY_BYTES = 100 * 1024 * 1024;
const LOOSE_WORKSPACE_SKILL_CANDIDATE_ID = 'workspace-skills-root';

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

interface OpenClawSkillRecoverCommandInput {
  workspaceDir: string;
  managedSkillsDir: string;
  skillId: string;
  paths: string[];
  recoveryToken: string;
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

function isLooseWorkspaceSkillEntry(entry: GatewaySkillStatusEntry, workspaceDir: string | undefined): boolean {
  if (!workspaceDir || !entry.baseDir || !entry.filePath) return false;
  const root = `${normalizeAbsolutePath(workspaceDir)}/skills`;
  return normalizeAbsolutePath(entry.baseDir) === root
    && normalizeAbsolutePath(entry.filePath) === `${root}/SKILL.md`;
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

export function buildOpenClawSkillRecoveryScanCommand(workspaceDir: string): string {
  const payload = {
    workspaceDir,
    candidateId: LOOSE_WORKSPACE_SKILL_CANDIDATE_ID,
    maxDocumentBytes: MAX_SKILL_DOCUMENT_BYTES,
    maxResourceBytes: MAX_SKILL_RESOURCE_BYTES,
    maxEntries: MAX_SKILL_RECOVERY_ENTRIES,
  };
  const script = [
    'const fs=require("node:fs"),p=require("node:path");',
    `const input=${JSON.stringify(payload)};`,
    '(()=>{',
    'if(!fs.existsSync(input.workspaceDir)){process.stdout.write("[]");return;}',
    'const workspace=fs.realpathSync(input.workspaceDir);const rootPath=p.join(workspace,"skills");',
    'if(!fs.existsSync(rootPath)){process.stdout.write("[]");return;}',
    'const rootItem=fs.lstatSync(rootPath);if(rootItem.isSymbolicLink()||!rootItem.isDirectory())throw new Error("Workspace skills root is invalid.");',
    'const root=fs.realpathSync(rootPath);if(p.dirname(root)!==workspace)throw new Error("Workspace skills root escapes the workspace.");',
    'const document=p.join(root,"SKILL.md");if(!fs.existsSync(document)){process.stdout.write("[]");return;}',
    'const documentItem=fs.lstatSync(document);if(documentItem.isSymbolicLink()||!documentItem.isFile())throw new Error("Loose SKILL.md is not a regular file.");',
    'if(documentItem.size===0||documentItem.size>input.maxDocumentBytes)throw new Error("Loose SKILL.md is empty or exceeds the 1 MiB limit.");',
    'const content=fs.readFileSync(document,"utf8");const frontmatter=content.match(/^---\\r?\\n([\\s\\S]*?)\\r?\\n---(?:\\r?\\n|$)/)?.[1]||"";',
    'const field=(key)=>{const line=frontmatter.split(/\\r?\\n/).find((value)=>new RegExp(`^\\\\s*${key}\\\\s*:`,"i").test(value));if(!line)return "";let value=line.slice(line.indexOf(":")+1).trim();if(value.startsWith(String.fromCharCode(34))&&value.endsWith(String.fromCharCode(34))){try{value=JSON.parse(value);}catch{}}else if(value.startsWith("\'")&&value.endsWith("\'")){value=value.slice(1,-1);}return String(value).trim();};',
    'const rawName=field("name");const heading=content.match(/^#\\s+(.+)$/m)?.[1]?.trim()||"";const name=(rawName||heading||"Unorganized skill").slice(0,200);',
    'const suggestedSkillId=(rawName||heading||"recovered-skill").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,80)||"recovered-skill";',
    'const description=(field("description")||"Skill files created directly in the workspace skills folder.").replace(/[\\r\\n]+/g," ").slice(0,500);',
    'const standard=new Set(["assets","references","scripts"]);',
    'const inspect=(target)=>{let count=0;const visit=(value)=>{if(++count>input.maxEntries)throw new Error("Resource contains too many entries.");const item=fs.lstatSync(value);if(item.isSymbolicLink())throw new Error("Symbolic links cannot be recovered.");if(item.isFile()){if(item.size>input.maxResourceBytes)throw new Error("Resource exceeds the 10 MiB limit.");return;}if(!item.isDirectory())throw new Error("Only regular files and directories can be recovered.");for(const child of fs.readdirSync(value))visit(p.join(value,child));};try{visit(target);return null;}catch(error){return error instanceof Error?error.message:"Resource cannot be recovered.";}};',
    'const entries=fs.readdirSync(root,{withFileTypes:true}).filter((entry)=>entry.name!=="SKILL.md"&&!entry.name.startsWith(".hypercli-")).map((entry)=>{const target=p.join(root,entry.name);let reason;if(entry.isSymbolicLink())reason="Symbolic links cannot be recovered.";else if(entry.isDirectory()&&fs.existsSync(p.join(target,"SKILL.md")))reason="This folder is already a separate skill.";else if(!entry.isFile()&&!entry.isDirectory())reason="Only regular files and directories can be recovered.";else reason=inspect(target)||undefined;return {name:entry.name,path:entry.name,type:entry.isDirectory()?"directory":"file",selectedByDefault:!reason&&entry.isDirectory()&&standard.has(entry.name.toLowerCase()),selectable:!reason,...(reason?{reason}:{})};}).sort((a,b)=>a.name.localeCompare(b.name));',
    'process.stdout.write(JSON.stringify([{id:input.candidateId,name,description,suggestedSkillId,entries}]));',
    '})();',
  ].join('');
  return `node -e ${shellQuoteArgument(script)}`;
}

export function buildOpenClawSkillRecoverCommand(input: OpenClawSkillRecoverCommandInput): string {
  const payload = {
    ...input,
    maxDocumentBytes: MAX_SKILL_DOCUMENT_BYTES,
    maxResourceBytes: MAX_SKILL_RESOURCE_BYTES,
    maxEntries: MAX_SKILL_RECOVERY_ENTRIES,
    maxTotalBytes: MAX_SKILL_RECOVERY_BYTES,
  };
  const script = [
    'const fs=require("node:fs"),p=require("node:path");',
    `const input=${JSON.stringify(payload)};`,
    'if(!/^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/.test(input.skillId))throw new Error("Invalid skill identifier.");',
    'if(!/^[a-z0-9-]+$/i.test(input.recoveryToken))throw new Error("Invalid skill recovery token.");',
    'if(!Array.isArray(input.paths)||input.paths.some((name)=>typeof name!=="string"||!name||name==="SKILL.md"||name.startsWith(".")||p.basename(name)!==name))throw new Error("Invalid recovery path.");',
    'input.paths=[...new Set(input.paths)];',
    'const workspace=fs.realpathSync(input.workspaceDir);const sourcePath=p.join(workspace,"skills");const sourceItem=fs.lstatSync(sourcePath);if(sourceItem.isSymbolicLink()||!sourceItem.isDirectory())throw new Error("Workspace skills root is invalid.");const source=fs.realpathSync(sourcePath);',
    'if(p.dirname(source)!==workspace)throw new Error("Workspace skills root is invalid.");',
    'fs.mkdirSync(input.managedSkillsDir,{recursive:true,mode:0o700});const managed=fs.realpathSync(input.managedSkillsDir);',
    'if(source===managed||source.startsWith(managed+p.sep)||managed.startsWith(source+p.sep))throw new Error("Skill recovery roots must be separate.");',
    'const target=p.join(managed,input.skillId);const stage=p.join(managed,`.hypercli-recover-${input.recoveryToken}`);const quarantine=p.join(source,`.hypercli-recover-${input.recoveryToken}`);',
    'if(p.dirname(target)!==managed||p.dirname(stage)!==managed||p.dirname(quarantine)!==source)throw new Error("Skill recovery path escapes its root.");',
    'if(fs.existsSync(target))throw new Error("A skill with this ID already exists.");if(fs.existsSync(stage)||fs.existsSync(quarantine))throw new Error("Skill recovery staging already exists.");',
    'let entries=0,totalBytes=0;const validate=(value,isDocument=false)=>{if(++entries>input.maxEntries)throw new Error("Skill recovery contains too many entries.");const item=fs.lstatSync(value);if(item.isSymbolicLink())throw new Error("Symbolic links cannot be recovered.");if(item.isFile()){const limit=isDocument?input.maxDocumentBytes:input.maxResourceBytes;if(item.size===0&&isDocument)throw new Error("SKILL.md cannot be empty.");if(item.size>limit)throw new Error(isDocument?"SKILL.md exceeds the 1 MiB limit.":"A skill resource exceeds the 10 MiB limit.");totalBytes+=item.size;if(totalBytes>input.maxTotalBytes)throw new Error("Skill recovery exceeds the 100 MiB total limit.");return;}if(!item.isDirectory())throw new Error("Only regular files and directories can be recovered.");for(const child of fs.readdirSync(value)){if(child.toLowerCase()==="skill.md")throw new Error("A selected folder contains another skill.");validate(p.join(value,child));}};',
    'const document=p.join(source,"SKILL.md");if(!fs.existsSync(document))throw new Error("Loose workspace SKILL.md no longer exists.");validate(document,true);for(const name of input.paths){const value=p.join(source,name);if(!fs.existsSync(value))throw new Error(`Recovery item no longer exists: ${name}`);validate(value);}',
    'const copy=(from,to)=>{const item=fs.lstatSync(from);if(item.isSymbolicLink())throw new Error("Symbolic links cannot be recovered.");if(item.isFile()){fs.copyFileSync(from,to,fs.constants.COPYFILE_EXCL);fs.chmodSync(to,item.mode&0o777);return;}if(!item.isDirectory())throw new Error("Only regular files and directories can be recovered.");fs.mkdirSync(to,{mode:item.mode&0o777});for(const child of fs.readdirSync(from))copy(p.join(from,child),p.join(to,child));};',
    'let committed=false;const moved=[];try{fs.mkdirSync(quarantine,{mode:0o700});for(const name of ["SKILL.md",...input.paths]){fs.renameSync(p.join(source,name),p.join(quarantine,name));moved.push(name);}fs.mkdirSync(stage,{mode:0o700});copy(p.join(quarantine,"SKILL.md"),p.join(stage,"SKILL.md"));for(const name of input.paths)copy(p.join(quarantine,name),p.join(stage,name));if(fs.existsSync(target))throw new Error("A skill with this ID already exists.");fs.renameSync(stage,target);committed=true;try{fs.rmSync(quarantine,{recursive:true,force:true});}catch{}process.stdout.write(JSON.stringify({skillId:input.skillId}));}catch(error){if(!committed){for(const name of [...moved].reverse()){const backup=p.join(quarantine,name),original=p.join(source,name);if(fs.existsSync(backup)&&!fs.existsSync(original))fs.renameSync(backup,original);}if(fs.existsSync(stage))fs.rmSync(stage,{recursive:true,force:true});if(fs.existsSync(quarantine)&&fs.readdirSync(quarantine).length===0)fs.rmdirSync(quarantine);}throw error;}',
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
  if (options.resources && entry.baseDir && !isLooseWorkspaceSkillEntry(entry, options.workspaceDir)) {
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
      recoverSkill: Boolean(options.exec),
    };
  }

  async list(): Promise<AgentSkillSummary[]> {
    const report = await this.client.skillsStatus();
    this.agentId = report.agentId;
    this.entries.clear();
    this.resourceAccess.clear();
    this.writableRoots = [report.managedSkillsDir, report.workspaceDir ? `${normalizeAbsolutePath(report.workspaceDir)}/skills` : undefined]
      .filter((path): path is string => Boolean(path));
    const catalogSkills = report.skills.filter((entry) => !isLooseWorkspaceSkillEntry(entry, report.workspaceDir));
    catalogSkills.forEach((entry) => this.entries.set(entry.skillKey, entry));
    const summaries = catalogSkills.map((entry) => normalizeOpenClawSkill(entry, {
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

  async listRecoveryCandidates(): Promise<AgentSkillRecoveryCandidate[]> {
    if (!this.options.exec) return [];
    const report = await this.client.skillsStatus();
    if (!report.workspaceDir?.trim() || !report.managedSkillsDir?.trim()) return [];
    const result = await this.options.exec(buildOpenClawSkillRecoveryScanCommand(report.workspaceDir));
    if (result.exitCode !== 0) throw new Error(result.stderr || 'Could not inspect workspace skill files.');
    try {
      const candidates = JSON.parse(result.stdout || '[]') as AgentSkillRecoveryCandidate[];
      return Array.isArray(candidates) ? candidates : [];
    } catch {
      throw new Error('Workspace skill recovery returned an invalid response.');
    }
  }

  async recoverSkill(request: AgentSkillRecoverRequest): Promise<AgentSkillRecoverResult> {
    if (!this.options.exec) throw new Error('Recovering workspace skills is unavailable for this agent.');
    if (request.candidateId !== LOOSE_WORKSPACE_SKILL_CANDIDATE_ID) throw new Error('Unknown workspace skill recovery candidate.');
    const skillId = request.skillId.trim();
    if (!/^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/.test(skillId)) {
      throw new Error('Skill IDs must be lowercase slugs between 1 and 80 characters.');
    }
    const paths = [...new Set(request.paths.map((path) => validateResourcePath(path)))]
      .filter((path) => path !== 'SKILL.md');
    if (paths.some((path) => path.includes('/'))) throw new Error('Recovery items must be direct children of the workspace skills folder.');

    const report = await this.client.skillsStatus();
    if (!report.workspaceDir?.trim()) throw new Error('The workspace directory is unavailable.');
    if (!report.managedSkillsDir?.trim()) throw new Error('The managed skills directory is unavailable.');
    const sourceRoot = `${normalizeAbsolutePath(report.workspaceDir)}/skills`;
    const collision = report.skills.some((skill) => skill.skillKey === skillId
      && !(normalizeAbsolutePath(skill.baseDir ?? '') === sourceRoot
        && normalizeAbsolutePath(skill.filePath ?? '') === `${sourceRoot}/SKILL.md`));
    if (collision) throw new Error('A skill with this ID already exists.');

    const result = await this.options.exec(buildOpenClawSkillRecoverCommand({
      workspaceDir: report.workspaceDir,
      managedSkillsDir: report.managedSkillsDir,
      skillId,
      paths,
      recoveryToken: globalThis.crypto.randomUUID(),
    }));
    if (result.exitCode !== 0) throw new Error(result.stderr || 'Workspace skill recovery failed.');
    try {
      const recovered = JSON.parse(result.stdout || '{}') as AgentSkillRecoverResult;
      if (recovered.skillId !== skillId) throw new Error();
      this.entries.clear();
      this.resourceAccess.clear();
      this.writableRoots = [];
      return recovered;
    } catch {
      throw new Error('Workspace skill recovery returned an invalid response.');
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
