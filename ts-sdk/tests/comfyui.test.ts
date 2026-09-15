import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HyperCLI } from '../src/client.js';
import {
  ComfyUIJob,
  applyParams,
  expandSubgraphs,
  graphToApi,
  loadTemplate,
} from '../src/job/comfyui.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeWorkflow(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    '1': {
      class_type: 'CLIPTextEncode',
      inputs: { text: 'old prompt' },
      _meta: { title: 'Positive' },
    },
    '2': {
      class_type: 'CLIPTextEncode',
      inputs: { text: 'old negative' },
      _meta: { title: 'Negative' },
    },
    '3': {
      class_type: 'KSampler',
      inputs: { seed: 42, steps: 20, cfg: 8 },
      _meta: { title: 'KSampler' },
    },
    '4': {
      class_type: 'EmptyLatentImage',
      inputs: { width: 512, height: 512, batch_size: 1 },
      _meta: { title: 'Latent' },
    },
    ...overrides,
  };
}

describe('comfyui loadTemplate', () => {
  it('loads a template JSON by explicit path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hypercli-comfy-'));
    try {
      const file = join(dir, 'graph.json');
      writeFileSync(file, JSON.stringify({ nodes: [], links: [] }));
      expect(loadTemplate(file)).toEqual({ nodes: [], links: [] });
      expect(loadTemplate(join(dir, 'graph'))).toEqual({ nodes: [], links: [] });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('resolves <templatesDir>/<templateId>.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hypercli-comfy-'));
    try {
      writeFileSync(join(dir, 't2v.json'), JSON.stringify({ nodes: [{ id: 1 }], links: [] }));
      expect(loadTemplate('t2v', { templatesDir: dir })).toEqual({ nodes: [{ id: 1 }], links: [] });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws a descriptive error when nothing resolves', () => {
    expect(() => loadTemplate('definitely-not-a-template')).toThrow(/template/i);
  });
});

describe('comfyui applyParams parity', () => {
  it('applies prompt/negative/dimensions/batch_size/sampler scalars', () => {
    const workflow = makeWorkflow();
    applyParams(workflow, {
      prompt: 'a horse',
      negative: 'blurry',
      width: 1024,
      height: 768,
      length: 97,
      batch_size: 2,
      seed: 1234,
      steps: 30,
      cfg: 5.5,
    });
    expect(workflow['1'].inputs.text).toBe('a horse');
    expect(workflow['2'].inputs.text).toBe('blurry');
    expect(workflow['4'].inputs).toMatchObject({ width: 1024, height: 768, batch_size: 2 });
    expect(workflow['3'].inputs).toMatchObject({ seed: 1234, steps: 30, cfg: 5.5 });
  });

  it('writes seed to noise_seed on KSamplerAdvanced (add_noise=enable only)', () => {
    const workflow = {
      '1': { class_type: 'KSamplerAdvanced', inputs: { add_noise: 'enable', noise_seed: 1 }, _meta: { title: 'first' } },
      '2': { class_type: 'KSamplerAdvanced', inputs: { add_noise: 'disable', noise_seed: 2 }, _meta: { title: 'second' } },
    };
    applyParams(workflow, { seed: 7 });
    expect(workflow['1'].inputs.noise_seed).toBe(7);
    expect(workflow['2'].inputs.noise_seed).toBe(2);
  });

  it('falls back to Flux2Scheduler/FluxGuidance/RandomNoise/PrimitiveNode', () => {
    const workflow = {
      '1': { class_type: 'PrimitiveNode', inputs: { value: 512 }, _meta: { title: 'width' } },
      '2': { class_type: 'PrimitiveNode', inputs: { value: 512 }, _meta: { title: 'height' } },
      '3': { class_type: 'Flux2Scheduler', inputs: { steps: 4 }, _meta: { title: 'sched' } },
      '4': { class_type: 'FluxGuidance', inputs: { guidance: 3.5 }, _meta: { title: 'guidance' } },
      '5': { class_type: 'RandomNoise', inputs: { noise_seed: 0 }, _meta: { title: 'noise' } },
    };
    applyParams(workflow, { width: 640, height: 480, steps: 12, cfg: 2.0, seed: 999 });
    expect(workflow['1'].inputs.value).toBe(640);
    expect(workflow['2'].inputs.value).toBe(480);
    expect(workflow['3'].inputs.steps).toBe(12);
    expect(workflow['4'].inputs.guidance).toBe(2.0);
    expect(workflow['5'].inputs.noise_seed).toBe(999);
  });
});

