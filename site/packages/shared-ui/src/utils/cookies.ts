/**
 * Cookie utilities for cross-domain authentication.
 *
 * The configured env domain is treated as a preference, but the runtime host
 * remains the source of truth so dev subdomains keep sharing one cookie scope
 * even when an app was built with localhost-oriented env files.
 */

const COOKIE_DOMAIN = (process.env.NEXT_PUBLIC_COOKIE_DOMAIN || "").trim();
const AUTH_COOKIE_EVENT = "hypercli-auth-cookie-changed";
export const AUTH_LOGOUT_COOKIE = "hypercli_logged_out";

function getCurrentHostname(): string {
  if (typeof window === "undefined") return "";
  return window.location.hostname.trim().toLowerCase();
}

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^\.+/, "");
}

function withLeadingDot(domain: string): string {
  const normalized = normalizeDomain(domain);
  return normalized ? `.${normalized}` : "";
}

function isIpAddress(hostname: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":");
}

export function isLocalHostname(hostname = getCurrentHostname()): boolean {
  return (
    !hostname ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname === "[::1]" ||
    isIpAddress(hostname)
  );
}

function deriveCookieDomain(hostname = getCurrentHostname()): string {
  const normalizedHost = normalizeDomain(hostname);
  if (!normalizedHost || isLocalHostname(normalizedHost)) {
    return "";
  }

  const labels = normalizedHost.split(".").filter(Boolean);
  if (labels.length < 2) {
    return "";
  }

  const suffixLength = labels.length >= 3 ? 3 : 2;
  return `.${labels.slice(-suffixLength).join(".")}`;
}

function matchesHost(domain: string, hostname = getCurrentHostname()): boolean {
  const normalizedDomain = normalizeDomain(domain);
  const normalizedHost = normalizeDomain(hostname);

  if (!normalizedDomain || !normalizedHost) {
    return false;
  }

  return (
    normalizedHost === normalizedDomain ||
    normalizedHost.endsWith(`.${normalizedDomain}`)
  );
}

function countLabels(domain: string): number {
  return normalizeDomain(domain).split(".").filter(Boolean).length;
}

export function resolveCookieDomain(
  configuredDomain = COOKIE_DOMAIN,
  hostname = getCurrentHostname()
): string {
  if (isLocalHostname(hostname)) {
    return "";
  }

  const derivedDomain = deriveCookieDomain(hostname);
  const normalizedConfigured = normalizeDomain(configuredDomain);
  if (!normalizedConfigured || normalizedConfigured === "localhost") {
    return derivedDomain;
  }

  const configuredWithDot = withLeadingDot(normalizedConfigured);
  if (!matchesHost(configuredWithDot, hostname)) {
    return derivedDomain;
  }

  if (!derivedDomain) {
    return configuredWithDot;
  }

  return countLabels(configuredWithDot) >= countLabels(derivedDomain)
    ? configuredWithDot
    : derivedDomain;
}

export function getCookieCandidateDomains(
  configuredDomain = COOKIE_DOMAIN,
  hostname = getCurrentHostname()
): string[] {
  if (isLocalHostname(hostname)) {
    return [];
  }

  const normalizedHost = normalizeDomain(hostname);
  const labels = normalizedHost.split(".").filter(Boolean);
  const candidates = new Set<string>();

  const resolved = resolveCookieDomain(configuredDomain, hostname);
  if (resolved) {
    candidates.add(resolved);
  }

  const normalizedConfigured = normalizeDomain(configuredDomain);
  if (normalizedConfigured && normalizedConfigured !== "localhost" && matchesHost(normalizedConfigured, hostname)) {
    candidates.add(withLeadingDot(normalizedConfigured));
  }

  if (labels.length >= 2) {
    candidates.add(`.${labels.slice(-2).join(".")}`);
  }
  if (labels.length >= 3) {
    candidates.add(`.${labels.slice(-3).join(".")}`);
  }

  return [...candidates].sort((left, right) => countLabels(right) - countLabels(left));
}

function getDomainPart(configuredDomain?: string): string {
  const resolvedDomain = resolveCookieDomain(configuredDomain);
  return resolvedDomain ? `; domain=${resolvedDomain}` : "";
}

function getSecurePart(): string {
  if (typeof window === "undefined" || isLocalHostname()) {
    return "";
  }

  return window.location.protocol === "https:" ? "; secure" : "";
}

function emitCookieChange(name: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(AUTH_COOKIE_EVENT, {
      detail: { name },
    })
  );
}

