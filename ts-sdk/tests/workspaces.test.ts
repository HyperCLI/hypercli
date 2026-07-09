import { describe, expect, it, vi } from 'vitest';
import { deriveWorkspacesApiBase, WorkspacesAPI } from '../src/workspaces.js';

describe('Workspaces SDK', () => {
  it('derives workspace API base from agents API base', () => {
    expect(deriveWorkspacesApiBase('https://api.agents.dev.hypercli.com/agents')).toBe(
      'https://api.agents.dev.hypercli.com/workspaces',
    );
  });

  it('creates workspaces with bearer auth', async () => {
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
      headers: expect.objectContaining({ Authorization: 'Bearer key' }),
      body: JSON.stringify({ name: 'Demo Workspace', slug: 'demo' }),
    });
    vi.unstubAllGlobals();
  });

  it('searches workspaces through the backend search endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([{ id: 'workspace-1', name: 'Team Knowledge', slug: 'team-knowledge' }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const api = new WorkspacesAPI('key', { apiBase: 'http://workspaces.test/workspaces' });
    const workspaces = await api.search('launch handoff', { userId: 'user-1' });

    expect(workspaces[0]?.slug).toBe('team-knowledge');
    expect(fetchMock.mock.calls[0][0]).toBe('http://workspaces.test/workspaces/search?q=launch+handoff&vector=true');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'GET',
      headers: expect.objectContaining({ Authorization: 'Bearer key' }),
    });
    vi.unstubAllGlobals();
  });

  it('can search files with vector search disabled explicitly', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            id: 'file-1',
            workspace_id: 'workspace-1',
            path: 'docs/brief.md',
            display_name: 'brief.md',
            current_version_id: 'version-1',
            file_state: 'processed',
            upload_status: 'uploaded',
            processing_state: 'processed',
            match_reasons: ['keyword'],
            keyword_score: 0.8,
            vector_score: null,
            score: 0.8,
          },
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const api = new WorkspacesAPI('key', { apiBase: 'http://workspaces.test/workspaces' });
    const files = await api.searchFiles('demo', 'brief', { userId: 'user-1' }, { vector: false });

    expect(files[0]?.path).toBe('docs/brief.md');
    expect(files[0]?.matchReasons).toEqual(['keyword']);
    expect(fetchMock.mock.calls[0][0]).toBe('http://workspaces.test/workspaces/demo/files/search?q=brief&vector=false');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'GET',
      headers: expect.objectContaining({ Authorization: 'Bearer key' }),
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
            processing_state: 'pending',
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
            markdown_files: [
              {
                file_id: 'file-1',
                path: 'projects/example/report.pdf',
                version: 1,
                part_count: 1,
                state: 'processed',
                keywords: ['handoff'],
                summary: 'Report summary.',
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
      { path: 'projects/example/report.pdf', sourceSha256: 'a'.repeat(64), keywords: ['handoff'] },
      { userId: 'user-1' },
    );
    const manifest = await api.manifest('demo', { agentId: 'agent-1' });

    expect(file.processingState).toBe('pending');
    expect(manifest.markdownFiles[0]?.path).toBe('projects/example/report.pdf');
    expect(fetchMock.mock.calls[0][0]).toBe('http://workspaces.test/workspaces/demo/files');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ keywords: ['handoff'] });
    expect(fetchMock.mock.calls[1][0]).toBe('http://workspaces.test/workspaces/demo/manifest');
    vi.unstubAllGlobals();
  });

  it('uploads files with multipart form data and bearer auth', async () => {
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
          processing_state: 'pending',
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
    expect(fetchMock.mock.calls[0][0]).toBe('http://workspaces.test/workspaces/upload');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer key' }),
    });
    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty('Content-Type');
    expect(fetchMock.mock.calls[0][1].body).toBeInstanceOf(FormData);
    vi.unstubAllGlobals();
  });

  it('gets and waits for processed workspace files', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'file-1',
            workspace_id: 'workspace-1',
            path: 'docs/source.md',
            display_name: 'source.md',
            current_version_id: 'version-1',
            file_state: 'processed',
            upload_status: 'uploaded',
            processing_state: 'processed',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const api = new WorkspacesAPI('key', { apiBase: 'http://workspaces.test/workspaces' });
    const file = await api.waitUntilProcessed(
      'demo',
      'docs/source.md',
      { agentId: 'agent-1' },
      { timeoutMs: 100, pollIntervalMs: 0 },
    );

    expect(file.fileState).toBe('processed');
    expect(file.processingState).toBe('processed');
    expect(fetchMock.mock.calls[0][0]).toBe('http://workspaces.test/workspaces/demo/files/docs/source.md');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'GET',
      headers: expect.objectContaining({ Authorization: 'Bearer key' }),
    });
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
              processing_state: 'pending',
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

  it('updates compact workspace file fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'file-1',
          workspace_id: 'workspace-1',
          path: 'docs/source.md',
          display_name: 'customer-pricing-brief.md',
          current_version_id: 'version-1',
          file_state: 'processed',
          upload_status: 'uploaded',
          processing_state: 'processed',
          keywords: ['pricing', 'retention'],
          summary: 'Pricing retention guidance.',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const api = new WorkspacesAPI('key', { apiBase: 'http://workspaces.test/workspaces' });
    const file = await api.updateFile('demo', 'docs/source.md', {
      displayName: 'customer-pricing-brief.md',
      keywords: ['pricing', 'retention'],
      summary: 'Pricing retention guidance.',
    });

    expect(fetchMock.mock.calls[0][0]).toBe('http://workspaces.test/workspaces/demo/files/docs/source.md');
    expect(fetchMock.mock.calls[0][1]?.method).toBe('PATCH');
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      display_name: 'customer-pricing-brief.md',
      keywords: ['pricing', 'retention'],
      summary: 'Pricing retention guidance.',
    });
    expect(file.keywords).toEqual(['pricing', 'retention']);
    expect(file.summary).toBe('Pricing retention guidance.');
    vi.unstubAllGlobals();
  });

  it('renders a single-file Markdown file with front matter', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          workspace_id: 'workspace-1',
          workspace_name: 'Demo Workspace',
          workspace_slug: 'demo',
          snapshot_id: 'snapshot-1',
          base_path: '/home/node/Workspaces/demo',
            markdown_files: [
              {
                file_id: 'file-1',
                path: 'docs/source.md',
                version: 1,
                part_count: 1,
                keywords: ['handoff', 'launch'],
                summary: 'Launch handoff notes.',
                state: 'processed',
              },
            ],
          }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
      .mockResolvedValueOnce(
        new Response(
          '---\npath: "docs/source.md"\nkeywords: ["handoff","launch"]\nsummary: "Launch handoff notes."\ndownload_command: "hyper workspaces download demo/docs/source.md --raw"\n---\n\n# Source\n',
          { status: 200 },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const api = new WorkspacesAPI('key', { apiBase: 'http://workspaces.test/workspaces' });
    const result = await api.markdownFile('demo', 'docs/source.md', { agentId: 'agent-1' });

    expect(result.markdownFile.path).toBe('docs/source.md');
    expect(result.markdown).toContain('path: "docs/source.md"');
    expect(result.markdown).toContain('keywords: ["handoff","launch"]');
    expect(result.markdown).toContain('summary: "Launch handoff notes."');
    expect(result.markdown).toContain('download_command: "hyper workspaces download demo/docs/source.md --raw"');
    expect(fetchMock.mock.calls[1][0]).toBe('http://workspaces.test/workspaces/tomd');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ workspace: 'demo', path: 'docs/source.md', index: 1 });
    vi.unstubAllGlobals();
  });

  it('downloads file bytes through the backend download endpoint', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(new Uint8Array([35, 32, 83, 111, 117, 114, 99, 101]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const api = new WorkspacesAPI('key', { apiBase: 'http://workspaces.test/workspaces' });
    const result = await api.downloadFileBytes('demo', 'docs/source.md', {}, { raw: true });

    expect(fetchMock.mock.calls[0][0]).toBe('http://workspaces.test/workspaces/download');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ workspace: 'demo', path: 'docs/source.md', raw: true, index: 1 });
    expect(result.path).toBe('docs/source.md');
    expect(result.name).toBe('source.md');
    expect(Array.from(result.content)).toEqual([35, 32, 83, 111, 117, 114, 99, 101]);
    vi.unstubAllGlobals();
  });
});
