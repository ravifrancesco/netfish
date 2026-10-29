import { t } from '../i18n';

/** A programme Netfish brought in for its channel (aired, then deleted unless someone keeps it). */
export function NewBadge() {
  return (
    <span className="new-badge">
      {t('New')}
    </span>
  );
}

/** Not downloaded yet: in the guide, not playable. */
export const isStandIn = (itemId: string) => itemId.startsWith('fresh:');
