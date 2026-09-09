/**
 * `hyper me` — composite identity check (golden sample of an authenticated
 * read command).
 *
 * Three authorities, reported independently:
 *   1. Product identity  — client.user.authMe()              (GET /api/auth/me)
 *   2. Agent entitlement — client.agent.subscriptionSummary() (agents section;
 *      a 401/403 here reports "unavailable" and must NOT erase section 1)
 *   3. Runtime identity  — client.deployments.accessIdentity() (cheap probe;
 *      only an agent runtime key can name its Agent — skip silently otherwise)
 *
 * The API key itself is never printed (keyId/keyName are identifiers, not the
 * secret).
 */

import {
  APIError,
  hasActivePlan,
  type AgentAccessIdentity,
  type AuthMe,
  type HyperAgentSubscriptionSummary,
} from '@hypercli.com/sdk';
import { parseCommandArgs } from '../core/argv.js';
import { CliError } from '../core/errors.js';
import { renderGroupHelp } from '../core/help.js';
import type { CommandContext } from '../core/types.js';

export const name = 'me';
export const summary = 'Resolve the current auth context and show key capabilities.';
export const usage = ['hyper me [--json]'];

/** Map an authMe failure to a precise CliError. Never retried. */
function toAuthError(err: unknown): CliError {
  if (err instanceof APIError && err.statusCode === 401) {
    const detail = err.detail ? `: ${err.detail}` : '';
    // "API key is inactive" => the key was recognized but deactivated.
    const message = /inactive/i.test(err.detail)
      ? `API key recognized but inactive${detail}. Reactivate or replace the key at its source, then run 'hyper me' again`
      : `API key invalid or expired${detail}. Run 'hyper configure' to set a valid key`;
    return new CliError(message, 1);
  }
  if (err instanceof CliError) return err;
  if (err instanceof APIError) {
    return new CliError(`failed to resolve identity (HTTP ${err.statusCode}): ${err.detail}`);
  }
  return new CliError(`failed to resolve identity: ${err instanceof Error ? err.message : String(err)}`);
}

function describeError(err: unknown): string {
  if (err instanceof APIError) return `${err.statusCode}: ${err.detail}`;
  return err instanceof Error ? err.message : String(err);
}

