import { MOMENT_LABELS, type Suggestion, type SuggestionSections } from '../context/moments';
import { A2UI_VERSION, DESK_CATALOG_ID, type A2uiMessage } from './deskAgent';

/**
 * Turns a cross-source `Suggestion` into a task-specific A2UI surface built only from the
 * controlled desk catalog. One surface per suggestion; data-only changes send `updateDataModel`.
 *
 * Honesty rules baked into the layout:
 * - the header, the "Why am I seeing this?" evidence list and the controls are always present;
 * - AI text only ever appears in an `AiNote` component, which is labelled as interpretation;
 * - an AI-proposed layout can reorder or omit content sections, never invent new ones.
 */

export const MOMENT_EVENTS = {
  ACTION: 'moment_action',
  SNOOZE: 'moment_snooze',
  DISMISS: 'moment_dismiss',
  SAVE: 'moment_save',
  SIMPLIFY: 'moment_simplify',
  CONNECT: 'moment_connect',
} as const;

/** Content sections the catalog can render (and that an AI layout may choose among). */
export const CONTENT_SECTIONS = ['event', 'hourly', 'media', 'checklist', 'project', 'timeline', 'memory', 'extras', 'prompt'] as const;
export type ContentSection = (typeof CONTENT_SECTIONS)[number];

type Component = Record<string, unknown> & { id: string; component: string };
const ref = (path: string) => ({ path });
const event = (name: string, context?: Record<string, unknown>) => ({ event: context ? { name, context } : { name } });

export function surfaceIdFor(key: string): string {
  return `moment_${key.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80)}`;
}

export interface MomentRenderOptions {
  interactive: boolean;
  simplified: boolean;
  saved: boolean;
  aiNote?: string | null;
  /** Validated AI layout (subset/order of CONTENT_SECTIONS), or null for the deterministic one. */
  layout?: ContentSection[] | null;
  /** Shown on saved snapshots. */
  savedAtLabel?: string;
}

function available(s: SuggestionSections): ContentSection[] {
  return CONTENT_SECTIONS.filter((k) => {
    const v = s[k];
    if (!v) return false;
    if (k === 'hourly') return (s.hourly?.points.length ?? 0) > 0;
    if (k === 'media') return (s.media?.picks.length ?? 0) > 0;
    if (k === 'checklist') return (s.checklist?.items.length ?? 0) > 0;
    if (k === 'timeline') return (s.timeline?.rows.length ?? 0) > 0;
    if (k === 'extras') return (s.extras?.lines.length ?? 0) > 0;
    return true;
  });
}

/** Keeps only known, available sections from an AI-proposed layout (in its order). */
export function validateLayout(proposed: unknown, s: SuggestionSections): ContentSection[] | null {
  if (!Array.isArray(proposed)) return null;
  const avail = new Set(available(s));
  const out: ContentSection[] = [];
  for (const p of proposed) {
    if (typeof p !== 'string' || !avail.has(p as ContentSection) || out.includes(p as ContentSection)) return null; // any invalid entry → reject the whole layout
    out.push(p as ContentSection);
  }
  return out.length ? out : null;
}

function sectionComponents(sec: ContentSection, interactive: boolean): Component[] {
  const im = String(interactive);
  switch (sec) {
    case 'event':
      return [{ id: 'event', component: 'EventPrep', title: ref('/m/event/title'), time: ref('/m/event/time'), place: ref('/m/event/place'), leaveBy: ref('/m/event/leaveBy'), travel: ref('/m/event/travel') }];
    case 'hourly':
      return [
        { id: 'hourly', component: 'HourlyStrip', label: ref('/m/hourly/label'), note: ref('/m/hourly/note'), items: { componentId: 'hour', path: '/m/hourly/points' } },
        { id: 'hour', component: 'HourCell', time: ref('time'), temp: ref('tempLabel'), pop: ref('popLabel'), condition: ref('condition') },
      ];
    case 'media':
      return [
        { id: 'media', component: 'MediaPicks', title: ref('/m/media/title'), items: { componentId: 'pick', path: '/m/media/picks' } },
        { id: 'pick', component: 'MediaPick', title: ref('title'), meta: ref('meta'), fits: ref('fits'), providers: ref('providers'), image: ref('image'), source: ref('source'), interactiveMode: im, openAction: event(MOMENT_EVENTS.ACTION, { key: ref('/m/key'), name: 'open_url', value: ref('url') }) },
      ];
    case 'checklist':
      return [
        { id: 'checklist', component: 'TaskChecklist', title: ref('/m/checklist/title'), items: { componentId: 'check', path: '/m/checklist/items' } },
        { id: 'check', component: 'ChecklistRow', text: ref('text'), source: ref('source'), done: ref('doneLabel') },
      ];
    case 'project':
      return [{ id: 'project', component: 'ProjectResume', title: ref('/m/project/title'), lastActivity: ref('/m/project/lastActivity'), excerpt: ref('/m/project/excerpt'), nextStep: ref('/m/project/nextStep'), files: ref('/m/project/filesCsv') }];
    case 'timeline':
      return [
        { id: 'timeline', component: 'DayTimeline', title: ref('/m/timeline/title'), items: { componentId: 'row', path: '/m/timeline/rows' } },
        { id: 'row', component: 'TimelineRow', time: ref('time'), text: ref('text'), source: ref('source'), kind: ref('kind') },
      ];
    case 'memory':
      return [{ id: 'memory', component: 'MemoryQuote', quote: ref('/m/memory/quote'), attribution: ref('/m/memory/attribution') }];
    case 'extras':
      return [
        { id: 'extras', component: 'ExtrasList', title: ref('/m/extras/title'), items: { componentId: 'extra', path: '/m/extras/lines' } },
        { id: 'extra', component: 'ExtraLine', text: ref('text'), source: ref('source') },
      ];
    case 'prompt':
      return [{ id: 'prompt', component: 'PromptSeed', prompt: ref('/m/prompt'), interactiveMode: im, useAction: event(MOMENT_EVENTS.ACTION, { key: ref('/m/key'), name: 'reflect', value: ref('/m/prompt') }) }];
  }
}

