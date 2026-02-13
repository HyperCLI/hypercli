import { describe, it, expect } from 'vitest';
import { HyperCLI } from '../src/client.js';

describe('Renders API', () => {
  const client = new HyperCLI();
  let createdRenderId: string | undefined;

  it('should list renders', async () => {
    const renders = await client.renders.list();
    expect(Array.isArray(renders)).toBe(true);
  });

  it.skip('should create a text-to-image render and wait for completion (template issue)', async () => {
    const render = await client.renders.create({
      template: 'txt2img-sd15',
      prompt: 'a red cube on a white background',
    });

    expect(render).toBeDefined();
    expect(render.renderId).toBeDefined();
    
    createdRenderId = render.renderId;

    // Poll for completion (max 120s)
    const startTime = Date.now();
    const maxWaitTime = 120000; // 120 seconds
    let completedRender = render;

    while (Date.now() - startTime < maxWaitTime) {
      completedRender = await client.renders.get(createdRenderId);
      
      if (completedRender.state === 'completed' || completedRender.state === 'failed') {
        break;
      }
      
      // Wait 2 seconds before polling again
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    expect(completedRender.state).toBe('completed');
    expect(completedRender.resultUrl).toBeDefined();
    expect(typeof completedRender.resultUrl).toBe('string');
  }, 130000); // 130s timeout to allow for polling
});
