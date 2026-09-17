import { describe, expect, it, vi } from 'vitest';
import { Deployments } from '../src/agents.js';
import { HTTPClient } from '../src/http.js';

const AGENT_ID = '11111111-1111-4111-8111-111111111111';

function deploymentsWith(http: Partial<HTTPClient>): Deployments {
  return new Deployments(
    http as HTTPClient,
    'hyper_api_test',
    'https://api.test.hypercli.com/agents',
  );
}

describe('Deployments lifecycle dry-run options', () => {
  it('posts a bodyless stop by default', async () => {
    const post = vi.fn().mockResolvedValue({ id: AGENT_ID, state: 'STOPPING' });
    const deployments = deploymentsWith({ post });
    const invalidate = vi.spyOn(deployments, 'invalidateOpenClawGateway');

    const agent = await deployments.stop(AGENT_ID);

    expect(agent.state).toBe('STOPPING');
    expect(post).toHaveBeenCalledWith(
      `/deployments/${AGENT_ID}/stop`,
      undefined,
      { retries: 1 },
    );
    expect(invalidate).toHaveBeenCalledWith(AGENT_ID);
  });

  it('sends dry_run on stop and leaves the current agent unchanged', async () => {
    const post = vi.fn().mockResolvedValue({ id: AGENT_ID, state: 'RUNNING', dry_run: true });
    const deployments = deploymentsWith({ post });
    const invalidate = vi.spyOn(deployments, 'invalidateOpenClawGateway');

    const agent = await deployments.stop(AGENT_ID, { dryRun: true });

    expect(agent.state).toBe('RUNNING');
    expect(post).toHaveBeenCalledWith(
      `/deployments/${AGENT_ID}/stop`,
      { dry_run: true },
      { retries: 1 },
    );
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('posts a bodyless archive by default', async () => {
    const post = vi.fn().mockResolvedValue({ id: AGENT_ID, state: 'ARCHIVING' });
    const deployments = deploymentsWith({ post });

    const agent = await deployments.archive(AGENT_ID);

    expect(agent.state).toBe('ARCHIVING');
    expect(post).toHaveBeenCalledWith(
      `/deployments/${AGENT_ID}/archive`,
      undefined,
      { retries: 1 },
    );
  });

  it('sends dry_run on archive and leaves the current agent unchanged', async () => {
    const post = vi.fn().mockResolvedValue({ id: AGENT_ID, state: 'STOPPED', dry_run: true });
    const deployments = deploymentsWith({ post });
    const invalidate = vi.spyOn(deployments, 'invalidateOpenClawGateway');

    const agent = await deployments.archive(AGENT_ID, { dryRun: true });

    expect(agent.state).toBe('STOPPED');
    expect(post).toHaveBeenCalledWith(
      `/deployments/${AGENT_ID}/archive`,
      { dry_run: true },
      { retries: 1 },
    );
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('posts a bodyless restore by default', async () => {
    const post = vi.fn().mockResolvedValue({ id: AGENT_ID, state: 'RESTORING' });
    const deployments = deploymentsWith({ post });

    const agent = await deployments.restore(AGENT_ID);

    expect(agent.state).toBe('RESTORING');
    expect(post).toHaveBeenCalledWith(
      `/deployments/${AGENT_ID}/restore`,
      undefined,
      { retries: 1 },
    );
  });

  it('sends dry_run on restore and leaves the current agent unchanged', async () => {
    const post = vi.fn().mockResolvedValue({ id: AGENT_ID, state: 'ARCHIVED', dry_run: true });
    const deployments = deploymentsWith({ post });
    const invalidate = vi.spyOn(deployments, 'invalidateOpenClawGateway');

    const agent = await deployments.restore(AGENT_ID, { dryRun: true });

    expect(agent.state).toBe('ARCHIVED');
    expect(post).toHaveBeenCalledWith(
      `/deployments/${AGENT_ID}/restore`,
      { dry_run: true },
      { retries: 1 },
    );
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('deletes bodyless by default', async () => {
    const deleteRequest = vi.fn().mockResolvedValue({ ok: true, id: AGENT_ID });
    const deployments = deploymentsWith({ delete: deleteRequest });
    const invalidate = vi.spyOn(deployments, 'invalidateOpenClawGateway');

    await expect(deployments.delete(AGENT_ID)).resolves.toEqual({ ok: true, id: AGENT_ID });
    expect(deleteRequest).toHaveBeenCalledTimes(1);
    expect(deleteRequest.mock.calls[0]).toEqual([`/deployments/${AGENT_ID}`]);
    expect(invalidate).toHaveBeenCalledWith(AGENT_ID);
  });

  it('sends dry_run on delete with an HTTP DELETE body and leaves the agent unchanged', async () => {
    const current = { id: AGENT_ID, state: 'STOPPED', dry_run: true };
    const deleteRequest = vi.fn().mockResolvedValue(current);
    const deployments = deploymentsWith({ delete: deleteRequest });
    const invalidate = vi.spyOn(deployments, 'invalidateOpenClawGateway');

    await expect(deployments.delete(AGENT_ID, { dryRun: true })).resolves.toEqual(current);
    expect(deleteRequest).toHaveBeenCalledWith(`/deployments/${AGENT_ID}`, { dry_run: true });
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('serializes a JSON body on HTTP DELETE requests', async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ dry_run: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })));
    vi.stubGlobal('fetch', fetchMock);
    const http = new HTTPClient('https://api.test.hypercli.com/agents', 'hyper_api_test', 1000);

    try {
      await expect(http.delete('/deployments/agent-123', { dry_run: true })).resolves.toEqual({ dry_run: true });
      await http.delete('/deployments/agent-123');

      expect(fetchMock).toHaveBeenCalledTimes(2);
      const [dryUrl, dryInit] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(dryUrl).toBe('https://api.test.hypercli.com/agents/deployments/agent-123');
      expect(dryInit.method).toBe('DELETE');
      expect(dryInit.body).toBe(JSON.stringify({ dry_run: true }));
      const [, plainInit] = fetchMock.mock.calls[1] as [string, RequestInit];
      expect(plainInit.method).toBe('DELETE');
      expect(plainInit.body).toBeUndefined();
    } finally {
      vi.stubGlobal('fetch', originalFetch);
    }
  });
});
