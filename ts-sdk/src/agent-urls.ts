/**
 * Agents API base/WS URL derivation. This module is intentionally free of
 * Node imports so browser bundles (console, desktop webview) can share the
 * single derivation instead of re-deriving URLs locally.
 */

export const DEFAULT_AGENTS_API_BASE_URL = 'https://api.hypercli.com/agents';
export const DEV_AGENTS_API_BASE_URL = 'https://api.dev.hypercli.com/agents';
export const DEFAULT_AGENTS_WS_URL = 'wss://api.agents.hypercli.com/ws';
export const DEV_AGENTS_WS_URL = 'wss://api.agents.dev.hypercli.com/ws';
const AGENTS_ACP_PROXY_WS_URL = 'wss://api.agents.hypercli.com/ws/acp';
const DEV_AGENTS_ACP_PROXY_WS_URL = 'wss://api.agents.dev.hypercli.com/ws/acp';

const PROD_AGENTS_HOSTS = new Set(['api.agents.hypercli.com', 'api.hypercli.com', 'api.hyperclaw.app']);
const DEV_AGENTS_HOSTS = new Set([
  'api.agents.dev.hypercli.com',
  'api.dev.hypercli.com',
  'api.dev.hyperclaw.app',
  'dev-api.hyperclaw.app',
]);