export const cookieUtils = {
  /**
   * Set a cookie with cross-domain support
   * @param name Cookie name
   * @param value Cookie value
   * @param days Expiry in days (default 365)
   */
  set(name: string, value: string, days: number = 365, configuredDomain = COOKIE_DOMAIN): void {
    const date = new Date();
    date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000);
    const expires = `expires=${date.toUTCString()}`;
    const domainPart = getDomainPart(configuredDomain);
    const securePart = getSecurePart();

    // URL encode the value (important for JWT tokens with special characters)
    const encodedValue = encodeURIComponent(value);
    const cookieString = `${name}=${encodedValue}; ${expires}; path=/${domainPart}${securePart}; samesite=lax`;
    document.cookie = cookieString;
    emitCookieChange(name);

    console.log(`🍪 Set cookie: ${name} (domain: ${resolveCookieDomain(configuredDomain) || "host-only"})`);
  },

  /**
   * Set a cookie with max-age (in seconds) instead of expiry date
   * @param name Cookie name
   * @param value Cookie value
   * @param maxAge Max age in seconds
   */
  setWithMaxAge(name: string, value: string, maxAge: number, configuredDomain = COOKIE_DOMAIN): void {
    const domainPart = getDomainPart(configuredDomain);
    const securePart = getSecurePart();
    const encodedValue = encodeURIComponent(value);
    const cookieString = `${name}=${encodedValue}; path=/; max-age=${maxAge}${domainPart}${securePart}; samesite=lax`;
    document.cookie = cookieString;
    emitCookieChange(name);

    console.log(`🍪 Set cookie with max-age: ${name} (domain: ${resolveCookieDomain(configuredDomain) || "host-only"})`);
  },

  setWithExpiry(name: string, value: string, expiresAt: string, configuredDomain = COOKIE_DOMAIN): void {
    const domainPart = getDomainPart(configuredDomain);
    const securePart = getSecurePart();
    const encodedValue = encodeURIComponent(value);
    const cookieString = `${name}=${encodedValue}; expires=${expiresAt}; path=/${domainPart}${securePart}; samesite=lax`;
    document.cookie = cookieString;
    emitCookieChange(name);

    console.log(`🍪 Set cookie with expiry: ${name} (domain: ${resolveCookieDomain(configuredDomain) || "host-only"})`);
  },

  /**
   * Get a cookie value
   */
  get(name: string): string | null {
    if (typeof document === 'undefined') return null;

    const nameEQ = `${name}=`;
    const cookies = document.cookie.split(';');

    for (let cookie of cookies) {
      cookie = cookie.trim();
      if (cookie.indexOf(nameEQ) === 0) {
        // URL decode the value when retrieving
        const encodedValue = cookie.substring(nameEQ.length);
        return decodeURIComponent(encodedValue);
      }
    }

    return null;
  },

  /**
   * Remove a cookie
   */
  remove(name: string, configuredDomain = COOKIE_DOMAIN): void {
    const securePart = getSecurePart();
    const expiration = "Thu, 01 Jan 1970 00:00:00 UTC";
    const domains = ["", ...getCookieCandidateDomains(configuredDomain)];

    for (const domain of domains) {
      const domainPart = domain ? `; domain=${domain}` : "";
      document.cookie = `${name}=; expires=${expiration}; max-age=0; path=/${domainPart}${securePart}; samesite=lax`;
    }

    emitCookieChange(name);

    console.log(`🍪 Removed cookie: ${name}`);
  },

  /**
   * Check if a cookie exists
   */
  has(name: string): boolean {
    return this.get(name) !== null;
  },
  AUTH_COOKIE_EVENT,
};

export function markAuthLogout(): void {
  cookieUtils.setWithMaxAge(AUTH_LOGOUT_COOKIE, String(Date.now()), 60 * 60 * 24 * 30);
}

export function clearAuthLogoutMarker(): void {
  cookieUtils.remove(AUTH_LOGOUT_COOKIE);
}

export function hasAuthLogoutMarker(): boolean {
  return cookieUtils.has(AUTH_LOGOUT_COOKIE);
}

export function clearLocalAuthTokens(...tokenStorageKeys: string[]): void {
  if (typeof window === "undefined") return;
  for (const tokenStorageKey of tokenStorageKeys) {
    if (!tokenStorageKey) continue;
    localStorage.removeItem(tokenStorageKey);
  }
}
