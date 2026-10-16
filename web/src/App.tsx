import { Suspense, lazy, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, setUnauthorizedHandler } from './api';
import { Nav } from './components/Nav';
import { Splash, shouldShowSplash } from './components/Splash';
import { PageLoader, ToastProvider } from './components/ui';
import { useConfig, useMe } from './lib/hooks';
import { isTV, manageFocus } from './lib/tv';
import ActivityPage from './pages/Activity';
import Browse from './pages/Browse';
import Home from './pages/Home';
import Login from './pages/Login';
import PersonPage from './pages/Person';
import Search from './pages/Search';
import Settings from './pages/Settings';
import Setup from './pages/Setup';
import Title from './pages/Title';
import { t } from './i18n';
import { useReadyNotifications, useTogetherNotifications } from './lib/notify';
import { JoinRoom } from './components/Together';
import { useLive } from './lib/together';
import { useOfflineAware } from './lib/offline';
import { RemoteBar } from './components/PlayOn';
import { ProfilePicker, useProfiles, wasPicked } from './components/ProfilePicker';

// The player pulls in hls.js; only load it when someone presses play.
const Watch = lazy(() => import('./pages/Watch'));
const Remote = lazy(() => import('./pages/Remote'));
const ChannelsPage = lazy(() => import('./pages/Channels'));
const ChannelPlayer = lazy(() => import('./pages/ChannelPlayer'));

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

/** TV: focus the first thing on each page, or where you were when you come back. */
function TvFocus() {
  const location = useLocation();
  // The player starts with nothing focused, so the remote's arrows skip and Select pauses.
  useEffect(
    () => (isTV() && !location.pathname.startsWith('/watch/') && !location.pathname.startsWith('/channels/') ? manageFocus(location.key) : undefined),
    [location.key, location.pathname],
  );
  return null;
}

/** "Switch profile" from the menu. */
function SwitchProfile() {
  const navigate = useNavigate();
  return (
    <ProfilePicker
      onAdd={() => navigate('/profiles/add')}
      onPicked={() => navigate('/', { replace: true })}
      onSignIn={(name) => navigate(`/profiles/add?again=${encodeURIComponent(name)}`)}
    />
  );
}

/** Adding someone, or someone signing in again (`?again=<name>`). */
function AddProfile() {
  const navigate = useNavigate();
  const again = new URLSearchParams(useLocation().search).get('again') ?? undefined;
  return <Login adding again={again} onCancel={() => navigate('/profiles', { replace: true })} onDone={() => navigate('/', { replace: true })} />;
}

function Shell({ user }: { user: NonNullable<ReturnType<typeof useMe>['data']> }) {
  const { pathname } = useLocation();
  useReadyNotifications(user.id);
  useTogetherNotifications(user.id);
  // The players (a film, a channel) and the profile picker fill the screen without the menu bar.
  const watching = pathname.startsWith('/watch/') || pathname.startsWith('/channels/') || pathname.startsWith('/profiles');
  // Open as long as Netfish is: rooms, screens, and films sent here from another device.
  useLive();
  // The apps: downloads watched offline reach the server, and a lost server means offline mode.
  useOfflineAware();
  return (
    <>
      <ScrollToTop />
      <TvFocus />
      {!watching && <Nav user={user} />}
      <main className={watching ? 'main main--player' : 'main'}>
        <Suspense fallback={<div className="page container"><PageLoader /></div>}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/movies" element={<Browse key="movie" mediaType="movie" />} />
            <Route path="/shows" element={<Browse key="tv" mediaType="tv" />} />
            <Route path="/search" element={<Search />} />
            <Route path="/title/:type/:id" element={<Title />} />
            <Route path="/person/:id" element={<PersonPage />} />
            <Route path="/activity" element={<ActivityPage />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/watch/:itemId" element={<Watch />} />
            <Route path="/together/:id" element={<JoinRoom />} />
            <Route path="/remote/:id" element={<Remote />} />
            <Route path="/channels" element={<ChannelsPage />} />
            <Route path="/channels/:number" element={<ChannelPlayer />} />
            <Route path="/profiles" element={<SwitchProfile />} />
            <Route path="/profiles/add" element={<AddProfile />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </main>
      {/* Playing on another device from here: a way back to its remote. */}
      {!watching && !pathname.startsWith('/remote/') && <RemoteBar />}
    </>
  );
}

export function App() {
  const qc = useQueryClient();
  const config = useConfig();
  const me = useMe();
  const [splash, setSplash] = useState(shouldShowSplash);

  useEffect(() => {
    setUnauthorizedHandler(() => qc.setQueryData(['me'], null));
  }, [qc]);

  const signedOut = me.data === null || (me.error instanceof ApiError && me.error.status === 401);
  const profiles = useProfiles();
  const [adding, setAdding] = useState(false);
  /** Someone picked whose sign-in has run out: their name, for signing in again. */
  const [again, setAgain] = useState<string>();
  const [picked, setPicked] = useState(wasPicked);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  /** Someone picked (or signed in) when Netfish opened: on to Home if it opened on the profiles page. */
  const choose = () => {
    setPicked(true);
    if (pathname.startsWith('/profiles')) navigate('/', { replace: true });
  };
  const ready = !config.isLoading && (me.isSuccess || me.isError) && (profiles.isSuccess || profiles.isError);
  const known = profiles.data?.profiles ?? [];
  // A device several people use asks who's watching when Netfish opens.
  const ask = !picked && known.length > 1 && profiles.data?.ask;
  // Whoever just signed in is who's watching.
  const signedIn = () => {
    setAdding(false);
    setAgain(undefined);
    choose();
  };

  return (
    <ToastProvider>
      {splash && <Splash ready={ready} onDone={() => setSplash(false)} />}
      {ready &&
        (config.data?.setupRequired ? (
          <Setup />
        ) : again ? (
          <Login adding again={again} onCancel={() => setAgain(undefined)} onDone={signedIn} />
        ) : signedOut && known.length && !adding ? (
          <ProfilePicker onAdd={() => setAdding(true)} onPicked={choose} onSignIn={setAgain} />
        ) : signedOut ? (
          <Login adding={adding} onCancel={known.length ? () => setAdding(false) : undefined} onDone={signedIn} />
        ) : me.data && ask ? (
          <ProfilePicker onAdd={() => setAdding(true)} onPicked={choose} onSignIn={setAgain} />
        ) : me.data && adding ? (
          <Login adding onCancel={() => setAdding(false)} onDone={signedIn} />
        ) : me.data ? (
          <Shell user={me.data} />
        ) : (
          <div className="page container empty">
            <p>{(me.error as Error)?.message ?? t("Can't reach the Netfish server.")}</p>
            <button className="btn btn--ghost" onClick={() => void me.refetch()}>
              {t('Try again')}
            </button>
          </div>
        ))}
    </ToastProvider>
  );
}
