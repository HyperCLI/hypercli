const AUTH_BACKEND = process.env.NEXT_PUBLIC_AUTH_BACKEND || "";
const CORS_PROXY_URL = process.env.NEXT_PUBLIC_CORS_PROXY_URL || "";
const BOT_API_URL = process.env.NEXT_PUBLIC_BOT_API_URL || "";
const LLM_API_URL = process.env.NEXT_PUBLIC_LLM_API_URL || "";

const isBrowser = typeof window !== "undefined";

const normalizeBase = (value: string) => value.replace(/\/+$/, "");

export const withCorsProxy = (url: string): string => {
  if (!url) return url;
  if (!CORS_PROXY_URL || !isBrowser) return url;

  const normalizedProxy = normalizeBase(CORS_PROXY_URL);
  if (url.startsWith(normalizedProxy)) return url;

  return `${normalizedProxy}/${url}`;
};

export const getAuthBackendUrl = (path: string = ""): string => {
  if (!AUTH_BACKEND) return path;

  const normalizedBase = normalizeBase(AUTH_BACKEND);
  const normalizedPath = path ? (path.startsWith("/") ? path : `/${path}`) : "";

  return withCorsProxy(`${normalizedBase}${normalizedPath}`);
};

export const getBotApiUrl = (path: string = ""): string => {
  if (!BOT_API_URL) return path;

  const normalizedBase = normalizeBase(BOT_API_URL);
  const normalizedPath = path ? (path.startsWith("/") ? path : `/${path}`) : "";

  return withCorsProxy(`${normalizedBase}${normalizedPath}`);
};

export const getLlmApiUrl = (path: string = ""): string => {
  if (!LLM_API_URL) return path;

  const normalizedBase = normalizeBase(LLM_API_URL);
  const normalizedPath = path ? (path.startsWith("/") ? path : `/${path}`) : "";

  return withCorsProxy(`${normalizedBase}${normalizedPath}`);
};

export const getBotWsBase = (): string => {
  if (!BOT_API_URL) return "";
  return normalizeBase(BOT_API_URL).replace(/^http/, "ws");
};
