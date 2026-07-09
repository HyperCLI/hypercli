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
  expiresAt: string | null;
  revokedAt: string | null;
}

export interface WorkspaceFile {
  id: string;
  workspaceId: string;
  path: string;
  displayName: string;
  currentVersionId: string | null;
  fileState: string;
  uploadStatus: string | null;
  processingState: string | null;
  keywords: string[];
  summary: string | null;
}

export interface WorkspaceFileSearchResult extends WorkspaceFile {
  matchReasons: string[];
  keywordScore: number;
  vectorScore: number | null;
  score: number;
}

export interface WorkspaceManifest {
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  snapshotId: string;
  basePath: string;
  markdownFiles: Array<Record<string, any>>;
}

export interface WorkspaceDownloadUrl {
  fileId: string;
  path: string;
  version: number;
  url: string | null;
  downloadCommand: string;
}

export interface WorkspaceFileBytes {
  content: Uint8Array;
  path: string;
  name: string;
}

export interface WorkspaceSubjectOptions {
  /** @deprecated Workspaces identity is resolved from the bearer credential. */
  userId?: string;
  /** @deprecated Workspaces identity is resolved from the bearer credential. */
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
    expiresAt: data?.expires_at || data?.expiresAt || null,
    revokedAt: data?.revoked_at || data?.revokedAt || null,
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
    processingState: data?.processing_state || data?.processingState || null,
    keywords: Array.isArray(data?.keywords) ? data.keywords.map(String) : [],
    summary: data?.summary || null,
  };
}

function fileSearchResultFromDict(data: any): WorkspaceFileSearchResult {
  return {
    ...fileFromDict(data),
    matchReasons: data?.match_reasons || data?.matchReasons || [],
    keywordScore: Number(data?.keyword_score ?? data?.keywordScore ?? 0),
    vectorScore:
      data?.vector_score !== undefined && data?.vector_score !== null
        ? Number(data.vector_score)
        : data?.vectorScore !== undefined && data?.vectorScore !== null
          ? Number(data.vectorScore)
          : null,
    score: Number(data?.score ?? 0),
  };
}

function manifestFromDict(data: any): WorkspaceManifest {
  return {
    workspaceId: String(data?.workspace_id || data?.workspaceId || ''),
    workspaceName: data?.workspace_name || data?.workspaceName || '',
    workspaceSlug: data?.workspace_slug || data?.workspaceSlug || '',
    snapshotId: data?.snapshot_id || data?.snapshotId || '',
    basePath: data?.base_path || data?.basePath || '',
    markdownFiles: Array.isArray(data?.markdown_files) ? data.markdown_files : Array.isArray(data?.markdownFiles) ? data.markdownFiles : [],
  };
}

