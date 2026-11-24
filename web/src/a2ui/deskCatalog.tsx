import type { ReactNode } from 'react';
import { z } from 'zod';
import { Catalog, CommonSchemas } from '@a2ui/web_core/v0_9';
import { createComponentImplementation } from '@a2ui/react/v0_9';
import { DESK_CATALOG_ID } from '../core/a2ui/deskAgent';
import { Icon, type IconName } from '../ui/icons';

/**
 * The Journal Companion desk catalog (A2UI v0.9). Names and props mirror the Android
 * `DeskA2uiCatalog` so payloads are portable; task-aware components are web additions.
 */

const S = CommonSchemas.DynamicString;
const optS = S.optional();
const optAction = CommonSchemas.Action.optional();

type BuildChild = (id: string, basePath?: string) => ReactNode;

/** Renders a resolved ChildList (static ids or a data-bound template). */
function renderChildren(children: unknown, buildChild: BuildChild): ReactNode[] {
  if (!Array.isArray(children)) return [];
  return children.map((c, i) => {
    if (typeof c === 'string') return <div key={c}>{buildChild(c)}</div>;
    const ref = c as { id?: string; componentId?: string; basePath?: string; path?: string };
    return <div key={`${ref.basePath ?? ref.path ?? ''}-${i}`}>{buildChild(ref.id ?? ref.componentId ?? '', ref.basePath ?? ref.path)}</div>;
  });
}

const isOn = (v: unknown) => v !== false && v !== 'false';
const csv = (v?: string) => (v ? v.split('|').filter(Boolean) : []);

const DeskColumn = createComponentImplementation(
  { name: 'DeskColumn', schema: z.object({ children: CommonSchemas.ChildList, spacingDp: optS }) },
  ({ props, buildChild }) => (
    <div className="a2-column" style={{ gap: Number(props.spacingDp) || 10 }}>
      {renderChildren(props.children, buildChild)}
    </div>
  ),
);

const TASK_ICON: Record<string, IconName> = {
  Ready: 'today',
  Thinking: 'lightbulb',
  Writing: 'pen',
  Break: 'sun',
  'Wrapping up': 'check',
  Done: 'check',
  'Setting up': 'edit',
  Projects: 'projects',
  Reviewing: 'history',
  Settings: 'settings',
  Ambient: 'moon',
};

const DeskTaskHeader = createComponentImplementation(
  { name: 'DeskTaskHeader', schema: z.object({ taskLabel: S, headline: S, detail: optS, engineBadge: optS }) },
  ({ props }) => (
    <div className="a2-header">
      <div className="spread">
        <span className="badge" data-testid="task_badge">
          <Icon name={TASK_ICON[props.taskLabel ?? ''] ?? 'spark'} size={14} /> {props.taskLabel}
        </span>
        {props.engineBadge && <span className="tiny muted">{props.engineBadge}</span>}
      </div>
      <h2 className="a2-headline serif" aria-live="polite">
        {props.headline}
      </h2>
      {props.detail && <p className="small muted a2-detail">{props.detail}</p>}
    </div>
  ),
);

const DeskMetricRow = createComponentImplementation(
  { name: 'DeskMetricRow', schema: z.object({ items: CommonSchemas.ChildList }) },
  ({ props, buildChild }) => <div className="a2-metrics">{renderChildren(props.items, buildChild)}</div>,
);

const DeskMetric = createComponentImplementation(
  { name: 'DeskMetric', schema: z.object({ label: S, value: S }) },
  ({ props }) => (
    <div className="a2-metric">
      <span className="a2-metric-value">{props.value}</span>
      <span className="tiny muted">{props.label}</span>
    </div>
  ),
);

const DeskInsightList = createComponentImplementation(
  { name: 'DeskInsightList', schema: z.object({ items: CommonSchemas.ChildList, interactiveMode: optS }) },
  ({ props, buildChild }) => (
    <div className="a2-insights" role="list" aria-label="Suggestions for right now">
      {renderChildren(props.items, buildChild)}
    </div>
  ),
);

const KIND_ICON: Record<string, IconName> = {
  rhythm: 'today',
  window: 'timer',
  weather: 'sun',
  daylight: 'sun',
  theme: 'spark',
  progress: 'pen',
  focus: 'timer',
  milestone: 'check',
  care: 'download',
  continuity: 'history',
  pattern: 'history',
  status: 'settings',
  setup: 'edit',
  nudge: 'lightbulb',
  project: 'projects',
};