describe('comfyui expandSubgraphs + graphToApi', () => {
  const graph = {
    nodes: [
      {
        id: 10,
        type: 'subgraph-uuid-1',
        mode: 0,
        title: 'Group',
        inputs: [{ name: 'latent_image', link: 1, label: 'latent_image' }],
        outputs: [{ name: 'LATENT', links: [2] }],
        properties: { proxyWidgets: [[-1, 'seed']] },
      },
      { id: 1, type: 'EmptyLatentImage', mode: 0, title: 'latent' },
      { id: 2, type: 'VAEDecode', mode: 0, title: 'decode', inputs: [{ name: 'samples', link: 2 }] },
    ],
    links: [
      [1, 1, 0, 10, 0, 'LATENT'],
      [2, 10, 0, 2, 0, 'LATENT'],
    ],
    definitions: {
      subgraphs: [
        {
          id: 'subgraph-uuid-1',
          nodes: [
            { id: -1, type: 'KSampler', title: 'sampler', mode: 0, widgets_values: [77] },
          ],
          links: [
            { id: 100, origin_id: -1, origin_slot: 0, target_id: -1, target_slot: 0, type: 'LATENT' },
          ],
          inputs: [{ name: 'latent_image', linkIds: [100] }],
          outputs: [{ name: 'LATENT', linkIds: [100] }],
        },
      ],
    },
    last_node_id: 10,
    last_link_id: 2,
  };

  it('expands group nodes into subgraph nodes and rewires links', () => {
    const expanded = expandSubgraphs(graph);
    const types = expanded.nodes.map((node: any) => node.type);
    expect(types).toContain('KSampler');
    expect(types).not.toContain('subgraph-uuid-1');
    // The external output link should now point at the expanded KSampler node.
    const ksampler = expanded.nodes.find((node: any) => node.type === 'KSampler');
    const outputLink = expanded.links.find((link: any[]) => link[0] === 2);
    expect(outputLink[1]).toBe(ksampler.id);
    // The input link should target the expanded node too.
    const inputLink = expanded.links.find((link: any[]) => link[0] === 1);
    expect(inputLink[3]).toBe(ksampler.id);
  });

  it('graphToApi maps widgets positionally for connected inputs and expands subgraphs', () => {
    const sampled = {
      nodes: [
        {
          id: 1,
          type: 'CLIPTextEncode',
          mode: 0,
          title: 'Positive',
          inputs: [{ name: 'clip', link: 13 }],
          widgets_values: ['a horse'],
        },
        {
          id: 2,
          type: 'KSampler',
          mode: 0,
          title: 'sampler',
          inputs: [
            { name: 'model', link: 10 },
            { name: 'positive', link: 11 },
            { name: 'negative', link: 11 },
            { name: 'latent_image', link: 12 },
          ],
          widgets_values: [42, 20, 8.0, 'euler', 'normal', 1.0],
        },
        { id: 3, type: 'CheckpointLoaderSimple', mode: 0, title: 'ckpt' },
        { id: 4, type: 'EmptyLatentImage', mode: 0, title: 'latent' },
      ],
      links: [
        [10, 3, 0, 2, 0, 'MODEL'],
        [11, 1, 0, 2, 1, 'CONDITIONING'],
        [12, 4, 0, 2, 3, 'LATENT'],
        [13, 3, 1, 1, 0, 'CLIP'],
      ],
      last_node_id: 4,
      last_link_id: 12,
    };
    const api = graphToApi(sampled);
    expect(api['2'].inputs.model).toEqual(['3', 0]);
    expect(api['2'].inputs.positive).toEqual(['1', 0]);
    expect(api['2'].inputs).toMatchObject({ seed: 42, steps: 20, cfg: 8.0, sampler_name: 'euler', scheduler: 'normal' });
    expect(api['1'].inputs.text).toBe('a horse');
  });

  it('graphToApi expands subgraph group nodes', () => {
    const api = graphToApi(graph);
    const ksamplerEntry = Object.values(api).find((node: any) => node.class_type === 'KSampler') as any;
    expect(ksamplerEntry).toBeDefined();
    expect(api['2'].class_type).toBe('VAEDecode');
    expect(api['2'].inputs.samples[0]).toBe(String(
      Object.keys(api).find((key) => (api as any)[key].class_type === 'KSampler'),
    ));
  });

  it('graphToApi resolves links through reroutes and skips muted nodes', () => {
    const routed = {
      nodes: [
        { id: 1, type: 'LoadImage', mode: 0, title: 'image' },
        { id: 2, type: 'Reroute', mode: 0, title: 'reroute', inputs: [{ name: 'in', link: 1 }] },
        { id: 3, type: 'VAEDecode', mode: 0, title: 'decode', inputs: [{ name: 'samples', link: 2 }] },
        { id: 4, type: 'KSampler', mode: 4, title: 'bypassed' },
      ],
      links: [
        [1, 1, 0, 2, 0, 'IMAGE'],
        [2, 2, 0, 3, 0, 'LATENT'],
      ],
      last_node_id: 4,
      last_link_id: 2,
    };
    const api = graphToApi(routed);
    expect(api['3'].inputs.samples).toEqual(['1', 0]);
    expect(Object.values(api).some((node: any) => node.class_type === 'KSampler')).toBe(false);
  });
});

