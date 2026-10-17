import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Clapperboard, Film, HardDriveDownload, House, LogOut, RadioTower, Search, Settings, Tv, Users, X } from 'lucide-react';
import type { User } from '@netfish/shared';
import { api } from '../api';
import { appKind, desktop } from '../lib/desktop';
import { useConfig } from '../lib/hooks';
import { Logo } from './Logo';
import { TogetherPill } from './Together';
import { CastButton } from './PlayOn';
import { t } from '../i18n';

function useActiveDownloads() {
  const { data: config } = useConfig();
  const { data } = useQuery({
    queryKey: ['downloads'],
    queryFn: api.downloads,
    enabled: Boolean(config?.features.downloads),
    refetchInterval: 10_000,
  });
  return (data?.items ?? []).filter((d) => d.state !== 'failed').length;
}

function SearchBox() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const onSearch = location.pathname === '/search';
  const [open, setOpen] = useState(onSearch);
  const [value, setValue] = useState(onSearch ? (params.get('q') ?? '') : '');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!onSearch) {
      setOpen(false);
      setValue('');
    }
  }, [onSearch]);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      const q = value.trim();
      if (q) navigate(`/search?q=${encodeURIComponent(q)}`, { replace: onSearch });
    }, 300);
    return () => clearTimeout(timer);
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`search${open ? ' is-open' : ''}`}>
      <button
        className="icon-btn"
        aria-label={t('Search')}
        onClick={() => {
          setOpen(true);
          setTimeout(() => input.current?.focus(), 0);
        }}
      >
        <Search size={20} />
      </button>
      <input
        ref={input}
        className="search__input"
        placeholder={t('Titles, people, anything')}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => !value && setOpen(false)}
        onKeyDown={(e) => e.key === 'Escape' && (setValue(''), setOpen(false), input.current?.blur())}
        aria-label={t('Search')}
      />
      {open && value && (
        <button className="icon-btn icon-btn--sm" aria-label={t('Clear search')} onClick={() => (setValue(''), input.current?.focus())}>
          <X size={16} />
        </button>
      )}
    </div>
  );
}

function ProfileMenu({ user }: { user: User }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // Admins: a newer Netfish than this server (the container to update) shows as a dot here.
  const update = useQuery({ queryKey: ['server-update'], queryFn: api.serverUpdate, enabled: user.isAdmin, staleTime: 30 * 60_000 });
  const logout = useMutation({
    mutationFn: api.logout,
    onSettled: () => {
      qc.clear();
      qc.setQueryData(['me'], null);
    },
  });
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="profile" ref={ref}>
      <button
        className="avatar"
        onClick={() => setOpen((o) => !o)}
        aria-label={update.data?.newer ? `${t('Account menu')} · ${t('A newer Netfish is out')}` : t('Account menu')}
        aria-expanded={open}
      >
        {user.avatar ? <img src={user.avatar} alt="" /> : <span>{user.name[0]?.toUpperCase()}</span>}
      </button>
      {update.data?.newer && <span className="profile__dot" aria-hidden="true" />}
      {open && (
        <div className="menu" role="menu">
          <div className="menu__head">
            <strong>{user.name}</strong>
            {user.isAdmin && <span className="badge badge--dim">{t('Admin')}</span>}
          </div>
          {desktop()?.openOffline && (
            <button className="menu__item" onClick={() => desktop()?.openOffline?.()} role="menuitem">
              <HardDriveDownload size={16} /> {t('Downloads on {device}', { device: appKind().device })}
            </button>
          )}
          <Link to="/profiles" className="menu__item" onClick={() => setOpen(false)} role="menuitem">
            <Users size={16} /> {t('Switch profile')}
          </Link>
          <Link to="/settings" className="menu__item" onClick={() => setOpen(false)} role="menuitem">
            <Settings size={16} /> {t('Settings')}
            {update.data?.newer && <span className="badge menu__note">{t('Update')}</span>}
          </Link>
          <button className="menu__item" onClick={() => logout.mutate()} role="menuitem">
            <LogOut size={16} /> {t('Sign out')}
          </button>
        </div>
      )}
    </div>
  );
}

const LINKS = [
  { to: '/', label: t('Home'), icon: House, end: true },
  { to: '/movies', label: t('Movies'), icon: Film },
  { to: '/shows', label: t('Shows'), icon: Tv },
  { to: '/activity', label: t('Activity'), icon: Activity },
];
const CHANNELS = { to: '/channels', label: t('Channels'), icon: RadioTower, end: false };

export function Nav({ user }: { user: User }) {
  const [scrolled, setScrolled] = useState(false);
  const active = useActiveDownloads();
  // Channels, when an admin has turned them on: in the top bar, right after Home (phones find them on Home).
  const channels = Boolean(useConfig().data?.features.channels);
  const links = channels ? [LINKS[0], CHANNELS, ...LINKS.slice(1)] : LINKS;
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <>
      <header className={`nav${scrolled ? ' is-scrolled' : ''}`}>
        <Link to="/" className="nav__logo" aria-label={t('Netfish home')}>
          <Logo />
        </Link>
        <nav className="nav__links">
          {links.map(({ to, label, end }) => (
            <NavLink key={to} to={to} end={end} className="nav__link">
              {label}
              {to === '/activity' && active > 0 && <span className="nav__count">{active}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="nav__right">
          <TogetherPill />
          <SearchBox />
          <CastButton />
          <ProfileMenu user={user} />
        </div>
      </header>
      <nav className="tabbar" aria-label={t('Main')}>
        {LINKS.slice(0, 3).map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className="tabbar__item">
            <Icon size={22} />
            <span>{label}</span>
          </NavLink>
        ))}
        <NavLink to="/search" className="tabbar__item">
          <Search size={22} />
          <span>{t('Search')}</span>
        </NavLink>
        <NavLink to="/activity" className="tabbar__item">
          <Clapperboard size={22} />
          <span>{t('Activity')}</span>
          {active > 0 && <span className="nav__count nav__count--tab">{active}</span>}
        </NavLink>
      </nav>
    </>
  );
}
