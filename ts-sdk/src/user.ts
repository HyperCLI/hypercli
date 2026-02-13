/**
 * User API - current user information
 */
import type { HTTPClient } from './http.js';

export interface User {
  userId: string;
  email: string | null;
  name: string | null;
  isActive: boolean;
  createdAt: string;
}

function userFromDict(data: any): User {
  return {
    userId: data.user_id || '',
    email: data.email || null,
    name: data.name || null,
    isActive: data.is_active !== false,
    createdAt: data.created_at || '',
  };
}

export class UserAPI {
  constructor(private http: HTTPClient) {}

  /**
   * Get current user info
   */
  async get(): Promise<User> {
    const data = await this.http.get('/api/user');
    return userFromDict(data);
  }
}