export function momentComponents(s: Suggestion, o: MomentRenderOptions): Component[] {
  const im = String(o.interactive);
  const avail = available(s.sections);
  let content: ContentSection[] = o.layout ?? avail;
  if (o.simplified) content = content.filter((c) => c !== 'prompt' && c !== 'extras').slice(0, 1);
  const children = ['header', ...(o.aiNote ? ['ai_note'] : []), ...content, ...(s.missing.length && !o.saved ? ['missing'] : []), ...(o.interactive && s.actions.length ? ['actions'] : []), 'evidence', ...(o.interactive ? ['controls'] : [])];
  const comps: Component[] = [
    { id: 'root', component: 'MomentColumn', children, simplified: String(o.simplified) },
    { id: 'header', component: 'MomentHeader', momentLabel: ref('/m/momentLabel'), title: ref('/m/title'), summary: ref('/m/summary'), timing: ref('/m/timing'), savedLabel: ref('/m/savedLabel') },
    ...content.flatMap((c) => sectionComponents(c, o.interactive)),
    {
      id: 'evidence',
      component: 'EvidenceList',
      items: { componentId: 'evidence_row', path: '/m/evidence' },
      count: ref('/m/evidenceCount'),
    },
    { id: 'evidence_row', component: 'EvidenceRow', text: ref('text'), source: ref('source'), freshness: ref('freshness'), origin: ref('origin'), stale: ref('staleLabel') },
  ];
  if (o.aiNote) comps.push({ id: 'ai_note', component: 'AiNote', text: ref('/m/aiNote'), basis: ref('/m/aiBasis') });
  if (s.missing.length && !o.saved) {
    comps.push(
      { id: 'missing', component: 'MissingSources', items: { componentId: 'missing_row', path: '/m/missing' } },
      { id: 'missing_row', component: 'MissingRow', text: ref('text'), interactiveMode: im, connectAction: event(MOMENT_EVENTS.CONNECT, { sourceId: ref('sourceId') }) },
    );
  }
  if (o.interactive && s.actions.length) {
    comps.push(
      { id: 'actions', component: 'ActionRow', items: { componentId: 'action_btn', path: '/m/actions' } },
      { id: 'action_btn', component: 'ActionButton', label: ref('label'), primary: ref('primary'), action: event(MOMENT_EVENTS.ACTION, { key: ref('/m/key'), name: ref('name'), value: ref('value') }) },
    );
  }
  if (o.interactive) {
    comps.push({
      id: 'controls',
      component: 'SurfaceControls',
      simplified: ref('/m/simplifiedLabel'),
      saved: ref('/m/savedFlag'),
      simplifyAction: event(MOMENT_EVENTS.SIMPLIFY, { key: ref('/m/key'), moment: ref('/m/moment') }),
      saveAction: event(MOMENT_EVENTS.SAVE, { key: ref('/m/key') }),
      dismissAction: event(MOMENT_EVENTS.DISMISS, { key: ref('/m/key'), moment: ref('/m/moment') }),
      snoozeHourAction: event(MOMENT_EVENTS.SNOOZE, { key: ref('/m/key'), moment: ref('/m/moment'), choice: 'hour' }),
      snoozeTonightAction: event(MOMENT_EVENTS.SNOOZE, { key: ref('/m/key'), moment: ref('/m/moment'), choice: 'tonight' }),
      snoozeTomorrowAction: event(MOMENT_EVENTS.SNOOZE, { key: ref('/m/key'), moment: ref('/m/moment'), choice: 'tomorrow' }),
      snoozeWeekendAction: event(MOMENT_EVENTS.SNOOZE, { key: ref('/m/key'), moment: ref('/m/moment'), choice: 'weekend' }),
    });
  }
  return comps;
}

