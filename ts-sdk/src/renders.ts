/**
 * Renders API - managed AI rendering workflows
 */
import type { HTTPClient } from './http.js';
import { APIError } from './errors.js';

export interface Render {
  renderId: string;
  state: string;
  template: string | null;
  renderType: string | null;
  tags: string[] | null;
  resultUrl: string | null;
  error: string | null;
  createdAt: number | null;
  startedAt: number | null;
  completedAt: number | null;
}

export interface RenderStatus {
  renderId: string;
  state: string;
  progress: number | null;
}

function renderFromDict(data: any): Render {
  return {
    renderId: data.id || data.render_id || '',
    state: data.state || '',
    template: data.template || data.meta?.template || null,
    renderType: data.type || data.render_type || null,
    tags: Array.isArray(data.tags) ? data.tags : null,
    resultUrl: data.result_url || null,
    error: data.error || null,
    createdAt: data.created_at || null,
    startedAt: data.started_at || null,
    completedAt: data.completed_at || null,
  };
}

function renderStatusFromDict(data: any): RenderStatus {
  return {
    renderId: data.id || data.render_id || '',
    state: data.state || '',
    progress: data.progress ?? null,
  };
}

export class Renders {
  static readonly DEFAULT_WAIT_TIMEOUT = 3600_000;
  static readonly DEFAULT_QUEUE_GRACE = 1800_000;
  static readonly DEFAULT_ACTIVE_GRACE = 300_000;

  private authMeCache: any | null = null;

  constructor(private http: HTTPClient, private authHttp: HTTPClient = http) {}

  private async authMe(): Promise<any> {
    if (this.authMeCache == null) {
      this.authMeCache = await this.authHttp.get('/api/auth/me');
    }
    return this.authMeCache;
  }

  private async supportsSubscriptionFamily(family: string, resource?: string): Promise<boolean> {
    try {
      const authMe = await this.authMe();
      if (!authMe?.has_active_subscription) {
        return false;
      }
      if (authMe.auth_type === 'user') {
        return true;
      }
      const capabilities = new Set(Array.isArray(authMe.capabilities) ? authMe.capabilities : []);
      if (capabilities.has(`${family}:*`)) {
        return true;
      }
      return Boolean(resource && capabilities.has(`${family}:${resource}`));
    } catch (error) {
      if (error instanceof APIError) {
        return false;
      }
      throw error;
    }
  }

  private async postFlow(flowType: string, payload: Record<string, any>): Promise<any> {
    const primary = (await this.supportsSubscriptionFamily('flows', flowType))
      ? `/agents/flow/${flowType}`
      : `/api/flow/${flowType}`;
    try {
      return await this.http.post(primary, payload);
    } catch (error) {
      if (primary.startsWith('/agents/flow/') && error instanceof APIError && (error.statusCode === 403 || error.statusCode === 404)) {
        return await this.http.post(`/api/flow/${flowType}`, payload);
      }
      throw error;
    }
  }

  private async getRender(renderId: string, status: boolean = false): Promise<any> {
    const suffix = status ? '/status' : '';
    const primary = (await this.supportsSubscriptionFamily('flows'))
      ? `/agents/flow/renders/${renderId}${suffix}`
      : `/api/flow/renders/${renderId}${suffix}`;
    try {
      return await this.http.get(primary);
    } catch (error) {
      if (primary.startsWith('/agents/flow/') && error instanceof APIError && (error.statusCode === 403 || error.statusCode === 404)) {
        return await this.http.get(`/api/flow/renders/${renderId}${suffix}`);
      }
      throw error;
    }
  }

  private async deleteRender(renderId: string): Promise<any> {
    const primary = (await this.supportsSubscriptionFamily('flows'))
      ? `/agents/flow/renders/${renderId}`
      : `/api/flow/renders/${renderId}`;
    try {
      return await this.http.delete(primary);
    } catch (error) {
      if (primary.startsWith('/agents/flow/') && error instanceof APIError && (error.statusCode === 403 || error.statusCode === 404)) {
        return await this.http.delete(`/api/flow/renders/${renderId}`);
      }
      throw error;
    }
  }

  /**
   * List all renders
   */
  async list(options?: {
    state?: string;
    template?: string;
    type?: string;
    tags?: string[];
  }): Promise<Render[]> {
    const params: Record<string, string> = {};
    if (options?.state) params.state = options.state;
    if (options?.template) params.template = options.template;
    if (options?.type) params.type = options.type;
    if (options?.tags?.length) {
      (params as unknown as Record<string, string | string[]>).tag = [...options.tags];
    }

    const data = await this.http.get('/api/renders', params);
    const items = typeof data === 'object' && data.items ? data.items : data;
    return (items || []).map(renderFromDict);
  }

