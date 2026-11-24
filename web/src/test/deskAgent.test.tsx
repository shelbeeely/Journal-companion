// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MessageProcessor } from '@a2ui/web_core/v0_9';
import { A2uiSurface } from '@a2ui/react/v0_9';
import { DeskAgent, SURFACES, type DeskSurfaceInput } from '../core/a2ui/deskAgent';
import { deskCatalog } from '../a2ui/deskCatalog';
import type { TaskComposition } from '../core/insights';
import type { CompanionSurface } from '../core/deskContext';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const composition: TaskComposition = {
  task: 'arriving',
  taskLabel: 'Ready',
  headline: "Good evening — today's page is open",
  detail: 'Evening wind-down',
  metrics: [{ id: 'streak', label: 'Streak', value: '3d' }],
  insights: [
    { id: 'streak', kind: 'rhythm', priority: 0, tone: 'positive', title: '3-day streak', body: 'One page today keeps it going.' },
    { id: 'rain', kind: 'weather', priority: 0, tone: 'neutral', title: 'Rain this evening', body: 'Stay in.', action: { label: 'Refresh', name: 'refresh_weather' } },
  ],
};
const companion: CompanionSurface = {
  intent: { eyebrow: 'Project Context', goal: 'Write warmly.', audience: 'A friend', tone: 'Warm', boundaries: '', briefHighlights: '' },
  starter: { starterText: 'Walking past the shelf…', recallQuestion: 'What habit?', continuityTitle: 'Fresh notebook start', continuityBody: 'Session #1' },
  pace: { show: true, sessionTitle: 'Session #1 · 0 done', cadenceSummary: 'Daily rhythm', pageEstimateSummary: '', draftProgressLabel: '', progressFraction: 0, untappedThemes: ['friends'], coveredThemes: [] },
  ambient: { dayWindow: 'Evening wind-down · 6:00 PM', ambientDetail: 'Week 48', engineBadge: 'x' },
  usedAi: false,
};
const input: DeskSurfaceInput = { composition, companion, interactive: true, density: 'RICH', discreet: false, engineBadge: 'Desk agent · local' };

describe('DeskAgent', () => {
  it('emits Android-compatible v0.9 messages and only data updates when structure is unchanged', () => {
    const agent = new DeskAgent();
    const first = agent.syncDesk(SURFACES.desk, input);
    expect(first.map((m) => Object.keys(m).find((k) => k !== 'version'))).toEqual(['createSurface', 'updateDataModel', 'updateComponents']);
    expect(first[0]).toMatchObject({ version: 'v0.9', createSurface: { catalogId: 'https://journalcompanion.local/catalogs/desk/v1/catalog.json' } });
    const comps = (first[2] as any).updateComponents.components as any[];
    expect(comps.map((c) => c.component)).toEqual(expect.arrayContaining(['DeskColumn', 'DeskStarterCard', 'DeskIntentCard', 'DeskThemePace', 'DeskAmbientWindow', 'DeskInsightList']));
    expect(comps.find((c) => c.id === 'starter_card').starterText).toEqual({ path: '/desk/starter/starterText' });

    const again = agent.syncDesk(SURFACES.desk, { ...input, composition: { ...composition, headline: 'Changed' } });
    expect(again.map((m) => Object.keys(m).find((k) => k !== 'version'))).toEqual(['updateDataModel']);
    expect(agent.syncDesk(SURFACES.desk, { ...input, composition: { ...composition, headline: 'Changed' } })).toEqual([]);
  });

  it('drops intent card in discreet mode and context surfaces have no companion sections', () => {
    const agent = new DeskAgent();
    const d = agent.syncDesk(SURFACES.desk, { ...input, discreet: true });
    const names = ((d.find((m) => 'updateComponents' in m) as any).updateComponents.components as any[]).map((c) => c.component);
    expect(names).not.toContain('DeskIntentCard');
    const c = agent.syncDesk(SURFACES.context, { ...input, companion: null });
    const cnames = ((c.find((m) => 'updateComponents' in m) as any).updateComponents.components as any[]).map((x) => x.component);
    expect(cnames).not.toContain('DeskStarterCard');
  });

  it('renders through the official A2UI renderer and dispatches actions', async () => {
    const actions: { name: string; context: Record<string, unknown> }[] = [];
    const errors: unknown[] = [];
    const processor = new MessageProcessor([deskCatalog], (a) => {
      actions.push({ name: a.name, context: a.context });
    }, { reportErrorsOnly: true, errorHandler: (e) => errors.push(e) });
    const agent = new DeskAgent();
    processor.processMessages(agent.syncDesk(SURFACES.desk, input) as never);
    processor.processMessages(agent.syncGlance({ composition }) as never);
    expect(errors).toEqual([]);

    const el = document.createElement('div');
    document.body.appendChild(el);
    await act(async () => {
      createRoot(el).render(
        <>
          <A2uiSurface surface={processor.model.surfacesMap.get(SURFACES.desk)! as never} />
          <A2uiSurface surface={processor.model.surfacesMap.get(SURFACES.glance)! as never} />
        </>,
      );
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(el.textContent).toContain("Good evening — today's page is open");
    expect(el.textContent).toContain('3-day streak');
    expect(el.textContent).toContain('Walking past the shelf');
    expect(el.querySelectorAll('[data-insight]')).toHaveLength(2);
    expect(el.querySelector('[data-testid=glance_strip]')?.textContent).toContain('Streak 3d');

    const click = async (target: Element | null) => {
      await act(async () => {
        (target as HTMLElement).click();
        await new Promise((r) => setTimeout(r, 10));
      });
    };
    await click(el.querySelector('[data-testid=a2_use_starter]'));
    await click(el.querySelector('[data-insight=rain] .btn'));
    await click(el.querySelector('[data-insight=streak] .a2-snooze'));
    expect(actions).toEqual([
      { name: 'use_starter', context: { starterText: 'Walking past the shelf…' } },
      { name: 'insight_action', context: { name: 'refresh_weather', id: 'rain' } },
      { name: 'snooze_insight', context: { id: 'streak' } },
    ]);

    // Live data update re-renders without new components.
    await act(async () => {
      processor.processMessages(agent.syncDesk(SURFACES.desk, { ...input, composition: { ...composition, headline: 'Writing' } }) as never);
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(el.textContent).toContain('Writing');
  });
});
