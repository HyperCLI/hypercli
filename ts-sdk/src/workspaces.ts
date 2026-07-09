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
  projectionStatus: string | null;
}

export interface WorkspaceFileSearchResult extends WorkspaceFile {
  matchReasons: string[];
  keywordScore: number;
  vectorScore: number | null;
  score: number;
}

export interface WorkspaceProjection {
  id: string;
  workspaceId: string;
  fileId: string;
  fileVersionId: string;
  projectionPath: string;
  projectionS3Key: string | null;
  status: string;
  kind: string;
  title: string | null;
  detectedType: string | null;
  markdownSha256: string | null;
  systemMetadata: Record<string, any>;
  semanticMetadata: Record<string, any>;
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
    projectionStatus: data?.projection_status || data?.projectionStatus || null,
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

function projectionFromDict(data: any): WorkspaceProjection {
  return {
    id: String(data?.id || ''),
    workspaceId: String(data?.workspace_id || data?.workspaceId || ''),
    fileId: String(data?.file_id || data?.fileId || ''),
    fileVersionId: String(data?.file_version_id || data?.fileVersionId || ''),
    projectionPath: data?.projection_path || data?.projectionPath || '',
    projectionS3Key: data?.projection_s3_key || data?.projectionS3Key || null,
    status: data?.status || '',
    kind: data?.kind || '',
    title: data?.title || null,
    detectedType: data?.detected_type || data?.detectedType || null,
    markdownSha256: data?.markdown_sha256 || data?.markdownSha256 || null,
    systemMetadata: data?.system_metadata || data?.systemMetadata || {},
    semanticMetadata: data?.semantic_metadata || data?.semanticMetadata || {},
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
    formData.append('file', file, filename);
    if (options.path) formData.append('path', options.path);
    if (options.sourceEtag) formData.append('source_etag', options.sourceEtag);

    const response = await fetch(`${this.apiBase}/${workspaceRef}/upload`, {
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
      if (file.fileState === 'processed' && file.projectionStatus === 'finished') {
        return file;
      }
      if (file.fileState === 'failed' || file.fileState === 'deleted' || file.projectionStatus === 'failed' || file.projectionStatus === 'deleted') {
        throw new Error(`Workspace file ${fileRef} is ${file.fileState} with projection ${file.projectionStatus || 'unknown'}`);
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

  async listProjections(workspaceRef: string, subject: WorkspaceSubjectOptions = {}): Promise<WorkspaceProjection[]> {
    const data = await this.request<any[]>('GET', `/${workspaceRef}/projections`, subject);
    return (data || []).map(projectionFromDict);
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

  async downloadFileBytes(
    workspaceRef: string,
    fileRef: string,
    subject: WorkspaceSubjectOptions = {},
  ): Promise<WorkspaceFileBytes> {
    const descriptor = await this.downloadUrl(workspaceRef, fileRef, subject);
    if (!descriptor.url) {
      throw new Error('Workspace file download URL is unavailable.');
    }
    const response = await fetch(descriptor.url);
    if (!response.ok) {
      throw new Error(`Unable to fetch workspace file (${response.status}).`);
    }
    const path = descriptor.sourcePath || fileRef;
    return {
      content: new Uint8Array(await response.arrayBuffer()),
      path,
      name: fileNameFromPath(path),
    };
  }

  async deleteFile(workspaceRef: string, fileRef: string, subject: WorkspaceSubjectOptions = {}): Promise<void> {
    await this.request('DELETE', `/${workspaceRef}/files/${fileRef}`, subject);
  }

  async projectionMarkdown(
    workspaceRef: string,
    fileRef: string,
    subject: WorkspaceSubjectOptions = {},
  ): Promise<{ projection: Record<string, any>; markdown: string }> {
    const manifest = await this.manifest(workspaceRef, subject);
    const projection = findProjection(manifest, fileRef);
    return { projection, markdown: projectionMarkdown(manifest, projection) };
  }
}

function findProjection(manifest: WorkspaceManifest, fileRef: string): Record<string, any> {
  const normalizedRef = normalizePosixPath(fileRef);
  for (const projection of manifest.projections) {
    if (!projection || typeof projection !== 'object') continue;
    if (fileRef === String(projection.file_id || '') || fileRef === String(projection.projection_id || '')) {
      return projection;
    }
    if (
      normalizedRef === normalizePosixPath(String(projection.source_path || '')) ||
      normalizedRef === normalizePosixPath(String(projection.projection_path || ''))
    ) {
      return projection;
    }
  }
  throw new Error(`Workspace projection not found for ${fileRef}`);
}

function projectionMarkdown(manifest: WorkspaceManifest, projection: Record<string, any>): string {
  const sourcePath = String(projection.source_path || '');
  const downloadCommand = projection.download_command || `hyper workspaces download ${manifest.workspaceSlug}/${sourcePath}`;
  const frontmatter: Record<string, unknown> = {
    workspace_id: manifest.workspaceId,
    workspace_slug: manifest.workspaceSlug,
    snapshot_id: manifest.snapshotId,
    file_id: projection.file_id || '',
    file_version_id: projection.file_version_id || '',
    projection_id: projection.projection_id || '',
    source_path: sourcePath,
    source_filename: projection.source_filename || '',
    source_content_type: projection.source_content_type || '',
    source_size_bytes: projection.source_size_bytes ?? null,
    source_s3_key: projection.source_s3_key || '',
    source_sha256: projection.source_sha256 || '',
    source_etag: projection.source_etag || '',
    source_last_modified: projection.source_last_modified || '',
    projection_path: projection.projection_path || '',
    markdown_sha256: projection.markdown_sha256 || '',
    keywords: projection.keywords || [],
    status: projection.status || '',
    download_command: downloadCommand,
  };
  const lines = ['---'];
  for (const [key, value] of Object.entries(frontmatter)) {
    lines.push(`${key}: ${yamlScalar(value)}`);
  }
  lines.push('---', '');
  if (typeof projection.markdown_body === 'string' && projection.markdown_body) {
    lines.push(projection.markdown_body.trimEnd(), '');
  }
  return lines.join('\n');
}

function normalizePosixPath(path: string): string {
  return path.trim().replace(/\\/g, '/').replace(/^\.\/+/, '');
}

function fileNameFromPath(path: string): string {
  const normalized = normalizePosixPath(path).replace(/^\/+/, '').replace(/\/+$/, '');
  return normalized.split('/').filter(Boolean).at(-1) || normalized || 'file';
}

function yamlScalar(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value) || typeof value === 'object') return JSON.stringify(value);
  return JSON.stringify(String(value));
}
