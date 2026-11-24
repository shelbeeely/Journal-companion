import type { CompanionSurface } from '../deskContext';
import type { TaskComposition } from '../insights';
import type { TaskKind } from '../taskContext';

/**
 * Local "desk agent": turns the current task composition into A2UI v0.9 protocol messages
 * (createSurface / updateComponents / updateDataModel).
 *
 * Component names, catalog id and `/desk/...` data paths match the Android
 * `DeskA2uiAgentEngine`, so a payload from either platform renders on both. The web adds
 * task-aware components (DeskTaskHeader, DeskMetricRow, DeskInsightList, DeskGlanceStrip).
 */

export const DESK_CATALOG_ID = 'https://journalcompanion.local/catalogs/desk/v1/catalog.json';
export const A2UI_VERSION = 'v0.9';

export const SURFACES = {
  desk: 'desk_proactive_surface',
  context: 'desk_context_surface',
  glance: 'desk_glance_surface',
  /** Non-interactive copy of the desk shown by the screen saver (Android renders the same in its DreamService). */
  ambient: 'desk_ambient_surface',
} as const;

export type SurfaceId = (typeof SURFACES)[keyof typeof SURFACES];

/** Action event names the catalog components emit (handled by the store). */
export const DeskA2uiActions = {
  USE_STARTER: 'use_starter',
  NEXT_ANGLE: 'next_angle',
  START_FOCUS: 'start_focus',
  REFRESH_SURFACE: 'refresh_surface',
  DISMISS_SURFACE: 'dismiss_surface',
  INSIGHT_ACTION: 'insight_action',
  SNOOZE_INSIGHT: 'snooze_insight',
} as const;

export type A2uiMessage = Record<string, unknown> & { version: string };

type Component = Record<string, unknown> & { id: string; component: string };

const ref = (path: string) => ({ path });
const event = (name: string, context?: Record<string, unknown>) => ({ event: context ? { name, context } : { name } });

/** Which desk sections appear for each task, top to bottom. */
const DESK_LAYOUT: Record<TaskKind, string[]> = {
  arriving: ['task_header', 'metrics', 'starter_card', 'insights', 'intent_card', 'theme_pace_card', 'ambient_window_card'],
  thinking: ['task_header', 'starter_card', 'insights', 'theme_pace_card', 'intent_card', 'ambient_window_card'],
  writing: ['task_header', 'metrics', 'starter_card', 'insights'],
  break: ['task_header', 'metrics', 'insights', 'ambient_window_card'],
  wrapping_up: ['task_header', 'metrics', 'insights', 'theme_pace_card'],
  done: ['task_header', 'metrics', 'insights', 'theme_pace_card', 'ambient_window_card'],
  setting_up: ['task_header', 'insights'],
  organizing: ['task_header', 'metrics', 'insights'],
  reviewing: ['task_header', 'metrics', 'insights'],
  configuring: ['task_header', 'metrics', 'insights'],
  ambient: ['task_header', 'starter_card', 'insights', 'ambient_window_card'],
};

export interface DeskSurfaceInput {
  composition: TaskComposition;
  /** Present on Today; null on other screens. */
  companion: CompanionSurface | null;
  interactive: boolean;
  density: 'RICH' | 'CALM';
  discreet: boolean;
  engineBadge: string;
}

function sectionsFor(input: DeskSurfaceInput, surface: SurfaceId): string[] {
  const { composition, companion, density, discreet } = input;
  let sections = surface === SURFACES.context ? ['task_header', 'metrics', 'insights'] : [...DESK_LAYOUT[composition.task]];
  if (!companion) sections = sections.filter((s) => ['task_header', 'metrics', 'insights'].includes(s));
  if (discreet || density === 'CALM') sections = sections.filter((s) => s !== 'intent_card');
  if (density === 'CALM') sections = sections.filter((s) => s !== 'theme_pace_card');
  if (companion && !companion.pace.show) sections = sections.filter((s) => s !== 'theme_pace_card');
  if (!composition.metrics.length) sections = sections.filter((s) => s !== 'metrics');
  if (!composition.insights.length) sections = sections.filter((s) => s !== 'insights');
  return sections;
}