function toWsBaseUrl(baseUrl: string): string {
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

/**
 * The shared agents-base normalize, mirroring py-sdk `_normalize_agents_api_base`
 * (ordering: empty yields the prod default; a trailing `/agents` path is kept;
 * a trailing `/api` path is rewritten to `/agents`; bare alias hosts map to the
 * prod/dev defaults; anything else gets `/agents` appended). On top of py
 * parity, host output is canonicalized: lowercased, default ports stripped,
 * and any run of trailing slashes collapsed. Scheme-less input keeps the
 * scheme-less echo on the custom fallback (py parity).
 */
export function resolveAgentsApiBase(apiBase: string, preserveOrigin = false): string {
  const raw = (apiBase || '').trim();
  if (!raw) return DEFAULT_AGENTS_API_BASE_URL;
  const explicitScheme = raw.includes('://');
  const parsed = new URL(explicitScheme ? raw : `https://${raw}`);
  const normalizedPath = parsed.pathname.replace(/\/+$/, '');
  const host = parsed.host.toLowerCase();
  // Explicit control-plane selections must never be redirected to a gateway.
  if (preserveOrigin) {
    const path = normalizedPath.endsWith('/agents')
      ? normalizedPath
      : `${normalizedPath.replace(/\/api$/, '')}/agents`;
    return `${parsed.origin}${path}`;
  }
  if (normalizedPath.endsWith('/agents')) {
    return `${parsed.origin}${normalizedPath}`;
  }
  if (normalizedPath.endsWith('/api')) {
    if (host === 'api.agents.hypercli.com') {
      return DEFAULT_AGENTS_API_BASE_URL;
    }
    if (host === 'api.agents.dev.hypercli.com') {
      return DEV_AGENTS_API_BASE_URL;
    }
    return `${parsed.origin}${normalizedPath.slice(0, -4)}/agents`;
  }
  if (PROD_AGENTS_HOSTS.has(host)) {
    return DEFAULT_AGENTS_API_BASE_URL;
  }
  if (DEV_AGENTS_HOSTS.has(host)) {
    return DEV_AGENTS_API_BASE_URL;
  }
  const normalized = explicitScheme ? `${parsed.protocol}//${parsed.host}` : parsed.host;
  return `${normalized}${normalizedPath}/agents`;
}

type AgentsHostTier = 'prod' | 'dev' | 'custom';

function classifyAgentsApiBase(apiBase: string): { tier: AgentsHostTier; resolvedApiBase: string } {
  const resolvedApiBase = resolveAgentsApiBase(apiBase, true);
  const parsed = new URL(resolvedApiBase.includes('://') ? resolvedApiBase : `https://${resolvedApiBase}`);
  const host = parsed.host.toLowerCase();
  if (parsed.pathname === '/agents') {
    if (PROD_AGENTS_HOSTS.has(host) && host !== 'api.agents.hypercli.com') return { tier: 'prod', resolvedApiBase };
    if (DEV_AGENTS_HOSTS.has(host) && host !== 'api.agents.dev.hypercli.com') return { tier: 'dev', resolvedApiBase };
  }
  return { tier: 'custom', resolvedApiBase };
}

// The `/ws` tunnel lives next to (never on) the agents REST prefix: strip a
// trailing `/agents` path suffix, then append the tunnel path.
function agentsTunnelWsUrl(resolvedApiBase: string): string {
  return normalizeAgentsWsUrl(resolvedApiBase.replace(/\/+$/, '').replace(/\/agents$/, ''));
}

export function defaultAgentsWsUrl(apiBase: string): string {
  const { tier, resolvedApiBase } = classifyAgentsApiBase(apiBase);
  if (tier === 'prod') return DEFAULT_AGENTS_WS_URL;
  if (tier === 'dev') return DEV_AGENTS_WS_URL;
  return agentsTunnelWsUrl(resolvedApiBase);
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
  const { tier, resolvedApiBase } = classifyAgentsApiBase(apiBase);
  if (tier === 'prod') return DEFAULT_AGENTS_WS_URL;
  if (tier === 'dev') return DEV_AGENTS_WS_URL;
  return agentsTunnelWsUrl(resolvedApiBase);
}

const AGENTS_ADMIN_API_BASE = 'https://api.agents.hypercli.com';
const DEV_AGENTS_ADMIN_API_BASE = 'https://api.agents.dev.hypercli.com';

/**
 * Agents admin API base (service-key surface) derived from a product API
 * base: the public product hosts map to the private admin hosts, anything
 * else keeps its origin with a trailing `/agents`/`/api`/`/admin` path
 * suffix stripped. Mirrors py-sdk `get_agents_admin_api_base_url_from_product_base`.
 */
export function agentsAdminApiBaseFromProductBase(productBase: string): string {
  const raw = (productBase || '').trim();
  if (!raw) return AGENTS_ADMIN_API_BASE;
  const parsed = new URL(raw.includes('://') ? raw : `https://${raw}`);
  const host = parsed.host.toLowerCase();
  if (host === 'api.hypercli.com' || host === 'api.hyperclaw.app' || host === 'api.agents.hypercli.com') {
    return AGENTS_ADMIN_API_BASE;
  }
  if (
    host === 'api.dev.hypercli.com' ||
    host === 'api.dev.hyperclaw.app' ||
    host === 'dev-api.hyperclaw.app' ||
    host === 'api.agents.dev.hypercli.com'
  ) {
    return DEV_AGENTS_ADMIN_API_BASE;
  }
  const path = parsed.pathname.replace(/\/+$/, '');
  const suffix = ['/agents/admin', '/agents', '/admin', '/api'].find((candidate) => path.endsWith(candidate));
  const kept = suffix ? path.slice(0, -suffix.length) : path;
  return `${parsed.protocol}//${parsed.host}${kept}`.replace(/\/+$/, '');
}

/**
 * Client-facing ACP session proxy (sessions/README §14): the session
 * authority every chat/session consumer dials. Lives next to (never on) the
 * agent-keyed `/ws` tunnel — that route stays reserved for runtime attach
 * and backend-service legs and is re-factored here only via the URL shape.
 */
export function defaultAcpProxyWsUrl(apiBase: string): string {
  const { tier, resolvedApiBase } = classifyAgentsApiBase(apiBase);
  if (tier === 'prod') return AGENTS_ACP_PROXY_WS_URL;
  if (tier === 'dev') return DEV_AGENTS_ACP_PROXY_WS_URL;
  const tunnel = agentsTunnelWsUrl(resolvedApiBase);
  return `${tunnel.slice(0, -'/ws'.length)}/ws/acp`;
}
