import type { ConnectionTest } from '@netfish/shared';
import { config } from '../config';
import { request, UpstreamError, type RequestOptions } from '../lib/upstream';
import { t } from '../lib/i18n';

/**
 * Trakt's API (api.trakt.tv): every call carries the app's Client ID; calls for
 * the linked account add its access token. Netfish links one account for the
 * whole server with Trakt's device flow (a code typed at trakt.tv/activate).
 */

/** Trakt apps made for devices use this "out of band" redirect. */
export const REDIRECT_URI = 'urn:ietf:wg:oauth:2.0:oob';

export interface TraktIds {
  trakt?: number;
  slug?: string;
  imdb?: string;
  tmdb?: number;
  tvdb?: number;
}

export interface TraktTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  created_at: number;
}

export interface TraktDeviceCode {
  device_code: string;
  user_code: string;
  verification_url: string;
  expires_in: number;
  interval: number;
}

export function traktRequest<T>(path: string, opts: RequestOptions & { token?: string; clientId?: string } = {}) {
  const { token, clientId = config.trakt.apiKey ?? '', ...rest } = opts;
  return request<T>('Trakt', config.trakt.url, path, {
    timeoutMs: 15_000,
    ...rest,
    headers: {
      'trakt-api-version': '2',
      'trakt-api-key': clientId,
      // Trakt turns away requests that don't say who they are.
      'user-agent': `Netfish/${config.version}`,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...rest.headers,
    },
  });
}

/**
 * Checks the Client ID with a public call, and the secret by refreshing a made-up
 * token: Trakt answers "invalid_client" when the secret is wrong and "invalid_grant"
 * when only the token is, without linking or changing anything.
 */
export async function traktCheck(clientId: string, secret: string): Promise<ConnectionTest> {
  await traktRequest('/movies/trending', { clientId, query: { limit: 1 }, timeoutMs: 8000 });
  try {
    await traktRequest('/oauth/token', {
      clientId,
      body: { refresh_token: 'netfish-check', client_id: clientId, client_secret: secret, redirect_uri: REDIRECT_URI, grant_type: 'refresh_token' },
      timeoutMs: 8000,
    });
  } catch (err) {
    if (!(err instanceof UpstreamError) || err.status >= 500) throw err;
    if ((err.body as { error?: string } | undefined)?.error === 'invalid_client') return { ok: false, error: t('Trakt rejected the Client secret') };
  }
  return { ok: true };
}
