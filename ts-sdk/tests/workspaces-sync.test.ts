import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspacesAPI } from '../src/workspaces.js';

const API_BASE = 'http://workspaces.test/workspaces';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Workspaces meta/sync', () => {
  it('meta posts to /meta with workspace and path', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ file_id: 'f1', state: 'processed' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const api = new WorkspacesAPI('key', { apiBase: API_BASE });
    const meta = await api.meta('knowledge', 'docs/readme.pdf');

    expect(meta.file_id).toBe('f1');
    expect(fetchMock.mock.calls[0][0]).toBe(`${API_BASE}/meta`);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      workspace: 'knowledge',
      path: 'docs/readme.pdf',
    });
  });

  it('syncManifest writes .md projections under <outputDir>/<slug>', async () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'hypercli-workspaces-'));
    try {
      const fetchMock = vi.fn().mockImplementation(async (url: string, init: any) => {
        if (url === `${API_BASE}/knowledge/manifest` && init.method === 'GET') {
          return new Response(
            JSON.stringify({
              workspace_id: 'ws-1',
              workspace_name: 'Knowledge',
              workspace_slug: 'knowledge',
              snapshot_id: 'snap-1',
              markdown_files: [
                { path: 'docs/readme', state: 'processed' },
                { path: 'notes/todo', state: 'processing' },
              ],
            }),
            { status: 200 },
          );
        }
        if (url === `${API_BASE}/tomd` && init.method === 'POST') {
          const body = JSON.parse(init.body);
          return new Response(`# ${body.path}`, { status: 200 });
        }
        return new Response('not found', { status: 404 });
      });
      vi.stubGlobal('fetch', fetchMock);

      const api = new WorkspacesAPI('key', { apiBase: API_BASE });
      const written = await api.syncManifest('knowledge', outputDir);

      expect(written).toHaveLength(2);
      for (const target of written) {
        expect(target.startsWith(join(outputDir, 'knowledge') + '/')).toBe(true);
      }
      expect(readFileSync(join(outputDir, 'knowledge', 'docs', 'readme.md'), 'utf8')).toBe('# docs/readme');
      expect(readFileSync(join(outputDir, 'knowledge', 'notes', 'todo.md'), 'utf8')).toBe('# notes/todo');
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('syncManifest with readyOnly skips unprocessed files', async () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'hypercli-workspaces-'));
    try {
      const fetchMock = vi.fn().mockImplementation(async (url: string, _init: any) => {
        if (url === `${API_BASE}/knowledge/manifest`) {
          return new Response(
            JSON.stringify({
              workspace_slug: 'knowledge',
              markdown_files: [
                { path: 'ready/file', state: 'processed' },
                { path: 'pending/file', state: 'processing' },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response('# ready/file', { status: 200 });
      });
      vi.stubGlobal('fetch', fetchMock);

      const api = new WorkspacesAPI('key', { apiBase: API_BASE });
      const written = await api.syncManifest('knowledge', outputDir, {}, { readyOnly: true });

      expect(written).toHaveLength(1);
      expect(written[0]).toBe(join(outputDir, 'knowledge', 'ready', 'file.md'));
      expect(fetchMock.mock.calls.some(([url]) => url === `${API_BASE}/tomd`)).toBe(true);
      expect(fetchMock.mock.calls.filter(([url]) => url === `${API_BASE}/tomd`)).toHaveLength(1);
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('syncAll syncs every workspace keyed by slug', async () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'hypercli-workspaces-'));
    try {
      const fetchMock = vi.fn().mockImplementation(async (url: string, init: any) => {
        if (url === API_BASE && init.method === 'GET') {
          return new Response(
            JSON.stringify([
              { id: 'ws-a', name: 'Alpha', slug: 'alpha' },
              { id: 'ws-b', name: 'Beta', slug: 'beta' },
            ]),
            { status: 200 },
          );
        }
        const manifestMatch = /\/(ws-[ab])\/manifest$/.exec(url);
        if (manifestMatch && init.method === 'GET') {
          return new Response(
            JSON.stringify({
              workspace_slug: manifestMatch[1] === 'ws-a' ? 'alpha' : 'beta',
              markdown_files: [{ path: 'index', state: 'processed' }],
            }),
            { status: 200 },
          );
        }
        if (url === `${API_BASE}/tomd`) {
          return new Response('# index', { status: 200 });
        }
        return new Response('not found', { status: 404 });
      });
      vi.stubGlobal('fetch', fetchMock);

      const api = new WorkspacesAPI('key', { apiBase: API_BASE });
      const synced = await api.syncAll(outputDir);

      expect(Object.keys(synced).sort()).toEqual(['alpha', 'beta']);
      expect(synced.alpha[0]).toBe(join(outputDir, 'alpha', 'index.md'));
      expect(synced.beta[0]).toBe(join(outputDir, 'beta', 'index.md'));
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });
});
