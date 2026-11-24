import { lazy, Suspense, useMemo } from 'react';
import { SURFACES, type DeskSurfaceInput } from '../core/a2ui/deskAgent';
import { useStore } from '../state/store';
import { CompanionCard } from './deskCards';
import { Icon } from './icons';

// The A2UI renderer (Lit, Zod, signals) loads in its own chunk so first paint on phones doesn't wait for it.
const DeskRuntime = lazy(() => import('../a2ui/DeskRuntime'));

type Kind = 'desk' | 'context' | 'glance' | 'ambient';

/** Renders one of the task-aware A2UI surfaces composed by the local desk agent. */
export function ProactiveSurface({ kind }: { kind: Kind }) {
  const { state, actions } = useStore();
  const { composition, companion, preferences, engineBadge } = state;

  const input = useMemo<DeskSurfaceInput>(
    () => ({
      composition,
      companion: kind === 'context' ? null : companion,
      interactive: kind !== 'ambient',
      density: preferences.proactiveDensity,
      discreet: preferences.discreetDeskModeEnabled,
      engineBadge,
    }),
    [composition, companion, kind, preferences.proactiveDensity, preferences.discreetDeskModeEnabled, engineBadge],
  );
  const glance = useMemo(() => ({ composition }), [composition]);

  if (kind === 'desk' && state.companionDismissed) {
    return (
      <button className="btn outlined" style={{ width: '100%' }} onClick={actions.restoreCompanion}>
        <Icon name="spark" size={16} /> Show Desk Companion
      </button>
    );
  }

  const fallback =
    kind === 'desk' ? (
      <CompanionCard />
    ) : kind === 'glance' ? null : (
      <section className="card a2-card">
        <span className="badge">{composition.taskLabel}</span>
        <h2 className="a2-headline serif">{composition.headline}</h2>
      </section>
    );

  const runtime =
    kind === 'glance' ? (
      <DeskRuntime surfaceId={SURFACES.glance} glance={glance} onAction={actions.handleDeskAction} />
    ) : (
      <DeskRuntime surfaceId={kind === 'desk' ? SURFACES.desk : kind === 'ambient' ? SURFACES.ambient : SURFACES.context} input={input} onAction={actions.handleDeskAction} />
    );

  return (
    <Suspense fallback={fallback}>
      {kind === 'glance' ? (
        runtime
      ) : (
        <section className={`card a2-card ${kind === 'ambient' ? 'a2-ambient-card' : ''}`} aria-label={kind === 'desk' ? 'Desk Companion' : 'Right now'} data-testid={`surface_${kind}`}>
          {runtime}
        </section>
      )}
    </Suspense>
  );
}
