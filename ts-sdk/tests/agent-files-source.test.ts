import { describe, expect, it, vi } from 'vitest';
import { OpenClawAgent } from '../src/agents.js';

// The unified file API: base Agent = backend sources (auto|pod|s3); OpenClawAgent
// adds the `gateway` source routing to the operator-WS `agents.files.*` RPC.
describe('Agent file source switch', () => {
  function makeAgent() {
    const gatewayClient = {
      filesList: vi.fn().mockResolvedValue([{ name: 'AGENTS.md', size: 12, missing: false }]),
      fileGet: vi.fn().mockResolvedValue('hello from gateway'),
      fileSet: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
    };
    const deployments = {
      filesList: vi.fn().mockResolvedValue([{ name: 'log.txt', path: 'log.txt', type: 'file' }]),
      fileReadBytes: vi.fn().mockResolvedValue(new TextEncoder().encode('pod bytes')),
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
    // Bypass the real connect/handshake — route withGateway to our fake client.
    vi.spyOn(agent, 'connect').mockResolvedValue(gatewayClient as any);
    return { agent, gatewayClient, deployments };
  }

  it('routes gateway writes to agents.files.set and closes the client', async () => {
    const { agent, gatewayClient, deployments } = makeAgent();
    const res = await agent.fileWrite('AGENTS.md', 'hi there', 'gateway');
    expect(gatewayClient.fileSet).toHaveBeenCalledWith('agent-123', 'AGENTS.md', 'hi there');
    expect(gatewayClient.close).toHaveBeenCalled();
    expect(deployments.fileWrite).not.toHaveBeenCalled();
    expect(res).toEqual({ name: 'AGENTS.md', source: 'gateway' });
  });

  it('routes gateway reads to agents.files.get', async () => {
    const { agent, gatewayClient } = makeAgent();
    expect(await agent.fileRead('AGENTS.md', 'gateway')).toBe('hello from gateway');
    expect(gatewayClient.fileGet).toHaveBeenCalledWith('agent-123', 'AGENTS.md');
  });

  it('maps gateway list entries to AgentFileEntry', async () => {
    const { agent } = makeAgent();
    const list = await agent.filesList('', 'gateway');
    expect(list).toEqual([{ name: 'AGENTS.md', path: 'AGENTS.md', type: 'file', size: 12 }]);
  });

  it('delegates non-gateway sources to the backend deployment API', async () => {
    const { agent, deployments, gatewayClient } = makeAgent();
    await agent.fileWrite('logs/out.txt', 'data', 'pod');
    expect(deployments.fileWrite).toHaveBeenCalledWith(agent, 'logs/out.txt', 'data', 'pod');
    expect(gatewayClient.fileSet).not.toHaveBeenCalled();
  });

  it('rejects delete over the gateway source (agents.files.* has no delete)', async () => {
    const { agent } = makeAgent();
    await expect(agent.fileDelete('AGENTS.md', { source: 'gateway' })).rejects.toThrow(/delete is not supported/i);
  });
});