  /**
   * Get render details
   */
  async get(renderId: string): Promise<Render> {
    const data = await this.getRender(renderId);
    return renderFromDict(data);
  }

  /**
   * Create a new render
   */
  async create(
    params: Record<string, any>,
    renderType: string = 'comfyui',
    notifyUrl?: string,
    tags?: string[],
  ): Promise<Render> {
    const payload: any = {
      type: renderType,
      params,
    };
    if (notifyUrl) {
      payload.notify_url = notifyUrl;
    }
    if (tags?.length) {
      payload.tags = [...tags];
    }

    const data = await this.http.post('/api/renders', payload);
    return renderFromDict(data);
  }

  /**
   * Cancel a render
   */
  async cancel(renderId: string): Promise<any> {
    return await this.deleteRender(renderId);
  }

  /**
   * Get render status (lightweight polling endpoint)
   */
  async status(renderId: string): Promise<RenderStatus> {
    const data = await this.getRender(renderId, true);
    return renderStatusFromDict(data);
  }

  async wait(
    renderId: string,
    options?: {
      timeoutMs?: number;
      pollIntervalMs?: number;
      queueGraceMs?: number;
      activeGraceMs?: number;
    },
  ): Promise<Render> {
    const timeoutMs = options?.timeoutMs ?? Renders.DEFAULT_WAIT_TIMEOUT;
    const pollIntervalMs = options?.pollIntervalMs ?? 5000;
    const queueGraceMs = options?.queueGraceMs ?? Renders.DEFAULT_QUEUE_GRACE;
    const activeGraceMs = options?.activeGraceMs ?? Renders.DEFAULT_ACTIVE_GRACE;

    let deadline = Date.now() + timeoutMs;
    let queueGraceUsed = false;
    let activeGraceUsed = false;
    let lastRender: Render | null = null;

    while (true) {
      const render = await this.get(renderId);
      lastRender = render;
      const state = (render.state || '').toLowerCase();
      if (state === 'completed' || state === 'failed' || state === 'cancelled') {
        return render;
      }

      const now = Date.now();
      if (now >= deadline) {
        const startedAt = this.parseRenderTimestamp(render.startedAt);
        if (!queueGraceUsed && startedAt == null) {
          queueGraceUsed = true;
          deadline = now + queueGraceMs;
        } else if (!activeGraceUsed && startedAt != null) {
          activeGraceUsed = true;
          deadline = Math.max(deadline, startedAt + activeGraceMs);
        } else {
          throw new Error(
            `Render ${renderId} did not complete within ${(timeoutMs / 1000).toFixed(0)}s ` +
            `(+${(queueGraceMs / 1000).toFixed(0)}s queue grace, +${(activeGraceMs / 1000).toFixed(0)}s active grace); ` +
            `lastRender=${JSON.stringify(lastRender)}`,
          );
        }
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  }

  // =========================================================================
  // Flow endpoints - simplified interfaces
  // =========================================================================

  private parseRenderTimestamp(value: unknown): number | null {
    if (value == null) return null;
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      return Number.isNaN(parsed) ? null : parsed;
    }
    return null;
  }

  async flow(flowType: string, params: Record<string, any>): Promise<Render> {
    // Filter out null/undefined values
    const payload: Record<string, any> = {};
    for (const [key, value] of Object.entries(params)) {
      if (value !== null && value !== undefined) {
        payload[key] = value;
      }
    }

    const data = await this.postFlow(flowType, payload);
    return renderFromDict(data);
  }

  /**
   * Generate an image using Qwen-Image
   */
  async textToImage(options: {
    prompt: string;
    negative?: string;
    width?: number;
    height?: number;
    notifyUrl?: string;
  }): Promise<Render> {
    return this.flow('text-to-image', {
      prompt: options.prompt,
      negative: options.negative,
      width: options.width,
      height: options.height,
      notify_url: options.notifyUrl,
    });
  }

  /**
   * Generate an image using HiDream I1 Full
   */
  async textToImageHidream(options: {
    prompt: string;
    negative?: string;
    width?: number;
    height?: number;
    notifyUrl?: string;
  }): Promise<Render> {
    return this.flow('text-to-image-hidream', {
      prompt: options.prompt,
      negative: options.negative,
      width: options.width,
      height: options.height,
      notify_url: options.notifyUrl,
    });
  }

  /**
   * Generate a video using Wan 2.2 14B
   */
  async textToVideo(options: {
    prompt: string;
    negative?: string;
    width?: number;
    height?: number;
    notifyUrl?: string;
  }): Promise<Render> {
    return this.flow('text-to-video', {
      prompt: options.prompt,
      negative: options.negative,
      width: options.width,
      height: options.height,
      notify_url: options.notifyUrl,
    });
  }

  /**
   * Animate an image using Wan 2.2 Animate
   */
  async imageToVideo(options: {
    prompt: string;
    imageUrl?: string;
    fileIds?: string[];
    negative?: string;
    width?: number;
    height?: number;
    notifyUrl?: string;
  }): Promise<Render> {
    return this.flow('image-to-video', {
      prompt: options.prompt,
      image_url: options.imageUrl,
      file_ids: options.fileIds,
      negative: options.negative,
      width: options.width,
      height: options.height,
      notify_url: options.notifyUrl,
    });
  }

  /**
   * Generate a lip-sync video using HuMo
   */
  async speakingVideo(options: {
    prompt: string;
    imageUrl?: string;
    audioUrl?: string;
    fileIds?: string[];
    negative?: string;
    length?: number;
    width?: number;
    height?: number;
    notifyUrl?: string;
  }): Promise<Render> {
    return this.flow('speaking-video', {
      prompt: options.prompt,
      image_url: options.imageUrl,
      audio_url: options.audioUrl,
      file_ids: options.fileIds,
      negative: options.negative,
      length: options.length,
      width: options.width,
      height: options.height,
      notify_url: options.notifyUrl,
    });
  }

  /**
   * Generate an audio-driven video using Wan 2.2 S2V
   */
  async speakingVideoWan(options: {
    prompt: string;
    imageUrl: string;
    audioUrl: string;
    negative?: string;
    width?: number;
    height?: number;
    notifyUrl?: string;
  }): Promise<Render> {
    return this.flow('speaking-video-wan', {
      prompt: options.prompt,
      image_url: options.imageUrl,
      audio_url: options.audioUrl,
      negative: options.negative,
      width: options.width,
      height: options.height,
      notify_url: options.notifyUrl,
    });
  }

  /**
   * Transform images using Qwen Image Edit
   */
  async imageToImage(options: {
    prompt: string;
    imageUrls?: string[];
    fileIds?: string[];
    negative?: string;
    width?: number;
    height?: number;
    notifyUrl?: string;
  }): Promise<Render> {
    return this.flow('image-to-image', {
      prompt: options.prompt,
      image_urls: options.imageUrls,
      file_ids: options.fileIds,
      negative: options.negative,
      width: options.width,
      height: options.height,
      notify_url: options.notifyUrl,
    });
  }

  /**
   * Generate video morphing between two images using Wan 2.2
   */
  async firstLastFrameVideo(options: {
    prompt: string;
    startImageUrl?: string;
    endImageUrl?: string;
    fileIds?: string[];
    negative?: string;
    width?: number;
    height?: number;
    notifyUrl?: string;
  }): Promise<Render> {
    return this.flow('first-last-frame-video', {
      prompt: options.prompt,
      start_image_url: options.startImageUrl,
      end_image_url: options.endImageUrl,
      file_ids: options.fileIds,
      negative: options.negative,
      width: options.width,
      height: options.height,
      notify_url: options.notifyUrl,
    });
  }

  /**
   * Transcribe audio/video to text using WhisperX
   */
  async audioToText(options: {
    audioUrl?: string;
    fileIds?: string[];
    notifyUrl?: string;
  }): Promise<Render> {
    return this.flow('audio-to-text', {
      audio_url: options.audioUrl,
      file_ids: options.fileIds,
      notify_url: options.notifyUrl,
    });
  }

  /**
   * Generate speech from text using Qwen3-TTS
   */
  async textToSpeech(options: {
    text: string;
    mode?: string;
    language?: string;
    speaker?: string;
    style?: string;
    modelSize?: string;
    voiceDescription?: string;
    refAudioUrl?: string;
    fileIds?: string[];
    refText?: string;
    useXvectorOnly?: boolean;
    notifyUrl?: string;
  }): Promise<Render> {
    return this.flow('text-to-speech', {
      text: options.text,
      mode: options.mode,
      language: options.language,
      speaker: options.speaker,
      style: options.style,
      model_size: options.modelSize,
      voice_description: options.voiceDescription,
      ref_audio_url: options.refAudioUrl,
      file_ids: options.fileIds,
      ref_text: options.refText,
      use_xvector_only: options.useXvectorOnly,
      notify_url: options.notifyUrl,
    });
  }
}
