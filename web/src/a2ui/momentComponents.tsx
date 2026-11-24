import { useState, type ReactNode } from 'react';
import { z } from 'zod';
import { CommonSchemas } from '@a2ui/web_core/v0_9';
import { createComponentImplementation } from '@a2ui/react/v0_9';
import { Icon, type IconName } from '../ui/icons';

/**
 * Moment components for the controlled desk catalog. Every component is presentational and
 * driven by the data model; actions are dispatched as A2UI events handled by the store.
 */

const S = CommonSchemas.DynamicString;
const optS = S.optional();
const optAction = CommonSchemas.Action.optional();

type BuildChild = (id: string, basePath?: string) => ReactNode;
const fn = (a: unknown) => a as (() => void) | undefined;
const on = (v: unknown) => v === true || v === 'true';

export function renderChildren(children: unknown, buildChild: BuildChild): ReactNode[] {
  if (!Array.isArray(children)) return [];
  return children.map((c, i) => {
    if (typeof c === 'string') return <div key={c}>{buildChild(c)}</div>;
    const r = c as { id?: string; componentId?: string; basePath?: string; path?: string };
    return <div key={`${r.basePath ?? r.path ?? ''}-${i}`}>{buildChild(r.id ?? r.componentId ?? '', r.basePath ?? r.path)}</div>;
  });
}

const MomentColumn = createComponentImplementation(
  { name: 'MomentColumn', schema: z.object({ children: CommonSchemas.ChildList, simplified: optS }) },
  ({ props, buildChild }) => <div className={`m-column ${on(props.simplified) ? 'simplified' : ''}`}>{renderChildren(props.children, buildChild)}</div>,
);

const MOMENT_ICON: Record<string, IconName> = {
  'Plan the day': 'today',
  'Heading out': 'location',
  'Something to watch': 'fullscreen',
  'New episode': 'fullscreen',
  'Pick a project back up': 'projects',
  'Back to your book': 'today',
  'Reflect on today': 'pen',
  'Unfinished thought': 'lightbulb',
  'On this day': 'history',
};

const MomentHeader = createComponentImplementation(
  { name: 'MomentHeader', schema: z.object({ momentLabel: S, title: S, summary: optS, timing: optS, savedLabel: optS }) },
  ({ props }) => (
    <header className="m-header">
      <div className="spread">
        <span className="eyebrow m-eyebrow">
          <Icon name={MOMENT_ICON[props.momentLabel ?? ''] ?? 'spark'} size={14} /> {props.momentLabel}
        </span>
        {props.timing ? <span className="badge warn">{props.timing}</span> : props.savedLabel ? <span className="badge">{props.savedLabel}</span> : null}
      </div>
      <h3 className="m-title serif">{props.title}</h3>
      {props.summary && <p className="small muted m-summary">{props.summary}</p>}
    </header>
  ),
);

const EventPrep = createComponentImplementation(
  { name: 'EventPrep', schema: z.object({ title: S, time: S, place: optS, leaveBy: optS, travel: optS }) },
  ({ props }) => (
    <div className="m-event">
      <div className="m-event-time mono">{props.time}</div>
      <div className="m-event-main">
        <b>{props.title}</b>
        {props.place && <span className="small muted">{props.place}</span>}
        {(props.leaveBy || props.travel) && (
          <span className="small">
            {props.leaveBy && <b className="m-leave">Leave by {props.leaveBy}</b>}
            {props.leaveBy && props.travel ? ' · ' : ''}
            <span className="muted">{props.travel}</span>
          </span>
        )}
      </div>
    </div>
  ),
);

const HourlyStrip = createComponentImplementation(
  { name: 'HourlyStrip', schema: z.object({ label: S, note: optS, items: CommonSchemas.ChildList }) },
  ({ props, buildChild }) => (
    <section className="m-block" aria-label={props.label}>
      <div className="spread small">
        <b>{props.label}</b>
        {props.note && <span className="m-note">{props.note}</span>}
      </div>
      <div className="m-hours" role="list">
        {renderChildren(props.items, buildChild)}
      </div>
    </section>
  ),
);

