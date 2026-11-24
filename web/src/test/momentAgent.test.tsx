// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MessageProcessor } from '@a2ui/web_core/v0_9';
import { A2uiSurface } from '@a2ui/react/v0_9';
import { deskCatalog } from '../a2ui/deskCatalog';
import { MomentAgent, momentComponents, snapshotMessages, surfaceIdFor, validateLayout } from '../core/a2ui/momentAgent';
import type { Suggestion } from '../core/context/moments';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const s: Suggestion = {
  key: 'outing:calendar_google:c1',
  moment: 'outing',
  title: 'Leave by 3:02 PM for Coffee with Sam',
  summary: '70% chance of rain from 3:00 PM · 18 min drive',
  priority: 92,
  window: { from: Date.now(), to: Date.now() + 40 * 60_000 },
  evidence: [
    { id: 'calendar_google:c1', sourceId: 'calendar_google', sourceLabel: 'Google Calendar', text: 'Coffee with Sam · 3:30 PM', fetchedAt: Date.now() - 5 * 60_000, origin: 'data' },
    { id: 'weather:hourly', sourceId: 'weather', sourceLabel: 'Weather & air', text: 'Rain, 9°C, 70% rain at 3:00 PM', fetchedAt: Date.now(), origin: 'data', stale: true },
    { id: 'time:golden', sourceId: 'clock', sourceLabel: 'Clock & calendar', text: 'Golden hour — sunset at 4:25 PM', origin: 'time' },
  ],
  reasons: ['Coffee with Sam at 3:30 PM · Google Calendar'],
  missing: [{ sourceId: 'transit_transitland', text: 'Connect transit for departures.' }],
  sections: {
    event: { title: 'Coffee with Sam', time: '3:30–4:30 PM', place: 'Victrola Coffee', leaveBy: '3:02 PM', travel: '18 min drive' },
    hourly: { label: 'Weather during Coffee with Sam', note: '70% chance of rain from 3:00 PM', points: [{ time: '3:00 PM', temp: 9, pop: 70, condition: 'Rain' }, { time: '4:00 PM', temp: 8, pop: 60, condition: 'Rain' }] },
    checklist: { title: 'Before you go', items: [{ text: 'Bring Sam the book', source: 'Todoist', done: false }] },
    memory: { quote: 'Sam told me about Victrola.', attribution: 'You wrote this on Nov 2' },
    prompt: 'What do you want to ask Sam?',
  },
  actions: [{ label: 'Open event', name: 'open_url', value: 'https://cal/1' }],
};

describe('MomentAgent', () => {
  it('builds always-honest layouts and validates AI layouts', () => {
    const ids = (o: Parameters<typeof momentComponents>[1]) => (momentComponents(s, o)[0].children as string[]);
    expect(ids({ interactive: true, simplified: false, saved: false })).toEqual(['header', 'event', 'hourly', 'checklist', 'memory', 'prompt', 'missing', 'actions', 'evidence', 'controls']);
    expect(ids({ interactive: true, simplified: true, saved: false })).toEqual(['header', 'event', 'missing', 'actions', 'evidence', 'controls']);
    // AI may reorder/omit content, but header/evidence/controls stay and AI text is isolated in AiNote.
    const layout = validateLayout(['hourly', 'event'], s.sections)!;
    expect(ids({ interactive: true, simplified: false, saved: false, layout, aiNote: 'Bring an umbrella.' })).toEqual(['header', 'ai_note', 'hourly', 'event', 'missing', 'actions', 'evidence', 'controls']);
    expect(validateLayout(['hourly', 'fireworks'], s.sections)).toBeNull();
    expect(validateLayout(['media'], s.sections)).toBeNull(); // not available for this suggestion
    // Saved snapshots are read-only.
    expect(ids({ interactive: false, simplified: false, saved: true })).toEqual(['header', 'event', 'hourly', 'checklist', 'memory', 'prompt', 'evidence']);
  });

  it('renders through the A2UI renderer and dispatches card actions', async () => {
    const actions: { name: string; context: Record<string, unknown> }[] = [];
    const errors: unknown[] = [];
    const p = new MessageProcessor([deskCatalog], (a) => {
      actions.push({ name: a.name, context: a.context });
    }, { reportErrorsOnly: true, errorHandler: (e) => errors.push(e) });
    const agent = new MomentAgent();
    const id = surfaceIdFor(s.key);
    p.processMessages(agent.sync(s, { interactive: true, simplified: false, saved: false, aiNote: 'Rain starts as you leave — bring an umbrella.' }) as never);
    expect(errors).toEqual([]);
    const el = document.createElement('div');
    document.body.appendChild(el);
    await act(async () => {
      createRoot(el).render(<A2uiSurface surface={p.model.surfacesMap.get(id)! as never} />);
      await new Promise((r) => setTimeout(r, 30));
    });
    const text = el.textContent!;
    expect(text).toContain('Leave by 3:02 PM');
    expect(text).toContain('Bring Sam the book');
    expect(text).toContain('AI interpretation');
    expect(text).toContain('Why am I seeing this?');
    expect(text).toContain('may be out of date');
    expect(el.querySelectorAll('.m-hour')).toHaveLength(2);
    const click = async (sel: string, text?: string) => {
      const target = [...el.querySelectorAll(sel)].find((b) => !text || b.textContent?.includes(text)) as HTMLElement;
      await act(async () => {
        target.click();
        await new Promise((r) => setTimeout(r, 10));
      });
    };
    await click('.m-actions .btn', 'Open event');
    await click('.m-prompt .btn');
    await click('.m-controls .btn', 'Simplify');
    await click('.m-controls .btn', 'Snooze');
    await click('.m-snooze-menu button', 'tomorrow');
    await click('.m-missing-row .btn');
    await click('.m-controls .icon-btn');
    expect(actions.map((a) => [a.name, a.context.name ?? a.context.choice ?? a.context.sourceId ?? null])).toEqual([
      ['moment_action', 'open_url'],
      ['moment_action', 'reflect'],
      ['moment_simplify', null],
      ['moment_snooze', 'tomorrow'],
      ['moment_connect', 'transit_transitland'],
      ['moment_dismiss', null],
    ]);
    expect(actions[0].context).toMatchObject({ key: s.key, value: 'https://cal/1' });
    // Data-only update when nothing structural changes.
    expect(agent.sync({ ...s, summary: 'Changed' }, { interactive: true, simplified: false, saved: false, aiNote: 'Rain starts as you leave — bring an umbrella.' }).map((m) => Object.keys(m)[1])).toEqual(['updateDataModel']);
  });

  it('produces self-contained snapshots for saved views', async () => {
    const p = new MessageProcessor([deskCatalog], undefined, { reportErrorsOnly: true });
    p.processMessages(snapshotMessages(s, { interactive: false, simplified: false, saved: true, savedAtLabel: 'Saved Nov 24' }, Date.now(), 'saved_1') as never);
    const el = document.createElement('div');
    await act(async () => {
      createRoot(el).render(<A2uiSurface surface={p.model.surfacesMap.get('saved_1')! as never} />);
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(el.textContent).toContain('Coffee with Sam');
    expect(el.querySelector('.m-controls')).toBeNull();
  });
});
