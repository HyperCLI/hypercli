import { describe, expect, it, vi } from 'vitest';
import { deriveWorkspacesApiBase, WorkspacesAPI } from '../src/workspaces.js';

describe('Workspaces SDK', () => {
  it('derives workspace API base from agents API base', () => {
    expect(deriveWorkspacesApiBase('https://api.agents.dev.hypercli.com/agents')).toBe(
      'https://api.agents.dev.hypercli.com/workspaces',
    );
  });

  it('creates workspaces with subject headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'workspace-1', name: 'Demo Workspace', slug: 'demo' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const api = new WorkspacesAPI('key', { apiBase: 'http://workspaces.test/workspaces' });
    const workspace = await api.create({ name: 'Demo Workspace', slug: 'demo' }, { userId: 'user-1' });

    expect(workspace.slug).toBe('demo');
    expect(fetchMock.mock.calls[0][0]).toBe('http://workspaces.test/workspaces');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer key', 'X-User-Id': 'user-1' }),
      body: JSON.stringify({ name: 'Demo Workspace', slug: 'demo' }),
    });
    vi.unstubAllGlobals();
  });

  it('updates and deletes workspaces', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'workspace-1', name: 'Renamed', slug: 'renamed' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ deleted: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const api = new WorkspacesAPI('key', { apiBase: 'http://workspaces.test/workspaces' });
    const workspace = await api.update('demo', { name: 'Renamed', slug: 'renamed' }, { userId: 'user-1' });
    await expect(api.delete('renamed', { userId: 'user-1' })).resolves.toBeUndefined();

    expect(workspace.slug).toBe('renamed');
    expect(fetchMock.mock.calls[0][0]).toBe('http://workspaces.test/workspaces/demo');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'PATCH',
      body: JSON.stringify({ name: 'Renamed', slug: 'renamed' }),
    });
    expect(fetchMock.mock.calls[1][0]).toBe('http://workspaces.test/workspaces/renamed');
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: 'DELETE' });
    vi.unstubAllGlobals();
  });

  it('lists and revokes workspace grants', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              id: 'grant-1',
              workspace_id: 'workspace-1',
              subject_type: 'agent',
              subject_id: 'agent-1',
              role: 'viewer',
            },
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ revoked: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const api = new WorkspacesAPI('key', { apiBase: 'http://workspaces.test/workspaces' });

    await expect(api.listGrants('demo', { userId: 'user-1' })).resolves.toMatchObject([
      { id: 'grant-1', subjectType: 'agent', subjectId: 'agent-1', role: 'viewer' },
    ]);
    await expect(api.revokeGrant('demo', 'grant-1', { userId: 'user-1' })).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0][0]).toBe('http://workspaces.test/workspaces/demo/grants');
    expect(fetchMock.mock.calls[1][0]).toBe('http://workspaces.test/workspaces/demo/grants/grant-1');
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: 'DELETE' });
    vi.unstubAllGlobals();
  });

  it('registers files and fetches manifests', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'file-1',
            workspace_id: 'workspace-1',
            path: 'projects/example/report.pdf',
            display_name: 'report.pdf',
            current_version_id: 'version-1',
            file_state: 'uploaded',
            upload_status: 'uploaded',
            projection_status: 'queued',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            workspace_id: 'workspace-1',
            workspace_name: 'Demo Workspace',
            workspace_slug: 'demo',
            snapshot_id: 'snapshot-1',
            base_path: '/home/node/Workspaces/demo',
            projections: [
              {
                file_id: 'file-1',
                file_version_id: 'version-1',
                projection_id: 'projection-1',
                source_path: 'projects/example/report.pdf',
                source_filename: 'report.pdf',
                source_content_type: 'application/pdf',
                source_size_bytes: 123,
                source_s3_key: 'test/workspaces/workspace-1/originals/file-1/version-1/report.pdf',
                projection_path: 'projects/example/.tomd/report.md',
                source_sha256: 'a'.repeat(64),
                source_etag: 'etag-1',
                source_last_modified: '2026-07-08T00:00:00Z',
                download_command: 'hyper workspaces download demo projects/example/report.pdf --raw --output report.pdf',
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const api = new WorkspacesAPI('key', { apiBase: 'http://workspaces.test/workspaces' });
    const file = await api.registerFile(
      'demo',
      { path: 'projects/example/report.pdf', sourceSha256: 'a'.repeat(64) },
      { userId: 'user-1' },
    );
    const manifest = await api.manifest('demo', { agentId: 'agent-1' });

    expect(file.projectionStatus).toBe('queued');
    expect(manifest.projections[0]?.projection_path).toBe('projects/example/.tomd/report.md');
    expect(fetchMock.mock.calls[0][0]).toBe('http://workspaces.test/workspaces/demo/files');
    expect(fetchMock.mock.calls[1][0]).toBe('http://workspaces.test/workspaces/demo/manifest');
    vi.unstubAllGlobals();
  });

  it('uploads files with multipart form data and subject headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'file-1',
          workspace_id: 'workspace-1',
          path: 'docs/source.md',
          display_name: 'source.md',
          current_version_id: 'version-1',
          file_state: 'uploaded',
          upload_status: 'uploaded',
          projection_status: 'queued',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const api = new WorkspacesAPI('key', { apiBase: 'http://workspaces.test/workspaces' });
    const file = await api.uploadFile(
      'demo',
      new Blob(['hello'], { type: 'text/markdown' }),
      { path: 'docs/source.md', filename: 'source.md' },
      { userId: 'user-1' },
    );

    expect(file.path).toBe('docs/source.md');
    expect(fetchMock.mock.calls[0][0]).toBe('http://workspaces.test/workspaces/demo/upload');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer key', 'X-User-Id': 'user-1' }),
    });
    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty('Content-Type');
    expect(fetchMock.mock.calls[0][1].body).toBeInstanceOf(FormData);
    vi.unstubAllGlobals();
  });

  it('lists and deletes workspace files', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              id: 'file-1',
              workspace_id: 'workspace-1',
              path: 'docs/source.md',
              display_name: 'source.md',
              current_version_id: 'version-1',
              file_state: 'uploaded',
              upload_status: 'uploaded',
              projection_status: 'queued',
            },
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ deleted: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const api = new WorkspacesAPI('key', { apiBase: 'http://workspaces.test/workspaces' });

    await expect(api.listFiles('demo', { agentId: 'agent-1' })).resolves.toHaveLength(1);
    await expect(api.deleteFile('demo', 'docs/source.md', { userId: 'user-1' })).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0][0]).toBe('http://workspaces.test/workspaces/demo/files');
    expect(fetchMock.mock.calls[1][0]).toBe('http://workspaces.test/workspaces/demo/files/docs/source.md');
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: 'DELETE' });
    vi.unstubAllGlobals();
  });

  it('renders a single-file Markdown projection with front matter', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          workspace_id: 'workspace-1',
          workspace_name: 'Demo Workspace',
          workspace_slug: 'demo',
          snapshot_id: 'snapshot-1',
          base_path: '/home/node/Workspaces/demo',
          projections: [
            {
              file_id: 'file-1',
              file_version_id: 'version-1',
              projection_id: 'projection-1',
              source_path: 'docs/source.md',
              source_filename: 'source.md',
              source_content_type: 'text/markdown',
              source_size_bytes: 12,
              source_s3_key: 'test/workspaces/workspace-1/originals/file-1/version-1/source.md',
              projection_path: 'docs/.tomd/source.md',
              source_sha256: 'b'.repeat(64),
              source_etag: 'etag-2',
              source_last_modified: '2026-07-08T01:00:00Z',
              status: 'queued',
              download_command: 'hyper workspaces download demo docs/source.md --raw --output source.md',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const api = new WorkspacesAPI('key', { apiBase: 'http://workspaces.test/workspaces' });
    const result = await api.projectionMarkdown('demo', 'docs/source.md', { agentId: 'agent-1' });

    expect(result.projection.projection_path).toBe('docs/.tomd/source.md');
    expect(result.markdown).toContain('source_path: "docs/source.md"');
    expect(result.markdown).toContain('source_size_bytes: 12');
    expect(result.markdown).toContain('download_command: "hyper workspaces download demo docs/source.md --raw --output source.md"');
    vi.unstubAllGlobals();
  });
});