const DeskInsight = createComponentImplementation(
  {
    name: 'DeskInsight',
    schema: z.object({
      insightId: S,
      kind: optS,
      tone: optS,
      title: S,
      body: optS,
      actionLabel: optS,
      interactiveMode: optS,
      action: optAction,
      snoozeAction: optAction,
    }),
  },
  ({ props }) => {
    const interactive = isOn(props.interactiveMode);
    const action = props.action as unknown as (() => void) | undefined;
    const snooze = props.snoozeAction as unknown as (() => void) | undefined;
    return (
      <div className={`a2-insight tone-${props.tone ?? 'neutral'}`} role="listitem" data-insight={props.insightId}>
        <span className="a2-insight-icon" aria-hidden="true">
          <Icon name={KIND_ICON[props.kind ?? ''] ?? 'spark'} size={16} />
        </span>
        <div className="a2-insight-text">
          <b>{props.title}</b>
          {props.body && <span className="small muted">{props.body}</span>}
        </div>
        {interactive && (
          <div className="a2-insight-actions">
            {props.actionLabel && action && (
              <button className="btn sm" onClick={action}>
                {props.actionLabel}
              </button>
            )}
            {snooze && (
              <button className="icon-btn a2-snooze" aria-label={`Hide “${props.title}” for today`} title="Hide for today" onClick={snooze}>
                <Icon name="close" size={16} />
              </button>
            )}
          </div>
        )}
      </div>
    );
  },
);

const DeskIntentCard = createComponentImplementation(
  { name: 'DeskIntentCard', schema: z.object({ eyebrow: S, goal: S, audience: optS, tone: optS, boundaries: optS, briefHighlights: optS }) },
  ({ props }) => (
    <div className="a2-block">
      <div className="eyebrow">{props.eyebrow}</div>
      <p style={{ margin: '4px 0 8px' }}>{props.goal}</p>
      {(props.audience || props.tone) && (
        <div className="row small" style={{ marginBottom: 6 }}>
          {props.audience && <span className="chip static">For: {props.audience}</span>}
          {props.tone && <span className="chip static">{props.tone}</span>}
        </div>
      )}
      {props.boundaries && <p className="small muted" style={{ margin: '0 0 6px' }}>Boundaries: {props.boundaries}</p>}
      {props.briefHighlights && (
        <details className="small">
          <summary className="muted" style={{ cursor: 'pointer' }}>
            Brief highlights
          </summary>
          <p style={{ margin: '6px 0 0' }}>{props.briefHighlights}</p>
        </details>
      )}
    </div>
  ),
);

const DeskStarterCard = createComponentImplementation(
  {
    name: 'DeskStarterCard',
    schema: z.object({
      eyebrow: optS,
      starterText: S,
      recallQuestion: optS,
      continuityTitle: optS,
      continuityBody: optS,
      interactiveMode: optS,
      useStarterAction: optAction,
      nextAngleAction: optAction,
      startFocusAction: optAction,
    }),
  },
  ({ props }) => {
    const interactive = isOn(props.interactiveMode);
    const use = props.useStarterAction as unknown as (() => void) | undefined;
    const next = props.nextAngleAction as unknown as (() => void) | undefined;
    const focus = props.startFocusAction as unknown as (() => void) | undefined;
    return (
      <div className="a2-block tonal">
        <div className="eyebrow">{props.eyebrow ?? 'Momentum & Sparks'}</div>
        <p className="serif a2-starter">“{props.starterText}”</p>
        {props.recallQuestion && (
          <p className="small" style={{ margin: '0 0 10px' }}>
            <span className="muted">Recall: </span>
            {props.recallQuestion}
          </p>
        )}
        {interactive && (
          <div className="row">
            {use && (
              <button className="btn filled sm" onClick={use} data-testid="a2_use_starter">
                <Icon name="pen" size={16} /> Use starter
              </button>
            )}
            {next && (
              <button className="btn sm" onClick={next}>
                Next angle
              </button>
            )}
            {focus && (
              <button className="btn text sm" onClick={focus}>
                <Icon name="timer" size={16} /> 10m focus
              </button>
            )}
          </div>
        )}
        {props.continuityTitle && (
          <p className="small" style={{ margin: '10px 0 0' }}>
            <b>{props.continuityTitle}</b>
            <br />
            <span className="muted">{props.continuityBody}</span>
          </p>
        )}
      </div>
    );
  },
);

