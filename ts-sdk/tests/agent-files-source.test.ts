import { describe, expect, it, vi } from 'vitest';

import { OpenClawAgent } from '../src/agents.js';

function makeAgent() {
  const deployments = {
    filesList: vi.fn().mockResolvedValue([{ name: 'out.txt', type: 'file' }]),
    fileReadBytes: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    fileReadBytesWithMetadata: vi.fn().mockResolvedValue({ content: new Uint8Array([1]), mimeType: 'text/plain' }),
    fileRead: vi.fn().mockResolvedValue('hello'),
    fileWriteBytes: vi.fn().mockResolvedValue({ ok: true }),
    fileWrite: vi.fn().mockResolvedValue({ ok: true }),
    fileDelete: vi.fn().mockResolvedValue({ ok: true }),
  };
  const agent = OpenClawAgent.fromDict({
    id: 'agent-123',
    user_id: 'user-456',
    state: 'STOPPED',
  });
  (agent as any)._deployments = deployments;
  return { agent, deployments };
}

describe('Reef-only workspace file client', () => {
  it('delegates without source or destination selectors', async () => {
    const { agent, deployments } = makeAgent();

    await expect(agent.filesList('notes')).resolves.toEqual([{ name: 'out.txt', type: 'file' }]);
    await expect(agent.fileRead('AGENTS.md')).resolves.toBe('hello');
    await expect(agent.fileReadBytes('data.bin')).resolves.toEqual(new Uint8Array([1, 2, 3]));
    await expect(agent.fileWrite('notes/todo.md', 'x')).resolves.toEqual({ ok: true });
    await expect(agent.fileWriteBytes('data.bin', new Uint8Array([1]))).resolves.toEqual({ ok: true });
    await expect(agent.fileDelete('notes', { recursive: true })).resolves.toEqual({ ok: true });

    expect(deployments.filesList).toHaveBeenCalledWith(agent, 'notes');
    expect(deployments.fileRead).toHaveBeenCalledWith(agent, 'AGENTS.md', undefined);
    expect(deployments.fileReadBytes).toHaveBeenCalledWith(agent, 'data.bin', undefined);
    expect(deployments.fileWrite).toHaveBeenCalledWith(agent, 'notes/todo.md', 'x');
    expect(deployments.fileWriteBytes).toHaveBeenCalledWith(agent, 'data.bin', new Uint8Array([1]));
    expect(deployments.fileDelete).toHaveBeenCalledWith(agent, 'notes', { recursive: true });
  });

  it('keeps gateway file RPCs explicit', () => {
    const { agent } = makeAgent();
    expect(agent.workspaceFiles).toBeTypeOf('function');
    expect(agent.fileGet).toBeTypeOf('function');
    expect(agent.fileSet).toBeTypeOf('function');
  });
});
