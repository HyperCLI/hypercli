/**
 * ComfyUI job helpers and workflow conversion utilities
 */
import type { HyperCLI } from '../client.js';
import type { Job } from '../jobs.js';
import { BaseJob } from './base.js';
import { COMFYUI_IMAGE } from '../config.js';
import { readFileSync } from 'fs';
import { basename } from 'path';

// Default object_info for offline workflow conversion
export const DEFAULT_OBJECT_INFO: Record<string, any> = {
  // Text encoders
  CLIPTextEncode: {
    input: { required: { clip: ['CLIP'], text: ['STRING', { multiline: true }] }, optional: {} },
    input_order: { required: ['clip', 'text'], optional: [] },
  },
  CLIPLoader: {
    input: { required: { clip_name: [['model.safetensors'], {}], type: [['stable_diffusion', 'wan'], {}], device: [['default', 'cpu'], {}] }, optional: {} },
    input_order: { required: ['clip_name', 'type', 'device'], optional: [] },
  },
  // Samplers
  KSampler: {
    input: {
      required: {
        model: ['MODEL'], positive: ['CONDITIONING'], negative: ['CONDITIONING'], latent_image: ['LATENT'],
        seed: ['INT', { default: 0 }], steps: ['INT', { default: 20 }], cfg: ['FLOAT', { default: 8.0 }],
        sampler_name: [['euler', 'euler_ancestral', 'dpm_2'], {}], scheduler: [['normal', 'karras', 'simple'], {}],
        denoise: ['FLOAT', { default: 1.0 }],
      },
      optional: {},
    },
    input_order: { required: ['model', 'positive', 'negative', 'latent_image', 'seed', 'steps', 'cfg', 'sampler_name', 'scheduler', 'denoise'], optional: [] },
  },
  // Latent generators
  EmptyLatentImage: {
    input: { required: { width: ['INT', {}], height: ['INT', {}], batch_size: ['INT', {}] }, optional: {} },
    input_order: { required: ['width', 'height', 'batch_size'], optional: [] },
  },
  // Model loaders
  UNETLoader: {
    input: { required: { unet_name: [['model.safetensors'], {}], weight_dtype: [['default', 'fp8_e4m3fn'], {}] }, optional: {} },
    input_order: { required: ['unet_name', 'weight_dtype'], optional: [] },
  },
  VAELoader: {
    input: { required: { vae_name: [['vae.safetensors'], {}] }, optional: {} },
    input_order: { required: ['vae_name'], optional: [] },
  },
  CheckpointLoaderSimple: {
    input: { required: { ckpt_name: [['model.safetensors'], {}] }, optional: {} },
    input_order: { required: ['ckpt_name'], optional: [] },
  },
  // Video/Image processing
  VAEDecode: {
    input: { required: { samples: ['LATENT'], vae: ['VAE'] }, optional: {} },
    input_order: { required: ['samples', 'vae'], optional: [] },
  },
  // Save nodes
  SaveImage: {
    input: { required: { images: ['IMAGE'], filename_prefix: ['STRING', {}] }, optional: {} },
    input_order: { required: ['images', 'filename_prefix'], optional: [] },
  },
  // Input loaders
  LoadImage: {
    input: { required: { image: ['STRING', {}] }, optional: {} },
    input_order: { required: ['image'], optional: [] },
  },
  LoadAudio: {
    input: { required: { audio: ['STRING', {}] }, optional: {} },
    input_order: { required: ['audio'], optional: [] },
  },
};

/**
 * Find nodes in API-format workflow by class_type and optional title pattern
 */
export function findNodes(
  workflow: Record<string, any>,
  classType: string,
  titleContains?: string
): Array<[string, any]> {
  const results: Array<[string, any]> = [];

  for (const [nodeId, node] of Object.entries(workflow)) {
    if (node.class_type === classType) {
      if (!titleContains) {
        results.push([nodeId, node]);
      } else {
        const title = node._meta?.title || '';
        if (title.toLowerCase().includes(titleContains.toLowerCase())) {
          results.push([nodeId, node]);
        }
      }
    }
  }

  return results;
}

/**
 * Find first node matching class_type and optional title pattern
 */
