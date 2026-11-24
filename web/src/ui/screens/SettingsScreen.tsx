import { useEffect, useRef, useState } from 'react';
import { SCREEN_SAVER_LABELS, THEME_LABELS, type AppThemeMode, type ScreenSaverMode } from '../../core/models';
import type { ExportBundle } from '../../core/repository';
import { beginOpenRouterOAuth, listModels, type ModelOption } from '../../core/ai/openRouterClient';
import { useInstallPrompt } from '../../state/install';
import { useStore } from '../../state/store';
import { navigate } from '../../state/router';
import { MOMENT_LABELS, type MomentKind } from '../../core/context/moments';
import { isEnabled, SOURCE_META } from '../../core/sources/meta';
import { Dialog, Segmented, Spinner, Switch } from '../controls';
import { Icon } from '../icons';
import { WeatherCard } from '../deskCards';
import { ProactiveSurface } from '../ProactiveSurface';

export function SettingsScreen() {
  const { state, actions } = useStore();
  const prefs = state.preferences;
  const set = actions.updatePreferences;

  return (
    <div className="content-narrow stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <h1>Settings</h1>
      </div>
      <ProactiveSurface kind="context" />

      <InstallCard />

      <ConnectionsEntry />
      <RhythmCard />
      <SuggestionsCard />

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
        <div className="field" style={{ marginTop: 10 }}>
          <span className="label">Proactive desk</span>
          <Segmented<'RICH' | 'CALM'>
            label="Proactive desk density"
            value={prefs.proactiveDensity}
            onChange={(v) => set({ proactiveDensity: v })}
            options={[
              { value: 'RICH', label: 'Rich — show everything relevant' },
              { value: 'CALM', label: 'Calm — just the essentials' },
            ]}
          />
          <span className="hint">The desk shows what fits what you're doing right now: arriving, writing, on a break, done, reviewing and so on.</span>
        </div>
        <p className="hint" style={{ marginBottom: 0 }}>
          Briefs, drafts, and history live in this browser's private storage. Nothing leaves the device unless you turn on AI below, and there are zero analytics.
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

const RECOMMENDED_MODELS = [
  { id: 'anthropic/claude-haiku-5.5', note: 'Default · fast, inexpensive' },
  { id: 'google/gemini-3.1-flash-lite', note: 'Very inexpensive' },
  { id: 'mistralai/ministral-8b-2512', note: 'Small, low cost' },
];

function AiCard() {
  const { state, actions } = useStore();
  const s = state.ai;
  const cfg = state.aiSettings;
  const [manualKey, setManualKey] = useState('');
  const [consentOpen, setConsentOpen] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [models, setModels] = useState<ModelOption[] | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const connected = !!cfg.apiKey;
  const enabled = connected && !!cfg.consentedAt;
  const statusText =
    s.kind === 'checking'
      ? 'Checking OpenRouter…'
      : s.kind === 'available'
        ? `On · ${cfg.model}`
        : s.kind === 'error'
          ? s.message
          : s.reason;

  const loadModels = async () => {
    setModelError(null);
    try {
      setModels(await listModels());
    } catch (e) {
      setModelError((e as Error).message);
    }
  };
  const shown = models?.filter((m) => !filter || m.id.toLowerCase().includes(filter.toLowerCase()) || m.name.toLowerCase().includes(filter.toLowerCase())).slice(0, 60);

  return (
    <section className="card">
      <div className="spread">
        <h2>AI (OpenRouter)</h2>
        <span className={`badge ${s.kind === 'available' ? '' : 'warn'}`}>{s.kind === 'available' ? 'On' : 'Built-in prompts'}</span>
      </div>
      <p className="small" data-testid="ai_status_text">
        {statusText}
      </p>
      <p className="hint">
        AI-written prompts, hints, draft help and desk cues come from the model you choose on OpenRouter, using your own OpenRouter account. Without it, the
        built-in prompt engine runs fully offline.
      </p>

      {!connected && (
        <div className="stack" style={{ gap: 10 }}>
          <div className="row">
            <button className="btn filled sm" onClick={() => beginOpenRouterOAuth()} data-testid="connect_openrouter">
              Connect OpenRouter
            </button>
          </div>
          <details className="small">
            <summary className="muted" style={{ cursor: 'pointer' }}>
              Or paste an API key
            </summary>
            <form
              className="row"
              style={{ marginTop: 8 }}
              onSubmit={async (e) => {
                e.preventDefault();
                if (!manualKey.trim()) return;
                await actions.updateAiSettings({ apiKey: manualKey.trim(), connectedVia: 'manual' });
                setManualKey('');
                setConsentOpen(true);
              }}
            >
              <input
                className="input"
                style={{ flex: '1 1 220px' }}
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="sk-or-…"
                aria-label="OpenRouter API key"
                value={manualKey}
                onChange={(e) => setManualKey(e.target.value)}
              />
              <button className="btn sm" type="submit" disabled={!manualKey.trim()}>
                Save key
              </button>
            </form>
            <p className="hint">Stored only in this browser. Never included in backups.</p>
          </details>
        </div>
      )}

      {connected && !enabled && (
        <div className="card primary-soft" style={{ padding: 14, marginTop: 4 }}>
          <b>One step left</b>
          <p className="small" style={{ margin: '4px 0 10px' }}>
            Review what is sent to OpenRouter, then turn AI on.
          </p>
          <div className="row">
            <button className="btn filled sm" onClick={() => setConsentOpen(true)} data-testid="review_consent">
              Review & turn on
            </button>
            <button className="btn text sm" onClick={() => actions.updateAiSettings({ apiKey: null, consentedAt: null, connectedVia: null })}>
              Disconnect
            </button>
          </div>
        </div>
      )}

      {enabled && (
        <div className="stack" style={{ gap: 10 }}>
          <div className="field">
            <span className="label">Model</span>
            <div className="row">
              {RECOMMENDED_MODELS.map((m) => (
                <button key={m.id} className="chip" aria-pressed={cfg.model === m.id} title={m.note} onClick={() => actions.updateAiSettings({ model: m.id })}>
                  {m.id.split('/')[1]}
                </button>
              ))}
              {!models && (
                <button className="btn text sm" onClick={loadModels}>
                  All models…
                </button>
              )}
            </div>
            {modelError && <span className="hint" style={{ color: 'var(--accent)' }}>{modelError}</span>}
            {models && (
              <>
                <input className="input" placeholder="Filter models" aria-label="Filter models" value={filter} onChange={(e) => setFilter(e.target.value)} enterKeyHint="search" />
                <select className="input" aria-label="Choose a model" value={cfg.model} onChange={(e) => actions.updateAiSettings({ model: e.target.value })} size={6}>
                  {shown?.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                      {m.promptPricePerM != null ? ` · $${m.promptPricePerM.toFixed(2)}/$${(m.completionPricePerM ?? 0).toFixed(2)} per M tokens` : ''}
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>
          <div className="row">
            <button
              className="btn sm"
              disabled={testing}
              onClick={async () => {
                setTesting(true);
                setTestResult(null);
                const r = await actions.repo.ai.testConnection();
                setTestResult(r.message);
                setTesting(false);
                actions.checkAi();
              }}
            >
              {testing ? <Spinner /> : <Icon name="refresh" size={16} />} Test
            </button>
            <button className="btn text sm" onClick={() => setConsentOpen(true)}>
              What's sent
            </button>
            <button className="btn text sm danger" onClick={() => actions.updateAiSettings({ apiKey: null, consentedAt: null, connectedVia: null })} data-testid="disconnect_openrouter">
              Disconnect
            </button>
          </div>
          {testResult && <p className="small" style={{ margin: 0 }} role="status">{testResult}</p>}
        </div>
      )}

      <Dialog open={consentOpen} onClose={() => setConsentOpen(false)} labelledBy="consent-title">
        <h2 id="consent-title">What AI sends to OpenRouter</h2>
        <p className="small muted">Only when the app asks the model for something. Everything else stays on this device.</p>
        <ul className="small" style={{ paddingLeft: 18 }}>
          <li>Today's question and recent prompts (to avoid repeats)</li>
          <li>Project goal, themes, tone and boundaries</li>
          <li>Your brief, when you tap Propose in the project wizard</li>
          <li>Your digital note, only when you tap Help me start or Tighten</li>
          <li>Audience and past notes, only if enabled for the project, and never in Discreet mode</li>
          <li>Time and weather, only if you turned them on for prompts</li>
        </ul>
        <p className="small muted">
          Requests ask OpenRouter to use only providers that don't store or train on data, and carry no name, email or device identifiers. Paper pages are
          never captured.
        </p>
        <div className="sheet-actions">
          <button className="btn text" onClick={() => setConsentOpen(false)}>
            {enabled ? 'Close' : 'Not now'}
          </button>
          {!enabled && (
            <button
              className="btn filled"
              data-testid="accept_consent"
              onClick={async () => {
                await actions.updateAiSettings({ consentedAt: Date.now() });
                setConsentOpen(false);
              }}
            >
              Turn on AI
            </button>
          )}
        </div>
      </Dialog>
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

  const doExport = actions.exportBackup;

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
        Your journal lives only in this browser. Export a backup file to keep a copy or move to another device. Backups never include your OpenRouter key.
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

function ConnectionsEntry() {
  const { life } = useStore();
  const on = Object.keys(SOURCE_META).filter((id) => isEnabled(id, life.states));
  const problems = on.filter((id) => ['needs_reauth', 'error'].includes(life.states[id]?.status ?? ''));
  return (
    <section className="card">
      <div className="spread">
        <h2>Connections</h2>
        <span className={`badge ${problems.length ? 'warn' : ''}`}>{problems.length ? `${problems.length} need attention` : `${on.length} on`}</span>
      </div>
      <p className="small muted">
        Calendars, tasks, media, music, reading, notes, weather and places — {Object.keys(SOURCE_META).length} sources. Each connects directly from this device; turn any of them off at any time.
      </p>
      <button className="btn filled sm" onClick={() => navigate({ name: 'connections' })} data-testid="open_connections">
        Manage connections
      </button>
    </section>
  );
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hourLabel = (h: number) => new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: 'numeric' });
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function RhythmCard() {
  const { state, actions, life } = useStore();
  const p = state.preferences;
  const t = life.temporal;
  return (
    <section className="card">
      <h2>Day & rhythm</h2>
      <p className="small muted">
        Suggestions follow your day: plans in the morning, something to watch that fits before bed, reflection in the evening. Right now: {t.dayName} {t.partLabel.toLowerCase()}, {t.isWorkday ? 'a workday' : 'a day off'}
        {t.holiday ? ` (${t.holiday})` : ''}, {t.season}, {t.moon.emoji} {t.moon.label.toLowerCase()}
        {t.travel.traveling ? ', traveling' : ''}.
      </p>
      <div className="row">
        <label className="field" style={{ flex: '1 1 140px' }}>
          <span className="label">I usually wake up</span>
          <select className="input" value={p.wakeHour} onChange={(e) => actions.updatePreferences({ wakeHour: Number(e.target.value) })}>
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {hourLabel(h)}
              </option>
            ))}
          </select>
        </label>
        <label className="field" style={{ flex: '1 1 140px' }}>
          <span className="label">Bedtime</span>
          <select className="input" value={p.sleepHour} onChange={(e) => actions.updatePreferences({ sleepHour: Number(e.target.value) })}>
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {hourLabel(h)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="field" style={{ marginTop: 10 }}>
        <span className="label">Workdays</span>
        <div className="row" role="group" aria-label="Workdays">
          {DOW.map((d, i) => (
            <button key={d} className="chip" aria-pressed={p.workdays.includes(i)} onClick={() => actions.updatePreferences({ workdays: p.workdays.includes(i) ? p.workdays.filter((x) => x !== i) : [...p.workdays, i].sort() })}>
              {d}
            </button>
          ))}
        </div>
      </div>
      <Switch label="Detect travel" description={`Lighter suggestions and no work tasks when you’re away from ${p.homeTimeZone?.split('/').pop()?.replace(/_/g, ' ') ?? 'home'}.`} checked={p.detectTravel} onChange={(v) => actions.updatePreferences({ detectTravel: v })} />
      {t.travel.traveling && (
        <button className="btn text sm" onClick={() => actions.updatePreferences({ homeTimeZone: t.travel.currentZone })}>
          I live here now
        </button>
      )}
    </section>
  );
}

function SuggestionsCard() {
  const { state, actions } = useStore();
  const p = state.preferences;
  const kinds = Object.keys(MOMENT_LABELS) as MomentKind[];
  return (
    <section className="card">
      <h2>Suggestions</h2>
      <p className="small muted">Shown only inside the app — no notifications. Every card says why it appeared, and you can simplify, snooze, dismiss or save it.</p>
      <div className="field">
        <span className="label">Which moments to suggest</span>
        <div className="row" role="group" aria-label="Moments">
          {kinds.map((k) => (
            <button key={k} className="chip" aria-pressed={!p.disabledMoments.includes(k)} onClick={() => actions.updatePreferences({ disabledMoments: p.disabledMoments.includes(k) ? p.disabledMoments.filter((x) => x !== k) : [...p.disabledMoments, k] })}>
              {MOMENT_LABELS[k]}
            </button>
          ))}
        </div>
      </div>
      <label className="field" style={{ marginTop: 10 }}>
        <span className="label">New cards per day</span>
        <select className="input" value={p.momentDailyLimit} onChange={(e) => actions.updatePreferences({ momentDailyLimit: Number(e.target.value) })}>
          {[3, 6, 12, 24].map((n) => (
            <option key={n} value={n}>
              Up to {n}
            </option>
          ))}
        </select>
      </label>
      {p.simplifiedMoments.length > 0 && (
        <button className="btn text sm" onClick={() => actions.updatePreferences({ simplifiedMoments: [] })}>
          Show full cards again ({p.simplifiedMoments.length} simplified)
        </button>
      )}
    </section>
  );
}
