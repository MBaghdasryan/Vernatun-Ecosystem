const PRODUCTION_API_ORIGIN = 'https://api.vernatun.io';

export function resolveApiBaseUrl(configured: string | undefined, hostname: string): string {
  const explicit = configured?.trim().replace(/\/+$/, '');
  if (explicit) return explicit;

  if (hostname === 'vernatun.io' || hostname.endsWith('.vernatun.io')) {
    return PRODUCTION_API_ORIGIN;
  }

  return '';
}

const browserHostname = typeof window === 'undefined' ? '' : window.location.hostname;

export const apiBaseUrl = resolveApiBaseUrl(
  import.meta.env?.VITE_API_BASE_URL,
  browserHostname,
);

export function apiUrl(path: string, baseUrl = apiBaseUrl): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${baseUrl}${normalizedPath}`;
}

export function apiCredentials(baseUrl = apiBaseUrl): RequestCredentials {
  return baseUrl ? 'include' : 'same-origin';
}
