import type { ComponentType } from 'react';
import { Activity } from './pages/Activity';
import { Dupes } from './pages/Dupes';
import { Large } from './pages/Large';
import { MapPage } from './pages/Map';
import { Overview } from './pages/Overview';
import { Rules } from './pages/Rules';
import { Settings } from './pages/Settings';
import { Suggest } from './pages/Suggest';
import { useRoute } from './router';
import { PATHS } from './routes';
import { Shell, Toasts } from './shell/Shell';
import { ShellProvider } from './shell/store';

const PAGES: Record<string, ComponentType> = {
  [PATHS.overview]: Overview,
  [PATHS.suggest]: Suggest,
  [PATHS.large]: Large,
  [PATHS.dupes]: Dupes,
  [PATHS.rules]: Rules,
  [PATHS.activity]: Activity,
  [PATHS.settings]: Settings,
};

function Routed() {
  const { path } = useRoute();
  // The space map supplies its own palette commands and toast placement.
  if (path === PATHS.map) return <MapPage />;
  const Page = PAGES[path] ?? Overview;
  const p = PAGES[path] ? path : PATHS.overview;
  return (
    <Shell path={p}>
      <Page key={p} />
      <Toasts />
    </Shell>
  );
}

export default function App() {
  return (
    <ShellProvider>
      <Routed />
    </ShellProvider>
  );
}
