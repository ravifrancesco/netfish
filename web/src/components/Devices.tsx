import { useQuery } from '@tanstack/react-query';
import { Globe, Laptop, Smartphone, Tablet, Tv } from 'lucide-react';
import type { ScreenKind } from '@netfish/shared';
import { api } from '../api';
import { appLabel, updateNeed, type AppName } from '../lib/appVersions';
import { ago } from '../lib/format';
import { ErrorState, Spinner } from './ui';
import { t } from '../i18n';

const ICONS: Record<ScreenKind, typeof Tv> = { tv: Tv, computer: Laptop, phone: Smartphone, tablet: Tablet, browser: Globe };

/**
 * Settings → Devices (admins): every Netfish open right now, whoever's signed in, which app
 * it runs, and whether that app should update (by the same rules as Home's note on it).
 */
export function Devices() {
  const q = useQuery({ queryKey: ['devices'], queryFn: api.devices, refetchInterval: 30_000 });
  if (q.isError) return <ErrorState error={q.error} retry={() => void q.refetch()} />;
  if (!q.data) return <Spinner size={20} />;
  return (
    <ul className="devices">
      {q.data.devices.map((device) => {
        const Icon = ICONS[device.kind] ?? Globe;
        const need = device.app && device.version ? updateNeed({ name: device.app as AppName, version: device.version }) : undefined;
        const app = device.app ? `${appLabel(device.app)} ${device.version}` : appLabel('');
        return (
          <li key={device.id} className="devices__row">
            <Icon size={20} />
            <span className="devices__text">
              <strong>{device.name}</strong>
              <span className="muted small">{[device.userName, app, t('opened {ago}', { ago: ago(device.since) })].join(' · ')}</span>
            </span>
            {device.app && (
              <span className={`badge ${need?.level === 'needed' ? 'badge--bad' : need ? 'badge--warn' : 'badge--good'}`}>
                {need?.level === 'needed' ? t('Needs an update') : need ? t('Update recommended') : t('No update needed')}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
