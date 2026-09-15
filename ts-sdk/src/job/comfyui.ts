/**
 * ComfyUI job helpers and workflow conversion utilities
 */
import type { HyperCLI } from '../client.js';
import type { Job } from '../jobs.js';
import { BaseJob } from './base.js';
import { COMFYUI_IMAGE } from '../config.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { basename, join } from 'path';
import { requestWithRetry } from '../http.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Load a workflow template JSON in graph format (nodes array, links array).
 *
 * The Python SDK resolves IDs via the comfyui-workflow-templates pip package;
 * Node has no equivalent package, so `templateId` must resolve to a JSON file:
 * an explicit path, `<templateId>.json`, or — when `templatesDir` is given —
 * `<templatesDir>/<templateId>.json` or `<templatesDir>/<templateId>/<templateId>.json`.
 */
export function loadTemplate(templateId: string, options: { templatesDir?: string } = {}): Record<string, any> {
  const candidates = [templateId, `${templateId}.json`];
  if (options.templatesDir) {
    candidates.push(
      join(options.templatesDir, `${templateId}.json`),
      join(options.templatesDir, templateId, `${templateId}.json`),
    );
  }
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return JSON.parse(readFileSync(candidate, 'utf8'));
    }
  }
  throw new Error(
    `Workflow template not found for "${templateId}". ` +
      'Provide a path to the template JSON, name the file <templateId>.json, ' +
      'or pass templatesDir containing <templateId>.json.',
  );
}

