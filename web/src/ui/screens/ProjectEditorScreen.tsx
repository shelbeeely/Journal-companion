import { useEffect, useState } from 'react';
import { CADENCE_LABELS, emptySetup, type JournalCadence, type JournalProject, type ProposedProjectSetup, type WizardSeedInputs } from '../../core/models';
import { estimatePageGrid } from '../../core/validator';
import { navigate } from '../../state/router';
import { useStore } from '../../state/store';
import { Spinner, Switch, TextField } from '../controls';
import { Icon } from '../icons';

const SAMPLE_BRIEFS = [
  {
    label: 'Daily reflection',
    text: 'A5 notebook for a daily 5-minute evening reflection for myself. Help me notice small ordinary details from my day without generic productivity pressure.',
  },
  {
    label: 'Creative project log',
    text: 'Studio project log for my woodworking and ceramic prototypes whenever I finish a work session. Track experiments, material notes, and next steps.',
  },
  {
    label: 'Mini friend journal',
    text: '3.25" x 4.5" mini journal. One page a day for my roommate and close friend while he\'s away for a while. I want to tell him what I appreciate about him and his friends, and that I care, without being too much or clingy. I\'ve missed his presence this week.',
  },
];

const AUDIENCE_PRESETS = ['Myself', 'A close friend', 'A future reader'];
const PAGE_PRESETS = ['3.25" × 4.5"', 'Pocket (3.5" × 5.5")', 'A6', 'A5'];
const TONE_PRESETS = ['Warm & low-pressure', 'Calm & observational', 'Curious & concrete'];
const STEP_TITLES = ['Brief', 'Cadence & Audience', 'Page Size & Tone', 'Review & Save'];

interface CardFlags {
  includePastAnswersInPrompts: boolean;
  showDateTimeCard: boolean;
  showWeatherCard: boolean;
  includeDateTimeInPrompt: boolean;
  includeWeatherInPrompt: boolean;
}

const defaultFlags: CardFlags = {
  includePastAnswersInPrompts: false,
  showDateTimeCard: true,
  showWeatherCard: true,
  includeDateTimeInPrompt: false,
  includeWeatherInPrompt: false,
};