const DeskThemePace = createComponentImplementation(
  {
    name: 'DeskThemePace',
    schema: z.object({
      sessionTitle: S,
      cadenceSummary: optS,
      pageEstimateSummary: optS,
      draftProgressLabel: optS,
      progressFraction: optS,
      untappedThemesCsv: optS,
      coveredThemesCsv: optS,
    }),
  },
  ({ props }) => {
    const fraction = Math.max(0, Math.min(1, Number(props.progressFraction) || 0));
    const untapped = csv(props.untappedThemesCsv);
    const covered = csv(props.coveredThemesCsv);
    return (
      <div className="a2-block">
        <div className="spread small">
          <b>{props.sessionTitle}</b>
          <span className="muted">{props.cadenceSummary}</span>
        </div>
        {props.pageEstimateSummary && <p className="small muted" style={{ margin: '4px 0' }}>{props.pageEstimateSummary}</p>}
        {props.draftProgressLabel && (
          <>
            <div className="progress" aria-label={props.draftProgressLabel}>
              <span style={{ width: `${Math.round(fraction * 100)}%` }} />
            </div>
            <p className="tiny muted" style={{ margin: '4px 0 0' }}>{props.draftProgressLabel}</p>
          </>
        )}
        {(untapped.length > 0 || covered.length > 0) && (
          <div className="theme-chips" style={{ marginTop: 8 }}>
            {untapped.map((t) => (
              <span key={t} className="chip static accent" title="Not yet explored">
                {t}
              </span>
            ))}
            {covered.map((t) => (
              <span key={t} className="chip static" title="Covered recently">
                <Icon name="check" size={14} /> {t}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  },
);

const DeskAmbientWindow = createComponentImplementation(
  {
    name: 'DeskAmbientWindow',
    schema: z.object({ dayWindow: S, ambientDetail: optS, engineBadge: optS, interactiveMode: optS, refreshAction: optAction, dismissAction: optAction }),
  },
  ({ props }) => {
    const interactive = isOn(props.interactiveMode);
    const refresh = props.refreshAction as unknown as (() => void) | undefined;
    const dismiss = props.dismissAction as unknown as (() => void) | undefined;
    return (
      <div className="a2-ambient spread">
        <span className="tiny muted">
          {props.dayWindow}
          {props.ambientDetail ? ` · ${props.ambientDetail}` : ''}
        </span>
        {interactive && (
          <span className="row" style={{ gap: 0, flexWrap: 'nowrap' }}>
            {refresh && (
              <button className="icon-btn" aria-label="Refresh desk companion" onClick={refresh}>
                <Icon name="refresh" size={16} />
              </button>
            )}
            {dismiss && (
              <button className="icon-btn" aria-label="Hide desk companion for this part of the day" onClick={dismiss}>
                <Icon name="close" size={16} />
              </button>
            )}
          </span>
        )}
      </div>
    );
  },
);

const DeskGlanceStrip = createComponentImplementation(
  { name: 'DeskGlanceStrip', schema: z.object({ label: optS, items: CommonSchemas.ChildList }) },
  ({ props, buildChild }) => (
    <div className="a2-glance" role="list" aria-label={`${props.label ?? 'Now'} at a glance`} data-testid="glance_strip">
      {renderChildren(props.items, buildChild)}
    </div>
  ),
);

const DeskGlanceChip = createComponentImplementation(
  { name: 'DeskGlanceChip', schema: z.object({ text: S, tone: optS }) },
  ({ props }) => (
    <span className={`a2-glance-chip tone-${props.tone ?? 'neutral'}`} role="listitem">
      {props.text}
    </span>
  ),
);

export const deskCatalog = new Catalog(
  DESK_CATALOG_ID,
  'v0.9',
  [
    DeskColumn,
    DeskTaskHeader,
    DeskMetricRow,
    DeskMetric,
    DeskInsightList,
    DeskInsight,
    DeskIntentCard,
    DeskStarterCard,
    DeskThemePace,
    DeskAmbientWindow,
    DeskGlanceStrip,
    DeskGlanceChip,
  ],
  [],
);