export function findNode(
  workflow: Record<string, any>,
  classType: string,
  titleContains?: string
): [string, any] | [null, null] {
  const nodes = findNodes(workflow, classType, titleContains);
  return nodes.length > 0 ? nodes[0] : [null, null];
}

/**
 * Apply parameters to workflow nodes
 */
export function applyParams(workflow: Record<string, any>, params: Record<string, any>): Record<string, any> {
  const clipTypes = ['CLIPTextEncode', 'CLIPTextEncodeFlux', 'CLIPTextEncodeSD3', 'TextEncodeQwenImageEditPlus'];

  // Helper to find first matching node from a list of types
  const findFirst = (types: string[], title?: string): [string, any] | [null, null] => {
    for (const t of types) {
      const result = findNode(workflow, t, title);
      if (result[0]) return result;
    }
    return [null, null];
  };

  // Positive prompt
  if (params.prompt) {
    let [_nodeId, node] = findNode(workflow, 'TextEncodeQwenImageEditPlus', 'Positive');
    if (node) {
      node.inputs.prompt = params.prompt;
    } else {
      [_nodeId, node] = findFirst(clipTypes, 'Positive');
      if (!node) {
        for (const t of clipTypes) {
          const nodes = findNodes(workflow, t);
          if (nodes.length > 0) {
            [_nodeId, node] = nodes[0];
            break;
          }
        }
      }
      if (node) {
        node.inputs.text = params.prompt;
      }
    }
  }

  // Negative prompt
  if (params.negative) {
    let [_nodeId, node] = findNode(workflow, 'TextEncodeQwenImageEditPlus', 'Negative');
    if (node) {
      node.inputs.prompt = params.negative;
    } else {
      [_nodeId, node] = findFirst(clipTypes, 'Negative');
      if (node) {
        node.inputs.text = params.negative;
      }
    }
  }

  // Width/Height/Length
  if (params.width || params.height || params.length) {
    const latentTypes = [
      'EmptySD3LatentImage', 'EmptyFlux2LatentImage', 'EmptyLatentImage',
      'EmptyHunyuanLatentVideo', 'EmptyMochiLatentVideo', 'EmptyLTXVLatentVideo',
      'WanImageToVideo', 'WanStartEndFrames', 'WanHuMoImageToVideo',
    ];
    const [_nodeId, node] = findFirst(latentTypes);
    if (node) {
      if (params.width) node.inputs.width = params.width;
      if (params.height) node.inputs.height = params.height;
      if (params.length) node.inputs.length = params.length;
    }
  }

  // Seed
  if (params.seed !== undefined) {
    const [_nodeId, node] = findNode(workflow, 'KSampler');
    if (node) {
      node.inputs.seed = params.seed;
    } else {
      const advancedNodes = findNodes(workflow, 'KSamplerAdvanced');
      let targetNode = null;
      for (const [_nid, n] of advancedNodes) {
        if (n.inputs.add_noise === 'enable') {
          targetNode = n;
          break;
        }
      }
      if (!targetNode && advancedNodes.length > 0) {
        targetNode = advancedNodes[0][1];
      }
      if (targetNode) {
        targetNode.inputs.noise_seed = params.seed;
      }
    }
  }

  // Steps
  if (params.steps !== undefined) {
    const [_nodeId, node] = findFirst(['KSampler', 'KSamplerAdvanced', 'SamplerCustom', 'SamplerCustomAdvanced']);
    if (node) {
      node.inputs.steps = params.steps;
    }
  }

  // CFG
  if (params.cfg !== undefined) {
    const [_nodeId, node] = findFirst(['KSampler', 'KSamplerAdvanced', 'SamplerCustom', 'SamplerCustomAdvanced']);
    if (node) {
      node.inputs.cfg = params.cfg;
    }
  }

  // Filename prefix
  if (params.filename_prefix) {
    const [_nodeId, node] = findFirst(['SaveImage', 'SaveVideo', 'SaveAnimatedWEBP', 'SaveAnimatedPNG']);
    if (node) {
      node.inputs.filename_prefix = params.filename_prefix;
    }
  }

  // Node-specific params
  if (params.nodes) {
    for (const [nodeId, values] of Object.entries(params.nodes)) {
      const node = workflow[nodeId];
      if (!node) continue;

      const nodeType = node.class_type || '';
      for (const [key, value] of Object.entries(values as Record<string, any>)) {
        if (key === 'image' && nodeType === 'LoadImage') {
          node.inputs.image = value;
        } else if (key === 'audio' && nodeType === 'LoadAudio') {
          node.inputs.audio = value;
        } else if (key === 'text' && nodeType.includes('Text')) {
          node.inputs.text = value;
        } else {
          node.inputs[key] = value;
        }
      }
    }
  }

  return workflow;
}

