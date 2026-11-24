import { useEffect, useRef, useState } from 'react';
import { CADENCE_LABELS, THEME_LABELS, type AppThemeMode, type JournalProject } from '../../core/models';
import { countWords } from '../../core/time';
import { navigate } from '../../state/router';
import { useStore } from '../../state/store';
import { useEffectiveDark } from '../../state/theme';
import { Dialog, Segmented, Switch } from '../controls';
import { DateTimeCard, FocusTimerCard, WeatherCard, formatClock } from '../deskCards';
import { ProactiveSurface } from '../ProactiveSurface';
import { PHONE_QUERY, useMediaQuery } from '../../state/media';
import { Icon } from '../icons';
import { useWakeLock } from '../../state/wakeLock';

export function TodayScreen({ onOpenScreenSaver }: { onOpenScreenSaver: () => void }) {
  const { state, actions } = useStore();
  const { activeProject: project, todayEntry: entry, preferences: prefs, snapshot } = state;
  const [hideCards, setHideCards] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const isDark = useEffectiveDark(prefs.themeMode, prefs.dimDeskModeEnabled);
  const wake = useWakeLock(!!project && prefs.keepScreenAwakeInDeskMode);
  const isPhone = useMediaQuery(PHONE_QUERY);
  const [moreOpen, setMoreOpen] = useState(false);

  if (state.isLoading) return <div className="empty muted">Opening your desk…</div>;

  if (!project) {
    return (
      <div className="empty content-narrow">
        <img src="icons/icon-192.png" alt="" />
        <h1>Create your first journal project</h1>
        <p className="muted">
          Paste a freeform brief describing your notebook, project, or routine. Journal Companion stays local on your device and gives you one concrete
          question at a time.
        </p>
        <button className="btn filled" onClick={() => navigate({ name: 'newProject' })} data-testid="empty_create_project_button">
          <Icon name="add" /> New journal project
        </button>
      </div>
    );
  }

  const labelled = (label: string) => (isPhone ? <span>{label}</span> : null);
  const deskOptions = (
    <>
      <button
        className="icon-btn"
        aria-pressed={prefs.dimDeskModeEnabled}
        aria-label={prefs.dimDeskModeEnabled ? 'Exit extra-dim evening mode' : 'Enable extra-dim evening mode'}
        title={prefs.dimDeskModeEnabled ? 'Exit extra-dim evening mode' : 'Enable extra-dim evening mode'}
        onClick={() => actions.updatePreferences({ dimDeskModeEnabled: !prefs.dimDeskModeEnabled })}
      >
        <Icon name="dim" />
        {labelled(prefs.dimDeskModeEnabled ? 'Exit dim mode' : 'Dim mode')}
      </button>
      <button
        className="icon-btn"
        aria-pressed={prefs.keepScreenAwakeInDeskMode}
        aria-label={prefs.keepScreenAwakeInDeskMode ? 'Allow screen sleep in Desk Mode' : 'Keep screen awake in Desk Mode'}
        title={prefs.keepScreenAwakeInDeskMode ? (wake.supported ? 'Screen stays awake in Desk Mode' : 'Keep-awake not supported by this browser') : 'Screen may sleep'}
        onClick={() => actions.updatePreferences({ keepScreenAwakeInDeskMode: !prefs.keepScreenAwakeInDeskMode })}
      >
        <Icon name={prefs.keepScreenAwakeInDeskMode ? 'awake' : 'sleep'} />
        {labelled(prefs.keepScreenAwakeInDeskMode ? 'Screen stays awake' : 'Screen may sleep')}
      </button>
      <button className="icon-btn" aria-label="Ambient screen saver" title="Ambient screen saver" onClick={onOpenScreenSaver}>
        <Icon name="fullscreen" />
        {labelled('Screen saver')}
      </button>
      <button className="icon-btn" aria-label="Customize Desk Mode cards and appearance" title="Desk appearance & cards" onClick={() => setCustomizeOpen(true)}>
        <Icon name="tune" />
        {labelled('Cards & appearance')}
      </button>
    </>
  );

  const anyCard = project.showTimerCard || project.showDateTimeCard || project.showWeatherCard || project.showSparksCard || project.showRhythmCard;
  const showCards = anyCard && !hideCards;
  const pulse = snapshot;
  const est = snapshot?.estimatedWordsPerPage ?? null;
  const paceCue = est ? `~${project.linesPerPage} lines · ~${est}w (~${Math.max(2, Math.floor(est / 25))}–${Math.max(2, Math.floor(est / 25)) + 2} min pen)` : null;
  const continuity = prefs.discreetDeskModeEnabled
    ? 'Discreet view'
    : snapshot?.recentNoteDayLabel
      ? `Last: ${snapshot.recentNoteDayLabel}${snapshot.recentNoteExcerpt ? ' (note)' : ''}`
      : 'Day 1 · fresh start';

  return (
    <div className="content-inner">
      <div className="desk-bar">
        <div className="project-switch">
          {state.projects.length > 1 ? (
            <select
              aria-label="Switch journal project"
              data-testid="desk_project_title"
              value={project.id}
              onChange={(e) => actions.selectProject(Number(e.target.value))}
            >
              {state.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          ) : (
            <h1 data-testid="desk_project_title" style={{ fontSize: '1.45rem' }}>
              {project.title}
            </h1>
          )}
        </div>
        {!isPhone && !showCards && project.showTimerCard && (
          <button className="chip" onClick={actions.toggleTimer} data-testid="desk_compact_timer_chip">
            <Icon name="timer" size={16} />
            {state.timer.isRunning ? `Pause ${formatClock(state.timer.remainingSeconds)}` : `Focus ${formatClock(state.timer.remainingSeconds)}`}
          </button>
        )}
        {!isPhone && anyCard && (
          <button className="icon-btn" aria-label={hideCards ? 'Show side cards' : 'Hide side cards'} title={hideCards ? 'Show side cards' : 'Hide side cards'} onClick={() => setHideCards(!hideCards)}>
            <Icon name="sidebar" />
          </button>
        )}
        <button
          className="icon-btn"
          aria-label={isDark ? 'Switch to Warm Light mode' : 'Switch to Soft Dark mode'}
          title={isDark ? 'Switch to Warm Light mode' : 'Switch to Soft Dark mode'}
          onClick={() => actions.updatePreferences({ themeMode: isDark ? 'LIGHT' : 'DARK', dimDeskModeEnabled: false })}
        >
          <Icon name={isDark ? 'sun' : 'moon'} />
        </button>
        {isPhone ? (
          <button className="icon-btn" aria-label="More desk options" onClick={() => setMoreOpen(true)} data-testid="desk_more_button">
            <Icon name="more" />
          </button>
        ) : (
          deskOptions
        )}
      </div>

      {isPhone && <ProactiveSurface kind="glance" />}

      <div className={`desk ${showCards ? 'with-cards' : ''}`}>
        <div className="stack">
          <div className="pulse-strip" data-testid="desk_proactive_strip">
            <span>
              <b>Session #{pulse?.sessionNumber ?? 1}</b> · {pulse?.promptTopicLabel}
            </span>
            <span>{continuity}</span>
            {pulse?.untappedThemes[0] && <span>Next theme: {pulse.untappedThemes[0]}</span>}
            {project.cadence && <span>{CADENCE_LABELS[project.cadence]}</span>}
            {paceCue && <span className="mono">{paceCue}</span>}
          </div>

          <section className="card prompt-card" aria-labelledby="prompt-label">
            <div className="spread">
              <span className="eyebrow" id="prompt-label">
                Today's question
              </span>
              {entry?.isCompleted && (
                <span className="completed-pill small" data-testid="completed_today_badge">
                  <Icon name="check" size={16} /> Completed today
                </span>
              )}
            </div>
            <p className={`prompt-text ${state.isGeneratingPrompt ? 'generating' : ''}`} data-testid="today_prompt_text" aria-live="polite">
              {state.isGeneratingPrompt ? 'Finding a fresh angle...' : (entry?.promptText ?? '…')}
            </p>
            {snapshot?.activeStarter && !prefs.discreetDeskModeEnabled && (
              <p className="starter-peek" data-testid="desk_proactive_spark_peek">
                Starter: {snapshot.activeStarter}
              </p>
            )}
            {!prefs.discreetDeskModeEnabled && project.audience && <p className="small muted" style={{ margin: '0 0 12px' }}>For: {project.audience}</p>}
            {!isPhone && <PromptActions />}
            {entry && entry.hints.length > 0 && (
              <div className="hints" data-testid="hints_box">
                <span className="eyebrow">Writing hints</span>
                <ul>
                  {entry.hints.map((h) => (
                    <li key={h}>{h}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <DraftDrawer />
        </div>

        {showCards &&
          (isPhone ? (
            <DeskTabs project={project} />
          ) : (
            <aside className="stack" aria-label="Desk cards">
              {project.showTimerCard && <FocusTimerCard />}
              {(project.showSparksCard || project.showRhythmCard) && <ProactiveSurface kind="desk" />}
              {project.showDateTimeCard && <DateTimeCard />}
              {project.showWeatherCard && <WeatherCard />}
            </aside>
          ))}
      </div>

      {isPhone && (
        <div className="action-bar" role="toolbar" aria-label="Today's page">
          <PromptActions compact />
        </div>
      )}

      <Dialog open={moreOpen} onClose={() => setMoreOpen(false)} labelledBy="more-title">
        <h2 id="more-title">Desk options</h2>
        <div className="more-grid" onClick={() => setMoreOpen(false)}>
          {deskOptions}
        </div>
      </Dialog>

      <CustomizeDialog open={customizeOpen} onClose={() => setCustomizeOpen(false)} project={project} />
    </div>
  );
}

function PromptActions({ compact = false }: { compact?: boolean }) {
  const { state, actions } = useStore();
  const entry = state.todayEntry;
  return (
    <div className="row prompt-actions">
      <button className="btn" onClick={actions.requestHint} disabled={state.isGeneratingHint || !entry} data-testid="give_hint_button">
        <Icon name="lightbulb" size={18} /> {state.isGeneratingHint ? 'Thinking…' : compact ? 'Hint' : 'Give me a hint'}
      </button>
      <button className="btn outlined" onClick={actions.tryAnotherPrompt} disabled={state.isGeneratingPrompt} data-testid="try_another_button">
        <Icon name="refresh" size={18} /> {compact ? 'Another' : 'Try another'}
      </button>
      <button className={`btn ${entry?.isCompleted ? 'outlined' : 'filled'}`} onClick={() => actions.markDone(!entry?.isCompleted)} disabled={!entry} data-testid="done_today_button">
        <Icon name="check" size={18} /> {entry?.isCompleted ? (compact ? 'Undo done' : 'Mark not done') : compact ? 'Done' : 'Done for today'}
      </button>
    </div>
  );
}

type DeskTab = 'desk' | 'timer' | 'time' | 'weather';
const TAB_KEY = 'jc-desk-tab';

/** Phone: desk cards as tabs instead of one long scroll. The proactive desk is the default tab. */
function DeskTabs({ project }: { project: JournalProject }) {
  const tabs = (
    [
      { value: 'desk', label: 'Desk', show: project.showSparksCard || project.showRhythmCard },
      { value: 'timer', label: 'Timer', show: project.showTimerCard },
      { value: 'time', label: 'Time', show: project.showDateTimeCard },
      { value: 'weather', label: 'Weather', show: project.showWeatherCard },
    ] as { value: DeskTab; label: string; show: boolean }[]
  ).filter((t) => t.show);
  const [tab, setTab] = useState<DeskTab>(() => {
    try {
      return (localStorage.getItem(TAB_KEY) as DeskTab | null) ?? 'desk';
    } catch {
      return 'desk';
    }
  });
  const current = tabs.find((t) => t.value === tab)?.value ?? tabs[0]?.value;
  if (!current) return null;
  const choose = (t: DeskTab) => {
    setTab(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      /* storage blocked */
    }
  };
  return (
    <section className="stack" aria-label="Desk cards">
      {tabs.length > 1 && (
        <div className="desk-tabs">
          <Segmented<DeskTab> label="Desk cards" value={current} onChange={choose} options={tabs.map(({ value, label }) => ({ value, label }))} />
        </div>
      )}
      {current === 'desk' && <ProactiveSurface kind="desk" />}
      {current === 'timer' && <FocusTimerCard />}
      {current === 'time' && <DateTimeCard />}
      {current === 'weather' && <WeatherCard />}
    </section>
  );
}

function DraftDrawer() {
  const { state, actions } = useStore();
  const [open, setOpen] = useState(() => state.draftText.trim().length > 0);
  const ref = useRef<HTMLTextAreaElement>(null);
  const words = countWords(state.draftText);
  const est = state.snapshot?.estimatedWordsPerPage;

  // Auto-open once per day/project when a saved note is present.
  const entryKey = state.todayEntry ? `${state.todayEntry.projectId}:${state.todayEntry.dateIso}` : null;
  const autoOpenedFor = useRef<string | null>(null);
  const hasDraft = state.draftText.trim().length > 0;
  useEffect(() => {
    if (entryKey && hasDraft && autoOpenedFor.current !== entryKey) {
      autoOpenedFor.current = entryKey;
      setOpen(true);
    }
  }, [entryKey, hasDraft]);

  // Open + focus only for a *new* request (e.g. "Use starter"), never on remount — that would pop
  // the on-screen keyboard every time the user comes back to Today.
  const seenNonce = useRef(state.draftOpenNonce);
  useEffect(() => {
    if (state.draftOpenNonce !== seenNonce.current) {
      seenNonce.current = state.draftOpenNonce;
      setOpen(true);
      requestAnimationFrame(() => ref.current?.focus());
    }
  }, [state.draftOpenNonce]);

  const s = state.pendingSuggestion;
  return (
    <section className="card draft-area" aria-labelledby="draft-title">
      <div className="spread">
        <h2 className="card-title" id="draft-title">
          Optional note
        </h2>
        <button className="btn text sm" onClick={() => setOpen(!open)} aria-expanded={open} data-testid="toggle_draft_button">
          <Icon name={open ? 'close' : 'edit'} size={16} /> {open ? 'Hide note' : state.draftText.trim() ? 'Edit note' : 'Add a note'}
        </button>
      </div>
      {!open && <p className="small muted" style={{ margin: '6px 0 0' }}>Paper mode: nothing needs typing. Tap Done when your page is written.</p>}
      {open && (
        <div className="stack" style={{ marginTop: 10 }}>
          <label className="sr-only" htmlFor="draft-input">
            Optional digital note or draft
          </label>
          <textarea
            id="draft-input"
            ref={ref}
            className="input"
            data-testid="digital_draft_input"
            value={state.draftText}
            placeholder="Optional: sketch an answer or key phrases here (never required for paper mode)"
            autoCapitalize="sentences"
            onChange={(e) => actions.onDraftChanged(e.target.value)}
            onFocus={(e) => {
              actions.setDraftFocused(true);
              const el = e.currentTarget;
              setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 250);
            }}
            onBlur={() => actions.setDraftFocused(false)}
          />
          <div className="spread small muted">
            <span className="mono">
              {words} word{words === 1 ? '' : 's'}
              {est ? ` / ~${est}` : ''}
            </span>
            <span>Saved on this device</span>
          </div>
          <div className="row">
            <button className="btn sm" onClick={actions.helpMeStart} disabled={state.isGeneratingAssist} data-testid="help_me_start_button">
              <Icon name="spark" size={16} /> Help me start
            </button>
            <button className="btn sm" onClick={actions.tightenDraft} disabled={state.isGeneratingAssist} data-testid="tighten_draft_button">
              Tighten my draft
            </button>
            <button className="btn text sm" onClick={actions.undoDraft} disabled={!state.canUndo} data-testid="undo_draft_button">
              <Icon name="undo" size={16} /> Undo
            </button>
            {state.isGeneratingAssist && <span className="spinner" aria-label="Working" />}
          </div>
          {s && (
            <div className="suggestion" data-testid="editable_suggestion_card">
              <div className="spread">
                <span className="eyebrow">{s.kind === 'HELP_START' ? 'Editable opening suggestion' : 'Editable tightened draft'}</span>
                <span className="badge">{s.usedAi ? 'AI' : 'Built-in'}</span>
              </div>
              <p className="hint">Edit freely below. Your draft only changes when you accept.</p>
              <textarea className="input" rows={4} value={state.editableSuggestion} onChange={(e) => actions.setEditableSuggestion(e.target.value)} aria-label="Suggestion text" />
              <div className="row" style={{ marginTop: 8 }}>
                <button className="btn filled sm" onClick={() => actions.acceptSuggestion(false)}>
                  Accept & Replace
                </button>
                <button className="btn sm" onClick={() => actions.acceptSuggestion(true)}>
                  Insert below
                </button>
                <button className="btn text sm" onClick={actions.dismissSuggestion}>
                  Dismiss
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function CustomizeDialog({ open, onClose, project }: { open: boolean; onClose: () => void; project: JournalProject }) {
  const { state, actions } = useStore();
  const prefs = state.preferences;
  const upd = (patch: Partial<JournalProject>) => actions.updateActiveProject((p) => ({ ...p, ...patch }));
  const [lines, setLines] = useState(project.linesPerPage);
  const [words, setWords] = useState(project.wordsPerLine);
  useEffect(() => {
    setLines(project.linesPerPage);
    setWords(project.wordsPerLine);
  }, [project.id, project.linesPerPage, project.wordsPerLine, open]);

  return (
    <Dialog open={open} onClose={onClose} labelledBy="customize-title">
      <h2 id="customize-title">Desk appearance & cards</h2>
      <p className="small muted">Choose which cards sit beside your notebook and whether Time or Weather feeds into today's prompt.</p>

      <div className="eyebrow" style={{ marginTop: 16 }}>
        Appearance
      </div>
      <div style={{ margin: '8px 0' }}>
        <Segmented<AppThemeMode>
          label="Theme"
          value={prefs.themeMode}
          onChange={(v) => actions.updatePreferences({ themeMode: v })}
          options={(Object.keys(THEME_LABELS) as AppThemeMode[]).map((k) => ({ value: k, label: THEME_LABELS[k] }))}
        />
      </div>
      <Switch label="Extra-dim evening mode" checked={prefs.dimDeskModeEnabled} onChange={(v) => actions.updatePreferences({ dimDeskModeEnabled: v })} />
      <Switch
        label="Discreet mode"
        description="Hide brief, audience & notes on the desk"
        checked={prefs.discreetDeskModeEnabled}
        onChange={(v) => actions.updatePreferences({ discreetDeskModeEnabled: v })}
        testId="dialog_toggle_discreet_mode"
      />

      <div className="eyebrow" style={{ marginTop: 16 }}>
        Cards
      </div>
      <Switch label="Show Focus Timer card" checked={project.showTimerCard} onChange={(v) => upd({ showTimerCard: v })} />
      <Switch label="Show Desk Companion" checked={project.showSparksCard || project.showRhythmCard} onChange={(v) => upd({ showSparksCard: v, showRhythmCard: v })} />
      <Switch label="Show Date & Time card" checked={project.showDateTimeCard} onChange={(v) => upd({ showDateTimeCard: v })} />
      <Switch label="Show Weather card" checked={project.showWeatherCard} onChange={(v) => upd({ showWeatherCard: v })} />
      <Switch label="Include Date & Time in prompt" checked={project.includeDateTimeInPrompt} onChange={(v) => upd({ includeDateTimeInPrompt: v })} />
      <Switch label="Include Weather in prompt" checked={project.includeWeatherInPrompt} onChange={(v) => upd({ includeWeatherInPrompt: v })} />

      {project.pageSizeLabel && (
        <>
          <div className="eyebrow" style={{ marginTop: 16 }}>
            Handwriting page estimate ({project.pageSizeLabel})
          </div>
          <p className="hint">Adjust to match your handwriting on this notebook. This is an estimate only—never an editing limit.</p>
          <label className="small">
            Lines per page: {lines}
            <input type="range" min={5} max={60} value={lines} onChange={(e) => setLines(Number(e.target.value))} />
          </label>
          <label className="small">
            Words per line: {words}
            <input type="range" min={3} max={20} value={words} onChange={(e) => setWords(Number(e.target.value))} />
          </label>
          <div className="row" style={{ marginTop: 6 }}>
            <span className="small muted">≈ {lines * words} words per page</span>
            <button className="btn sm" onClick={() => upd({ linesPerPage: lines, wordsPerLine: words })} disabled={lines === project.linesPerPage && words === project.wordsPerLine}>
              Save estimate
            </button>
          </div>
        </>
      )}

      <div className="sheet-actions">
        <button className="btn filled" onClick={onClose}>
          Done
        </button>
      </div>
    </Dialog>
  );
}