function freshness(fetchedAt: number | undefined, now: number): string {
  if (!fetchedAt) return '';
  const m = Math.round((now - fetchedAt) / 60_000);
  if (m < 2) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

export function momentData(s: Suggestion, o: MomentRenderOptions, now: number): Record<string, unknown> {
  const sec = s.sections;
  const timing = s.window && s.window.to > now ? (() => {
    const mins = Math.round((s.window.to - now) / 60_000);
    return s.moment === 'outing' ? (mins < 60 ? `Starts in ${mins} min` : `Starts in ${Math.floor(mins / 60)}h ${mins % 60}m`) : '';
  })() : '';
  return {
    key: s.key,
    moment: s.moment,
    momentLabel: MOMENT_LABELS[s.moment],
    title: s.title,
    summary: s.summary,
    timing,
    savedLabel: o.savedAtLabel ?? '',
    savedFlag: String(o.saved),
    simplifiedLabel: String(o.simplified),
    aiNote: o.aiNote ?? '',
    aiBasis: o.aiNote ? 'AI interpretation of the evidence below — not a fact' : '',
    event: sec.event ? { title: sec.event.title, time: sec.event.time, place: sec.event.place ?? '', leaveBy: sec.event.leaveBy ?? '', travel: sec.event.travel ?? '' } : {},
    hourly: sec.hourly ? { label: sec.hourly.label, note: sec.hourly.note ?? '', points: sec.hourly.points.map((p) => ({ time: p.time, tempLabel: `${p.temp}°`, popLabel: p.pop != null && p.pop >= 20 ? `${p.pop}%` : '', condition: p.condition })) } : { points: [] },
    media: sec.media ? { title: sec.media.title, picks: sec.media.picks.map((p) => ({ ...p, url: p.url ?? '', image: p.image ?? '' })) } : { picks: [] },
    checklist: sec.checklist ? { title: sec.checklist.title, items: sec.checklist.items.map((i) => ({ text: i.text, source: i.source, doneLabel: String(i.done) })) } : { items: [] },
    project: sec.project ? { title: sec.project.title, lastActivity: sec.project.lastActivity, excerpt: sec.project.excerpt ?? '', nextStep: sec.project.nextStep ?? '', filesCsv: (sec.project.files ?? []).join('|') } : {},
    timeline: sec.timeline ? sec.timeline : { rows: [] },
    memory: sec.memory ?? {},
    extras: sec.extras ?? { lines: [] },
    prompt: sec.prompt ?? '',
    evidenceCount: String(s.evidence.length),
    evidence: s.evidence.map((e) => ({ text: e.text, source: e.sourceLabel, freshness: e.origin === 'time' ? 'now' : freshness(e.fetchedAt, now), origin: e.origin, staleLabel: String(!!e.stale) })),
    missing: s.missing.map((m) => ({ text: m.text, sourceId: m.sourceId })),
    actions: s.actions.map((a, i) => ({ label: a.label, name: a.name, value: a.value ?? '', primary: String(i === 0) })),
  };
}

/** Change-only emitter for moment surfaces (one instance per processor). */
export class MomentAgent {
  private created = new Set<string>();
  private structure = new Map<string, string>();
  private data = new Map<string, string>();

  sync(s: Suggestion, o: MomentRenderOptions, now = Date.now(), surfaceId = surfaceIdFor(s.key)): A2uiMessage[] {
    const msgs: A2uiMessage[] = [];
    if (!this.created.has(surfaceId)) {
      msgs.push({ version: A2UI_VERSION, createSurface: { surfaceId, catalogId: DESK_CATALOG_ID, sendDataModel: true } });
      this.created.add(surfaceId);
    }
    const value = momentData(s, o, now);
    const d = JSON.stringify(value);
    if (this.data.get(surfaceId) !== d) {
      msgs.push({ version: A2UI_VERSION, updateDataModel: { surfaceId, path: '/m', value } });
      this.data.set(surfaceId, d);
    }
    const comps = momentComponents(s, o);
    const c = JSON.stringify(comps);
    if (this.structure.get(surfaceId) !== c) {
      msgs.push({ version: A2UI_VERSION, updateComponents: { surfaceId, components: comps } });
      this.structure.set(surfaceId, c);
    }
    return msgs;
  }

  forget(surfaceId: string) {
    this.created.delete(surfaceId);
    this.structure.delete(surfaceId);
    this.data.delete(surfaceId);
  }
}

/** A full, self-contained message list (for saving an interface and re-rendering it later). */
export function snapshotMessages(s: Suggestion, o: MomentRenderOptions, now: number, surfaceId: string): A2uiMessage[] {
  return [
    { version: A2UI_VERSION, createSurface: { surfaceId, catalogId: DESK_CATALOG_ID, sendDataModel: false } },
    { version: A2UI_VERSION, updateDataModel: { surfaceId, path: '/m', value: momentData(s, o, now) } },
    { version: A2UI_VERSION, updateComponents: { surfaceId, components: momentComponents(s, o) } },
  ];
}
