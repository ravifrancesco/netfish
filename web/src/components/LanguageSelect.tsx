import { useLanguages } from '../lib/hooks';

/** Native <select> on purpose: it works with phone pickers and TV remotes for free. */
export function LanguageSelect({
  value,
  onChange,
  anyLabel,
  only,
  id,
}: {
  value: string;
  onChange: (code: string) => void;
  anyLabel?: string;
  /** Restrict to these codes (e.g. languages present in search results). */
  only?: string[];
  id?: string;
}) {
  const { data = [] } = useLanguages();
  const list = only ? data.filter((l) => only.includes(l.code)) : data;
  return (
    <select id={id} className="select" value={value} onChange={(e) => onChange(e.target.value)}>
      {anyLabel !== undefined && <option value="">{anyLabel}</option>}
      {list.map((l) => (
        <option key={l.code} value={l.code}>
          {l.native && l.native !== l.name ? `${l.name} · ${l.native}` : l.name}
        </option>
      ))}
    </select>
  );
}