const HourCell = createComponentImplementation(
  { name: 'HourCell', schema: z.object({ time: S, temp: S, pop: optS, condition: optS }) },
  ({ props }) => (
    <div className="m-hour" role="listitem" title={props.condition}>
      <span className="tiny muted">{props.time?.replace(':00', '')}</span>
      <b>{props.temp}</b>
      <span className="tiny m-pop">{props.pop || ' '}</span>
    </div>
  ),
);

const MediaPicks = createComponentImplementation(
  { name: 'MediaPicks', schema: z.object({ title: S, items: CommonSchemas.ChildList }) },
  ({ props, buildChild }) => (
    <section className="m-block">
      <b className="small">{props.title}</b>
      <div className="m-picks" role="list">
        {renderChildren(props.items, buildChild)}
      </div>
    </section>
  ),
);

const MediaPick = createComponentImplementation(
  { name: 'MediaPick', schema: z.object({ title: S, meta: optS, fits: optS, providers: optS, image: optS, source: optS, interactiveMode: optS, openAction: optAction }) },
  ({ props }) => {
    const open = fn(props.openAction);
    const body = (
      <>
        {props.image ? <img src={props.image} alt="" loading="lazy" className="m-poster" /> : <span className="m-poster m-poster-empty" aria-hidden="true" />}
        <span className="m-pick-text">
          <b>{props.title}</b>
          <span className="tiny muted">{props.meta}</span>
          <span className="tiny">
            {props.fits}
            {props.providers ? ` · ${props.providers}` : ''}
          </span>
          <span className="tiny muted">via {props.source}</span>
        </span>
      </>
    );
    return on(props.interactiveMode) && open ? (
      <button className="m-pick" role="listitem" onClick={open}>
        {body}
      </button>
    ) : (
      <div className="m-pick" role="listitem">
        {body}
      </div>
    );
  },
);

const TaskChecklist = createComponentImplementation(
  { name: 'TaskChecklist', schema: z.object({ title: S, items: CommonSchemas.ChildList }) },
  ({ props, buildChild }) => (
    <section className="m-block">
      <b className="small">{props.title}</b>
      <ul className="m-checklist">{renderChildren(props.items, buildChild)}</ul>
    </section>
  ),
);

const ChecklistRow = createComponentImplementation(
  { name: 'ChecklistRow', schema: z.object({ text: S, source: optS, done: optS }) },
  ({ props }) => (
    <li className={on(props.done) ? 'done' : ''}>
      <Icon name={on(props.done) ? 'check' : 'timer'} size={14} /> <span>{props.text}</span> <span className="tiny muted">· {props.source}</span>
    </li>
  ),
);

const ProjectResume = createComponentImplementation(
  { name: 'ProjectResume', schema: z.object({ title: S, lastActivity: optS, excerpt: optS, nextStep: optS, files: optS }) },
  ({ props }) => {
    const files = (props.files ?? '').split('|').filter(Boolean);
    return (
      <section className="m-block">
        <div className="spread small">
          <b>{props.title}</b>
          <span className="muted">Last active {props.lastActivity}</span>
        </div>
        {props.excerpt && <p className="serif m-quote">“…{props.excerpt}”</p>}
        {props.nextStep && (
          <p className="small" style={{ margin: '6px 0 0' }}>
            <span className="muted">Next step: </span>
            {props.nextStep}
          </p>
        )}
        {files.length > 0 && <p className="tiny muted" style={{ margin: '6px 0 0' }}>Recently edited: {files.join(', ')}</p>}
      </section>
    );
  },
);

const DayTimeline = createComponentImplementation(
  { name: 'DayTimeline', schema: z.object({ title: S, items: CommonSchemas.ChildList }) },
  ({ props, buildChild }) => (
    <section className="m-block">
      <b className="small">{props.title}</b>
      <ol className="m-timeline">{renderChildren(props.items, buildChild)}</ol>
    </section>
  ),
);

