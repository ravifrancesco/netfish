import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@fontsource-variable/inter';
import './styles.css';
import { ApiError } from './api';
import { App } from './App';
import { markFullscreen } from './lib/desktop';
import { startSystemVolume } from './lib/systemVolume';
import { isTV, startTV } from './lib/tv';
import { language } from './i18n';

document.documentElement.lang = language;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
});

// The Mac and Windows apps mark themselves so the UI can leave room for window controls.
if (/NetfishDesktop/.test(navigator.userAgent)) {
  document.documentElement.classList.add('is-desktop', /Mac/.test(navigator.platform) ? 'is-mac' : 'is-other-os');
  markFullscreen(document.documentElement);
  startSystemVolume();
}

// Phone & tablet apps (iPhone, iPad, Android): room for notches, no volume slider (the device buttons do that).
// And they're apps, not web pages: no pinch or double-tap zoom, nor zooming in on a text field.
if (/NetfishiOS|NetfishAndroid/.test(navigator.userAgent)) {
  document.documentElement.classList.add('is-ios-app');
  const viewport = document.querySelector('meta[name="viewport"]');
  viewport?.setAttribute('content', `${viewport.getAttribute('content')}, maximum-scale=1, user-scalable=no`);
}

// The Fire TV app (or ?tv=1 in a browser): remote-control navigation.
if (isTV()) startTV();

// TVs that lay pages out 1920 px wide (Samsung's, LG's): everything a size up, for the sofa, as
// on a 1280 px screen (Fire TV's is already about half that). A browser that keeps its own width
// gets the page zoomed instead.
if (isTV() && window.innerWidth >= 1800) {
  document.querySelector('meta[name="viewport"]')?.setAttribute('content', 'width=1280, viewport-fit=cover');
  requestAnimationFrame(() => {
    if (window.innerWidth >= 1800) document.documentElement.style.setProperty('zoom', String(window.innerWidth / 1280));
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