function downloadUrlFromDict(data: any): WorkspaceDownloadUrl {
  return {
    fileId: String(data?.file_id || data?.fileId || ''),
    path: data?.path || '',
    version: Number(data?.version || 0),
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

async function handleBytesResponse(response: Response): Promise<Uint8Array> {
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
  return new Uint8Array(await response.arrayBuffer());
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

  private headers(_subject: WorkspaceSubjectOptions = {}): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
    return headers;
  }

  private authHeaders(_subject: WorkspaceSubjectOptions = {}): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
    };
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

  async search(
    query: string,
    subject: WorkspaceSubjectOptions = {},
    options: { vector?: boolean } = {},
  ): Promise<Workspace[]> {
    const params = new URLSearchParams({ q: query, vector: String(options.vector ?? true) });
    const data = await this.request<any[]>('GET', `/search?${params.toString()}`, subject);
    return (data || []).map(workspaceFromDict);
  }

  async create(
    body: { name: string; slug?: string; description?: string },
    subject: WorkspaceSubjectOptions = {},
  ): Promise<Workspace> {
    const data = await this.request('POST', '', subject, body);
    return workspaceFromDict(data);
  }

  async update(
    workspaceRef: string,
    body: { name?: string; slug?: string; description?: string },
    subject: WorkspaceSubjectOptions = {},
  ): Promise<Workspace> {
    const data = await this.request('PATCH', `/${workspaceRef}`, subject, body);
    return workspaceFromDict(data);
  }

  async delete(workspaceRef: string, subject: WorkspaceSubjectOptions = {}): Promise<void> {
    await this.request('DELETE', `/${workspaceRef}`, subject);
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

  async listGrants(workspaceRef: string, subject: WorkspaceSubjectOptions = {}): Promise<WorkspaceGrant[]> {
    const data = await this.request<any[]>('GET', `/${workspaceRef}/grants`, subject);
    return (data || []).map(grantFromDict);
  }

  async revokeGrant(workspaceRef: string, grantId: string, subject: WorkspaceSubjectOptions = {}): Promise<void> {
    await this.request('DELETE', `/${workspaceRef}/grants/${grantId}`, subject);
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
      keywords?: string[];
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
      keywords: body.keywords,
    });
    return fileFromDict(data);
  }

  async uploadFile(
    workspaceRef: string,
    file: Blob,
    options: { path?: string; filename?: string; sourceEtag?: string } = {},
    subject: WorkspaceSubjectOptions = {},
  ): Promise<WorkspaceFile> {
    const formData = new FormData();
    const filename = options.filename || (typeof File !== 'undefined' && file instanceof File ? file.name : 'upload');
    formData.append('workspace', workspaceRef);
    formData.append('file', file, filename);
    if (options.path) formData.append('path', options.path);
    if (options.sourceEtag) formData.append('source_etag', options.sourceEtag);

    const response = await fetch(`${this.apiBase}/upload`, {
      method: 'POST',
      headers: this.authHeaders(subject),
      body: formData,
    });
    return fileFromDict(await handleResponse(response));
  }

  async getFile(
    workspaceRef: string,
    fileRef: string,
    subject: WorkspaceSubjectOptions = {},
  ): Promise<WorkspaceFile> {
    const data = await this.request('GET', `/${workspaceRef}/files/${fileRef}`, subject);
    return fileFromDict(data);
  }

  async updateFile(
    workspaceRef: string,
    fileRef: string,
    body: { displayName?: string; keywords?: string[]; summary?: string | null },
    subject: WorkspaceSubjectOptions = {},
  ): Promise<WorkspaceFile> {
    const data = await this.request('PATCH', `/${workspaceRef}/files/${fileRef}`, subject, {
      ...(body.displayName !== undefined ? { display_name: body.displayName } : {}),
      ...(body.keywords !== undefined ? { keywords: body.keywords } : {}),
      ...(body.summary !== undefined ? { summary: body.summary } : {}),
    });
    return fileFromDict(data);
  }

  async regenerateFile(workspaceRef: string, fileRef: string, subject: WorkspaceSubjectOptions = {}): Promise<WorkspaceFile> {
    const data = await this.request('POST', `/${workspaceRef}/files/${fileRef}/regenerate`, subject);
    return fileFromDict(data);
  }

  async waitUntilProcessed(
    workspaceRef: string,
    fileRef: string,
    subject: WorkspaceSubjectOptions = {},
    options: { timeoutMs?: number; pollIntervalMs?: number } = {},
  ): Promise<WorkspaceFile> {
    const timeoutMs = options.timeoutMs ?? 300000;
    const pollIntervalMs = options.pollIntervalMs ?? 2000;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const file = await this.getFile(workspaceRef, fileRef, subject);
      if (file.fileState === 'processed' && file.processingState === 'processed') {
        return file;
      }
      if (file.fileState === 'failed' || file.fileState === 'deleted' || file.processingState === 'failed' || file.processingState === 'deleted') {
        throw new Error(`Workspace file ${fileRef} is ${file.fileState} with processing ${file.processingState || 'unknown'}`);
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
    throw new Error(`Workspace file ${fileRef} did not process within ${timeoutMs}ms`);
  }

  async listFiles(workspaceRef: string, subject: WorkspaceSubjectOptions = {}): Promise<WorkspaceFile[]> {
    const data = await this.request<any[]>('GET', `/${workspaceRef}/files`, subject);
    return (data || []).map(fileFromDict);
  }

  async searchFiles(
    workspaceRef: string,
    query: string,
    subject: WorkspaceSubjectOptions = {},
    options: { vector?: boolean } = {},
  ): Promise<WorkspaceFileSearchResult[]> {
    const params = new URLSearchParams({ q: query, vector: String(options.vector ?? true) });
    const data = await this.request<any[]>('GET', `/${workspaceRef}/files/search?${params.toString()}`, subject);
    return (data || []).map(fileSearchResultFromDict);
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
    const data = await this.request('POST', `/download-url`, subject, { workspace: workspaceRef, path: fileRef });
    return downloadUrlFromDict(data);
  }

  async downloadFileBytes(
    workspaceRef: string,
    fileRef: string,
    subject: WorkspaceSubjectOptions = {},
    options: { raw?: boolean; index?: number } = {},
  ): Promise<WorkspaceFileBytes> {
    const response = await requestWithRetry({
      method: 'POST',
      url: `${this.apiBase}/download`,
      headers: this.headers(subject),
      body: { workspace: workspaceRef, path: fileRef, raw: Boolean(options.raw), index: options.index ?? 1 },
      timeout: this.timeout,
    });
    const path = fileRef;
    return {
      content: await handleBytesResponse(response),
      path,
      name: fileNameFromPath(path),
    };
  }

  async deleteFile(workspaceRef: string, fileRef: string, subject: WorkspaceSubjectOptions = {}): Promise<void> {
    await this.request('DELETE', `/${workspaceRef}/files/${fileRef}`, subject);
  }

  async markdownFile(
    workspaceRef: string,
    fileRef: string,
    subject: WorkspaceSubjectOptions = {},
  ): Promise<{ markdownFile: Record<string, any>; markdown: string }> {
    const manifest = await this.manifest(workspaceRef, subject);
    const markdownFile = findMarkdownFile(manifest, fileRef);
    const response = await requestWithRetry({
      method: 'POST',
      url: `${this.apiBase}/tomd`,
      headers: this.headers(subject),
      body: { workspace: workspaceRef, path: markdownFile.path || fileRef, index: 1 },
      timeout: this.timeout,
    });
    const bytes = await handleBytesResponse(response);
    return { markdownFile, markdown: new TextDecoder().decode(bytes) };
  }
}

function findMarkdownFile(manifest: WorkspaceManifest, fileRef: string): Record<string, any> {
  const normalizedRef = normalizePosixPath(fileRef);
  for (const markdownFile of manifest.markdownFiles) {
    if (!markdownFile || typeof markdownFile !== 'object') continue;
    if (fileRef === String(markdownFile.file_id || '')) {
      return markdownFile;
    }
    if (normalizedRef === normalizePosixPath(String(markdownFile.path || ''))) {
      return markdownFile;
    }
  }
  throw new Error(`Workspace Markdown file not found for ${fileRef}`);
}

function normalizePosixPath(path: string): string {
  return path.trim().replace(/\\/g, '/').replace(/^\.\/+/, '');
}

function fileNameFromPath(path: string): string {
  const normalized = normalizePosixPath(path).replace(/^\/+/, '').replace(/\/+$/, '');
  return normalized.split('/').filter(Boolean).at(-1) || normalized || 'file';
}