/** Check whether a widget value matches the expected input type. */
export function valueMatchesType(value: any, inputSpec: any): boolean {
  if (inputSpec === undefined || inputSpec === null) {
    return true;
  }

  // inputSpec is typically [type, config] or just [type]
  if (Array.isArray(inputSpec) && inputSpec.length > 0) {
    const typeInfo = inputSpec[0];
    const config = inputSpec.length > 1 ? inputSpec[1] : {};

    // List of allowed values (enum/combo) - older format
    if (Array.isArray(typeInfo)) {
      // Accept if value is in list, or if value is a string (enum values may differ between versions)
      if (typeInfo.includes(value)) {
        return true;
      }
      if (typeof value === 'string' && typeInfo.some((v) => typeof v === 'string')) {
        return true;
      }
      return false;
    }

    // Type string
    if (typeof typeInfo === 'string') {
      // COMBO type - options are in config["options"] (newer ComfyUI format)
      if (typeInfo === 'COMBO') {
        const options = config && typeof config === 'object' && Array.isArray(config.options) ? config.options : [];
        if (options.includes(value)) {
          return true;
        }
        // Accept any string for combo - versions may have different allowed values
        if (typeof value === 'string' && options.length > 0 && options.some((v: any) => typeof v === 'string')) {
          return true;
        }
        return false;
      }
      if (typeInfo === 'INT' || typeInfo === 'FLOAT') {
        return typeof value === 'number' && Number.isFinite(value);
      }
      if (typeInfo === 'STRING') {
        return typeof value === 'string';
      }
      if (typeInfo === 'BOOLEAN') {
        return typeof value === 'boolean';
      }
      // Connection types (MODEL, CLIP, VIDEO, etc.) are handled via links, not widgets
      if (/^[A-Z0-9_]+$/.test(typeInfo)) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Expand subgraph/group nodes into their constituent nodes.
 *
 * ComfyUI supports "workflow components" (group nodes) where a subgraph is
 * collapsed into a single node with a UUID type. These must be expanded before
 * the workflow can be executed. Returns a new graph; the input is not modified.
 */
export function expandSubgraphs(graph: Record<string, any>, debug: boolean = false): Record<string, any> {
  const log = debug ? console.debug.bind(console) : () => undefined;

  // Check whether there are subgraph definitions
  const subgraphs: Record<string, any> = {};
  for (const sg of graph?.definitions?.subgraphs ?? []) {
    subgraphs[sg.id] = sg;
  }
  if (Object.keys(subgraphs).length === 0) {
    return graph; // No subgraphs, return as-is
  }

  graph = JSON.parse(JSON.stringify(graph));

  const nodes: any[] = graph.nodes ?? [];
  const links: any[] = graph.links ?? [];

  const newNodes: any[] = [];
  const newLinks: any[] = [];
  const nodesToRemove = new Set<any>();
  const linksToRemove = new Set<any>();

  let nextNodeId = (graph.last_node_id ?? 0) + 1;
  let nextLinkId = (graph.last_link_id ?? 0) + 1;

  const getLinkFields = (lnk: any): [any, any, any, any, any, any] => {
    if (lnk && typeof lnk === 'object' && !Array.isArray(lnk)) {
      return [lnk.id, lnk.origin_id, lnk.origin_slot ?? 0, lnk.target_id, lnk.target_slot ?? 0, lnk.type ?? ''];
    }
    return [lnk[0], lnk[1], lnk[2], lnk[3], lnk[4], lnk[5] ?? ''];
  };

  for (const node of nodes) {
    const nodeType = String(node?.type ?? '');
    const nodeId = node?.id;
    const mode = node?.mode ?? 0;

    if (!(nodeType in subgraphs)) {
      continue;
    }

    // Skip bypassed/muted group nodes
    if (mode === 2 || mode === 4) {
      log(`Skipping bypassed group node ${nodeId}`);
      nodesToRemove.add(nodeId);
      for (const link of links) {
        if (link[1] === nodeId || link[3] === nodeId) {
          linksToRemove.add(link[0]);
        }
      }
      continue;
    }

    log(`Expanding group node ${nodeId} -> subgraph ${nodeType.slice(0, 20)}...`);

    const sg = subgraphs[nodeType];
    const sgNodes: any[] = sg.nodes ?? [];
    const sgLinks: any[] = sg.links ?? [];

    const idMap: Record<string, number> = {};
    for (const sgNode of sgNodes) {
      idMap[String(sgNode.id)] = nextNodeId;
      nextNodeId += 1;
    }

    // Apply widget values from proxyWidgets
    const proxyWidgets: any[] = node?.properties?.proxyWidgets ?? [];
    const widgetValues: any[] = node?.widgets_values ?? [];
    const widgetOverrides: Record<string, Record<string, any>> = {};
    for (let index = 0; index < proxyWidgets.length && index < widgetValues.length; index += 1) {
      const [targetId, widgetName] = proxyWidgets[index];
      const key = String(targetId);
      if (!widgetOverrides[key]) {
        widgetOverrides[key] = {};
      }
      widgetOverrides[key][widgetName] = widgetValues[index];
    }

    for (const sgNode of sgNodes) {
      const oldId = sgNode.id;
      const newNode = JSON.parse(JSON.stringify(sgNode));
      newNode.id = idMap[String(oldId)];

      const overrides = widgetOverrides[String(oldId)];
      if (overrides) {
        const sgWidgets = newNode.widgets_values ?? [];
        if (!Array.isArray(sgWidgets) && typeof sgWidgets === 'object') {
          Object.assign(sgWidgets, overrides);
        } else {
          const nodeTypeInner = newNode.type ?? '';
          if ('text' in overrides && (nodeTypeInner === 'CLIPTextEncode' || nodeTypeInner === 'CLIPTextEncodeFlux')) {
            if (sgWidgets.length) {
              sgWidgets[0] = overrides.text;
            } else {
              newNode.widgets_values = [overrides.text];
            }
          }
        }
      }
      newNodes.push(newNode);
    }

    // Copy subgraph links with remapped IDs
    const linkIdMap: Record<string, number> = {};
    for (const sgLink of sgLinks) {
      const [oldLinkId, fromNode, fromSlot, toNode, toSlot, linkType] = getLinkFields(sgLink);
      const newFrom = idMap[String(fromNode)] ?? fromNode;
      const newTo = idMap[String(toNode)] ?? toNode;
      newLinks.push([nextLinkId, newFrom, fromSlot, newTo, toSlot, linkType]);
      linkIdMap[String(oldLinkId)] = nextLinkId;
      nextLinkId += 1;
    }

    // Update node input link references using the link ID mapping
    for (const newNode of newNodes) {
      for (const input of newNode.inputs ?? []) {
        const oldLink = input.link;
        if (oldLink !== null && oldLink !== undefined && String(oldLink) in linkIdMap) {
          input.link = linkIdMap[String(oldLink)];
        }
      }
    }

    // Rewire external connections: group node inputs -> subgraph input nodes
    const sgInputs: any[] = sg.inputs ?? [];
    for (const input of node.inputs ?? []) {
      const linkId = input.link;
      if (linkId === null || linkId === undefined) continue;
      const inputName = input.name;
      for (const sgInput of sgInputs) {
        if (sgInput.name === inputName || sgInput.label === input.label) {
          for (const sgLinkId of sgInput.linkIds ?? []) {
            for (const sgLink of sgLinks) {
              const fields = getLinkFields(sgLink);
              if (String(fields[0]) === String(sgLinkId)) {
                const targetNode = idMap[String(fields[3])] ?? fields[3];
                const targetSlot = fields[4];
                for (const link of links) {
                  if (link[0] === linkId) {
                    link[3] = targetNode;
                    link[4] = targetSlot;
                    break;
                  }
                }
                break;
              }
            }
          }
          break;
        }
      }
    }

    // Group node outputs -> subgraph output nodes
    const sgOutputs: any[] = sg.outputs ?? [];
    for (const output of node.outputs ?? []) {
      const outLinks: any[] = output.links ?? [];
      if (!outLinks.length) continue;
      for (const sgOutput of sgOutputs) {
        let done = false;
        for (const sgLinkId of sgOutput.linkIds ?? []) {
          for (const sgLink of sgLinks) {
            const fields = getLinkFields(sgLink);
            if (String(fields[0]) === String(sgLinkId)) {
              const sourceNode = idMap[String(fields[1])] ?? fields[1];
              const sourceSlot = fields[2];
              for (const extLinkId of outLinks) {
                for (const link of links) {
                  if (link[0] === extLinkId) {
                    link[1] = sourceNode;
                    link[2] = sourceSlot;
                    break;
                  }
                }
              }
              done = true;
              break;
            }
          }
          if (done) break;
        }
        if (done) break;
      }
    }

    nodesToRemove.add(nodeId);
  }

  graph.nodes = nodes.filter((node) => !nodesToRemove.has(node.id)).concat(newNodes);
  graph.links = links.filter((link) => !linksToRemove.has(link[0])).concat(newLinks);
  graph.last_node_id = nextNodeId;
  graph.last_link_id = nextLinkId;

  log(`Expanded ${nodesToRemove.size} group nodes, added ${newNodes.length} nodes`);
  return graph;
}

// Default object_info for offline workflow conversion (no running instance needed)
// This covers common node types - extend as needed for new workflows
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
  QuadrupleCLIPLoader: {
    input: { required: { clip_name1: [['clip.safetensors'], {}], clip_name2: [['clip.safetensors'], {}], clip_name3: [['clip.safetensors'], {}], clip_name4: [['clip.safetensors'], {}] }, optional: {} },
    input_order: { required: ['clip_name1', 'clip_name2', 'clip_name3', 'clip_name4'], optional: [] },
  },
  AudioEncoderLoader: {
    input: { required: { audio_encoder_name: [['whisper_large_v3_fp16.safetensors'], {}] }, optional: {} },
    input_order: { required: ['audio_encoder_name'], optional: [] },
  },
  WanHuMoImageToVideo: {
    input: { required: { positive: ['CONDITIONING'], negative: ['CONDITIONING'], vae: ['VAE'], width: ['INT', { default: 640 }], height: ['INT', { default: 640 }], length: ['INT', { default: 97 }], batch_size: ['INT', { default: 1 }] }, optional: { audio_encoder_output: ['AUDIO_ENCODER_OUTPUT'], ref_image: ['IMAGE'] } },
    input_order: { required: ['positive', 'negative', 'vae', 'width', 'height', 'length', 'batch_size'], optional: ['audio_encoder_output', 'ref_image'] },
  },
  TextEncodeQwenImageEditPlus: {
    input: {
      required: { clip: ['CLIP'], vae: ['VAE'], prompt: ['STRING', { multiline: true }] },
      optional: { image1: ['IMAGE'], image2: ['IMAGE'], image3: ['IMAGE'] },
    },
    input_order: { required: ['clip', 'vae', 'prompt'], optional: ['image1', 'image2', 'image3'] },
  },
  ModelSamplingAuraFlow: {
    input: { required: { model: ['MODEL'], shift: ['FLOAT', { default: 1.73 }] }, optional: {} },
    input_order: { required: ['model', 'shift'], optional: [] },
  },
  CFGNorm: {
    input: { required: { model: ['MODEL'], strength: ['FLOAT', { default: 1.0 }] }, optional: {} },
    input_order: { required: ['model', 'strength'], optional: [] },
  },
  FluxKontextImageScale: {
    input: { required: { image: ['IMAGE'], max_pixels: ['INT', { default: 1048576 }] }, optional: {} },
    input_order: { required: ['image', 'max_pixels'], optional: [] },
  },
  ReferenceLatent: {
    input: { required: { conditioning: ['CONDITIONING'], latent: ['LATENT'] }, optional: {} },
    input_order: { required: ['conditioning', 'latent'], optional: [] },
  },
  KSamplerAdvanced: {
    input: {
      required: {
        model: ['MODEL'], positive: ['CONDITIONING'], negative: ['CONDITIONING'], latent_image: ['LATENT'],
        add_noise: [['enable', 'disable'], {}], noise_seed: ['INT', { default: 0 }],
        steps: ['INT', { default: 20 }], cfg: ['FLOAT', { default: 8.0 }],
        sampler_name: [['euler', 'euler_ancestral'], {}], scheduler: [['normal', 'simple'], {}],
        start_at_step: ['INT', { default: 0 }], end_at_step: ['INT', { default: 10000 }],
        return_with_leftover_noise: [['disable', 'enable'], {}],
      },
      optional: {},
    },
    input_order: {
      required: ['model', 'positive', 'negative', 'latent_image', 'add_noise', 'noise_seed', 'steps', 'cfg', 'sampler_name', 'scheduler', 'start_at_step', 'end_at_step', 'return_with_leftover_noise'],
      optional: [],
    },
  },
  EmptySD3LatentImage: {
    input: { required: { width: ['INT', {}], height: ['INT', {}], batch_size: ['INT', {}] }, optional: {} },
    input_order: { required: ['width', 'height', 'batch_size'], optional: [] },
  },
  EmptyHunyuanLatentVideo: {
    input: { required: { width: ['INT', {}], height: ['INT', {}], length: ['INT', {}], batch_size: ['INT', {}] }, optional: {} },
    input_order: { required: ['width', 'height', 'length', 'batch_size'], optional: [] },
  },
  WanImageToVideo: {
    input: { required: { width: ['INT', {}], height: ['INT', {}], length: ['INT', {}], batch_size: ['INT', {}] }, optional: {} },
    input_order: { required: ['width', 'height', 'length', 'batch_size'], optional: [] },
  },
  WanStartEndFrames: {
    input: { required: { width: ['INT', {}], height: ['INT', {}], length: ['INT', {}], batch_size: ['INT', {}] }, optional: {} },
    input_order: { required: ['width', 'height', 'length', 'batch_size'], optional: [] },
  },
  WanFirstLastFrameToVideo: {
    input: { required: { width: ['INT', {}], height: ['INT', {}], length: ['INT', {}], batch_size: ['INT', {}], positive: ['CONDITIONING'], negative: ['CONDITIONING'], vae: ['VAE'], start_image: ['IMAGE'], end_image: ['IMAGE'] }, optional: {} },
    input_order: { required: ['width', 'height', 'length', 'batch_size', 'positive', 'negative', 'vae', 'start_image', 'end_image'], optional: [] },
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
  LoraLoaderModelOnly: {
    input: { required: { model: ['MODEL'], lora_name: [['lora.safetensors'], {}], strength_model: ['FLOAT', {}] }, optional: {} },
    input_order: { required: ['model', 'lora_name', 'strength_model'], optional: [] },
  },
  ModelSamplingSD3: {
    input: { required: { model: ['MODEL'], shift: ['FLOAT', {}] }, optional: {} },
    input_order: { required: ['model', 'shift'], optional: [] },
  },
  // Video/Image processing
  VAEEncode: {
    input: { required: { pixels: ['IMAGE'], vae: ['VAE'] }, optional: {} },
    input_order: { required: ['pixels', 'vae'], optional: [] },
  },
  CreateVideo: {
    input: { required: { images: ['IMAGE'], fps: ['FLOAT', { default: 16 }] }, optional: { audio: ['AUDIO'] } },
    input_order: { required: ['images', 'fps'], optional: ['audio'] },
  },
  SaveVideo: {
    input: {
      required: {
        video: ['VIDEO'],
        filename_prefix: ['STRING', { default: 'video/ComfyUI' }],
        format: ['COMBO', { default: 'auto', options: ['auto', 'mp4'] }],
        codec: ['COMBO', { default: 'auto', options: ['auto', 'h264'] }],
      },
      optional: {},
    },
    input_order: { required: ['video', 'filename_prefix', 'format', 'codec'], optional: [] },
  },
  SaveAnimatedWEBP: {
    input: { required: { images: ['IMAGE'], filename_prefix: ['STRING', {}], fps: ['FLOAT', {}], lossless: ['BOOLEAN', {}], quality: ['INT', {}], method: [['default'], {}] }, optional: {} },
    input_order: { required: ['images', 'filename_prefix', 'fps', 'lossless', 'quality', 'method'], optional: [] },
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
      'WanImageToVideo', 'WanStartEndFrames', 'WanFirstLastFrameToVideo', 'WanHuMoImageToVideo',
    ];
    const [_nodeId, node] = findFirst(latentTypes);
    if (node) {
      if (params.width) node.inputs.width = params.width;
      if (params.height) node.inputs.height = params.height;
      if (params.length) node.inputs.length = params.length;
      if (params.batch_size) node.inputs.batch_size = params.batch_size;
    } else {
      // Try PrimitiveNode with "width"/"height" title (Flux2 style)
      if (params.width) {
        const [_wid, widthNode] = findNode(workflow, 'PrimitiveNode', 'width');
        if (widthNode && 'value' in (widthNode.inputs ?? {})) {
          widthNode.inputs.value = params.width;
        }
      }
      if (params.height) {
        const [_hid, heightNode] = findNode(workflow, 'PrimitiveNode', 'height');
        if (heightNode && 'value' in (heightNode.inputs ?? {})) {
          heightNode.inputs.value = params.height;
        }
      }
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
      } else {
        // Try other sampler types
        const [_rnid, randomNoiseNode] = findNode(workflow, 'RandomNoise');
        if (randomNoiseNode) {
          randomNoiseNode.inputs.noise_seed = params.seed;
        }
      }
    }
  }

  // Steps
  if (params.steps !== undefined) {
    const [_nodeId, node] = findFirst(['KSampler', 'KSamplerAdvanced', 'SamplerCustom', 'SamplerCustomAdvanced']);
    if (node) {
      node.inputs.steps = params.steps;
    } else {
      const [_fsid, fluxScheduler] = findNode(workflow, 'Flux2Scheduler');
      if (fluxScheduler) {
        fluxScheduler.inputs.steps = params.steps;
      }
    }
  }

  // CFG
  if (params.cfg !== undefined) {
    const [_nodeId, node] = findFirst(['KSampler', 'KSamplerAdvanced', 'SamplerCustom', 'SamplerCustomAdvanced']);
    if (node) {
      node.inputs.cfg = params.cfg;
    } else {
      const [_fgid, fluxGuidance] = findNode(workflow, 'FluxGuidance');
      if (fluxGuidance) {
        fluxGuidance.inputs.guidance = params.cfg;
      }
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
 * Convert ComfyUI graph format (from UI) to API format (for /prompt endpoint).
 */
export function graphToApi(graph: any, objectInfo?: Record<string, any>, debug: boolean = false): Record<string, any> {
  const log = debug ? console.debug.bind(console) : () => undefined;

  // First, expand any subgraphs/group nodes
  graph = expandSubgraphs(graph, debug);

  if (!objectInfo) {
    objectInfo = DEFAULT_OBJECT_INFO;
  }

  const api: Record<string, any> = {};
  const nodesById: Record<string, any> = {};
  const links: Record<string, [any, number]> = {};

  // Build lookups
  for (const node of graph.nodes || []) {
    nodesById[node.id] = node;
  }

  for (const link of graph.links || []) {
    const [linkId, fromNode, fromSlot] = link;
    links[linkId] = [fromNode, fromSlot];
  }

  const isSkippedNode = (node: any): boolean => {
    if (!node) return true;
    const classType = node.type;
    if (!classType || ['Note', 'Reroute', 'MarkdownNote'].includes(classType)) {
      return true;
    }
    // mode 2 = muted, mode 4 = bypassed
    if ([2, 4].includes(node.mode ?? 0)) {
      return true;
    }
    return false;
  };

  // Follow a link through skipped nodes (reroutes, bypassed) to the real source.
  const resolveLink = (linkId: any, visited: Set<string> = new Set()): [any, number] | null => {
    const key = String(linkId);
    if (visited.has(key)) return null; // Cycle detection
    visited.add(key);
    if (!(key in links)) return null;

    const [fromNodeId, fromSlot] = links[key];
    const fromNode = nodesById[fromNodeId];

    if (!isSkippedNode(fromNode)) {
      return [fromNodeId, fromSlot];
    }

    // Node is skipped - follow through its input; output slot 0 passes through input slot 0
    if (fromSlot === 0 && fromNode) {
      const nodeInputs = fromNode.inputs ?? [];
      if (nodeInputs.length) {
        const upstreamLink = nodeInputs[0].link;
        if (upstreamLink !== null && upstreamLink !== undefined) {
          return resolveLink(upstreamLink, visited);
        }
      }
    }
    return null;
  };

  // Convert nodes
  for (const node of graph.nodes || []) {
    const nodeId = String(node.id);
    const classType = node.type;

    if (!classType || ['Note', 'Reroute', 'MarkdownNote'].includes(classType)) {
      continue;
    }

    if ([2, 4].includes(node.mode ?? 0)) {
      continue; // Skip muted/bypassed
    }

    const info = objectInfo[classType] || {};
    const inputs: Record<string, any> = {};

    // Get input specs from schema
    const inputSpecs: Record<string, any> = {};
    for (const section of ['required', 'optional']) {
      for (const [name, spec] of Object.entries(info.input?.[section] ?? {})) {
        inputSpecs[name] = spec;
      }
    }

    // Get input order from schema; fall back to input spec keys for older ComfyUI
    const inputOrder = [...(info.input_order?.required || []), ...(info.input_order?.optional || [])];
    if (inputOrder.length === 0 && Object.keys(inputSpecs).length > 0) {
      inputOrder.push(
        ...Object.keys(info.input?.required ?? {}),
        ...Object.keys(info.input?.optional ?? {}),
      );
    }

    // Map connections
    const connectedInputs = new Set<string>();
    for (const inp of node.inputs || []) {
      const linkId = inp.link;
      if (linkId !== null && linkId !== undefined) {
        const resolved = resolveLink(linkId);
        if (resolved) {
          const [fromNode, fromSlot] = resolved;
          inputs[inp.name] = [String(fromNode), fromSlot];
          connectedInputs.add(inp.name);
        }
      }
    }

    // Map widget values to unconnected inputs with type validation
    const widgets = node.widgets_values ?? [];
    if (!Array.isArray(widgets) && widgets && typeof widgets === 'object') {
      // Some nodes use dict format for widgets
      for (const [name, value] of Object.entries(widgets)) {
        if (!connectedInputs.has(name)) {
          inputs[name] = value;
        }
      }
    } else {
      // List format - map positionally to input names, skipping UI-only widgets
      let wIdx = 0;
      for (const name of inputOrder) {
        if (connectedInputs.has(name)) continue;
        const inputSpec = inputSpecs[name];
        while (wIdx < widgets.length) {
          const value = widgets[wIdx];
          wIdx += 1;
          if (valueMatchesType(value, inputSpec)) {
            inputs[name] = value;
            break;
          }
          // Skip UI-only widgets (e.g., 'randomize', 'fixed', etc.)
        }
      }
    }

    log(`node ${nodeId} (${classType}) inputs: ${JSON.stringify(inputs)}`);

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
        headers: await this.resolvedAuthHeaders(),
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
   * Connect to a specific ComfyUI instance by job ID or hostname.
   */
  static async getInstance(
    client: HyperCLI,
    instance: string,
    options: { useLb?: boolean; useAuth?: boolean } = {},
  ): Promise<ComfyUIJob> {
    let job: Job | null = null;
    // Check if it looks like a UUID (job ID)
    if (instance.includes('-') && instance.length > 30) {
      job = await client.jobs.get(instance);
    } else {
      // Assume hostname - search running jobs
      const jobs = await client.jobs.list('running');
      for (const candidate of jobs) {
        if (candidate.hostname && (candidate.hostname === instance || candidate.hostname.startsWith(instance))) {
          job = candidate;
          break;
        }
      }
      if (!job) {
        throw new Error(`No running job found with hostname: ${instance}`);
      }
    }
    return new ComfyUIJob(client, job, undefined, Boolean(options.useLb), Boolean(options.useAuth));
  }

  /**
   * Get existing running job or create new one for a template.
   *
   * If reuse is true and a ComfyUI job is already running, it will be reused
   * (note: the existing job may have different models loaded).
   */
  static async getOrCreateForTemplate(
    client: HyperCLI,
    template: string,
    options: {
      gpuType?: string;
      gpuCount?: number;
      runtime?: number;
      reuse?: boolean;
      lb?: number;
      auth?: boolean;
      [key: string]: any;
    } = {},
  ): Promise<ComfyUIJob> {
    const { reuse = true, gpuType, gpuCount, runtime, lb, auth = false, ...kwargs } = options;

    if (reuse) {
      const existing = await ComfyUIJob.getRunning(client, ComfyUIJob.DEFAULT_IMAGE);
      if (existing) {
        existing.template = template;
        existing.useLb = Boolean(lb);
        existing.useAuth = auth;
        return existing;
      }
    }

    return ComfyUIJob.createForTemplate(client, template, {
      gpuType,
      gpuCount,
      runtime,
      lb,
      auth,
      ...kwargs,
    });
  }

  /**
   * Load workflow template JSON in graph format.
   *
   * Unlike the Python SDK, Node has no comfyui-workflow-templates package, so
   * the ID must resolve to a JSON file (see the module-level loadTemplate).
   */
  loadTemplate(templateId: string, options: { templatesDir?: string } = {}): Record<string, any> {
    return loadTemplate(templateId, options);
  }

  // =========================================================================
  // ComfyUI Manager - Custom Node Installation
  // =========================================================================

  private async comfyJson(
    method: string,
    path: string,
    options: { params?: Record<string, string>; body?: any; timeout?: number; retries?: number } = {},
  ): Promise<any> {
    const response = await requestWithRetry({
      method,
      url: `${this.baseUrl}${path}`,
      headers: {
        ...(await this.resolvedAuthHeaders()),
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      params: options.params,
      body: options.body,
      timeout: options.timeout ?? 60000,
      retries: options.retries ?? 3,
    });
    if (response.status >= 400) {
      const text = await response.text();
      throw new Error(`ComfyUI ${method} ${path} failed (${response.status}): ${text}`);
    }
    return response.json();
  }

  private async resolvedAuthHeaders(): Promise<Record<string, string>> {
    if (this.useAuth) {
      await this.jobToken();
    }
    return this.authHeaders;
  }

  private static isTransientNetworkError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    // fetch() throws TypeError on connect/DNS failures; AbortError on timeout.
    return error instanceof TypeError || error.name === 'AbortError';
  }

  /**
   * Get set of available node class_types from ComfyUI's /object_info.
   */
  async getAvailableNodeTypes(): Promise<Set<string>> {
    const info = await this.comfyJson('GET', '/object_info', { timeout: 60000 });
    return new Set(Object.keys(info ?? {}));
  }

  /**
   * Extract all class_type values from a workflow (API format or UI format).
   */
  getWorkflowNodeTypes(workflow: Record<string, any>): Set<string> {
    const classTypes = new Set<string>();

    // UI format: {"nodes": [{"type": "..."}, ...]}
    if (Array.isArray(workflow?.nodes)) {
      for (const node of workflow.nodes) {
        if (node && typeof node.type === 'string') {
          classTypes.add(node.type);
        }
      }
    } else {
      // API format: {"1": {"class_type": "..."}, ...}
      for (const nodeData of Object.values(workflow ?? {})) {
        if (nodeData && typeof nodeData === 'object' && typeof (nodeData as any).class_type === 'string') {
          classTypes.add((nodeData as any).class_type);
        }
      }
    }
    return classTypes;
  }

  /**
   * Find node types in workflow that aren't available in ComfyUI.
   */
  async getMissingNodeTypes(workflow: Record<string, any>): Promise<Set<string>> {
    const available = await this.getAvailableNodeTypes();
    const required = this.getWorkflowNodeTypes(workflow);
    const missing = new Set<string>();
    for (const nodeType of required) {
      if (!available.has(nodeType)) {
        missing.add(nodeType);
      }
    }
    return missing;
  }

  /**
   * Get node class_type to package mappings from ComfyUI Manager.
   *
   * Returns a mapping of package URL to [node_list, metadata].
   */
  async getNodeMappings(): Promise<Record<string, any>> {
    return await this.comfyJson('GET', '/customnode/getmappings', { timeout: 60000 });
  }

  /**
   * Look up which packages provide the given node types.
   *
   * Returns a mapping of package URL to the node types it provides.
   */
  async lookupPackagesForNodes(nodeTypes: Iterable<string>): Promise<Record<string, string[]>> {
    const mappings = await this.getNodeMappings();

    // Invert the mapping: node_type -> package_url
    const nodeToPackage: Record<string, string> = {};
    for (const [url, data] of Object.entries(mappings ?? {})) {
      if (Array.isArray(data) && data.length > 0 && Array.isArray(data[0])) {
        for (const node of data[0]) {
          nodeToPackage[node] = url;
        }
      }
    }

    // Group requested nodes by package
    const packages: Record<string, string[]> = {};
    for (const nodeType of nodeTypes) {
      const pkg = nodeToPackage[nodeType];
      if (pkg) {
        (packages[pkg] ??= []).push(nodeType);
      }
    }
    return packages;
  }

  /**
   * Get the full list of available custom node packages.
   */
  async getCustomNodeList(): Promise<Record<string, any>> {
    return await this.comfyJson('GET', '/customnode/getlist', {
      params: { skip_update: 'true' },
      timeout: 60000,
    });
  }

  /**
   * Install custom node packages by their repository URLs. Returns
   * { queued, failed, notFound } package titles/URLs.
   */
  async installPackagesByUrl(packageUrls: string[]): Promise<{ queued: string[]; failed: string[]; notFound: string[] }> {
    const results = { queued: [] as string[], failed: [] as string[], notFound: [] as string[] };

    const pkgList = await this.getCustomNodeList();
    const nodePacks: Record<string, any> = pkgList?.node_packs ?? {};

    const urlToMetadata: Record<string, any> = {};
    for (const metadata of Object.values(nodePacks)) {
      for (const url of (metadata as any)?.files ?? []) {
        urlToMetadata[url] = metadata;
      }
    }

    for (const url of packageUrls) {
      const metadata = urlToMetadata[url];
      if (!metadata) {
        results.notFound.push(url);
        continue;
      }
      const response = await requestWithRetry({
        method: 'POST',
        url: `${this.baseUrl}/manager/queue/install`,
        headers: {
          ...(await this.resolvedAuthHeaders()),
          'Content-Type': 'application/json',
        },
        body: metadata,
        retries: 1,
        timeout: 60000,
      });
      if (response.status === 200 || response.status === 201) {
        results.queued.push(metadata.title || url);
      } else {
        results.failed.push(metadata.title || url);
      }
    }

    // Start processing if we queued anything
    if (results.queued.length) {
      await requestWithRetry({
        method: 'GET',
        url: `${this.baseUrl}/manager/queue/start`,
        headers: await this.resolvedAuthHeaders(),
        retries: 1,
        timeout: 60000,
      });
    }

    return results;
  }

  /**
   * Automatically install missing custom nodes for a workflow.
   */
  async autoInstallWorkflowNodes(
    workflow: Record<string, any>,
    options: { wait?: boolean; reboot?: boolean } = {},
  ): Promise<{
    missingNodes: string[];
    packagesToInstall: Record<string, string[]>;
    installed: string[];
    failed: string[];
    notFoundNodes: string[];
  }> {
    const { wait = true, reboot = true } = options;
    const results = {
      missingNodes: [] as string[],
      packagesToInstall: {} as Record<string, string[]>,
      installed: [] as string[],
      failed: [] as string[],
      notFoundNodes: [] as string[],
    };

    const missing = await this.getMissingNodeTypes(workflow);
    if (!missing.size) {
      return results;
    }
    results.missingNodes = [...missing];

    const packages = await this.lookupPackagesForNodes(missing);
    results.packagesToInstall = packages;

    const foundNodes = new Set(Object.values(packages).flat());
    results.notFoundNodes = [...missing].filter((nodeType) => !foundNodes.has(nodeType));

    if (!Object.keys(packages).length) {
      return results;
    }

    const installResult = await this.installPackagesByUrl(Object.keys(packages));
    results.installed = installResult.queued;
    results.failed = [...installResult.failed, ...installResult.notFound];

    // Wait for installation (max 3 minutes)
    if (wait && results.installed.length) {
      const headers = await this.resolvedAuthHeaders();
      for (let attempt = 0; attempt < 180; attempt += 1) {
        await sleep(1000);
        const response = await requestWithRetry({
          method: 'GET',
          url: `${this.baseUrl}/manager/queue/status`,
          headers,
          retries: 1,
          timeout: 60000,
        }).catch(() => null);
        if (response && response.status === 200) {
          const status: any = await response.json();
          if (!status?.is_processing) {
            break;
          }
        }
      }
    }

    if (reboot && results.installed.length) {
      await this.reboot();
    }

    return results;
  }

  /**
   * Get list of installed custom nodes from ComfyUI Manager.
   */
  async getInstalledNodes(): Promise<Record<string, any>> {
    return await this.comfyJson('GET', '/customnode/installed', { timeout: 30000 });
  }

  /**
   * Install a custom node package via ComfyUI Manager.
   * Returns true if installation was queued successfully.
   */
  async installNode(nodeName: string): Promise<boolean> {
    const headers = await this.resolvedAuthHeaders();
    const response = await requestWithRetry({
      method: 'POST',
      url: `${this.baseUrl}/manager/queue/install`,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: { name: nodeName },
      retries: 1,
      timeout: 60000,
    });
    if (response.status !== 200 && response.status !== 201) {
      return false;
    }
    const start = await requestWithRetry({
      method: 'GET',
      url: `${this.baseUrl}/manager/queue/start`,
      headers,
      retries: 1,
      timeout: 60000,
    });
    return start.status === 200 || start.status === 201;
  }

  /**
   * Install multiple custom node packages. Returns { queued, failed }.
   */
  async installNodes(nodeNames: string[], options: { wait?: boolean } = {}): Promise<{ queued: string[]; failed: string[] }> {
    const { wait = true } = options;
    const results = { queued: [] as string[], failed: [] as string[] };
    const headers = await this.resolvedAuthHeaders();

    for (const name of nodeNames) {
      const response = await requestWithRetry({
        method: 'POST',
        url: `${this.baseUrl}/manager/queue/install`,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: { name },
        retries: 1,
        timeout: 60000,
      });
      if (response.status === 200 || response.status === 201) {
        results.queued.push(name);
      } else {
        results.failed.push(name);
      }
    }

    if (!results.queued.length) {
      return results;
    }

    await requestWithRetry({
      method: 'GET',
      url: `${this.baseUrl}/manager/queue/start`,
      headers,
      retries: 1,
      timeout: 60000,
    });

    // Wait for completion (max 2 minutes)
    if (wait) {
      for (let attempt = 0; attempt < 120; attempt += 1) {
        await sleep(1000);
        const response = await requestWithRetry({
          method: 'GET',
          url: `${this.baseUrl}/manager/queue/status`,
          headers,
          retries: 1,
          timeout: 60000,
        }).catch(() => null);
        if (response && response.status === 200) {
          const status: any = await response.json();
          if (!status?.is_processing) {
            break;
          }
        }
      }
    }

    return results;
  }

  /**
   * Reboot ComfyUI server (required after installing nodes).
   */
  async reboot(options: { waitReady?: boolean; timeoutSeconds?: number } = {}): Promise<boolean> {
    const { waitReady = true, timeoutSeconds = 120 } = options;
    try {
      await requestWithRetry({
        method: 'GET',
        url: `${this.baseUrl}/manager/reboot`,
        headers: await this.resolvedAuthHeaders(),
        retries: 1,
        timeout: 10000,
      });
    } catch {
      // The server may not respond as it is rebooting; that is expected.
    }

    if (waitReady) {
      // Wait a moment for the server to start shutting down
      await sleep(3000);
      return await this.waitReady(timeoutSeconds * 1000);
    }
    return true;
  }

  /**
   * Ensure custom nodes are installed, installing missing ones. Returns
   * { alreadyInstalled, installed, failed }.
   */
  async ensureNodesInstalled(
    nodeNames: string[],
  ): Promise<{ alreadyInstalled: string[]; installed: string[]; failed: string[] }> {
    const results = {
      alreadyInstalled: [] as string[],
      installed: [] as string[],
      failed: [] as string[],
    };

    let installedNames: Set<string>;
    try {
      const installed = await this.getInstalledNodes();
      installedNames = new Set(installed && typeof installed === 'object' ? Object.keys(installed) : []);
    } catch {
      installedNames = new Set();
    }

    results.alreadyInstalled = nodeNames.filter((name) => installedNames.has(name));
    const missing = nodeNames.filter((name) => !installedNames.has(name));

    if (!missing.length) {
      return results;
    }

    const installResult = await this.installNodes(missing, { wait: true });
    results.installed = installResult.queued;
    results.failed = installResult.failed;

    if (results.installed.length) {
      await this.reboot();
    }

    return results;
  }

  /**
   * Submit workflow to ComfyUI, returns prompt_id.
   * Retries on connection errors including DNS failures.
   */
  async queuePrompt(workflow: Record<string, any>, retries: number = 5): Promise<string> {
    let lastError: unknown;
    for (let attempt = 0; attempt < retries; attempt += 1) {
      try {
        const response = await fetch(`${this.baseUrl}/prompt`, {
          method: 'POST',
          headers: {
            ...(await this.resolvedAuthHeaders()),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ prompt: workflow }),
          signal: AbortSignal.timeout(30000),
        });
        if (response.status !== 200) {
          let errorDetail: any;
          try {
            errorDetail = await response.json();
          } catch {
            errorDetail = await response.text();
          }
          throw new Error(`ComfyUI prompt failed (${response.status}): ${JSON.stringify(errorDetail)}`);
        }
        const data: any = await response.json();
        return data.prompt_id;
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('ComfyUI prompt failed')) {
          throw error;
        }
        if (!ComfyUIJob.isTransientNetworkError(error)) {
          throw error;
        }
        lastError = error;
        if (attempt < retries - 1) {
          await sleep(2 ** attempt * 1000); // Exponential backoff
          continue;
        }
        throw error;
      }
    }
    throw lastError;
  }

  /**
   * Get execution history for a prompt. Retries on connection errors including
   * DNS failures.
   */
  async getHistory(promptId: string, retries: number = 5): Promise<Record<string, any> | null> {
    for (let attempt = 0; attempt < retries; attempt += 1) {
      try {
        const response = await fetch(`${this.baseUrl}/history/${encodeURIComponent(promptId)}`, {
          headers: await this.resolvedAuthHeaders(),
          signal: AbortSignal.timeout(30000),
        });
        if (response.status >= 400) {
          throw new Error(`ComfyUI history failed (${response.status}): ${await response.text()}`);
        }
        const data: any = await response.json();
        return data?.[promptId] ?? null;
      } catch (error) {
        if (!ComfyUIJob.isTransientNetworkError(error)) {
          throw error;
        }
        if (attempt < retries - 1) {
          await sleep(2 ** attempt * 1000); // Exponential backoff: 1s, 2s, 4s, 8s
          continue;
        }
        throw error;
      }
    }
    return null;
  }

  /**
   * Wait for prompt execution to complete, returns the history entry.
   */
  async waitForCompletion(
    promptId: string,
    options: { timeoutSeconds?: number; pollIntervalSeconds?: number } = {},
  ): Promise<Record<string, any>> {
    const timeoutSeconds = options.timeoutSeconds ?? 300;
    const pollIntervalSeconds = options.pollIntervalSeconds ?? 2;
    const start = Date.now();
    let consecutiveErrors = 0;
    const maxConsecutiveErrors = 10; // Handle DNS propagation delays

    while (Date.now() - start < timeoutSeconds * 1000) {
      try {
        const history = await this.getHistory(promptId);
        consecutiveErrors = 0;
        if (history) {
          const status = history.status ?? {};
          if (status.completed) {
            return history;
          }
          if (status.status_str === 'error') {
            throw new Error(`Workflow execution failed: ${JSON.stringify(status)}`);
          }
        }
      } catch (error) {
        if (!ComfyUIJob.isTransientNetworkError(error)) {
          throw error;
        }
        consecutiveErrors += 1;
        if (consecutiveErrors >= maxConsecutiveErrors) {
          throw new Error(`Lost connection to ComfyUI after ${consecutiveErrors} retries: ${error}`);
        }
        await sleep(pollIntervalSeconds * 2 * 1000);
        continue;
      }
      await sleep(pollIntervalSeconds * 1000);
    }
    throw new Error(`Workflow did not complete within ${timeoutSeconds}s`);
  }

  /**
   * Download output file from ComfyUI server.
   * If the file already exists, increments the name (file_1.png, file_2.png, etc.)
   */
  async downloadOutput(
    filename: string,
    options: { outputDir?: string; subfolder?: string; retries?: number } = {},
  ): Promise<string> {
    const outputDir = options.outputDir ?? '.';
    const subfolder = options.subfolder ?? '';
    const retries = options.retries ?? 5;
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    const params = new URLSearchParams({ filename, type: 'output' });
    if (subfolder) params.set('subfolder', subfolder);
    const url = `${this.baseUrl}/view?${params.toString()}`;

    for (let attempt = 0; attempt < retries; attempt += 1) {
      try {
        const response = await fetch(url, {
          headers: await this.resolvedAuthHeaders(),
          signal: AbortSignal.timeout(120000),
        });
        if (response.status >= 400) {
          throw new Error(`ComfyUI download failed (${response.status}): ${await response.text()}`);
        }
        const content = Buffer.from(await response.arrayBuffer());

        // Auto-increment filename if exists
        let outputPath = join(outputDir, filename);
        if (existsSync(outputPath)) {
          const dotIndex = filename.lastIndexOf('.');
          const stem = dotIndex > 0 ? filename.slice(0, dotIndex) : filename;
          const suffix = dotIndex > 0 ? filename.slice(dotIndex) : '';
          let index = 1;
          while (existsSync(outputPath)) {
            outputPath = join(outputDir, `${stem}_${index}${suffix}`);
            index += 1;
          }
        }
        writeFileSync(outputPath, content);
        return outputPath;
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('ComfyUI download failed')) {
          throw error;
        }
        if (!ComfyUIJob.isTransientNetworkError(error)) {
          throw error;
        }
        if (attempt < retries - 1) {
          await sleep(2 ** attempt * 1000);
          continue;
        }
        throw error;
      }
    }
    throw new Error('ComfyUI download failed');
  }

  /**
   * Run a workflow and wait for completion.
   */
  async run(
    workflow: Record<string, any>,
    options: { timeoutSeconds?: number; convert?: boolean } = {},
  ): Promise<Record<string, any>> {
    const { timeoutSeconds = 300, convert = true } = options;

    // Detect format and convert if needed
    if (convert && 'nodes' in workflow) {
      workflow = await this.convertWorkflow(workflow);
    }

    const promptId = await this.queuePrompt(workflow);
    return await this.waitForCompletion(promptId, { timeoutSeconds });
  }

  /**
   * Run a template workflow with parameter overrides.
   */
  async runTemplate(
    templateId: string,
    options: { timeoutSeconds?: number; templatesDir?: string; params?: Record<string, any> } = {},
  ): Promise<Record<string, any>> {
    const graph = this.loadTemplate(templateId, { templatesDir: options.templatesDir });
    const workflow = await this.convertWorkflow(graph);

    // Apply parameter overrides using type-based node lookup
    if (options.params) {
      applyParams(workflow, options.params);
    }

    return await this.run(workflow, { timeoutSeconds: options.timeoutSeconds, convert: false });
  }

  /**
   * Extract output file info from a history entry (images, videos, gifs).
   */
  getOutputImages(history: Record<string, any>): Array<Record<string, any>> {
    const outputs: Array<Record<string, any>> = [];
    for (const nodeOutput of Object.values(history?.outputs ?? {})) {
      for (const key of ['images', 'videos', 'gifs']) {
        const items = (nodeOutput as any)?.[key];
        if (Array.isArray(items)) {
          outputs.push(...items);
        }
      }
    }
    return outputs;
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
      headers: await this.resolvedAuthHeaders(),
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
      headers: await this.resolvedAuthHeaders(),
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Failed to upload audio: ${response.statusText}`);
    }

    const data: any = await response.json();
    return data.name || fname;
  }
}
