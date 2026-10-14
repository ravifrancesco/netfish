/** A thin fetch wrapper for talking to the other services on the box. */

export class UpstreamError extends Error {
  constructor(
    readonly service: string,
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
  }
}

export class NotConfiguredError extends Error {
  readonly status = 503;
  constructor(readonly service: string) {
    super(`${service} is not configured on this Netfish server`);
  }
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type QueryValue = string | number | boolean | undefined | null | Array<string | number>;

export interface RequestOptions {
  method?: string;
  query?: Record<string, QueryValue>;
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

// Strict RFC 3986 encoding. Seerr's request validator rejects raw !'()* in queries.
const encode = (value: string) =>
  encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export function buildQuery(query: Record<string, QueryValue> = {}): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    const values = Array.isArray(value) ? value : [value];
    for (const v of values) parts.push(`${encode(key)}=${encode(String(v))}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

function messageFrom(data: unknown): string | undefined {
  if (!data) return undefined;
  if (typeof data === 'string') return data.length < 300 ? data : undefined;
  if (Array.isArray(data)) return messageFrom(data[0]);
  if (typeof data === 'object') {
    const o = data as Record<string, unknown>;
    for (const key of ['message', 'error', 'errorMessage', 'title', 'detail']) {
      if (typeof o[key] === 'string' && o[key]) return o[key] as string;
    }
  }
  return undefined;
}

export async function request<T>(
  service: string,
  baseUrl: string,
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  const target = `${baseUrl}${path}${buildQuery(opts.query)}`;
  const headers: Record<string, string> = { accept: 'application/json', ...opts.headers };
  let body: string | URLSearchParams | undefined;
  if (opts.body instanceof URLSearchParams) {
    body = opts.body;
  } else if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }

  let res: Response;
  try {
    res = await fetch(target, {
      method: opts.method ?? (body !== undefined ? 'POST' : 'GET'),
      headers,
      body,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
    });
  } catch (err) {
    const e = err as Error & { cause?: { code?: string } };
    const reason = e.name === 'TimeoutError' ? 'timed out' : (e.cause?.code ?? e.message);
    throw new UpstreamError(service, 502, `${service} is unreachable (${reason})`);
  }

  const text = await res.text();
  let data: unknown = text;
  if (text && (res.headers.get('content-type') ?? '').includes('json')) {
    try {
      data = JSON.parse(text);
    } catch {
      /* keep text */
    }
  }
  if (!res.ok) {
    const detail = messageFrom(data) ?? `${res.status} ${res.statusText}`;
    throw new UpstreamError(service, res.status, `${service}: ${detail}`, data);
  }
  return (text === '' ? undefined : data) as T;
}
