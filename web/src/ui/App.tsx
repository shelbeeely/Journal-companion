import { useEffect, useState } from 'react';
import { hrefFor, useRoute, type Route } from '../state/router';
import { useStore } from '../state/store';
import { useApplyTheme } from '../state/theme';
import { Icon, type IconName } from './icons';
import { ScreenSaver, useIdle } from './ScreenSaver';
import { HistoryScreen } from './screens/HistoryScreen';
import { ProjectEditorScreen } from './screens/ProjectEditorScreen';
import { ProjectsScreen } from './screens/ProjectsScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { TodayScreen } from './screens/TodayScreen';
import { UpdatePrompt } from './UpdatePrompt';

const NAV: { route: Route; label: string; icon: IconName; match: Route['name'][] }[] = [
  { route: { name: 'today' }, label: 'Today', icon: 'today', match: ['today'] },
  { route: { name: 'projects' }, label: 'Projects', icon: 'projects', match: ['projects', 'newProject', 'editProject'] },
  { route: { name: 'history' }, label: 'History', icon: 'history', match: ['history'] },
  { route: { name: 'settings' }, label: 'Settings', icon: 'settings', match: ['settings'] },
];

export function App() {
  const { state, actions } = useStore();
  const route = useRoute();
  const prefs = state.preferences;
  const [screenSaver, setScreenSaver] = useState(false);
  const veiled = usePrivacyVeil(prefs.privacyVeilEnabled);
  useApplyTheme(prefs.themeMode, prefs.dimDeskModeEnabled);
  useIdle(prefs.screenSaverIdleMinutes, route.name === 'today' && !!state.activeProject && !screenSaver, () => setScreenSaver(true));

  // Keyboard shortcuts on the desk (ignored while typing).
  useEffect(() => {
    if (route.name !== 'today') return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || t.closest('input, textarea, select, [contenteditable], dialog')) return;
      if (e.key === 'h') actions.requestHint();
      else if (e.key === 'n') actions.tryAnotherPrompt();
      else if (e.key === 'f') actions.toggleTimer();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [route.name, actions]);

  let screen;
  switch (route.name) {
    case 'today':
      screen = <TodayScreen onOpenScreenSaver={() => setScreenSaver(true)} />;
      break;
    case 'projects':
      screen = <ProjectsScreen />;
      break;
    case 'newProject':
      screen = <ProjectEditorScreen key="new" editingId={null} />;
      break;
    case 'editProject':
      screen = <ProjectEditorScreen key={route.id} editingId={route.id} />;
      break;
    case 'history':
      screen = <HistoryScreen />;
      break;
    case 'settings':
      screen = <SettingsScreen />;
      break;
  }

  const nav = NAV.map((n) => (
    <a key={n.label} className="nav-item" href={hrefFor(n.route)} aria-current={n.match.includes(route.name) ? 'page' : undefined}>
      <span className="nav-icon">
        <Icon name={n.icon} size={22} />
      </span>
      {n.label}
    </a>
  ));

  return (
    <>
      <div className="titlebar" />
      <div className="shell">
        <nav className="rail" aria-label="Main">
          <img className="brand" src="icons/icon-192.png" alt="Journal Companion" />
          {nav}
        </nav>
        <main className="content" id="main">
          {screen}
        </main>
      </div>
      <nav className="bottom-nav" aria-label="Main">
        {nav}
      </nav>

      {state.banner && (
        <div className="banner" role="status">
          <span>{state.banner}</span>
          <button className="btn sm" onClick={actions.dismissBanner}>
            Dismiss
          </button>
        </div>
      )}
      <UpdatePrompt />
      {screenSaver && <ScreenSaver onExit={() => setScreenSaver(false)} />}
      {veiled && (
        <div className="privacy-veil" aria-hidden="true">
          <div>
            <img src="icons/icon-192.png" alt="" />
            <p className="small">Journal Companion</p>
          </div>
        </div>
      )}
    </>
  );
}

/** Blanks the UI while the app is hidden or unfocused so OS switchers and screen shares see nothing private. */
function usePrivacyVeil(enabled: boolean) {
  const [veiled, setVeiled] = useState(false);
  useEffect(() => {
    if (!enabled) {
      setVeiled(false);
      return;
    }
    const update = () => setVeiled(document.visibilityState === 'hidden' || !document.hasFocus());
    const show = () => setVeiled(true);
    update();
    window.addEventListener('blur', show);
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    window.addEventListener('pointerdown', update);
    return () => {
      window.removeEventListener('blur', show);
      window.removeEventListener('focus', update);
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('pointerdown', update);
    };
  }, [enabled]);
  return veiled;
}
