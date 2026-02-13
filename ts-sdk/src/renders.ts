/**
 * Renders API - managed AI rendering workflows
 */
import type { HTTPClient } from './http.js';

export interface Render {
  renderId: string;
  state: string;
  template: string | null;
  renderType: string | null;
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
  constructor(private http: HTTPClient) {}

  /**
   * List all renders
   */
  async list(options?: {
    state?: string;
    template?: string;
    type?: string;
  }): Promise<Render[]> {
    const params: Record<string, string> = {};
    if (options?.state) params.state = options.state;
    if (options?.template) params.template = options.template;
    if (options?.type) params.type = options.type;

    const data = await this.http.get('/api/renders', params);
    const items = typeof data === 'object' && data.items ? data.items : data;
    return (items || []).map(renderFromDict);
  }

  /**
   * Get render details
   */
  async get(renderId: string): Promise<Render> {
    const data = await this.http.get(`/api/renders/${renderId}`);
    return renderFromDict(data);
  }

  /**
   * Create a new render
   */
  async create(
    params: Record<string, any>,
    renderType: string = 'comfyui',
    notifyUrl?: string
  ): Promise<Render> {
    const payload: any = {
      type: renderType,
      params,
    };
    if (notifyUrl) {
      payload.notify_url = notifyUrl;
    }

    const data = await this.http.post('/api/renders', payload);
    return renderFromDict(data);
  }

  /**
   * Cancel a render
   */
  async cancel(renderId: string): Promise<any> {
    return await this.http.delete(`/api/renders/${renderId}`);
  }

  /**
   * Get render status (lightweight polling endpoint)
   */
  async status(renderId: string): Promise<RenderStatus> {
    const data = await this.http.get(`/api/renders/${renderId}/status`);
    return renderStatusFromDict(data);
  }

  // =========================================================================
  // Flow endpoints - simplified interfaces
  // =========================================================================

  private async flow(endpoint: string, params: Record<string, any>): Promise<Render> {
    // Filter out null/undefined values
    const payload: Record<string, any> = {};
    for (const [key, value] of Object.entries(params)) {
      if (value !== null && value !== undefined) {
        payload[key] = value;
      }
    }

    const data = await this.http.post(endpoint, payload);
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
    return this.flow('/api/flow/text-to-image', {
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
    return this.flow('/api/flow/text-to-image-hidream', {
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
    return this.flow('/api/flow/text-to-video', {
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
    return this.flow('/api/flow/image-to-video', {
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
    return this.flow('/api/flow/speaking-video', {
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
    return this.flow('/api/flow/speaking-video-wan', {
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
    return this.flow('/api/flow/image-to-image', {
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
    return this.flow('/api/flow/first-last-frame-video', {
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
    return this.flow('/api/flow/audio-to-text', {
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
    return this.flow('/api/flow/text-to-speech', {
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