/**
 * Convert ComfyUI graph format to API format
 */
export function graphToApi(graph: any, objectInfo?: Record<string, any>, _debug: boolean = false): Record<string, any> {
  if (!objectInfo) {
    objectInfo = DEFAULT_OBJECT_INFO;
  }

  const api: Record<string, any> = {};
  const nodesById: Record<number, any> = {};
  const links: Record<number, [number, number]> = {};

  // Build lookups
  for (const node of graph.nodes || []) {
    nodesById[node.id] = node;
  }

  for (const link of graph.links || []) {
    const [linkId, fromNode, fromSlot] = link;
    links[linkId] = [fromNode, fromSlot];
  }

  // Convert nodes
  for (const node of graph.nodes || []) {
    const nodeId = String(node.id);
    const classType = node.type;

    if (!classType || ['Note', 'Reroute', 'MarkdownNote'].includes(classType)) {
      continue;
    }

    if ([2, 4].includes(node.mode)) {
      continue; // Skip muted/bypassed
    }

    const info = objectInfo[classType] || {};
    const inputs: Record<string, any> = {};

    // Map connections
    const connectedInputs = new Set<string>();
    for (const inp of node.inputs || []) {
      const linkId = inp.link;
      if (linkId !== null && links[linkId]) {
        const [fromNode, fromSlot] = links[linkId];
        inputs[inp.name] = [String(fromNode), fromSlot];
        connectedInputs.add(inp.name);
      }
    }

    // Map widget values
    const inputOrder = [
      ...(info.input_order?.required || []),
      ...(info.input_order?.optional || []),
    ];

    const widgets = node.widgets_values || [];
    let wIdx = 0;

    for (const name of inputOrder) {
      if (connectedInputs.has(name)) continue;
      if (wIdx < widgets.length) {
        inputs[name] = widgets[wIdx];
        wIdx++;
      }
    }

    api[nodeId] = {
      class_type: classType,
      inputs,
      _meta: { title: node.title || classType },
    };
  }

  return api;
}

/**
 * Apply graph modes (enable/disable nodes)
 */
export function applyGraphModes(graph: any, nodesConfig: Record<string, any>): any {
  const nodesById: Record<string, any> = {};
  
  for (const node of graph.nodes || []) {
    nodesById[String(node.id)] = node;
  }

  for (const [nodeId, config] of Object.entries(nodesConfig)) {
    const node = nodesById[nodeId];
    if (!node) continue;

    if ('mode' in config) {
      node.mode = config.mode;
    } else if ('enabled' in config) {
      node.mode = config.enabled ? 0 : 4;
    }
  }

  return graph;
}

/**
 * ComfyUI-specific job with workflow execution helpers
 */
export class ComfyUIJob extends BaseJob {
  static override DEFAULT_IMAGE = COMFYUI_IMAGE;
  static override DEFAULT_GPU_TYPE = 'l40s';
  static override HEALTH_ENDPOINT = '/system_stats';
  static COMFYUI_PORT = 8188;

  private _objectInfo: Record<string, any> | null = null;
  private _jobToken: string | null = null;
  private _useLb: boolean;
  public useAuth: boolean;
  public template: string | null = null;

  constructor(
    client: HyperCLI,
    job: Job,
    template?: string,
    useLb: boolean = false,
    useAuth: boolean = false
  ) {
    super(client, job);
    this.template = template || null;
    this._useLb = useLb;
    this.useAuth = useAuth;
  }

  get useLb(): boolean {
    return this._useLb;
  }