describe('ComfyUIJob node management', () => {
  function makeJob(fetchBehaviour: (url: string, init: any) => Response | Promise<Response>) {
    const fetchMock = vi.fn().mockImplementation((url: any, init: any) => fetchBehaviour(String(url), init));
    vi.stubGlobal('fetch', fetchMock);
    const client = { apiKey: 'hyper_api_test' } as unknown as HyperCLI;
    const job = { jobId: 'job-1', hostname: 'comfy.test' } as any;
    const comfy = new ComfyUIJob(client, job);
    return { comfy, fetchMock };
  }

  it('installNode queues install and starts the manager queue', async () => {
    const urls: string[] = [];
    const { comfy } = makeJob((url) => {
      urls.push(url);
      return new Response('{}', { status: url.includes('/manager/queue/install') ? 201 : 200 });
    });
    const queued = await comfy.installNode('comfyui-videohelpersuite');
    expect(queued).toBe(true);
    expect(urls[0]).toBe('http://comfy.test:8188/manager/queue/install');
    expect(urls[1]).toBe('http://comfy.test:8188/manager/queue/start');
  });

  it('getWorkflowNodeTypes supports UI and API formats', () => {
    const client = { apiKey: 'hyper_api_test' } as unknown as HyperCLI;
    const comfy = new ComfyUIJob(client, { jobId: 'job-1', hostname: 'comfy.test' } as any);
    expect(comfy.getWorkflowNodeTypes({ nodes: [{ type: 'KSampler' }, { type: 'Note' }] })).toEqual(new Set(['KSampler', 'Note']));
    expect(comfy.getWorkflowNodeTypes({ '1': { class_type: 'CLIPTextEncode' }, '2': { class_type: 'KSampler' } })).toEqual(
      new Set(['CLIPTextEncode', 'KSampler']),
    );
  });

  it('queuePrompt retries transient connect errors and returns prompt_id', async () => {
    let attempts = 0;
    const { comfy } = makeJob(() => {
      attempts += 1;
      if (attempts < 3) {
        throw new TypeError('fetch failed');
      }
      return new Response(JSON.stringify({ prompt_id: 'prompt-9' }), { status: 200 });
    });
    const promptId = await comfy.queuePrompt({ '1': { class_type: 'KSampler', inputs: {} } }, 3);
    expect(promptId).toBe('prompt-9');
    expect(attempts).toBe(3);
  });

  it('queuePrompt surfaces non-200 responses without retrying', async () => {
    let attempts = 0;
    const { comfy } = makeJob(() => {
      attempts += 1;
      return new Response(JSON.stringify({ error: 'bad workflow' }), { status: 400 });
    });
    await expect(comfy.queuePrompt({}, 3)).rejects.toThrow(/ComfyUI prompt failed \(400\)/);
    expect(attempts).toBe(1);
  });

  it('getOutputImages flattens images/videos/gifs from history outputs', () => {
    const client = { apiKey: 'hyper_api_test' } as unknown as HyperCLI;
    const comfy = new ComfyUIJob(client, { jobId: 'job-1', hostname: 'comfy.test' } as any);
    const history = {
      outputs: {
        '9': { images: [{ filename: 'a.png' }, { filename: 'b.png' }] },
        '10': { videos: [{ filename: 'c.mp4' }] },
      },
    };
    expect(comfy.getOutputImages(history).map((item) => item.filename)).toEqual(['a.png', 'b.png', 'c.mp4']);
  });
});
