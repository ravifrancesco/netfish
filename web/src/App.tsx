import { Suspense, lazy, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
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

function Shell({ user }: { user: NonNullable<ReturnType<typeof useMe>['data']> }) {
  const { pathname } = useLocation();
  const watching = pathname.startsWith('/watch/');
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
  const ready = !config.isLoading && (me.isSuccess || me.isError);

  return (
    <ToastProvider>
      {splash && <Splash ready={ready} onDone={() => setSplash(false)} />}
      {ready &&
        (config.data?.setupRequired ? (
          <Setup />
        ) : signedOut ? (
          <Login />
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
