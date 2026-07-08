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
            projections: [{ projection_path: 'projects/example/.tomd/report.md' }],
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
});