export function ProjectEditorScreen({ editingId }: { editingId: number | null }) {
  const { state, actions } = useStore();
  const editing = editingId != null ? (state.projects.find((p) => p.id === editingId) ?? null) : null;

  const [step, setStep] = useState(0);
  const [brief, setBrief] = useState('');
  const [inputs, setInputs] = useState<WizardSeedInputs>({});
  const [setup, setSetup] = useState<ProposedProjectSetup | null>(null);
  const [flags, setFlags] = useState<CardFlags>(defaultFlags);
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadedFor, setLoadedFor] = useState<number | null>(null);

  // Populate the form once the project being edited is available.
  useEffect(() => {
    if (!editing || loadedFor === editing.id) return;
    setLoadedFor(editing.id);
    setBrief(editing.originalBrief);
    setInputs({ cadence: editing.cadence, audience: editing.audience, pageSizeLabel: editing.pageSizeLabel, tonePreferences: editing.tonePreferences, boundaries: editing.boundaries });
    setSetup({
      ...emptySetup(),
      title: editing.title,
      writingGoal: editing.writingGoal,
      audience: editing.audience,
      cadence: editing.cadence,
      pageSizeLabel: editing.pageSizeLabel,
      entryLengthLabel: editing.entryLengthLabel,
      linesPerPage: editing.linesPerPage,
      wordsPerLine: editing.wordsPerLine,
      themes: editing.themes,
      tonePreferences: editing.tonePreferences,
      boundaries: editing.boundaries,
    });
    setFlags({
      includePastAnswersInPrompts: editing.includePastAnswersInPrompts,
      showDateTimeCard: editing.showDateTimeCard,
      showWeatherCard: editing.showWeatherCard,
      includeDateTimeInPrompt: editing.includeDateTimeInPrompt,
      includeWeatherInPrompt: editing.includeWeatherInPrompt,
    });
  }, [editing, loadedFor]);

  if (editingId != null && !editing) {
    return <div className="empty muted">{state.isLoading ? 'Loading…' : 'That project no longer exists.'}</div>;
  }

  const analyze = async () => {
    if (!brief.trim()) {
      actions.showBanner('Paste or type a short brief about what you want to journal.');
      return;
    }
    setAnalyzing(true);
    try {
      const proposed = await actions.repo.analyzeBrief(brief.trim(), inputs);
      setSetup(editing ? { ...proposed, firstPrompt: '' } : proposed);
      setStep(3);
    } catch (e) {
      actions.showBanner((e as Error).message || 'Could not analyze brief.');
    } finally {
      setAnalyzing(false);
    }
  };

  const skipAi = () => {
    if (setup) {
      setStep(3);
      return;
    }
    const pageSize = inputs.pageSizeLabel?.trim() || null;
    const [lines, words] = estimatePageGrid(pageSize);
    setSetup({
      ...emptySetup(),
      audience: inputs.audience?.trim() || null,
      cadence: inputs.cadence ?? null,
      pageSizeLabel: pageSize,
      linesPerPage: inputs.linesPerPage ?? lines,
      wordsPerLine: inputs.wordsPerLine ?? words,
      tonePreferences: inputs.tonePreferences?.trim() || null,
      boundaries: inputs.boundaries?.trim() || null,
      firstPrompt: 'What is one concrete detail from today worth putting on paper?',
      statusNote: 'Manual setup selected—AI suggestions skipped.',
    });
    setStep(3);
  };

  const save = async () => {
    if (!setup) return;
    setSaving(true);
    try {
      if (!editing) {
        const id = await actions.repo.createProjectFromSetup(brief, setup, flags);
        actions.focusProjectAfterCreate(id);
      } else {
        const t = (s: string | null) => (s?.trim() ? s.trim() : null);
        const updated: JournalProject = {
          ...editing,
          title: setup.title.trim() || editing.title,
          writingGoal: setup.writingGoal.trim() || editing.writingGoal,
          originalBrief: brief.trim() || editing.originalBrief,
          audience: t(setup.audience),
          cadence: setup.cadence,
          pageSizeLabel: t(setup.pageSizeLabel),
          entryLengthLabel: t(setup.entryLengthLabel),
          linesPerPage: Math.min(60, Math.max(5, setup.linesPerPage)),
          wordsPerLine: Math.min(20, Math.max(3, setup.wordsPerLine)),
          themes: setup.themes.map((x) => x.trim()).filter(Boolean),
          tonePreferences: t(setup.tonePreferences),
          boundaries: t(setup.boundaries),
          ...flags,
        };
        await actions.repo.updateProjectPreservingHistory(updated);
      }
      navigate({ name: 'today' });
    } finally {
      setSaving(false);
    }
  };

  const aiReady = state.ai.kind === 'available';
  const analyzeLabel = editing ? 'Re-analyze brief' : aiReady ? 'Propose with on-device AI' : 'Propose setup';

  return (
    <div className="content-narrow">
      <div className="page-head">
        <div>
          <button className="btn text sm" onClick={() => history.back()} style={{ marginLeft: -10 }}>
            ← Back
          </button>
          <h1>{editing ? 'Edit Project & Brief' : 'New Journal Project'}</h1>
          {editing ? (
            <p className="small muted" style={{ margin: '4px 0 0' }}>
              Editing your brief updates future guidance after review. Existing journal history is always preserved.
            </p>
          ) : (
            <p className="small muted" style={{ margin: '4px 0 0' }} data-testid="wizard_step_label">
              Step {step + 1} of 4 · {STEP_TITLES[step]}
            </p>
          )}
        </div>
      </div>
      {!editing && (
        <div className="stepper" aria-hidden="true">
          {STEP_TITLES.map((t, i) => (
            <span key={t} className={i <= step ? 'done' : ''} />
          ))}
        </div>
      )}

      {(editing || step === 0) && (
        <section className="card stack">
          <h2>{editing ? '1. Your brief' : 'What is this journal for?'}</h2>
          <p className="small muted" style={{ margin: 0 }}>
            Describe your notebook in your own words: size, cadence, themes, tone, boundaries, or audience. Your brief stays private on this device.
          </p>
          <textarea
            className="input"
            rows={6}
            aria-label="Brief"
            data-testid="project_brief_input"
            value={brief}
            placeholder="e.g., pocket journal for daily reflections, or notes for a friend…"
            onChange={(e) => setBrief(e.target.value)}
          />
          <div className="row small">
            <span className="muted">Or load a sample brief:</span>
            {SAMPLE_BRIEFS.map((s) => (
              <button key={s.label} className="chip" onClick={() => setBrief(s.text)}>
                {s.label}
              </button>
            ))}
          </div>
          <div className="row">
            {editing ? (
              <button className="btn outlined" onClick={analyze} disabled={analyzing} data-testid="analyze_brief_button">
                {analyzing ? <Spinner label="Analyzing…" /> : analyzeLabel}
              </button>
            ) : (
              <>
                <button className="btn filled" onClick={() => setStep(1)} disabled={!brief.trim()} data-testid="wizard_next_step_1">
                  Next: Cadence & Audience
                </button>
                <button className="btn text" onClick={skipAi} data-testid="wizard_skip_ai_button">
                  Skip AI & set up manually
                </button>
              </>
            )}
          </div>
        </section>
      )}

      {!editing && step === 1 && (
        <section className="card stack" data-testid="wizard_step_2_card">
          <h2>Cadence & Audience</h2>
          <p className="small muted" style={{ margin: 0 }}>
            Optional—leave anything unset if you'd rather let the brief decide.
          </p>
          <div className="field">
            <span className="label">Desired cadence</span>
            <div className="row">
              <button className="chip" aria-pressed={!inputs.cadence} onClick={() => setInputs({ ...inputs, cadence: null })}>
                Let brief decide
              </button>
              {(Object.keys(CADENCE_LABELS) as JournalCadence[]).map((c) => (
                <button key={c} className="chip" aria-pressed={inputs.cadence === c} onClick={() => setInputs({ ...inputs, cadence: c })}>
                  {CADENCE_LABELS[c]}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span className="label">Audience (optional)</span>
            <div className="row">
              {AUDIENCE_PRESETS.map((a) => (
                <button key={a} className="chip" aria-pressed={inputs.audience === a} onClick={() => setInputs({ ...inputs, audience: inputs.audience === a ? null : a })}>
                  {a}
                </button>
              ))}
            </div>
          </div>
          <TextField label="Custom audience (leave blank if none)" value={inputs.audience ?? ''} onChange={(v) => setInputs({ ...inputs, audience: v })} />
          <div className="row">
            <button className="btn text" onClick={() => setStep(0)}>
              Back
            </button>
            <button className="btn filled" onClick={() => setStep(2)} data-testid="wizard_next_step_2">
              Next: Page Size & Tone
            </button>
          </div>
        </section>
      )}

      {!editing && step === 2 && (
        <section className="card stack" data-testid="wizard_step_3_card">
          <h2>Page Size & Tone</h2>
          <p className="small muted" style={{ margin: 0 }}>
            Set your physical notebook size and preferred voice, or leave blank.
          </p>
          <div className="field">
            <span className="label">Physical page size (optional)</span>
            <div className="row">
              {PAGE_PRESETS.map((p) => (
                <button
                  key={p}
                  className="chip"
                  aria-pressed={inputs.pageSizeLabel === p}
                  onClick={() => setInputs({ ...inputs, pageSizeLabel: inputs.pageSizeLabel === p ? null : p, linesPerPage: null, wordsPerLine: null })}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
          <TextField label='Custom page size (e.g., Pocket 3.5" × 5.5")' value={inputs.pageSizeLabel ?? ''} onChange={(v) => setInputs({ ...inputs, pageSizeLabel: v, linesPerPage: null, wordsPerLine: null })} />
          <div className="field">
            <span className="label">Tone preferences (optional)</span>
            <div className="row">
              {TONE_PRESETS.map((t) => (
                <button key={t} className="chip" aria-pressed={inputs.tonePreferences === t} onClick={() => setInputs({ ...inputs, tonePreferences: inputs.tonePreferences === t ? null : t })}>
                  {t}
                </button>
              ))}
            </div>
          </div>
          <TextField label="Tone (e.g., gentle, grounded, unhurried)" value={inputs.tonePreferences ?? ''} onChange={(v) => setInputs({ ...inputs, tonePreferences: v })} />
          <TextField label="Boundaries (optional — never shown on Desk Mode)" multiline rows={2} value={inputs.boundaries ?? ''} onChange={(v) => setInputs({ ...inputs, boundaries: v })} />
          <div className="row">
            <button className="btn text" onClick={() => setStep(1)}>
              Back
            </button>
            <button className="btn filled" onClick={analyze} disabled={analyzing} data-testid="analyze_brief_button">
              {analyzing ? <Spinner label="Analyzing on-device…" /> : analyzeLabel}
            </button>
            <button className="btn text" onClick={skipAi} data-testid="wizard_step3_skip_ai">
              Skip AI
            </button>
          </div>
          {!aiReady && <p className="hint">No on-device model in this browser—your brief is analyzed by the built-in template engine, entirely offline.</p>}
        </section>
      )}

      {(editing || step === 3) && setup && (
        <ReviewCard editing={!!editing} setup={setup} onChange={setSetup} flags={flags} onFlags={setFlags} saving={saving} onSave={save} onRerun={analyze} analyzing={analyzing} onBack={() => setStep(2)} />
      )}
    </div>
  );
}

function ReviewCard({
  editing,
  setup,
  onChange,
  flags,
  onFlags,
  saving,
  onSave,
  onRerun,
  analyzing,
  onBack,
}: {
  editing: boolean;
  setup: ProposedProjectSetup;
  onChange: (s: ProposedProjectSetup) => void;
  flags: CardFlags;
  onFlags: (f: CardFlags) => void;
  saving: boolean;
  onSave: () => void;
  onRerun: () => void;
  analyzing: boolean;
  onBack: () => void;
}) {
  const set = (patch: Partial<ProposedProjectSetup>) => onChange({ ...setup, ...patch });
  const [themesText, setThemesText] = useState(setup.themes.join(', '));
  useEffect(() => setThemesText(setup.themes.join(', ')), [setup.themes]);

  return (
    <>
      <section className="card stack" style={{ marginTop: 12 }} data-testid="proposed_setup_review_card">
        <div className="spread">
          <h2>{editing ? '2. Review & adjust setup' : 'Review & Edit Proposal'}</h2>
          {setup.usedAi && <span className="badge">On-device AI</span>}
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          {setup.usedAi ? 'Proposed on-device. Edit any field before saving.' : 'Prepared locally. Unknown fields stay unset—edit anything below.'}
        </p>
        {setup.statusNote && <p className="hint" style={{ margin: 0 }}>{setup.statusNote}</p>}
        <TextField label="Discreet project title" value={setup.title} onChange={(v) => set({ title: v })} testId="setup_title_input" />
        <TextField label="One-sentence writing goal" multiline rows={2} value={setup.writingGoal} onChange={(v) => set({ writingGoal: v })} testId="setup_goal_input" />
        <TextField label="Audience (optional — leave blank if unset)" value={setup.audience ?? ''} onChange={(v) => set({ audience: v })} testId="setup_audience_input" />
        <div className="field">
          <span className="label">Cadence (optional)</span>
          <div className="row">
            <button className="chip" aria-pressed={!setup.cadence} onClick={() => set({ cadence: null })}>
              Unset
            </button>
            {(Object.keys(CADENCE_LABELS) as JournalCadence[]).map((c) => (
              <button key={c} className="chip" aria-pressed={setup.cadence === c} onClick={() => set({ cadence: c })}>
                {CADENCE_LABELS[c]}
              </button>
            ))}
          </div>
        </div>
        <TextField
          label='Physical page size (optional, e.g., 3.25" × 4.5")'
          value={setup.pageSizeLabel ?? ''}
          onChange={(v) => {
            const [l, w] = estimatePageGrid(v);
            set({ pageSizeLabel: v, linesPerPage: l, wordsPerLine: w });
          }}
          testId="setup_pagesize_input"
        />
        {setup.pageSizeLabel?.trim() && (
          <div className="stack" style={{ gap: 4 }}>
            <label className="small">
              Lines per page: {setup.linesPerPage}
              <input type="range" min={5} max={60} value={setup.linesPerPage} onChange={(e) => set({ linesPerPage: Number(e.target.value) })} />
            </label>
            <label className="small">
              Words per line: {setup.wordsPerLine}
              <input type="range" min={3} max={20} value={setup.wordsPerLine} onChange={(e) => set({ wordsPerLine: Number(e.target.value) })} />
            </label>
            <span className="hint">
              Handwriting estimate: ~{setup.linesPerPage * setup.wordsPerLine} words ({setup.linesPerPage} lines × {setup.wordsPerLine} words/line). Advisory only—never enforced.
            </span>
          </div>
        )}
        <TextField
          label="Themes (comma-separated)"
          value={themesText}
          onChange={(v) => {
            setThemesText(v);
            onChange({ ...setup, themes: v.split(',').map((x) => x.trim()).filter(Boolean) });
          }}
          testId="setup_themes_input"
        />
        <TextField label="Tone preferences (optional)" value={setup.tonePreferences ?? ''} onChange={(v) => set({ tonePreferences: v })} testId="setup_tone_input" />
        <TextField label="Boundaries (optional — kept off Desk Mode)" multiline rows={2} value={setup.boundaries ?? ''} onChange={(v) => set({ boundaries: v })} testId="setup_boundaries_input" />
        {!editing && <TextField label="Initial Today prompt" multiline rows={2} value={setup.firstPrompt} onChange={(v) => set({ firstPrompt: v })} testId="setup_first_prompt_input" />}
      </section>

      <section className="card" style={{ marginTop: 12 }}>
        <h2>{editing ? '3. Context & Information Cards' : 'Desk Mode Cards & Privacy'}</h2>
        <Switch label="Show Date & Time card" description="Display local date & time beside your notebook" checked={flags.showDateTimeCard} onChange={(v) => onFlags({ ...flags, showDateTimeCard: v })} />
        <Switch label="Include Date & Time in today's prompt" description="Off = supplementary display only" checked={flags.includeDateTimeInPrompt} onChange={(v) => onFlags({ ...flags, includeDateTimeInPrompt: v })} />
        <Switch label="Show Weather card" description="Display cached Open-Meteo weather" checked={flags.showWeatherCard} onChange={(v) => onFlags({ ...flags, showWeatherCard: v })} />
        <Switch
          label="Include Weather in today's prompt"
          description="Off by default so weather sits beside your notebook without turning every prompt into a weather question"
          checked={flags.includeWeatherInPrompt}
          onChange={(v) => onFlags({ ...flags, includeWeatherInPrompt: v })}
        />
        <Switch
          label="Use previous typed answers in future prompts"
          description="Off by default. Never guesses what you wrote on paper."
          checked={flags.includePastAnswersInPrompts}
          onChange={(v) => onFlags({ ...flags, includePastAnswersInPrompts: v })}
          testId="toggle_use_past_answers"
        />
      </section>

      <div className="row" style={{ margin: '16px 0 8px' }}>
        {!editing && (
          <button className="btn text" onClick={onBack}>
            Back
          </button>
        )}
        {!editing && (
          <button className="btn outlined" onClick={onRerun} disabled={analyzing}>
            {analyzing ? <Spinner label="Analyzing…" /> : 'Re-run analysis'}
          </button>
        )}
        <button className="btn filled" onClick={onSave} disabled={saving} data-testid="save_project_button">
          <Icon name="check" size={18} /> {editing ? 'Save changes (preserve history)' : 'Save & open Today'}
        </button>
      </div>
    </>
  );
}
