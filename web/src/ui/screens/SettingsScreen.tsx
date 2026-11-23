import { useEffect, useRef, useState } from 'react';
import { SCREEN_SAVER_LABELS, THEME_LABELS, type AppThemeMode, type ScreenSaverMode } from '../../core/models';
import type { ExportBundle } from '../../core/repository';
import { localDateIso } from '../../core/time';
import { useInstallPrompt } from '../../state/install';
import { useStore } from '../../state/store';
import { Dialog, Segmented, Spinner, Switch } from '../controls';
import { Icon } from '../icons';
import { WeatherCard } from '../deskCards';

export function SettingsScreen() {
  const { state, actions } = useStore();
  const prefs = state.preferences;
  const set = actions.updatePreferences;

  return (
    <div className="content-narrow stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <h1>Settings</h1>
      </div>

      <InstallCard />

      <section className="card">
        <h2>Appearance & Eye Comfort</h2>
        <p className="small muted">Warm Light (matte oat paper), Soft Dark (low-halation charcoal), or follow your system theme.</p>
        <Segmented<AppThemeMode>
          label="Theme"
          value={prefs.themeMode}
          onChange={(v) => set({ themeMode: v })}
          options={(Object.keys(THEME_LABELS) as AppThemeMode[]).map((k) => ({ value: k, label: THEME_LABELS[k] }))}
        />
        <div style={{ marginTop: 8 }}>
          <Switch label="Extra-dim evening mode" description="Ultra-low-glare candlelight surface for late-night desk sessions" checked={prefs.dimDeskModeEnabled} onChange={(v) => set({ dimDeskModeEnabled: v })} />
        </div>
      </section>

      <section className="card">
        <h2>Desk Mode & Privacy</h2>
        <Switch
          label="Keep screen awake in Desk Mode"
          description={'wakeLock' in navigator ? 'Active only while Today is open and visible' : "This browser doesn't support keep-awake"}
          checked={prefs.keepScreenAwakeInDeskMode}
          onChange={(v) => set({ keepScreenAwakeInDeskMode: v })}
          testId="setting_keep_awake"
        />
        <Switch
          label="Discreet mode"
          description="Hide brief, audience & notes on Desk Mode, History and the screen saver. Turn on in shared spaces."
          checked={prefs.discreetDeskModeEnabled}
          onChange={(v) => set({ discreetDeskModeEnabled: v })}
          testId="setting_discreet_mode"
        />
        <Switch
          label="Privacy veil"
          description="Cover the app whenever it's in the background or loses focus, so app switchers and screen shares show a blank page"
          checked={prefs.privacyVeilEnabled}
          onChange={(v) => set({ privacyVeilEnabled: v })}
          testId="setting_privacy_veil"
        />
        <p className="hint" style={{ marginBottom: 0 }}>
          On-device only: briefs, drafts, and history live in this browser's private storage, are never sent anywhere, and there are zero analytics.
        </p>
      </section>

      <section className="card">
        <h2>Ambient Screen Saver</h2>
        <p className="small muted">A drifting clock-and-cues display for a propped-up tablet or a docked phone. Tap anywhere to return.</p>
        <Segmented<ScreenSaverMode>
          label="Screen saver content"
          value={prefs.screenSaverMode}
          onChange={(v) => set({ screenSaverMode: v })}
          options={(Object.keys(SCREEN_SAVER_LABELS) as ScreenSaverMode[]).map((k) => ({ value: k, label: SCREEN_SAVER_LABELS[k] }))}
        />
        <div style={{ marginTop: 8 }}>
          <Switch label="Dim screen saver brightness" description="Reduces luminance for bedside and evening stands" checked={prefs.screenSaverDimBrightness} onChange={(v) => set({ screenSaverDimBrightness: v })} />
        </div>
        <label className="field" style={{ marginTop: 8 }}>
          <span className="label">Start automatically after Today is idle</span>
          <select className="input" value={prefs.screenSaverIdleMinutes} onChange={(e) => set({ screenSaverIdleMinutes: Number(e.target.value) })}>
            <option value={0}>Never (start from the Today toolbar)</option>
            <option value={2}>2 minutes</option>
            <option value={5}>5 minutes</option>
            <option value={10}>10 minutes</option>
            <option value={20}>20 minutes</option>
          </select>
        </label>
      </section>

      <section>
        <h2 style={{ margin: '8px 0' }}>Weather Card (Open-Meteo)</h2>
        <p className="small muted" style={{ marginTop: 0 }}>
          Enter a city or grant approximate location on demand. Only your city query or rounded coordinates are sent to Open-Meteo—never your journal.
        </p>
        <WeatherCard />
        <div className="card" style={{ marginTop: 12 }}>
          <Switch label="Use Celsius (°C)" description="Switch between Fahrenheit and Celsius" checked={prefs.useCelsius} onChange={(v) => set({ useCelsius: v })} testId="setting_use_celsius" />
        </div>
      </section>

      <AiCard />
      <BackupCard />

      <p className="tiny muted" style={{ textAlign: 'center', margin: '8px 0 24px' }}>
        Journal Companion · works offline · v{__APP_VERSION__}
      </p>
    </div>
  );
}

