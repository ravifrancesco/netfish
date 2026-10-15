import { Suspense, lazy, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, setUnauthorizedHandler } from './api';
import { Nav } from './components/Nav';
import { Splash, shouldShowSplash } from './components/Splash';
import { Spinner, ToastProvider } from './components/ui';
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
import { useLiveRooms } from './lib/together';
import { ProfilePicker, useProfiles, wasPicked } from './components/ProfilePicker';

// The player pulls in hls.js; only load it when someone presses play.
const Watch = lazy(() => import('./pages/Watch'));

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
  useEffect(() => (isTV() && !location.pathname.startsWith('/watch/') ? manageFocus(location.key) : undefined), [location.key, location.pathname]);
  return null;
}

/** "Switch profile" from the menu. */
function SwitchProfile() {
  const navigate = useNavigate();
  return <ProfilePicker onAdd={() => navigate('/profiles/add')} onPicked={() => navigate('/', { replace: true })} />;
}

function AddProfile() {
  const navigate = useNavigate();
  return <Login adding onCancel={() => navigate('/profiles', { replace: true })} onDone={() => navigate('/', { replace: true })} />;
}

function Shell({ user }: { user: NonNullable<ReturnType<typeof useMe>['data']> }) {
  const { pathname } = useLocation();
  useReadyNotifications(user.id);
  useTogetherNotifications(user.id);
  // The player and the profile picker fill the screen without the menu bar.
  const watching = pathname.startsWith('/watch/') || pathname.startsWith('/profiles');
  useLiveRooms(!pathname.startsWith('/watch/'));
  return (
    <>
      <ScrollToTop />
      <TvFocus />
      {!watching && <Nav user={user} />}
      <main className={watching ? 'main main--player' : 'main'}>
        <Suspense fallback={<div className="page container"><Spinner size={32} /></div>}>
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
            <Route path="/profiles" element={<SwitchProfile />} />
            <Route path="/profiles/add" element={<AddProfile />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </main>
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
  const [picked, setPicked] = useState(wasPicked);
  const ready = !config.isLoading && (me.isSuccess || me.isError) && (profiles.isSuccess || profiles.isError);
  const known = profiles.data?.profiles ?? [];
  // A device several people use asks who's watching when Netfish opens.
  const ask = !picked && known.length > 1 && profiles.data?.ask;
  // Whoever just signed in is who's watching.
  const signedIn = () => {
    setAdding(false);
    setPicked(true);
  };

  return (
    <ToastProvider>
      {splash && <Splash ready={ready} onDone={() => setSplash(false)} />}
      {ready &&
        (config.data?.setupRequired ? (
          <Setup />
        ) : signedOut && known.length && !adding ? (
          <ProfilePicker onAdd={() => setAdding(true)} onPicked={() => setPicked(true)} />
        ) : signedOut ? (
          <Login adding={adding} onCancel={known.length ? () => setAdding(false) : undefined} onDone={signedIn} />
        ) : me.data && ask ? (
          <ProfilePicker onAdd={() => setAdding(true)} onPicked={() => setPicked(true)} />
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
