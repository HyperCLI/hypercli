import { describe, expect, it, vi } from 'vitest';
import { OpenClawAgent } from '../src/agents.js';

// One AgentFiles client wraps all three access paths behind a `source` switch.
// The SDK owns the roots: workspace-relative paths are prefixed with
// `.openclaw/workspace/` for the backend (agent/backup); `agent` also takes
// absolute `/…` paths for full-fs; gateway is name-addressed within the workspace.
describe('AgentFiles — one client, three sources', () => {
  function makeAgent() {
    const gatewayClient = {
      // The in-gateway agent is "main" — NOT the deployment id ("agent-123").
      agentsList: vi.fn().mockResolvedValue([{ id: 'main' }]),
      filesList: vi.fn().mockResolvedValue([{ name: 'AGENTS.md', size: 12, missing: false }]),
      fileGet: vi.fn().mockResolvedValue('hello from gateway'),
      fileSet: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
    };
    const deployments = {
      filesList: vi.fn().mockResolvedValue([{ name: 'out.txt', path: 'out.txt', type: 'file' }]),
      fileReadBytes: vi.fn().mockResolvedValue(new TextEncoder().encode('backend bytes')),
      fileWrite: vi.fn().mockResolvedValue({ ok: true }),
      fileWriteBytes: vi.fn().mockResolvedValue({ ok: true }),
      fileDelete: vi.fn().mockResolvedValue({ ok: true }),
    };
    const agent = new OpenClawAgent({
      id: 'agent-123',
      command: [], entrypoint: [], ports: [], routes: {},
      gatewayUrl: 'wss://gw', gatewayToken: 't',
    } as any);
    agent._deployments = deployments as any;
    vi.spyOn(agent, 'connect').mockResolvedValue(gatewayClient as any);
    return { agent, gatewayClient, deployments };
  }

  // --- gateway: name-addressed workspace, resolved agent id ---
  it('gateway write hits agents.files.set with the resolved id and bare name', async () => {
    const { agent, gatewayClient, deployments } = makeAgent();
    const res = await agent.fileWrite('AGENTS.md', 'hi', 'gateway');
    expect(gatewayClient.fileSet).toHaveBeenCalledWith('main', 'AGENTS.md', 'hi');
    expect(deployments.fileWrite).not.toHaveBeenCalled();
    expect(res).toEqual({ name: 'AGENTS.md', source: 'gateway', agentId: 'main' });
  });

  it('gateway read strips a workspace prefix to the bare name', async () => {
    const { agent, gatewayClient } = makeAgent();
    expect(await agent.fileRead('.openclaw/workspace/AGENTS.md', 'gateway')).toBe('hello from gateway');
    expect(gatewayClient.fileGet).toHaveBeenCalledWith('main', 'AGENTS.md');
  });

  // --- agent (pod) / backup (s3): workspace-relative → prefixed backend path ---
  it('agent source prefixes the workspace and maps to wire source pod', async () => {
    const { agent, deployments } = makeAgent();
    await agent.fileWrite('notes/todo.md', 'x', 'agent');
    expect(deployments.fileWrite).toHaveBeenCalledWith(agent, '.openclaw/workspace/notes/todo.md', 'x', 'pod');
  });

  it('backup source prefixes the workspace and maps to wire source s3', async () => {
    const { agent, deployments } = makeAgent();
    await agent.filesList('logs', 'backup');
    expect(deployments.filesList).toHaveBeenCalledWith(agent, '.openclaw/workspace/logs', 's3');
  });

  it('the same workspace-relative name is the same file on all three sources', async () => {
    const { agent, gatewayClient, deployments } = makeAgent();
    await agent.fileRead('AGENTS.md', 'gateway');
    await agent.fileReadBytes('AGENTS.md', 'agent');
    await agent.fileReadBytes('AGENTS.md', 'backup');
    expect(gatewayClient.fileGet).toHaveBeenCalledWith('main', 'AGENTS.md');
    expect(deployments.fileReadBytes).toHaveBeenNthCalledWith(1, agent, '.openclaw/workspace/AGENTS.md', 'pod');
    expect(deployments.fileReadBytes).toHaveBeenNthCalledWith(2, agent, '.openclaw/workspace/AGENTS.md', 's3');
  });

  // --- full-fs: absolute paths only on agent ---
  it('agent accepts an absolute path for full-fs access (no workspace prefix)', async () => {
    const { agent, deployments } = makeAgent();
    await agent.fileRead('/etc/hosts', 'agent');
    expect(deployments.fileReadBytes).toHaveBeenCalledWith(agent, '/etc/hosts', 'pod');
  });

  it('absolute paths are rejected for backup and gateway (out of scope)', async () => {
    const { agent } = makeAgent();
    await expect(agent.fileRead('/etc/hosts', 'backup')).rejects.toThrow(/absolute paths need the 'agent' source/i);
    await expect(agent.fileRead('/etc/hosts', 'gateway')).rejects.toThrow(/absolute paths are not valid for the 'gateway'/i);
  });

  // --- deprecated aliases still work ---
  it('pod/s3 aliases still map to agent/backup', async () => {
    const { agent, deployments } = makeAgent();
    await agent.fileWrite('a.md', 'x', 'pod');
    await agent.fileWrite('a.md', 'x', 's3');
    expect(deployments.fileWrite).toHaveBeenNthCalledWith(1, agent, '.openclaw/workspace/a.md', 'x', 'pod');
    expect(deployments.fileWrite).toHaveBeenNthCalledWith(2, agent, '.openclaw/workspace/a.md', 'x', 's3');
  });

  it('delete over the gateway source is rejected', async () => {
    const { agent } = makeAgent();
    await expect(agent.fileDelete('AGENTS.md', { source: 'gateway' })).rejects.toThrow(/delete is not supported/i);
  });
});
