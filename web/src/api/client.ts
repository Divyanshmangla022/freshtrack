const TOKEN_KEY = 'freshtrack.token';
const BASE = '/api';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Fired on any 401 so the auth layer can drop the session and redirect. */
export const AUTH_ERROR_EVENT = 'freshtrack:unauthorized';

async function parseError(res: Response): Promise<ApiError> {
  let code = 'ERROR';
  let message = res.statusText || 'Request failed';
  let details: unknown;
  try {
    const body = await res.json();
    if (body?.error) {
      code = body.error.code ?? code;
      message = body.error.message ?? message;
      details = body.error.details;
    }
  } catch {
    /* non-JSON error body */
  }
  return new ApiError(res.status, code, message, details);
}

async function request<T>(
  method: string,
  path: string,
  opts: { body?: unknown; form?: FormData } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let payload: BodyInit | undefined;
  if (opts.form) {
    payload = opts.form; // browser sets multipart boundary
  } else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(opts.body);
  }

  const res = await fetch(BASE + path, { method, headers, body: payload });
  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent(AUTH_ERROR_EVENT));
    throw await parseError(res);
  }
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, { body }),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, { body }),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, { body }),
  del: <T>(path: string) => request<T>('DELETE', path),
  upload: <T>(path: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<T>('POST', path, { form });
  },
  /**
   * Upload a file and return the parsed body WITH the HTTP status, without
   * throwing on 4xx. Needed for invoice ingestion, where a 422 (validation
   * failed) still carries the full report body to display. 401 still redirects.
   */
  uploadRaw: async <T>(path: string, file: File): Promise<{ status: number; data: T }> => {
    const form = new FormData();
    form.append('file', file);
    const token = getToken();
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(BASE + path, { method: 'POST', headers, body: form });
    if (res.status === 401) {
      window.dispatchEvent(new CustomEvent(AUTH_ERROR_EVENT));
      throw await parseError(res);
    }
    // Only 2xx (report) and 422 (validation report) carry a usable JSON body.
    // Anything else (413 too large, 500, non-JSON error page) is a hard error.
    if (!res.ok && res.status !== 422) throw await parseError(res);
    const data = (await res.json()) as T;
    return { status: res.status, data };
  },
  /** Open an authenticated SSE stream (token passed via query, per EventSource limits). */
  sse: (path: string): EventSource => {
    const token = getToken();
    const sep = path.includes('?') ? '&' : '?';
    return new EventSource(`${BASE}${path}${token ? `${sep}token=${encodeURIComponent(token)}` : ''}`);
  },
  /** Trigger a browser download of a server-generated file with auth. */
  download: async (path: string, fallbackName: string): Promise<void> => {
    const token = getToken();
    const res = await fetch(BASE + path, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw await parseError(res);
    const blob = await res.blob();
    const disposition = res.headers.get('content-disposition') || '';
    const match = /filename="?([^"]+)"?/.exec(disposition);
    const name = match?.[1] ?? fallbackName;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};
