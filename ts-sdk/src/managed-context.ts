import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import type { Agent, Deployments } from './agents.js';
import { APIError } from './errors.js';

export const MANAGED_CONTEXT_PATHS = ['.hypercli/USER.md', '.hypercli/SOUL.md'] as const;
export interface ManagedContext {
  /** Missing means leave the file alone; null projects an explicitly empty profile. */
  profile?: string | null;
  description?: string | null;
}
export interface ManagedContextFileResult {
  path: typeof MANAGED_CONTEXT_PATHS[number];
  status: 'written' | 'unchanged' | 'preserved' | 'skipped' | 'failed';
  detail?: string;
}

function digest(text: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(text)));
}

function projection(text: string): string {
  return `<!-- hypercli-projection sha256:${digest(text)} -->\n${text}`;
}

function isUneditedProjection(text: string): boolean {
  const match = /^<!-- hypercli-projection sha256:([a-f0-9]{64}) -->\n/.exec(text);
  return !!match && digest(text.slice(match[0].length)) === match[1];
}

/**
 * Explicit, one-way projection. The caller must supply the authenticated account UUID.
 * Owner deployments use Reef or the native runner's retained assignment root. No start, policy change,
 * directory cleanup, or import back into account metadata occurs. Each PUT is atomic;
 * the file API has no compare-and-swap or multi-file transaction.
 */
export async function projectManagedContext(
  deployments: Deployments,
  agent: Agent,
  ownerUserId: string,
  context: ManagedContext,
): Promise<ManagedContextFileResult[]> {
  const values = [context.profile, context.description];
  const results: ManagedContextFileResult[] = [];
  let unavailable: string | undefined;
  if (!ownerUserId || agent.userId !== ownerUserId) unavailable = 'Only the owning account can project personal context.';
  else if (!['STOPPED', 'RUNNING', 'STARTING', 'STOPPING'].includes(String(agent.state).toUpperCase())) {
    unavailable = `Files are unavailable in ${agent.state}; retry when storage is ready.`;
  }
  if (!unavailable) {
    try {
      await deployments.waitForFileApiReady(agent, { timeoutMs: 10_000 });
    } catch (error) {
      unavailable = String(error);
    }
  }
  for (const [index, path] of MANAGED_CONTEXT_PATHS.entries()) {
    const value = values[index];
    if (value === undefined) {
      results.push({ path, status: 'skipped', detail: 'No server value has been set.' });
      continue;
    }
    if (unavailable) {
      results.push({ path, status: 'skipped', detail: unavailable });
      continue;
    }
    const include = agent.launchConfig?.sync_include;
    const exclude = agent.launchConfig?.sync_exclude;
    // Do not guess glob semantics or mutate an immutable retained-storage policy.
    if (!agent.runner && ((Array.isArray(include) && !include.includes(path) && !include.includes('.hypercli'))
      || (Array.isArray(exclude) && exclude.length > 0))) {
      results.push({ path, status: 'skipped', detail: 'Persistence policy does not explicitly cover this file. Review the retained-storage policy; existing agents cannot change it after first launch.' });
      continue;
    }
    try {
      if (value !== null && (typeof value !== 'string' || [...value].length > 32768)) throw new Error('Markdown must be at most 32768 characters.');
      const text = projection(value ?? '');
      let current: string | undefined;
      if (agent.runner) {
        try {
          current = await deployments.fileRead(agent, path);
        } catch (error) {
          if (!(error instanceof APIError) || error.statusCode !== 404 || error.detail !== 'Runner file not_found') throw error;
        }
      } else {
        const root = await deployments.filesList(agent, '');
        const directory = root.find((entry) => entry.name === '.hypercli');
        if (directory && directory.type !== 'directory') throw new Error('.hypercli is not a directory.');
        const files = directory ? await deployments.filesList(agent, '.hypercli') : [];
        const exists = files.some((entry) => entry.name === path.split('/')[1]);
        current = exists ? await deployments.fileRead(agent, path) : undefined;
      }
      if (current === text) results.push({ path, status: 'unchanged' });
      else if (current !== undefined && !isUneditedProjection(current)) {
        results.push({ path, status: 'preserved', detail: 'Existing user content preserved. Move it aside explicitly before projecting.' });
      } else {
        await deployments.fileWrite(agent, path, text);
        results.push({ path, status: 'written' });
      }
    } catch (error) {
      results.push({ path, status: 'failed', detail: String(error) });
    }
  }
  return results;
}