/** Latest expiresAt among ACTIVE entitlement items (python parity). */
function latestActiveExpiry(summary: HyperAgentSubscriptionSummary): Date | null {
  const dates = summary.entitlementItems
    .filter((item) => item.status.toUpperCase() === 'ACTIVE')
    .map((item) => item.expiresAt)
    .filter((d): d is Date => d instanceof Date && Number.isFinite(d.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());
  return dates.length > 0 ? dates[dates.length - 1] : null;
}

/** e.g. "3d 4h", "2h 15m", "40m", "expired" (python parity). */
function formatTimeLeft(expiresAt: Date, now: Date = new Date()): string {
  const remainingMs = expiresAt.getTime() - now.getTime();
  if (remainingMs <= 0) return 'expired';
  const totalMinutes = Math.floor(remainingMs / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function thousands(n: number): string {
  return n.toLocaleString('en-US');
}

// ---------- table rendering ----------

function rowsBlock(rows: ReadonlyArray<readonly [string, string]>): string[] {
  const width = Math.max(0, ...rows.map(([key]) => key.length));
  return rows.map(([key, value]) => `  ${key.padEnd(width)}  ${value}`.trimEnd());
}

function identityRows(
  authMe: AuthMe,
  agentIdentity: AgentAccessIdentity | null,
): Array<[string, string]> {
  const rows: Array<[string, string]> = [
    ['user_id', authMe.userId],
    ['orchestra_user_id', authMe.orchestraUserId ?? ''],
    ['external_id', authMe.externalId ?? ''],
    ['privy_user_id', authMe.privyUserId ?? ''],
    ['wallet_address', authMe.walletAddress ?? ''],
    ['team_id', authMe.teamId],
    ['plan_id', authMe.planId],
    ['email', authMe.email ?? ''],
    ['user_type', authMe.userType ?? ''],
    ['auth_type', authMe.authType],
    ['has_active_subscription', authMe.hasActiveSubscription ? 'yes' : 'no'],
    ['key_id', authMe.keyId ?? ''],
    ['key_name', authMe.keyName ?? ''],
  ];
  if (authMe.runtime) rows.push(['runtime', authMe.runtime.runtime]);
  if (agentIdentity) {
    rows.push(['agent_id', agentIdentity.agentId ?? '']);
    if (agentIdentity.capabilities.length > 0) {
      rows.push(['agent_capabilities', agentIdentity.capabilities.join(', ')]);
    }
  }
  return rows;
}

function agentsRows(
  summary: HyperAgentSubscriptionSummary | null,
  agentsError: string | null,
): Array<[string, string]> {
  if (!summary) {
    return [['entitlements', `unavailable (${agentsError ?? 'unknown error'})`]];
  }
  const rows: Array<[string, string]> = [
    ['has_active_plan', hasActivePlan(summary) ? 'yes' : 'no'],
    ['effective_plan', summary.effectivePlanId],
    ['current_entitlement', summary.currentEntitlementId ?? ''],
    ['active_subscriptions', String(summary.activeSubscriptionCount)],
    ['active_entitlements', String(summary.activeEntitlementCount)],
  ];
  const expiresAt = latestActiveExpiry(summary);
  if (expiresAt) {
    rows.push(['expires_at', expiresAt.toISOString()]);
    rows.push(['time_left', formatTimeLeft(expiresAt)]);
  }
  rows.push([
    'limits',
    `${thousands(summary.pooledTpmLimit)} TPM / ${thousands(summary.pooledRpmLimit)} RPM / ${thousands(summary.pooledTpd)} TPD`,
  ]);
  return rows;
}

function renderTable(
  authMe: AuthMe,
  agentIdentity: AgentAccessIdentity | null,
  summary: HyperAgentSubscriptionSummary | null,
  agentsError: string | null,
): string {
  const identity = ['Identity', ...rowsBlock(identityRows(authMe, agentIdentity))].join('\n');
  const capabilityLines =
    authMe.capabilities.length > 0 ? authMe.capabilities.map((c) => `  ${c}`) : ['  (none)'];
  const capabilities = ['Capabilities', ...capabilityLines].join('\n');
  const agents = ['Agents', ...rowsBlock(agentsRows(summary, agentsError))].join('\n');
  return `${identity}\n\n${capabilities}\n\n${agents}`;
}

// ---------- json rendering ----------

function identityJson(
  authMe: AuthMe,
  agentIdentity: AgentAccessIdentity | null,
): Record<string, unknown> {
  const identity: Record<string, unknown> = {
    userId: authMe.userId,
    orchestraUserId: authMe.orchestraUserId,
    externalId: authMe.externalId,
    privyUserId: authMe.privyUserId,
    walletAddress: authMe.walletAddress,
    userType: authMe.userType,
    teamId: authMe.teamId,
    planId: authMe.planId,
    email: authMe.email,
    authType: authMe.authType,
    hasActiveSubscription: authMe.hasActiveSubscription,
    keyId: authMe.keyId,
    keyName: authMe.keyName,
    tags: authMe.tags,
  };
  if (authMe.runtime) identity.runtime = authMe.runtime;
  if (agentIdentity) {
    identity.agent_id = agentIdentity.agentId;
    identity.agent_capabilities = agentIdentity.capabilities;
  }
  return identity;
}

function agentsJson(summary: HyperAgentSubscriptionSummary): Record<string, unknown> {
  return {
    hasActivePlan: hasActivePlan(summary),
    effectivePlanId: summary.effectivePlanId,
    currentSubscriptionId: summary.currentSubscriptionId,
    currentEntitlementId: summary.currentEntitlementId,
    activeSubscriptionCount: summary.activeSubscriptionCount,
    activeEntitlementCount: summary.activeEntitlementCount,
    pooledTpmLimit: summary.pooledTpmLimit,
    pooledRpmLimit: summary.pooledRpmLimit,
    pooledTpd: summary.pooledTpd,
    billingResetAt: summary.billingResetAt ? summary.billingResetAt.toISOString() : null,
    entitlementItems: summary.entitlementItems.map((item) => ({
      id: item.id,
      planId: item.planId,
      planName: item.planName,
      provider: item.provider,
      status: item.status,
      startsAt: item.startsAt ? item.startsAt.toISOString() : null,
      expiresAt: item.expiresAt ? item.expiresAt.toISOString() : null,
      tpmLimit: item.tpmLimit,
      rpmLimit: item.rpmLimit,
      tpdLimit: item.tpdLimit,
      agentTier: item.agentTier,
      features: item.features,
      tags: item.tags,
    })),
  };
}

export async function run(ctx: CommandContext, args: string[]): Promise<void> {
  const parsed = parseCommandArgs(args);
  if (parsed.help) {
    process.stdout.write(`${renderGroupHelp({ name, summary, usage, run })}\n`);
    return;
  }

  const client = await ctx.client();

  // 1. Product identity — the command's spine. A 401 here is fatal, no retry.
  let authMe: AuthMe;
  try {
    authMe = await client.user.authMe();
  } catch (err) {
    throw toAuthError(err);
  }

  // 2. Agent entitlement — failure degrades to "unavailable", never erases 1.
  let entitlementSummary: HyperAgentSubscriptionSummary | null = null;
  let agentsError: string | null = null;
  try {
    entitlementSummary = await client.agent.subscriptionSummary();
  } catch (err) {
    agentsError = describeError(err);
  }

  // 3. Runtime identity — only an agent runtime key can name its Agent;
  //    a failure here must leave `hyper me` exactly as it was.
  let agentIdentity: AgentAccessIdentity | null = null;
  try {
    const resolved: AgentAccessIdentity = await client.deployments.accessIdentity();
    if (resolved.isAgentRuntimeKey) agentIdentity = resolved;
  } catch {
    agentIdentity = null;
  }

  const agents = entitlementSummary ? agentsJson(entitlementSummary) : null;
  const payload: Record<string, unknown> = {
    identity: identityJson(authMe, agentIdentity),
    capabilities: authMe.capabilities,
    agents,
  };
  if (agents === null) payload.agents_error = agentsError ?? 'unknown error';

  ctx.output.result(payload, renderTable(authMe, agentIdentity, entitlementSummary, agentsError));
}
