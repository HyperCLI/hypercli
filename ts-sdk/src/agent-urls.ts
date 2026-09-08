/**
 * Agents API base/WS URL derivation. This module is intentionally free of
 * Node imports so browser bundles (console, desktop webview) can share the
 * single derivation instead of re-deriving URLs locally.
 */

const AGENTS_API_BASE = 'https://api.hypercli.com/agents';
const DEV_AGENTS_API_BASE = 'https://api.dev.hypercli.com/agents';
const AGENTS_WS_URL = 'wss://api.agents.hypercli.com/ws';
const DEV_AGENTS_WS_URL = 'wss://api.agents.dev.hypercli.com/ws';

export function toWsBaseUrl(baseUrl: string): string {
  const base = (baseUrl || '').replace(/\/+$/, '');
  if (!base) return '';
  if (base.startsWith('https://')) return `wss://${base.slice('https://'.length)}`;
  if (base.startsWith('http://')) return `ws://${base.slice('http://'.length)}`;
  return base;
}

export function normalizeAgentsWsUrl(url: string): string {
  const base = toWsBaseUrl(url);
  if (!base) return '';
  return base.endsWith('/ws') ? base : `${base}/ws`;
}

export function resolveAgentsApiBase(apiBase: string): string {
  const raw = (apiBase || '').trim();
  if (!raw) return AGENTS_API_BASE;
  const parsed = new URL(raw.includes('://') ? raw : `https://${raw}`);
  const normalizedPath = parsed.pathname.replace(/\/+$/, '');
  const host = parsed.host.toLowerCase();
  if (normalizedPath.endsWith('/agents')) {
    return `${parsed.origin}${normalizedPath}`;
  }
  if (normalizedPath.endsWith('/api')) {
    if (host === 'api.agents.hypercli.com') {
      return AGENTS_API_BASE;
    }
    if (host === 'api.agents.dev.hypercli.com') {
      return DEV_AGENTS_API_BASE;
    }
    return `${parsed.origin}${normalizedPath.slice(0, -4)}/agents`;
  }
  if (host === 'api.agents.hypercli.com' || host === 'api.hypercli.com' || host === 'api.hyperclaw.app') {
    return AGENTS_API_BASE;
  }
  if (
    host === 'api.agents.dev.hypercli.com' ||
    host === 'api.dev.hypercli.com' ||
    host === 'api.dev.hyperclaw.app' ||
    host === 'dev-api.hyperclaw.app'
  ) {
    return DEV_AGENTS_API_BASE;
  }
  const normalized = raw.replace(/\/$/, '');
  return `${normalized}/agents`;
}

export function defaultAgentsWsUrl(apiBase: string): string {
  const resolvedApiBase = resolveAgentsApiBase(apiBase);
  const parsed = new URL(resolvedApiBase.includes('://') ? resolvedApiBase : `https://${resolvedApiBase}`);
  const host = parsed.host.toLowerCase();
  if (host === 'api.agents.hypercli.com' || host === 'api.hypercli.com' || host === 'api.hyperclaw.app') return AGENTS_WS_URL;
  if (
    host === 'api.agents.dev.hypercli.com' ||
    host === 'api.dev.hypercli.com' ||
    host === 'api.dev.hyperclaw.app' ||
    host === 'dev-api.hyperclaw.app'
  ) {
    return DEV_AGENTS_WS_URL;
  }
  return normalizeAgentsWsUrl(resolvedApiBase);
}

/**
 * Same-origin `/ws` base used by the desktop bridge: keep the API host, strip
 * a trailing `/agents` or `/api` path suffix, and append `/ws`. Browser-side
 * packaged code and the vite dev bridge both consume this so the derivation
 * cannot diverge.
 */
export function agentsBridgeWsBase(apiBase: string): string {
  const url = new URL(apiBase);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = url.pathname.replace(/\/+$/, '').replace(/\/agents$/, '').replace(/\/api$/, '');
  return `${url.toString().replace(/\/+$/, '')}/ws`;
}

export function defaultHyperAcpWsUrl(apiBase: string): string {
  const resolvedApiBase = resolveAgentsApiBase(apiBase);
  const parsed = new URL(resolvedApiBase.includes('://') ? resolvedApiBase : `https://${resolvedApiBase}`);
  const host = parsed.host.toLowerCase();
  if (host === 'api.agents.hypercli.com' || host === 'api.hypercli.com' || host === 'api.hyperclaw.app') return AGENTS_WS_URL;
  if (
    host === 'api.agents.dev.hypercli.com' ||
    host === 'api.dev.hypercli.com' ||
    host === 'api.dev.hyperclaw.app' ||
    host === 'dev-api.hyperclaw.app'
  ) {
    return DEV_AGENTS_WS_URL;
  }
  const base = resolvedApiBase.replace(/\/+$/, '').replace(/\/agents$/, '');
  return normalizeAgentsWsUrl(base);
}
