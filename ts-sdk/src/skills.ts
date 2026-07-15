export type AgentSkillOrigin = 'built-in' | 'extension' | 'registry' | 'custom' | 'unknown';

export type AgentSkillAvailability = 'active' | 'disabled' | 'needs-setup' | 'blocked';

export type AgentSkillResourceAccess = 'none' | 'read-only' | 'read-write';

export interface AgentSkillResourceEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  lastModified?: string;
}

export interface AgentSkillRequirements {
  env: string[];
  bins: string[];
  os: string[];
}

export interface AgentSkillSummary {
  id: string;
  name: string;
  description: string;
  origin: AgentSkillOrigin;
  availability: AgentSkillAvailability;
  enabled: boolean;
  ready: boolean;
  documentAvailable: boolean;
  resourceAccess: AgentSkillResourceAccess;
  requirements: AgentSkillRequirements;
  missingRequirements: AgentSkillRequirements;
  emoji?: string;
  homepage?: string;
  installHints?: string[];
}

export interface AgentSkillDocument {
  skillId: string;
  content: string;
  sizeBytes?: number;
}

export interface AgentSkillUpdate {
  enabled?: boolean;
  apiKey?: string;
  env?: Record<string, string>;
}

export interface AgentSkillSearchItem {
  id: string;
  name: string;
  description?: string;
  version?: string | null;
  owner?: string;
}

export type AgentSkillInstallRequest =
  | { source: 'registry'; id: string; version?: string; force?: boolean }
  | { source: 'upload'; uploadId: string; id: string; force?: boolean; sha256?: string };

export interface AgentSkillInstallResult {
  ok: boolean;
  skillId?: string;
  message?: string;
  warnings?: string[];
}

export interface AgentSkillCreateRequest {
  id: string;
  content: string;
  directories?: string[];
}

export interface AgentSkillCreateResult {
  skillId: string;
}

export interface AgentSkillsProviderCapabilities {
  readDocument: boolean;
  configure: boolean;
  searchRegistry: boolean;
  installRegistry: boolean;
  installUpload: boolean;
  resources: boolean;
  createSkill: boolean;
}

export interface AgentSkillsProvider {
  readonly capabilities: AgentSkillsProviderCapabilities;
  list(): Promise<AgentSkillSummary[]>;
  readDocument(skillId: string): Promise<AgentSkillDocument | null>;
  update?(skillId: string, update: AgentSkillUpdate): Promise<void>;
  search?(query: string, limit?: number): Promise<AgentSkillSearchItem[]>;
  install?(request: AgentSkillInstallRequest): Promise<AgentSkillInstallResult>;
  createSkill?(request: AgentSkillCreateRequest): Promise<AgentSkillCreateResult>;
  listResources?(skillId: string, path?: string): Promise<AgentSkillResourceEntry[]>;
  readResource?(skillId: string, path: string): Promise<Uint8Array>;
  writeResource?(skillId: string, path: string, content: Uint8Array): Promise<void>;
  deleteResource?(skillId: string, path: string, options?: { recursive?: boolean }): Promise<void>;
  createResourceDirectory?(skillId: string, path: string): Promise<void>;
}
