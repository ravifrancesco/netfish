import fs from 'node:fs';
import path from 'node:path';

declare const __NETFISH_VERSION__: string | undefined;

// In Docker the env comes from the stack; locally we read a .env file.
const envFile = process.env.NETFISH_ENV_FILE ?? path.resolve(process.cwd(), '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const env = (key: string): string | undefined => process.env[key]?.trim() || undefined;
const url = (...keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = env(key);
    if (value) return value.replace(/\/+$/, '');
  }
  return undefined;
};
const first = (...keys: string[]) => keys.map(env).find(Boolean);

export interface ServiceConfig {
  url?: string;
  apiKey?: string;
}

function resolvePublicDir(): string | undefined {
  const candidates = [
    env('NETFISH_PUBLIC_DIR'),
    path.join(__dirname, 'public'), // Docker: /app/server.cjs + /app/public
    path.resolve(__dirname, '../../web/dist'), // `npm start` after `npm run build`
  ];
  return candidates.find((dir) => dir && fs.existsSync(path.join(dir, 'index.html')));
}

export const config = {
  version: typeof __NETFISH_VERSION__ === 'string' ? __NETFISH_VERSION__ : 'dev',
  port: Number(env('NETFISH_PORT') ?? env('PORT') ?? 7777),
  host: env('NETFISH_HOST') ?? '0.0.0.0',
  publicDir: resolvePublicDir(),
  logLevel: env('LOG_LEVEL') ?? 'info',
  /** Where Netfish keeps its own small state (settings). A Docker volume in production. */
  dataDir: env('NETFISH_DATA_DIR') ?? path.resolve(process.cwd(), 'data'),
  trustProxy: env('TRUST_PROXY') === 'true',

  jellyfin: {
    url: url('JELLYFIN_URL'),
    /** Optional admin API key: lets Netfish refresh items after new subtitles land. */
    apiKey: env('JELLYFIN_API_KEY'),
  } satisfies ServiceConfig,
  seerr: {
    url: url('SEERR_URL', 'JELLYSEERR_URL', 'OVERSEERR_URL'),
    apiKey: first('SEERR_API_KEY', 'JELLYSEERR_API_KEY', 'OVERSEERR_API_KEY'),
  } satisfies ServiceConfig,
  radarr: { url: url('RADARR_URL'), apiKey: env('RADARR_API_KEY') } satisfies ServiceConfig,
  sonarr: { url: url('SONARR_URL'), apiKey: env('SONARR_API_KEY') } satisfies ServiceConfig,
  bazarr: { url: url('BAZARR_URL'), apiKey: env('BAZARR_API_KEY') } satisfies ServiceConfig,
  qbittorrent: {
    url: url('QBITTORRENT_URL', 'QBIT_URL'),
    username: first('QBITTORRENT_USERNAME', 'QBIT_USERNAME'),
    password: first('QBITTORRENT_PASSWORD', 'QBIT_PASSWORD'),
  },

  /** Optional MDBList key (free at mdblist.com): adds Letterboxd and Metacritic scores. */
  mdblist: { url: url('MDBLIST_URL') ?? 'https://api.mdblist.com', apiKey: env('MDBLIST_API_KEY') },
  /** Optional Trakt app (free at trakt.tv): recommendations and a watch history for the whole server. */
  trakt: { url: url('TRAKT_URL') ?? 'https://api.trakt.tv', apiKey: env('TRAKT_CLIENT_ID'), password: env('TRAKT_CLIENT_SECRET') },
  /** Where TMDB images come from (Seerr returns bare paths like "/abc.jpg"). */
  tmdbImageBase: url('TMDB_IMAGE_BASE') ?? 'https://image.tmdb.org/t/p',
  /** Default for who may pick specific releases; admins can change it in the app. */
  manualGrabs: (env('MANUAL_GRABS') ?? env('LANGUAGE_REQUESTS')) === 'admin' ? ('admin' as const) : ('all' as const),
  /** Metadata language passed to Seerr (TMDB), e.g. "en", "es". */
  metadataLanguage: env('METADATA_LANGUAGE') ?? 'en',
};

export const has = {
  jellyfin: () => Boolean(config.jellyfin.url),
  seerr: () => Boolean(config.seerr.url && config.seerr.apiKey),
  radarr: () => Boolean(config.radarr.url && config.radarr.apiKey),
  sonarr: () => Boolean(config.sonarr.url && config.sonarr.apiKey),
  bazarr: () => Boolean(config.bazarr.url && config.bazarr.apiKey),
  qbittorrent: () => Boolean(config.qbittorrent.url),
  trakt: () => Boolean(config.trakt.apiKey && config.trakt.password),
};
