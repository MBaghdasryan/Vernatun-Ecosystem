export type MobileAuthContext = {
  id: string;
  role_key: string;
  shell: string;
  organization_id: string | null;
  organization_name: string | null;
  building_id: string | null;
  building_name: string | null;
  unit_id: string | null;
  unit_number: string | null;
  expires_at: string | null;
  permissions: string[];
  product?: string;
  products?: string[];
};

export type MobileAuthUser = {
  id: string;
  name: string;
  email: string;
};

export type MobileAuthSession = {
  user: MobileAuthUser | null;
  contexts: MobileAuthContext[];
  contextId: string | null;
  csrf: string;
  demo?: boolean;
  mfaAvailable?: boolean;
};

export type HayatQueueRow = {
  id: string;
  subject: string;
  description: string;
  status: string;
  version: number;
  created_at: string;
  due_on: string | null;
  location: string | null;
  number: string;
  building_id: string;
  building_name: string;
  technician_name: string | null;
  work_order_id: string | null;
};

export type HayatQueueResponse = {
  rows: HayatQueueRow[];
  total: number;
  stats: { status: string; count: number }[];
  buildings: { id: string; name: string }[];
  pageSize: number;
  serverTime: string;
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let csrfToken: string | null = null;

function apiBase(): string {
  const explicitUrl = process.env.EXPO_PUBLIC_API_URL?.trim();
  const configuredDomain = process.env.EXPO_PUBLIC_DOMAIN?.trim();
  const origin = explicitUrl || (configuredDomain
    ? (/^https?:\/\//i.test(configuredDomain) ? configuredDomain : `https://${configuredDomain}`)
    : '');
  if (!origin) {
    throw new Error('Set EXPO_PUBLIC_API_URL to the Vernatun API base URL.');
  }
  const normalized = origin.replace(/\/+$/, '');
  return normalized.endsWith('/api') ? normalized : `${normalized}/api`;
}

async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;
  const response = await fetch(`${apiBase()}${path}`, {
    method,
    headers,
    credentials: 'include',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => null) as
    | (Record<string, unknown> & { csrf?: string; error?: string; message?: string })
    | null;
  if (typeof payload?.csrf === 'string') csrfToken = payload.csrf;
  if (!response.ok) {
    const code = typeof payload?.error === 'string' ? payload.error : undefined;
    const message = code === 'stale_version'
      ? 'Այս առաջադրանքը թարմացվել է։ Վերբեռնեք հերթը և կրկին ստուգեք։'
      : code === 'mfa_required'
        ? 'Enter the verification code for your account to continue.'
        : code === 'invalid_credentials'
          ? 'The work email, password, or verification code is incorrect.'
          : code === 'rate_limited'
            ? 'Too many attempts. Wait a little before trying again.'
      : code === 'forbidden'
        ? 'Այս գործողության իրավունքը սերվերը չի հաստատել։ Թարմացրեք մուտքը։'
        : code === 'invalid_transition'
          ? 'Առաջադրանքի վիճակը փոխվել է։ Թարմացրեք հերթը։'
          : typeof payload?.message === 'string'
            ? payload.message
            : 'Հարցումը չհաջողվեց։ Ստուգեք կապը և կրկին փորձեք։';
    throw new ApiError(message, response.status, code);
  }
  return payload as T;
}

export function getSession(): Promise<MobileAuthSession> {
  return request('/auth/session');
}

export function login(input: { email: string; password: string; code?: string }): Promise<MobileAuthSession> {
  return request('/auth/login', 'POST', input);
}

export async function selectContext(id: string): Promise<void> {
  await request('/auth/context', 'POST', { id });
}

export async function logout(): Promise<void> {
  try {
    await request('/auth/logout', 'POST');
  } finally {
    csrfToken = null;
  }
}

export function getQueue(status = '', page = 0): Promise<HayatQueueResponse> {
  const query = new URLSearchParams({ page: String(page), ...(status ? { status } : {}) });
  return request(`/hayat/queue?${query.toString()}`);
}

export function transitionDefect(
  id: string,
  input: { key: string; action: 'start' | 'report'; version: number; note?: string },
): Promise<unknown> {
  return request(`/defects/${encodeURIComponent(id)}/transition`, 'POST', input);
}

export function createIdempotencyKey(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    return (character === 'x' ? random : (random & 0x3) | 0x8).toString(16);
  });
}
