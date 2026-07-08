/**
 * Workspaces API - shared Markdown-backed workspace surfaces.
 */
import { requestWithRetry } from './http.js';
import { APIError } from './errors.js';
import { getAgentsApiBaseUrl } from './config.js';

function envValue(key: string): string | undefined {
  const maybeProcess = globalThis as unknown as { process?: { env?: Record<string, string | undefined> } };
  return maybeProcess.process?.env?.[key];
}

export function deriveWorkspacesApiBase(agentsApiBase?: string): string {
  const configured = envValue('HYPER_WORKSPACES_API_BASE');
  const raw = (configured || agentsApiBase || getAgentsApiBaseUrl()).replace(/\/$/, '');
  const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
  let path = url.pathname.replace(/\/$/, '');
  if (path.endsWith('/workspaces')) {
    return `${url.protocol}//${url.host}${path}`;
  }
  if (path.endsWith('/agents')) {
    path = path.slice(0, -'/agents'.length);
  }
  return `${url.protocol}//${url.host}${path}/workspaces`;
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  description: string | null;
}

export interface WorkspaceGrant {
  id: string;
  workspaceId: string;
  subjectType: string;
  subjectId: string;
  role: string;
}

export interface WorkspaceFile {
  id: string;
  workspaceId: string;
  path: string;
  displayName: string;
  currentVersionId: string | null;
  fileState: string;
  uploadStatus: string | null;
  projectionStatus: string | null;
}

export interface WorkspaceManifest {
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  snapshotId: string;
  basePath: string;
  projections: Array<Record<string, any>>;
}

export interface WorkspaceDownloadUrl {
  fileId: string;
  fileVersionId: string;
  sourcePath: string;
  sourceS3Key: string;
  s3Bucket: string;
  s3Endpoint: string;
  url: string | null;
  downloadCommand: string;
}

export interface WorkspaceSubjectOptions {
  userId?: string;
  agentId?: string;
}

function workspaceFromDict(data: any): Workspace {
  return {
    id: String(data?.id || ''),
    name: data?.name || '',
    slug: data?.slug || '',
    description: data?.description ?? null,
  };
}

function grantFromDict(data: any): WorkspaceGrant {
  return {
    id: String(data?.id || ''),
    workspaceId: String(data?.workspace_id || data?.workspaceId || ''),
    subjectType: data?.subject_type || data?.subjectType || '',
    subjectId: data?.subject_id || data?.subjectId || '',
    role: data?.role || '',
  };
}

function fileFromDict(data: any): WorkspaceFile {
  return {
    id: String(data?.id || ''),
    workspaceId: String(data?.workspace_id || data?.workspaceId || ''),
    path: data?.path || '',
    displayName: data?.display_name || data?.displayName || '',
    currentVersionId: data?.current_version_id || data?.currentVersionId || null,
    fileState: data?.file_state || data?.fileState || '',
    uploadStatus: data?.upload_status || data?.uploadStatus || null,
    projectionStatus: data?.projection_status || data?.projectionStatus || null,
  };
}

function manifestFromDict(data: any): WorkspaceManifest {
  return {
    workspaceId: String(data?.workspace_id || data?.workspaceId || ''),
    workspaceName: data?.workspace_name || data?.workspaceName || '',
    workspaceSlug: data?.workspace_slug || data?.workspaceSlug || '',
    snapshotId: data?.snapshot_id || data?.snapshotId || '',
    basePath: data?.base_path || data?.basePath || '',
    projections: Array.isArray(data?.projections) ? data.projections : [],
  };
}

function downloadUrlFromDict(data: any): WorkspaceDownloadUrl {
  return {
    fileId: String(data?.file_id || data?.fileId || ''),
    fileVersionId: String(data?.file_version_id || data?.fileVersionId || ''),
    sourcePath: data?.source_path || data?.sourcePath || '',
    sourceS3Key: data?.source_s3_key || data?.sourceS3Key || '',
    s3Bucket: data?.s3_bucket || data?.s3Bucket || '',
    s3Endpoint: data?.s3_endpoint || data?.s3Endpoint || '',
    url: data?.url ?? null,
    downloadCommand: data?.download_command || data?.downloadCommand || '',
  };
}