function deskComponents(sections: string[], interactive: boolean): Component[] {
  const im = String(interactive);
  const all: Record<string, Component[]> = {
    task_header: [
      {
        id: 'task_header',
        component: 'DeskTaskHeader',
        taskLabel: ref('/desk/task/label'),
        headline: ref('/desk/task/headline'),
        detail: ref('/desk/task/detail'),
        engineBadge: ref('/desk/ambient/engineBadge'),
      },
    ],
    metrics: [
      { id: 'metrics', component: 'DeskMetricRow', items: { componentId: 'metric', path: '/desk/metrics' } },
      { id: 'metric', component: 'DeskMetric', label: ref('label'), value: ref('value') },
    ],
    insights: [
      { id: 'insights', component: 'DeskInsightList', items: { componentId: 'insight', path: '/desk/insights' }, interactiveMode: im },
      {
        id: 'insight',
        component: 'DeskInsight',
        insightId: ref('id'),
        kind: ref('kind'),
        tone: ref('tone'),
        title: ref('title'),
        body: ref('body'),
        actionLabel: ref('actionLabel'),
        interactiveMode: im,
        action: event(DeskA2uiActions.INSIGHT_ACTION, { name: ref('actionName'), id: ref('id') }),
        snoozeAction: event(DeskA2uiActions.SNOOZE_INSIGHT, { id: ref('id') }),
      },
    ],
    intent_card: [
      {
        id: 'intent_card',
        component: 'DeskIntentCard',
        eyebrow: ref('/desk/intent/eyebrow'),
        goal: ref('/desk/intent/goal'),
        audience: ref('/desk/intent/audience'),
        tone: ref('/desk/intent/tone'),
        boundaries: ref('/desk/intent/boundaries'),
        briefHighlights: ref('/desk/intent/briefHighlights'),
      },
    ],
    starter_card: [
      {
        id: 'starter_card',
        component: 'DeskStarterCard',
        eyebrow: ref('/desk/starter/eyebrow'),
        starterText: ref('/desk/starter/starterText'),
        recallQuestion: ref('/desk/starter/recallQuestion'),
        continuityTitle: ref('/desk/starter/continuityTitle'),
        continuityBody: ref('/desk/starter/continuityBody'),
        interactiveMode: im,
        useStarterAction: event(DeskA2uiActions.USE_STARTER, { starterText: ref('/desk/starter/starterText') }),
        nextAngleAction: event(DeskA2uiActions.NEXT_ANGLE),
        startFocusAction: event(DeskA2uiActions.START_FOCUS),
      },
    ],
    theme_pace_card: [
      {
        id: 'theme_pace_card',
        component: 'DeskThemePace',
        sessionTitle: ref('/desk/pace/sessionTitle'),
        cadenceSummary: ref('/desk/pace/cadenceSummary'),
        pageEstimateSummary: ref('/desk/pace/pageEstimateSummary'),
        draftProgressLabel: ref('/desk/pace/draftProgressLabel'),
        progressFraction: ref('/desk/pace/progressFraction'),
        untappedThemesCsv: ref('/desk/pace/untappedThemesCsv'),
        coveredThemesCsv: ref('/desk/pace/coveredThemesCsv'),
      },
    ],
    ambient_window_card: [
      {
        id: 'ambient_window_card',
        component: 'DeskAmbientWindow',
        dayWindow: ref('/desk/ambient/dayWindow'),
        ambientDetail: ref('/desk/ambient/ambientDetail'),
        engineBadge: ref('/desk/ambient/engineBadge'),
        interactiveMode: im,
        refreshAction: event(DeskA2uiActions.REFRESH_SURFACE),
        dismissAction: event(DeskA2uiActions.DISMISS_SURFACE),
      },
    ],
  };
  return [{ id: 'root', component: 'DeskColumn', children: sections, spacingDp: '10' }, ...sections.flatMap((s) => all[s])];
}