  set useLb(value: boolean) {
    this._useLb = value;
    this._baseUrl = null;
  }

  override get baseUrl(): string {
    if (!this._baseUrl && this.hostname) {
      if (this._useLb) {
        this._baseUrl = `https://${this.hostname}`;
      } else {
        this._baseUrl = `http://${this.hostname}:${ComfyUIJob.COMFYUI_PORT}`;
      }
    }
    return this._baseUrl || '';
  }

  override get authHeaders(): Record<string, string> {
    if (this.useAuth) {
      if (!this._jobToken) {
        throw new Error('Job token not loaded. Call await job.jobToken() first.');
      }
      return { 'Authorization': `Bearer ${this._jobToken}` };
    }
    return { 'Authorization': `Bearer ${this.client.apiKey}` };
  }

  async jobToken(): Promise<string> {
    if (!this._jobToken) {
      this._jobToken = await this.client.jobs.token(this.jobId);
    }
    return this._jobToken;
  }

  /**
   * Create a new ComfyUI job configured for a specific template
   */
  static async createForTemplate(
    client: HyperCLI,
    template: string,
    options: {
      gpuType?: string;
      gpuCount?: number;
      runtime?: number;
      lb?: number;
      auth?: boolean;
      [key: string]: any;
    } = {}
  ): Promise<ComfyUIJob> {
    const { gpuType, gpuCount = 1, runtime = 3600, lb, auth = false, ...kwargs } = options;

    const env = kwargs.env || {};
    env.COMFYUI_TEMPLATES = template;

    const ports: Record<string, number> = {};
    if (lb) {
      ports.lb = lb;
    } else {
      ports[String(ComfyUIJob.COMFYUI_PORT)] = ComfyUIJob.COMFYUI_PORT;
    }

    const job = await client.jobs.create({
      image: ComfyUIJob.DEFAULT_IMAGE,
      gpuType: gpuType || ComfyUIJob.DEFAULT_GPU_TYPE,
      gpuCount,
      runtime,
      env,
      ports,
      auth,
      ...kwargs,
    });

    return new ComfyUIJob(client, job, template, Boolean(lb), auth);
  }

  /**
   * Get object_info from ComfyUI (cached)
   */
  async getObjectInfo(refresh: boolean = false): Promise<Record<string, any>> {
    if (this._objectInfo === null || refresh) {
      const response = await fetch(`${this.baseUrl}/object_info`, {
        headers: this.authHeaders,
      });

      if (!response.ok) {
        throw new Error(`Failed to get object_info: ${response.statusText}`);
      }

      this._objectInfo = (await response.json()) as Record<string, any>;
    }
    return this._objectInfo!;
  }

  /**
   * Convert graph format workflow to API format
   */
  async convertWorkflow(graph: any, debug: boolean = false): Promise<Record<string, any>> {
    const objectInfo = await this.getObjectInfo();
    return graphToApi(graph, objectInfo, debug);
  }

  /**
   * Upload image to ComfyUI server
   */
  async uploadImage(filePath: string, filename?: string): Promise<string> {
    const content = readFileSync(filePath);
    const fname = filename || basename(filePath);

    const formData = new FormData();
    const blob = new Blob([content], { type: 'image/png' });
    formData.append('image', blob, fname);

    const response = await fetch(`${this.baseUrl}/upload/image`, {
      method: 'POST',
      headers: this.authHeaders,
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Failed to upload image: ${response.statusText}`);
    }

    const data: any = await response.json();
    return data.name || fname;
  }

  /**
   * Upload audio to ComfyUI server
   */
  async uploadAudio(filePath: string, filename?: string): Promise<string> {
    const content = readFileSync(filePath);
    const fname = filename || basename(filePath);

    const formData = new FormData();
    const blob = new Blob([content], { type: 'audio/mpeg' });
    formData.append('image', blob, fname); // ComfyUI uses /upload/image for all files

    const response = await fetch(`${this.baseUrl}/upload/image`, {
      method: 'POST',
      headers: this.authHeaders,
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Failed to upload audio: ${response.statusText}`);
    }

    const data: any = await response.json();
    return data.name || fname;
  }
}