const TimelineRow = createComponentImplementation(
  { name: 'TimelineRow', schema: z.object({ time: S, text: S, source: optS, kind: optS }) },
  ({ props }) => (
    <li className={`m-tl kind-${props.kind ?? 'event'}`}>
      <span className="mono tiny m-tl-time">{props.time}</span>
      <span className="m-tl-text">
        {props.text} <span className="tiny muted">· {props.source}</span>
      </span>
    </li>
  ),
);

const MemoryQuote = createComponentImplementation(
  { name: 'MemoryQuote', schema: z.object({ quote: S, attribution: optS }) },
  ({ props }) => (
    <figure className="m-memory">
      <blockquote className="serif">“{props.quote}”</blockquote>
      {props.attribution && <figcaption className="tiny muted">{props.attribution}</figcaption>}
    </figure>
  ),
);

const ExtrasList = createComponentImplementation(
  { name: 'ExtrasList', schema: z.object({ title: S, items: CommonSchemas.ChildList }) },
  ({ props, buildChild }) => (
    <section className="m-block">
      <b className="small">{props.title}</b>
      <ul className="m-extras">{renderChildren(props.items, buildChild)}</ul>
    </section>
  ),
);

const ExtraLine = createComponentImplementation(
  { name: 'ExtraLine', schema: z.object({ text: S, source: optS }) },
  ({ props }) => (
    <li>
      {props.text} <span className="tiny muted">· {props.source}</span>
    </li>
  ),
);

const PromptSeed = createComponentImplementation(
  { name: 'PromptSeed', schema: z.object({ prompt: S, interactiveMode: optS, useAction: optAction }) },
  ({ props }) => {
    const use = fn(props.useAction);
    return (
      <div className="m-prompt">
        <span className="eyebrow">Writing angle</span>
        <p className="serif">{props.prompt}</p>
        {on(props.interactiveMode) && use && (
          <button className="btn sm" onClick={use}>
            <Icon name="pen" size={16} /> Write about this
          </button>
        )}
      </div>
    );
  },
);

const AiNote = createComponentImplementation(
  { name: 'AiNote', schema: z.object({ text: S, basis: optS, state: optS }) },
  ({ props }) => (
    <aside className={`m-ai${props.state === 'pending' ? ' pending' : ''}`} aria-label="AI interpretation" aria-busy={props.state === 'pending'}>
      <span className="badge m-ai-badge">
        <Icon name="spark" size={13} /> AI interpretation
      </span>
      <p className="small" aria-live="polite">{props.text}</p>
      {props.basis && <span className="tiny muted">{props.basis}</span>}
    </aside>
  ),
);

const EvidenceList = createComponentImplementation(
  { name: 'EvidenceList', schema: z.object({ items: CommonSchemas.ChildList, count: optS }) },
  ({ props, buildChild }) => (
    <details className="m-why">
      <summary className="small">
        <Icon name="lightbulb" size={14} /> Why am I seeing this? <span className="muted">({props.count} from your data)</span>
      </summary>
      <ul className="m-evidence">{renderChildren(props.items, buildChild)}</ul>
      <p className="tiny muted" style={{ margin: '6px 0 0' }}>
        Built from your connected sources and the time. Nothing here is guessed by AI.
      </p>
    </details>
  ),
);

const EvidenceRow = createComponentImplementation(
  { name: 'EvidenceRow', schema: z.object({ text: S, source: S, freshness: optS, origin: optS, stale: optS }) },
  ({ props }) => (
    <li>
      <span className={`m-src ${props.origin === 'time' ? 'time' : 'data'}`}>{props.source}</span> {props.text}
      {props.freshness && <span className="tiny muted"> · {props.freshness}</span>}
      {on(props.stale) && <span className="badge warn" style={{ marginLeft: 6 }}>may be out of date</span>}
    </li>
  ),
);

