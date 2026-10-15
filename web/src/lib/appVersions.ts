import { desktop } from './desktop';
import { t } from '../i18n';

/**
 * Which versions of the apps are still fine with this server. Most changes reach every
 * device without an app update (the interface comes from the server), so this is only
 * raised at release time when an app itself gains something worth installing
 * ("recommended") or the interface relies on something older apps lack ("needed").
 * Releases that only change the server leave it alone, and nobody is asked to update.
 * scripts/release.sh checks that no version here is newer than the release.
 */

export type AppName = 'mac' | 'windows' | 'ios' | 'android' | 'samsung';

interface Rule {
  recommended?: string;
  needed?: string;
  /** What the update brings, in a sentence. */
  why?: () => string;
}

const RULES: Record<AppName, Rule> = {
  mac: { recommended: '0.6.3', why: () => t("Downloads play in Netfish's own player, and it opens faster away from home.") },
  windows: { recommended: '0.6.3', why: () => t("Downloads play in Netfish's own player, and it opens faster away from home.") },
  ios: { recommended: '0.6.3', why: () => t("Downloads play in Netfish's own player, and it opens faster away from home.") },
  android: { recommended: '0.6.3', why: () => t("Downloads play in Netfish's own player, it opens faster away from home, and it installs its own updates from now on.") },
  samsung: {},
};

/** Whether version a is older than b ("0.6.10" > "0.6.9"). */
export function older(a: string, b: string): boolean {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0);
  return false;
}

const VERSION = /^\d+\.\d+\.\d+$/;

// The Samsung TV app opens Netfish as /?tv=1&app=samsung&v=0.6.3; remembered for the visit.
try {
  const query = new URLSearchParams(location.search);
  const v = query.get('v');
  if (query.get('app') === 'samsung' && v && VERSION.test(v)) sessionStorage.setItem('netfish.samsungApp', v);
} catch {
  /* storage blocked */
}

/** The Netfish app this page is open in, and its version; nothing in a browser. */
export function thisApp(): { name: AppName; version: string } | undefined {
  const app = desktop();
  const named = (name: AppName, version?: string) => (version && VERSION.test(version) ? { name, version } : undefined);
  switch (app?.platform) {
    case 'darwin':
      return named('mac', app.version);
    case 'win32':
      return named('windows', app.version);
    case 'ios':
      return named('ios', app.version);
    case 'android':
    case 'firetv':
      return named('android', app.version);
  }
  try {
    return named('samsung', sessionStorage.getItem('netfish.samsungApp') ?? undefined);
  } catch {
    return undefined;
  }
}

export interface UpdateNeed {
  level: 'needed' | 'recommended';
  /** The version that's asked for (or anything newer). */
  version: string;
  why?: string;
}

/** Whether an app at this version should update, and how much it matters. */
export function updateNeed(app: { name: AppName; version: string } | undefined = thisApp()): UpdateNeed | undefined {
  const rule = app && RULES[app.name];
  if (!app || !rule) return undefined;
  if (rule.needed && older(app.version, rule.needed)) return { level: 'needed', version: rule.needed, why: rule.why?.() };
  if (rule.recommended && older(app.version, rule.recommended)) return { level: 'recommended', version: rule.recommended, why: rule.why?.() };
  return undefined;
}

/** How each app is called in the device list. */
export function appLabel(name: string): string {
  switch (name) {
    case 'mac':
      return t('Mac app');
    case 'windows':
      return t('Windows app');
    case 'ios':
      return t('iPhone & iPad app');
    case 'android':
      return t('Android app');
    case 'samsung':
      return t('Samsung TV app');
    default:
      return t('Browser');
  }
}
