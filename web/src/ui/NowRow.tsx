import { lazy, Suspense, useMemo, useRef } from 'react';
import type { MomentRenderOptions } from '../core/a2ui/momentAgent';
import { MOMENT_LABELS, type MomentKind, type Suggestion } from '../core/context/moments';
import { navigate } from '../state/router';
import { useStore } from '../state/store';
import { Icon, type IconName } from './icons';

// Rendered by the lazily loaded A2UI runtime (same chunk as the desk surfaces).
const MomentSurface = lazy(() => import('../a2ui/DeskRuntime').then((m) => ({ default: m.MomentSurface })));

const ASKS: { moment: MomentKind; label: string; icon: IconName }[] = [
  { moment: 'outing', label: 'Heading out', icon: 'location' },
  { moment: 'watch', label: 'What to watch', icon: 'fullscreen' },
  { moment: 'plan_day', label: 'Plan my day', icon: 'today' },
  { moment: 'reflect', label: 'Reflect', icon: 'pen' },
];

function Fallback({ s }: { s: Suggestion }) {
  return (
    <div className="m-column">
      <span className="eyebrow">{MOMENT_LABELS[s.moment]}</span>
      <h3 className="m-title serif">{s.title}</h3>
      <p className="small muted m-summary">{s.summary}</p>
    </div>
  );
}

function MomentCard({ s }: { s: Suggestion }) {
  const { state, life, actions } = useStore();
  const interp = life.interpretationFor(s);
  const simplified = state.preferences.simplifiedMoments.includes(s.moment);
  const saved = life.isSaved(s.key);
  const aiPending = !interp && life.interpretationPending(s);
  const options = useMemo<MomentRenderOptions>(
    () => ({ interactive: true, simplified, saved, aiNote: interp?.note ?? null, aiPending, layout: interp?.layout ?? null }),
    [simplified, saved, interp?.note, interp?.layout, aiPending],
  );
  return (
    <article className="card now-card" data-testid={`moment_${s.moment}`}>
      <Suspense fallback={<Fallback s={s} />}>
        <MomentSurface suggestion={s} options={options} onAction={actions.handleDeskAction} />
      </Suspense>
    </article>
  );
}

/** "Right now": task-specific interfaces generated from connected sources, time and the journal. */
export function NowRow() {
  const { state, life } = useStore();
  const max = state.preferences.proactiveDensity === 'CALM' ? 1 : 3;
  const fresh = life.suggestions.slice(0, max);
  // While writing, keep exactly what was on screen: nothing appears, disappears or moves.
  // An explicit ask always breaks through.
  const paused = life.quiet && !life.requested;
  const frozen = useRef<Suggestion[]>(fresh);
  if (!paused) frozen.current = fresh;
  const shown = paused ? frozen.current.filter((f) => !life.userHidden.has(f.key)).map((f) => life.allSuggestions.find((s) => s.key === f.key) ?? f) : fresh;
  const connected = Object.values(life.states).filter((s) => s.enabled && s.status === 'connected').length;

  return (
    <section className="now" aria-label="Right now" data-testid="now_row">
      <div className="now-head">
        <span className="eyebrow now-eyebrow">
          Right now · {life.temporal.dayName} {life.temporal.partLabel.toLowerCase()}
          {paused && <span className="badge" style={{ marginLeft: 8 }}>Paused while you write</span>}
        </span>
        <div className="now-asks" role="group" aria-label="Ask the companion">
          {ASKS.map((a) => (
            <button key={a.moment} className="chip" onClick={() => life.ask(a.moment)} data-testid={`ask_${a.moment}`}>
              <Icon name={a.icon} size={14} /> {a.label}
            </button>
          ))}
        </div>
      </div>
      {shown.length > 0 ? (
        <div className={`now-row count-${shown.length}`}>
          {shown.map((s) => (
            <MomentCard key={s.key} s={s} />
          ))}
        </div>
      ) : (
        <p className="small muted now-empty">
          Nothing needs your attention right now.{' '}
          {connected <= 3 && (
            <button className="btn text sm" onClick={() => navigate({ name: 'connections' })}>
              Connect calendars, tasks and media
            </button>
          )}
        </p>
      )}
    </section>
  );
}