const MissingSources = createComponentImplementation(
  { name: 'MissingSources', schema: z.object({ items: CommonSchemas.ChildList }) },
  ({ props, buildChild }) => <div className="m-missing">{renderChildren(props.items, buildChild)}</div>,
);

const MissingRow = createComponentImplementation(
  { name: 'MissingRow', schema: z.object({ text: S, interactiveMode: optS, connectAction: optAction }) },
  ({ props }) => {
    const connect = fn(props.connectAction);
    return (
      <div className="m-missing-row small">
        <Icon name="eyeOff" size={14} />
        <span>{props.text}</span>
        {on(props.interactiveMode) && connect && (
          <button className="btn text sm" onClick={connect}>
            Connect
          </button>
        )}
      </div>
    );
  },
);

const ActionRow = createComponentImplementation(
  { name: 'ActionRow', schema: z.object({ items: CommonSchemas.ChildList }) },
  ({ props, buildChild }) => <div className="row m-actions">{renderChildren(props.items, buildChild)}</div>,
);

const ActionButton = createComponentImplementation(
  { name: 'ActionButton', schema: z.object({ label: S, primary: optS, action: optAction }) },
  ({ props }) => (
    <button className={`btn sm ${on(props.primary) ? 'filled' : ''}`} onClick={fn(props.action)}>
      {props.label}
    </button>
  ),
);

const SurfaceControls = createComponentImplementation(
  {
    name: 'SurfaceControls',
    schema: z.object({
      simplified: optS,
      saved: optS,
      simplifyAction: optAction,
      saveAction: optAction,
      dismissAction: optAction,
      snoozeHourAction: optAction,
      snoozeTonightAction: optAction,
      snoozeTomorrowAction: optAction,
      snoozeWeekendAction: optAction,
    }),
  },
  ({ props }) => {
    const [snoozeOpen, setSnoozeOpen] = useState(false);
    const snooze = (a: unknown) => () => {
      setSnoozeOpen(false);
      fn(a)?.();
    };
    return (
      <div className="m-controls" role="toolbar" aria-label="Card options">
        <button className="btn text sm" onClick={fn(props.simplifyAction)} aria-pressed={on(props.simplified)}>
          {on(props.simplified) ? 'Show more' : 'Simplify'}
        </button>
        <div className="m-snooze">
          <button className="btn text sm" aria-expanded={snoozeOpen} onClick={() => setSnoozeOpen(!snoozeOpen)}>
            Snooze ▾
          </button>
          {snoozeOpen && (
            <div className="m-snooze-menu" role="menu">
              <button role="menuitem" onClick={snooze(props.snoozeHourAction)}>For an hour</button>
              <button role="menuitem" onClick={snooze(props.snoozeTonightAction)}>Until tonight</button>
              <button role="menuitem" onClick={snooze(props.snoozeTomorrowAction)}>Until tomorrow morning</button>
              <button role="menuitem" onClick={snooze(props.snoozeWeekendAction)}>Until the weekend</button>
            </div>
          )}
        </div>
        <button className="btn text sm" onClick={fn(props.saveAction)} disabled={on(props.saved)}>
          {on(props.saved) ? 'Saved' : 'Save'}
        </button>
        <button className="icon-btn" aria-label="Dismiss this suggestion" title="Dismiss" onClick={fn(props.dismissAction)}>
          <Icon name="close" size={16} />
        </button>
      </div>
    );
  },
);

export const MOMENT_COMPONENTS = [
  MomentColumn,
  MomentHeader,
  EventPrep,
  HourlyStrip,
  HourCell,
  MediaPicks,
  MediaPick,
  TaskChecklist,
  ChecklistRow,
  ProjectResume,
  DayTimeline,
  TimelineRow,
  MemoryQuote,
  ExtrasList,
  ExtraLine,
  PromptSeed,
  AiNote,
  EvidenceList,
  EvidenceRow,
  MissingSources,
  MissingRow,
  ActionRow,
  ActionButton,
  SurfaceControls,
];