async function handleResponse<T = any>(response: Response): Promise<T> {
  if (response.status >= 400) {
    let detail = response.statusText;
    try {
      const payload: any = await response.json();
      detail = payload.detail || detail;
    } catch {
      detail = await response.text();
    }
    throw new APIError(response.status, detail);
  }
  return (await response.json()) as T;
}

export class WorkspacesAPI {
  private apiBase: string;
  private apiKey: string;
  private timeout: number;

  constructor(apiKey: string, options: { apiBase?: string; agentsApiBase?: string; timeout?: number } = {}) {
    if (!apiKey) {
      throw new Error('API key required for Workspaces API');
    }
    this.apiKey = apiKey;
    this.apiBase = (options.apiBase || deriveWorkspacesApiBase(options.agentsApiBase)).replace(/\/$/, '');
    this.timeout = options.timeout || 30000;
  }

  private headers(subject: WorkspaceSubjectOptions = {}): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
    if (subject.userId) headers['X-User-Id'] = subject.userId;
    if (subject.agentId) headers['X-Agent-Id'] = subject.agentId;
    return headers;
  }

  private async request<T = any>(
    method: string,
    path: string,
    subject: WorkspaceSubjectOptions = {},
    body?: any,
  ): Promise<T> {
    const response = await requestWithRetry({
      method,
      url: `${this.apiBase}${path}`,
      headers: this.headers(subject),
      body,
      timeout: this.timeout,
    });
    return handleResponse<T>(response);
  }

  async list(subject: WorkspaceSubjectOptions = {}): Promise<Workspace[]> {
    const data = await this.request<any[]>('GET', '', subject);
    return (data || []).map(workspaceFromDict);
  }

  async create(
    body: { name: string; slug?: string; description?: string },
    subject: WorkspaceSubjectOptions = {},
  ): Promise<Workspace> {
    const data = await this.request('POST', '', subject, body);
    return workspaceFromDict(data);
  }

  async grant(
    workspaceRef: string,
    body: { subjectType: 'user' | 'agent'; subjectId: string; role?: 'viewer' | 'contributor' | 'admin' },
    subject: WorkspaceSubjectOptions = {},
  ): Promise<WorkspaceGrant> {
    const data = await this.request('POST', `/${workspaceRef}/grants`, subject, {
      subject_type: body.subjectType,
      subject_id: body.subjectId,
      role: body.role || 'viewer',
    });
    return grantFromDict(data);
  }

  async registerFile(
    workspaceRef: string,
    body: {
      path: string;
      sourceFilename?: string;
      sourceContentType?: string;
      sourceSizeBytes?: number;
      sourceSha256?: string;
      sourceEtag?: string;
    },
    subject: WorkspaceSubjectOptions = {},
  ): Promise<WorkspaceFile> {
    const data = await this.request('POST', `/${workspaceRef}/files`, subject, {
      path: body.path,
      source_filename: body.sourceFilename,
      source_content_type: body.sourceContentType,
      source_size_bytes: body.sourceSizeBytes,
      source_sha256: body.sourceSha256,
      source_etag: body.sourceEtag,
    });
    return fileFromDict(data);
  }

  async manifest(workspaceRef: string, subject: WorkspaceSubjectOptions = {}): Promise<WorkspaceManifest> {
    const data = await this.request('GET', `/${workspaceRef}/manifest`, subject);
    return manifestFromDict(data);
  }

  async downloadUrl(
    workspaceRef: string,
    fileRef: string,
    subject: WorkspaceSubjectOptions = {},
  ): Promise<WorkspaceDownloadUrl> {
    const data = await this.request('GET', `/${workspaceRef}/files/${fileRef}/download-url`, subject);
    return downloadUrlFromDict(data);
  }
}
