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
  emailVerified?: boolean;
  updatedAt?: string;
  userType?: string | null;
  meta?: string | null;
}

export interface AuthMe {
  userId: string;
  orchestraUserId: string | null;
  teamId: string;
  planId: string;
  email: string | null;
  authType: string;
  capabilities: string[];
  hasActiveSubscription: boolean;
  keyId: string | null;
  keyName: string | null;
}

export interface UpdateUserOptions {
  name?: string;
  email?: string;
}

function userFromDict(data: any): User {
  return {
    userId: data.user_id || '',
    email: data.email || null,
    name: data.name || null,
    isActive: data.is_active !== false,
    createdAt: data.created_at || '',
    emailVerified: data.email_verified,
    updatedAt: data.updated_at || '',
    userType: data.user_type ?? null,
    meta: data.meta ?? null,
  };
}

function authMeFromDict(data: any): AuthMe {
  return {
    userId: data.user_id || '',
    orchestraUserId: data.orchestra_user_id || null,
    teamId: data.team_id || '',
    planId: data.plan_id || '',
    email: data.email || null,
    authType: data.auth_type || '',
    capabilities: Array.isArray(data.capabilities) ? data.capabilities : [],
    hasActiveSubscription: Boolean(data.has_active_subscription),
    keyId: data.key_id || null,
    keyName: data.key_name || null,
  };
}

export class UserAPI {
  constructor(private http: HTTPClient, private authHttp: HTTPClient = http) {}

  /**
   * Get current user info
   */
  async get(): Promise<User> {
    const data = await this.http.get('/api/user');
    return userFromDict(data);
  }

  /**
   * Resolve the current auth context, including key capabilities.
   */
  async authMe(): Promise<AuthMe> {
    const data = await this.authHttp.get('/auth/me');
    return authMeFromDict(data);
  }

  /**
   * Update the current user profile.
   */
  async update(options: UpdateUserOptions): Promise<User> {
    const data = await this.http.patch('/api/user', options);
    return userFromDict(data);
  }
}
