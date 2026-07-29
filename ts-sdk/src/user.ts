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
  externalId: string | null;
  privyUserId: string | null;
  walletAddress: string | null;
  userType: string | null;
  teamId: string;
  planId: string;
  email: string | null;
  authType: string;
  capabilities: string[];
  tags: string[];
  runtime: RuntimeIdentity | null;
  hasActiveSubscription: boolean;
  keyId: string | null;
  keyName: string | null;
}

export interface RuntimeIdentity {
  runtime: string;
  agentId: string | null;
}

export interface UpdateUserOptions {
  name?: string;
  email?: string;
}

export interface UserProfileImage {
  id: string;
  avatarUrl: string | null;
  s3Key: string | null;
}

function userProfileImageFromDict(data: any): UserProfileImage {
  return {
    id: String(data?.id || ''),
    avatarUrl: data?.avatar_url || null,
    s3Key: data?.s3_key || null,
  };
}

function deriveExternalId(data: any): string | null {
  if (data.external_id) return data.external_id;
  if (data.privy_user_id) return data.privy_user_id;
  if (data.wallet_address) return `wallet:${String(data.wallet_address).toLowerCase()}`;
  if (data.turnkey_org_id) return `turnkey:${data.turnkey_org_id}`;
  if (data.user_id) return `orchestra:${data.user_id}`;
  return null;
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
  const runtime = data?.runtime && typeof data.runtime === 'object'
    ? {
        runtime: data.runtime.runtime || '',
        agentId: data.runtime.agent_id || null,
      }
    : null;
  return {
    userId: data.user_id || '',
    orchestraUserId: data.orchestra_user_id || null,
    externalId: deriveExternalId(data),
    privyUserId: data.privy_user_id || null,
    walletAddress: data.wallet_address || null,
    userType: data.user_type || null,
    teamId: data.team_id || '',
    planId: data.plan_id || '',
    email: data.email || null,
    authType: data.auth_type || '',
    capabilities: Array.isArray(data.capabilities) ? data.capabilities : [],
    tags: Array.isArray(data.tags) ? data.tags : [],
    runtime,
    hasActiveSubscription: Boolean(data.has_active_subscription),
    keyId: data.key_id || null,
    keyName: data.key_name || null,
  };
}

export function runtimeAgentId(auth: AuthMe): string | null {
  return auth.runtime?.runtime === 'agent' ? auth.runtime.agentId : null;
}

export function isRuntimeAgent(auth: AuthMe): boolean {
  return runtimeAgentId(auth) !== null;
}

export class UserAPI {
  constructor(
    private http: HTTPClient,
    private authHttp: HTTPClient = http,
    private profileHttp: HTTPClient = authHttp,
  ) {}

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
    const data = await this.authHttp.get('/api/auth/me');
    return authMeFromDict(data);
  }

  /**
   * Update the current user profile.
   */
  async update(options: UpdateUserOptions): Promise<User> {
    const data = await this.http.patch('/api/user', options);
    return userFromDict(data);
  }

  async getProfileImage(): Promise<UserProfileImage> {
    return userProfileImageFromDict(await this.profileHttp.get('/users/profile-image'));
  }

  async uploadProfileImage(
    content: Blob | ArrayBuffer | ArrayBufferView,
    contentType?: string,
  ): Promise<UserProfileImage> {
    let body: any;
    let resolvedContentType = contentType || 'image/png';
    if (content instanceof Blob) {
      body = content;
      resolvedContentType = contentType || content.type || resolvedContentType;
    } else if (ArrayBuffer.isView(content)) {
      body = content;
    } else {
      body = content;
    }
    return userProfileImageFromDict(
      await this.profileHttp.postRaw('/users/profile-image', body, resolvedContentType),
    );
  }

  async deleteProfileImage(): Promise<UserProfileImage> {
    return userProfileImageFromDict(await this.profileHttp.delete('/users/profile-image'));
  }
}