function AiCard() {
  const { state, actions } = useStore();
  const s = state.ai;
  let text: string;
  switch (s.kind) {
    case 'checking':
      text = 'Checking for an on-device language model…';
      break;
    case 'available':
      text = 'Ready: an on-device model is available in this browser. Prompts, hints and draft help are generated locally—nothing leaves your device.';
      break;
    case 'downloadable':
      text = s.isDownloading
        ? `Downloading the on-device model${s.progress ? ` (${Math.round(s.progress * 100)}%)` : ''}…`
        : 'This browser supports an on-device model and can download it now (a one-time download of a few GB).';
      break;
    case 'unavailable':
      text = s.reason;
      break;
    case 'error':
      text = `On-device AI error: ${s.message}. Built-in templates remain active.`;
      break;
  }
  return (
    <section className="card">
      <div className="spread">
        <h2>On-Device AI</h2>
        <span className={`badge ${s.kind === 'available' ? '' : 'warn'}`}>{s.kind === 'available' ? 'On-device' : 'Templates'}</span>
      </div>
      <p className="small" data-testid="ai_status_text">
        {text}
      </p>
      <p className="hint">
        Uses the browser's built-in Prompt API where offered (e.g. Chrome or Edge on desktop with a capable GPU). Everywhere else—Safari, Firefox, iOS and most
        phones—the full built-in prompt engine runs instead, completely offline.
      </p>
      <div className="row">
        {s.kind === 'downloadable' && !s.isDownloading && (
          <button className="btn filled sm" onClick={actions.downloadAi}>
            <Icon name="download" size={16} /> Download on-device model
          </button>
        )}
        <button className="btn sm" onClick={actions.checkAi} disabled={s.kind === 'checking'}>
          {s.kind === 'checking' ? <Spinner /> : <Icon name="refresh" size={16} />} Re-check
        </button>
      </div>
    </section>
  );
}

function BackupCard() {
  const { actions } = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<ExportBundle | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);

  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null));
  }, []);

  const doExport = async () => {
    const bundle = await actions.repo.exportAll();
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `journal-companion-backup-${localDateIso()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const parsed = JSON.parse(await f.text()) as ExportBundle;
      if (parsed?.format !== 'journal-companion-export') throw new Error();
      setPending(parsed);
    } catch {
      actions.showBanner("That file isn't a Journal Companion backup.");
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <section className="card">
      <h2>Backup & Device Transfer</h2>
      <p className="small muted">
        Your journal lives only in this browser. Export a backup file to keep a copy or move to another device—nothing is uploaded anywhere.
      </p>
      <div className="row">
        <button className="btn sm" onClick={doExport}>
          <Icon name="download" size={16} /> Export backup
        </button>
        <button className="btn sm" onClick={() => fileRef.current?.click()}>
          <Icon name="upload" size={16} /> Import backup
        </button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => onFile(e.target.files?.[0])} />
      </div>
      <p className="hint" style={{ marginBottom: 0 }}>
        {persisted === true
          ? 'Storage is marked persistent: the browser will not clear it under storage pressure.'
          : persisted === false
            ? 'Tip: install the app so the browser keeps your journal storage persistent. Exporting a backup now and then is still wise.'
            : 'Export a backup now and then; browsers can clear site data if you ask them to.'}
      </p>

      <Dialog open={!!pending} onClose={() => setPending(null)} labelledBy="import-title">
        <h2 id="import-title">Replace local journal?</h2>
        <p className="muted">
          This replaces everything on this device with the backup from {pending ? new Date(pending.exportedAt).toLocaleString() : ''} ({pending?.projects.length ?? 0}{' '}
          project(s), {pending?.entries.length ?? 0} page(s)).
        </p>
        <div className="sheet-actions">
          <button className="btn text" onClick={() => setPending(null)}>
            Cancel
          </button>
          <button
            className="btn filled"
            onClick={async () => {
              try {
                if (pending) await actions.repo.importAll(pending);
                actions.showBanner('Backup restored.');
              } catch (e) {
                actions.showBanner((e as Error).message);
              }
              setPending(null);
            }}
          >
            Replace & restore
          </button>
        </div>
      </Dialog>
    </section>
  );
}

function InstallCard() {
  const install = useInstallPrompt();
  if (install.isStandalone) return null;
  return (
    <section className="card primary-soft install-hint">
      <div className="spread">
        <h2>Install Journal Companion</h2>
        <Icon name="install" />
      </div>
      <p className="small" style={{ margin: '6px 0 10px' }}>
        Install it like a native app: its own window and icon, full offline use, and persistent local storage.
      </p>
      {install.canPrompt ? (
        <button className="btn filled sm" onClick={install.prompt}>
          Install app
        </button>
      ) : install.platform === 'ios' ? (
        <ol className="small">
          <li>Open this page in Safari.</li>
          <li>Tap the Share button, then “Add to Home Screen”.</li>
        </ol>
      ) : install.platform === 'mac-safari' ? (
        <p className="small" style={{ margin: 0 }}>
          In Safari, choose File → Add to Dock.
        </p>
      ) : install.platform === 'firefox' ? (
        <p className="small" style={{ margin: 0 }}>
          Firefox on Android: menu → Install. On desktop Firefox, use Chrome, Edge or Safari to install, or keep using it in a tab—it still works offline.
        </p>
      ) : (
        <p className="small" style={{ margin: 0 }}>
          Use your browser menu's “Install app” or “Add to Home screen” option.
        </p>
      )}
    </section>
  );
}
