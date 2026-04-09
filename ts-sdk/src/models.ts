/**
 * OpenAI-compatible models API
 */
import type { HTTPClient } from './http.js';

export interface Model {
  id: string;
  object: string;
  ownedBy: string | null;
}

function modelFromDict(data: any): Model {
  return {
    id: data?.id || '',
    object: data?.object || 'model',
    ownedBy: data?.owned_by || null,
  };
}

export class ModelsAPI {
  constructor(private http: HTTPClient) {}

  async list(): Promise<Model[]> {
    const payload = await this.http.get('/v1/models');
    const data = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
    return data.map(modelFromDict);
  }
}