function deskData(input: DeskSurfaceInput): Record<string, unknown> {
  const { composition: c, companion: s } = input;
  return {
    task: { kind: c.task, label: c.taskLabel, headline: c.headline, detail: c.detail },
    metrics: c.metrics.map((m) => ({ id: m.id, label: m.label, value: m.value })),
    insights: c.insights.map((i) => ({
      id: i.id,
      kind: i.kind,
      tone: i.tone,
      title: i.title,
      body: i.body,
      actionLabel: i.action?.label ?? '',
      actionName: i.action?.name ?? '',
    })),
    intent: s?.intent ?? {},
    starter: s
      ? { eyebrow: 'Momentum & Sparks', ...s.starter }
      : {},
    pace: s
      ? {
          sessionTitle: s.pace.sessionTitle,
          cadenceSummary: s.pace.cadenceSummary,
          pageEstimateSummary: s.pace.pageEstimateSummary,
          draftProgressLabel: s.pace.draftProgressLabel,
          progressFraction: String(s.pace.progressFraction),
          untappedThemesCsv: s.pace.untappedThemes.join('|'),
          coveredThemesCsv: s.pace.coveredThemes.join('|'),
        }
      : {},
    ambient: { dayWindow: s?.ambient.dayWindow ?? '', ambientDetail: s?.ambient.ambientDetail ?? '', engineBadge: input.engineBadge },
  };
}

/**
 * Stateful per-processor agent: sends createSurface once, updateComponents only when a surface's
 * structure changes, and updateDataModel otherwise.
 */
export class DeskAgent {
  private created = new Set<string>();
  private structure = new Map<string, string>();
  private lastData = new Map<string, string>();

  reset() {
    this.created.clear();
    this.structure.clear();
    this.lastData.clear();
  }

  syncDesk(surfaceId: Exclude<SurfaceId, typeof SURFACES.glance>, input: DeskSurfaceInput): A2uiMessage[] {
    const sections = sectionsFor(input, surfaceId);
    return this.sync(surfaceId, deskComponents(sections, input.interactive), '/desk', deskData(input));
  }

  syncGlance(input: { composition: TaskComposition }): A2uiMessage[] {
    const c = input.composition;
    const items = [
      ...c.metrics.slice(0, 2).map((m) => ({ id: `m-${m.id}`, text: `${m.label} ${m.value}`, tone: 'neutral' })),
      ...c.insights.slice(0, 3).map((i) => ({ id: `i-${i.id}`, text: i.title, tone: i.tone })),
    ];
    const components: Component[] = [
      { id: 'root', component: 'DeskGlanceStrip', label: ref('/glance/label'), items: { componentId: 'chip', path: '/glance/items' } },
      { id: 'chip', component: 'DeskGlanceChip', text: ref('text'), tone: ref('tone') },
    ];
    return this.sync(SURFACES.glance, components, '/glance', { label: c.taskLabel, items });
  }

  private sync(surfaceId: string, components: Component[], path: string, value: Record<string, unknown>): A2uiMessage[] {
    const msgs: A2uiMessage[] = [];
    if (!this.created.has(surfaceId)) {
      msgs.push({ version: A2UI_VERSION, createSurface: { surfaceId, catalogId: DESK_CATALOG_ID, sendDataModel: true } });
      this.created.add(surfaceId);
    }
    // Data first, so components never bind to missing paths.
    const data = JSON.stringify(value);
    if (this.lastData.get(surfaceId) !== data) {
      msgs.push({ version: A2UI_VERSION, updateDataModel: { surfaceId, path, value } });
      this.lastData.set(surfaceId, data);
    }
    const sig = JSON.stringify(components);
    if (this.structure.get(surfaceId) !== sig) {
      msgs.push({ version: A2UI_VERSION, updateComponents: { surfaceId, components } });
      this.structure.set(surfaceId, sig);
    }
    return msgs;
  }
}
